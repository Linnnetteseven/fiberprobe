/**
 * FiberEventEmitter — event-driven payment and invoice lifecycle for Fiber Network.
 *
 * The Fiber RPC does not expose a push-based subscription interface over the
 * standard JSON-RPC port. This module bridges that gap with per-item adaptive
 * polling: each watched payment, invoice, or channel gets its own backoff
 * schedule so recently-started items are checked frequently while long-running
 * ones are polled progressively less often.
 *
 * This is architecturally cleaner than a single global polling loop because:
 *  - Items at different lifecycle stages don't share a tick
 *  - Backoff is independent per item — a stale payment doesn't slow invoice checks
 *  - Callers receive a cancel function, giving them explicit lifecycle control
 *
 * @example
 * ```ts
 * const emitter = new FiberEventEmitter(client)
 *
 * // Watch a payment until it settles
 * const cancel = emitter.watchPayment('0xabc...', {
 *   onSettled: (payment) => console.log('Payment settled:', payment.status),
 *   onFailed:  (err)     => console.error('Payment failed:', err.suggestion),
 * })
 *
 * // Watch an invoice until it's paid
 * emitter.watchInvoice('0xdef...', {
 *   onPaid:    (invoice) => console.log('Paid!', invoice.invoice_address),
 *   onExpired: (invoice) => console.warn('Invoice expired'),
 * })
 *
 * // Clean up everything at once
 * emitter.destroy()
 * ```
 */

import type { FiberClient }   from '../client/index.js'
import type { Payment, InvoiceResult, Channel } from '../client/types.js'
import { FiberError }         from '../client/errors.js'

// ── Backoff configuration ─────────────────────────────────────────────────────

/**
 * Backoff profile controlling how poll intervals grow over time.
 * All durations are in milliseconds.
 */
export interface BackoffProfile {
  /** Initial polling interval. Default: 500ms */
  initialMs:  number
  /** Multiplier applied after each poll. Default: 1.5 */
  multiplier: number
  /** Maximum polling interval. Default: 10_000ms (10s) */
  maxMs:      number
  /** Maximum number of poll attempts before giving up. Default: 60 */
  maxAttempts: number
}

const DEFAULT_BACKOFF: BackoffProfile = {
  initialMs:   500,
  multiplier:  1.5,
  maxMs:       10_000,
  maxAttempts: 60,
}

// ── Payment watcher ───────────────────────────────────────────────────────────

export interface WatchPaymentOptions {
  /** Called when the payment reaches Success or Failed status. */
  onSettled?:  (payment: Payment) => void
  /** Called when the payment fails. Receives a structured FiberError. */
  onFailed?:   (error: FiberError, payment: Payment) => void
  /** Called on each poll while the payment is still Inflight. */
  onProgress?: (payment: Payment, attempt: number) => void
  /** Called when maxAttempts is reached without a terminal status. */
  onTimeout?:  (lastPayment: Payment | null) => void
  backoff?:    Partial<BackoffProfile>
}

// ── Invoice watcher ───────────────────────────────────────────────────────────

export interface WatchInvoiceOptions {
  /** Called when the invoice status becomes Paid. */
  onPaid?:     (invoice: InvoiceResult) => void
  /** Called when the invoice status becomes Expired or Cancelled. */
  onExpired?:  (invoice: InvoiceResult) => void
  /** Called on each poll while the invoice is still Open. */
  onProgress?: (invoice: InvoiceResult, attempt: number) => void
  /** Called when maxAttempts is reached without a terminal status. */
  onTimeout?:  (lastInvoice: InvoiceResult | null) => void
  backoff?:    Partial<BackoffProfile>
}

// ── Channel watcher ───────────────────────────────────────────────────────────

export interface WatchChannelOptions {
  /** Called when the channel reaches ChannelReady state. */
  onReady?:    (channel: Channel) => void
  /** Called when the channel reaches Closed state. */
  onClosed?:   (channel: Channel) => void
  /** Called on each poll while the channel is still opening. */
  onProgress?: (channel: Channel, attempt: number) => void
  /** Called when maxAttempts is reached without a terminal state. */
  onTimeout?:  (lastChannel: Channel | null) => void
  backoff?:    Partial<BackoffProfile>
}

/** Function returned by all watch methods. Call it to cancel the watcher. */
export type CancelFn = () => void

// ── Internal state ────────────────────────────────────────────────────────────

interface ActiveWatcher {
  id:      string
  timer:   ReturnType<typeof setTimeout> | null
  cancel:  () => void
}

// ── FiberEventEmitter ─────────────────────────────────────────────────────────

export class FiberEventEmitter {
  private readonly watchers = new Map<string, ActiveWatcher>()
  private watcherCount      = 0

  constructor(private readonly client: FiberClient) {}

  // ── Payment watcher ─────────────────────────────────────────────────────────

  /**
   * Polls get_payment until the payment reaches a terminal status (Success/Failed)
   * or maxAttempts is exhausted.
   *
   * @param paymentHash - The payment hash to watch
   * @param options     - Callbacks and optional backoff overrides
   * @returns           A cancel function — call it to stop polling immediately
   */
  watchPayment(paymentHash: string, options: WatchPaymentOptions = {}): CancelFn {
    const profile  = this.resolveProfile(options.backoff)
    const watchId  = `payment:${paymentHash}:${++this.watcherCount}`
    let   interval = profile.initialMs
    let   attempts = 0
    let   lastPayment: Payment | null = null

    const poll = async (): Promise<void> => {
      if (!this.watchers.has(watchId)) return

      attempts++

      try {
        const payment = await this.client.getPayment(paymentHash)
        lastPayment   = payment

        if (payment.status === 'Success') {
          options.onSettled?.(payment)
          this.cleanup(watchId)
          return
        }

        if (payment.status === 'Failed') {
          const raw  = payment.failed_error ?? 'Payment failed with no error detail'
          const err  = FiberError.parse(raw)
          options.onFailed?.(err, payment)
          options.onSettled?.(payment)
          this.cleanup(watchId)
          return
        }

        // Still Inflight or Created
        options.onProgress?.(payment, attempts)

      } catch (err) {
        // RPC errors are non-fatal during polling — the node may be briefly busy
        // We continue polling until maxAttempts, then surface via onTimeout
      }

      if (attempts >= profile.maxAttempts) {
        options.onTimeout?.(lastPayment)
        this.cleanup(watchId)
        return
      }

      // Schedule next poll with backoff
      interval          = Math.min(interval * profile.multiplier, profile.maxMs)
      const watcher     = this.watchers.get(watchId)
      if (watcher) {
        watcher.timer   = setTimeout(() => { void poll() }, interval)
      }
    }

    const timer   = setTimeout(() => { void poll() }, interval)
    const cancel  = () => this.cleanup(watchId)
    this.watchers.set(watchId, { id: watchId, timer, cancel })

    return cancel
  }

  // ── Invoice watcher ─────────────────────────────────────────────────────────

  /**
   * Polls get_invoice until the invoice is Paid, Expired, or Cancelled,
   * or maxAttempts is exhausted.
   *
   * @param paymentHash - The payment hash identifying the invoice to watch
   * @param options     - Callbacks and optional backoff overrides
   * @returns           A cancel function
   */
  watchInvoice(paymentHash: string, options: WatchInvoiceOptions = {}): CancelFn {
    const profile  = this.resolveProfile(options.backoff)
    const watchId  = `invoice:${paymentHash}:${++this.watcherCount}`
    let   interval = profile.initialMs
    let   attempts = 0
    let   lastInvoice: InvoiceResult | null = null

    const poll = async (): Promise<void> => {
      if (!this.watchers.has(watchId)) return

      attempts++

      try {
        const invoice = await this.client.getInvoice(paymentHash)
        lastInvoice   = invoice

        if (invoice.status === 'Paid') {
          options.onPaid?.(invoice)
          this.cleanup(watchId)
          return
        }

        if (invoice.status === 'Expired' || invoice.status === 'Cancelled') {
          options.onExpired?.(invoice)
          this.cleanup(watchId)
          return
        }

        // Still Open or Received
        options.onProgress?.(invoice, attempts)

      } catch {
        // Continue polling on transient RPC errors
      }

      if (attempts >= profile.maxAttempts) {
        options.onTimeout?.(lastInvoice)
        this.cleanup(watchId)
        return
      }

      interval        = Math.min(interval * profile.multiplier, profile.maxMs)
      const watcher   = this.watchers.get(watchId)
      if (watcher) {
        watcher.timer = setTimeout(() => { void poll() }, interval)
      }
    }

    const timer   = setTimeout(() => { void poll() }, interval)
    const cancel  = () => this.cleanup(watchId)
    this.watchers.set(watchId, { id: watchId, timer, cancel })

    return cancel
  }

  // ── Channel watcher ─────────────────────────────────────────────────────────

  /**
   * Polls list_channels filtered to a specific channel_id until the channel
   * reaches ChannelReady or Closed, or maxAttempts is exhausted.
   *
   * Useful for giving users feedback during the channel-opening flow without
   * requiring them to poll manually.
   *
   * @param channelId - The channel_id to watch
   * @param options   - Callbacks and optional backoff overrides
   * @returns         A cancel function
   */
  watchChannel(channelId: string, options: WatchChannelOptions = {}): CancelFn {
    const profile  = this.resolveProfile(options.backoff)
    const watchId  = `channel:${channelId}:${++this.watcherCount}`
    let   interval = profile.initialMs
    let   attempts = 0
    let   lastChannel: Channel | null = null

    const poll = async (): Promise<void> => {
      if (!this.watchers.has(watchId)) return

      attempts++

      try {
        const channels = await this.client.listChannels({ include_closed: true })
        const channel  = channels.find((c) => c.channel_id === channelId)

        if (!channel) {
          // Channel not yet visible — keep polling
          options.onProgress?.(null as unknown as Channel, attempts)
        } else {
          lastChannel = channel

          if (channel.state === 'ChannelReady') {
            options.onReady?.(channel)
            this.cleanup(watchId)
            return
          }

          if (channel.state === 'Closed') {
            options.onClosed?.(channel)
            this.cleanup(watchId)
            return
          }

          options.onProgress?.(channel, attempts)
        }

      } catch {
        // Continue on transient errors
      }

      if (attempts >= profile.maxAttempts) {
        options.onTimeout?.(lastChannel)
        this.cleanup(watchId)
        return
      }

      interval        = Math.min(interval * profile.multiplier, profile.maxMs)
      const watcher   = this.watchers.get(watchId)
      if (watcher) {
        watcher.timer = setTimeout(() => { void poll() }, interval)
      }
    }

    const timer   = setTimeout(() => { void poll() }, interval)
    const cancel  = () => this.cleanup(watchId)
    this.watchers.set(watchId, { id: watchId, timer, cancel })

    return cancel
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  /**
   * Returns the number of currently active watchers.
   * Useful for debugging and testing.
   */
  get activeWatcherCount(): number {
    return this.watchers.size
  }

  /**
   * Cancels all active watchers and clears all timers.
   * Call this when tearing down the application or component.
   */
  destroy(): void {
    for (const watcher of this.watchers.values()) {
      if (watcher.timer !== null) clearTimeout(watcher.timer)
    }
    this.watchers.clear()
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private cleanup(watchId: string): void {
    const watcher = this.watchers.get(watchId)
    if (watcher?.timer !== null) clearTimeout(watcher!.timer)
    this.watchers.delete(watchId)
  }

  private resolveProfile(override?: Partial<BackoffProfile>): BackoffProfile {
    return { ...DEFAULT_BACKOFF, ...override }
  }
}
