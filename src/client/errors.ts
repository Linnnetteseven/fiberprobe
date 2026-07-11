/**
 * FiberError — typed error hierarchy for Fiber RPC failures.
 *
 * The Fiber RPC returns payment failures as raw `failed_error` strings.
 * This module parses those strings into structured, actionable error
 * classes so application code can branch on error type and surface
 * meaningful messages to developers and users.
 *
 * @example
 * ```ts
 * const err = FiberError.parse(payment.failed_error)
 * if (err instanceof InsufficientCapacityError) {
 *   console.log(err.suggestion)
 * }
 * ```
 */

// ── Base class ────────────────────────────────────────────────────────────────

export abstract class FiberError extends Error {
  abstract readonly code:       string
  abstract readonly suggestion: string
  readonly raw?: string

  constructor(message: string, raw?: string) {
    super(message)
    this.name = this.constructor.name
    if (raw !== undefined){
    this.raw  = raw
    }
    Object.setPrototypeOf(this, new.target.prototype)
  }

  /**
   * Parse a raw Fiber RPC failed_error string into a typed FiberError.
   * Matches against known error patterns using normalised lowercase comparison.
   *
   * @param raw - The failed_error string from a Payment or RPC response
   */
  static parse(raw: string): FiberError {
    const n = raw.toLowerCase()

    if (n.includes('no_route')        ||
        n.includes('noroute')         ||
        n.includes('unknown_next_peer')) {
      return new RouteNotFoundError(raw)
    }
    if (n.includes('insufficient') || n.includes('capacity')) {
      return new InsufficientCapacityError(raw)
    }
    if (n.includes('temporary_channel_failure') ||
        n.includes('temporarychannelfailure')) {
      return new TemporaryChannelFailureError(raw)
    }
    if ((n.includes('peer') || n.includes('node')) &&
        (n.includes('unreachable') ||
         n.includes('disconnected') ||
         n.includes('not_connected'))) {
      return new PeerUnreachableError(raw)
    }
    if (n.includes('timeout') || n.includes('expir')) {
      return new PaymentTimeoutError(raw)
    }
    if (n.includes('fee')) {
      return new FeeInsufficientError(raw)
    }
    if (n.includes('amount') && n.includes('minimum')) {
      return new AmountBelowMinimumError(raw)
    }

    return new UnknownFiberError(raw)
  }
}

// ── Concrete error types ──────────────────────────────────────────────────────

export class RouteNotFoundError extends FiberError {
  readonly code       = 'ROUTE_NOT_FOUND'
  readonly suggestion =
    'No payment route exists to the destination. Verify the recipient ' +
    'has at least one open, public channel with sufficient inbound capacity, ' +
    'and that your node is connected to the Fiber network.'
  constructor(raw?: string) {
    super('No route found to the payment destination.', raw)
  }
}

export class InsufficientCapacityError extends FiberError {
  readonly code       = 'INSUFFICIENT_CAPACITY'
  readonly suggestion =
    'Outbound channel capacity is too low for this amount plus fees. ' +
    'Open a new channel with more funding, or ask your peer to push ' +
    'liquidity to your side on an existing channel.'
  constructor(raw?: string) {
    super('Insufficient outbound capacity to route this payment.', raw)
  }
}

export class TemporaryChannelFailureError extends FiberError {
  readonly code       = 'TEMPORARY_CHANNEL_FAILURE'
  readonly suggestion =
    'A channel on the route reported a transient failure. ' +
    'This is usually self-resolving — wait a few seconds and retry.'
  constructor(raw?: string) {
    super('A channel on the payment route reported a temporary failure.', raw)
  }
}

export class PeerUnreachableError extends FiberError {
  readonly code       = 'PEER_UNREACHABLE'
  readonly suggestion =
    'The destination peer appears offline or disconnected. ' +
    'Check your own node connectivity, then verify the recipient node ' +
    'is reachable on the Fiber network before retrying.'
  constructor(raw?: string) {
    super('The destination peer is unreachable.', raw)
  }
}

export class PaymentTimeoutError extends FiberError {
  readonly code       = 'PAYMENT_TIMEOUT'
  readonly suggestion =
    'The payment timed out before the destination acknowledged it. ' +
    'Retry with a higher timeout value or during quieter network conditions.'
  constructor(raw?: string) {
    super('Payment timed out before completion.', raw)
  }
}

export class FeeInsufficientError extends FiberError {
  readonly code       = 'FEE_INSUFFICIENT'
  readonly suggestion = 'The fee offered was rejected by a node on the route. Increase max_fee_amount and retry.'
  constructor(raw?: string) {
    super('Fee was insufficient for the discovered payment route.', raw)
  }
}

export class AmountBelowMinimumError extends FiberError {
  readonly code       = 'AMOUNT_BELOW_MINIMUM'
  readonly suggestion =
    'The payment amount is below the minimum TLC value enforced by ' +
    'one or more channels on the route. Try a larger amount.'
  constructor(raw?: string) {
    super('Payment amount is below the channel minimum.', raw)
  }
}

export class UnknownFiberError extends FiberError {
  readonly code       = 'UNKNOWN'
  readonly suggestion = 'An unrecognised error was returned by the Fiber node. Inspect the raw field for the original error string.'
  constructor(raw?: string) {
    super('An unknown Fiber error occurred.', raw)
  }
}
