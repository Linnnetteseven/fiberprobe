/**
 * PaymentChecker — pre-flight payment feasibility analysis for Fiber Network.
 *
 * Solves two problems that every Fiber application faces:
 *
 *  1. canPay()     — Will this payment succeed before I try to send it?
 *  2. canReceive() — Do I have enough inbound capacity to receive a payment?
 *
 * canPay() uses the FNN RPC dry_run flag on send_payment to validate routing
 * without broadcasting, then cross-references graph_channels to score
 * per-hop liquidity and produce a 0–100 confidence value.
 *
 * canReceive() scans open ChannelReady channels and sums usable inbound
 * capacity, correctly accounting for in-flight received TLCs.
 */

import type { FiberClient }          from '../client/index.js'
import type { Channel, GraphChannel, Payment } from '../client/types.js'
import { FiberError }                from '../client/errors.js'

// ── Public types ──────────────────────────────────────────────────────────────

export interface CanPayParams {
  /** Fiber invoice string (fibb… / fibt… / fibd…) */
  invoice: string
  /**
   * Maximum fee in shannon (hex string).
   * The node rejects routes whose total fee exceeds this value.
   */
  maxFeeAmount?: string
  /**
   * Dry-run timeout in seconds. Defaults to 30.
   * Increase on testnet where routing can be slower.
   */
  timeout?: number
}

export interface PaymentCheckResult {
  /** Whether a valid route was found and the payment appears feasible. */
  canPay: boolean
  /**
   * Confidence score: 0–100.
   *
   *   80–100  High.     Route is liquid, short, and well-capitalised.
   *   60–79   Moderate. Route found but some liquidity is uncertain.
   *   30–59   Low.      Route exists but liquidity is thin or unverifiable.
   *   0       None.     No route found, or payment will definitely fail.
   *
   * Note: 100 does not guarantee success — balances can shift between
   * check and send. Treat this as a probability signal, not a promise.
   */
  confidence: number
  /** Estimated total fee in shannon (hex). Present when canPay is true. */
  estimatedFee?: string
  /** Number of hops on the discovered route. Present when canPay is true. */
  hopCount?: number
  /** Human-readable issues identified during analysis. */
  issues: string[]
  /**
   * Structured error describing why the payment cannot proceed.
   * Present only when canPay is false.
   */
  error?: FiberError
}

export interface CanReceiveParams {
  /**
   * Amount in shannon to check receivability for (hex string).
   * Example: "0x174876e800" = 100 CKB = 100_000_000_000 shannon.
   */
  amount: string
  /**
   * Optional UDT type script hash for multi-asset capacity checks.
   * When omitted, checks CKB (native asset) inbound capacity only.
   */
  udtTypeScriptHash?: string
}

export interface ReceiveCheckResult {
  /** Whether total usable inbound capacity covers the requested amount. */
  canReceive: boolean
  /** Sum of usable inbound capacity across all active channels, in shannon. */
  totalInboundCapacity: bigint
  /** Number of ChannelReady + enabled channels contributing inbound capacity. */
  activeChannelCount: number
  /** Per-channel breakdown for operator diagnostics. */
  channelBreakdown: ChannelCapacityEntry[]
  /** Human-readable issues when canReceive is false, including shortfall amount. */
  issues: string[]
}

export interface ChannelCapacityEntry {
  channelId:     string
  peerId:        string
  /** Usable inbound capacity on this channel in shannon. */
  usableInbound: bigint
  /** Whether this channel is currently enabled for forwarding. */
  isEnabled:     boolean
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Parse a hex-encoded u128 RPC value into a BigInt.
 * BigInt is used throughout to avoid floating-point precision loss
 * on large shannon values (CKB amounts can exceed Number.MAX_SAFE_INTEGER).
 */
function parseHexAmount(hex: string): bigint {
  if (!hex.startsWith('0x') && !hex.startsWith('0X')) {
    throw new Error(`Expected hex amount string, got: ${hex}`)
  }
  return BigInt(hex)
}

/**
 * Build a lookup index from channel outpoint → GraphChannel.
 * Constructed once per canPay() call to give O(1) access during hop scoring,
 * avoiding O(n) linear scans over the channel list for each hop.
 */
function buildGraphIndex(channels: GraphChannel[]): Map<string, GraphChannel> {
  return new Map(channels.map((ch) => [ch.channel_outpoint, ch]))
}

/**
 * Score a single payment route hop against public graph liquidity data.
 *
 * Scoring logic:
 *   Private channel (not in graph)       → 0.65  Cannot verify liquidity.
 *   In graph, no liquidity published      → 0.70  Operator chose not to advertise.
 *   In graph, zero liquidity reported     → 0.05  Almost certainly will fail.
 *   Liquidity ≥ 3× amount to forward     → 0.95  Well capitalised, high confidence.
 *   Liquidity ≥ 1.5× amount              → 0.82  Healthy margin.
 *   Liquidity ≥ 1× amount                → 0.65  Tight but passable.
 *   Liquidity < amount                   → 0.20  Stale data likely; risky.
 *
 * The minimum of both directional liquidity values is used because we cannot
 * determine precise hop direction from route node data alone — taking the
 * conservative minimum avoids overconfidence.
 */
function scoreHop(
  channelOutpoint: string,
  amountToForward: bigint,
  graphIndex: Map<string, GraphChannel>
): { score: number; issue?: string } {
  const channel = graphIndex.get(channelOutpoint)
  const shortId = channelOutpoint.slice(0, 14) + '…'

  if (!channel) {
    return {
      score: 0.65,
      issue: `Channel ${shortId} is private; liquidity cannot be verified`,
    }
  }

  const published = [
    channel.update_info_of_node1?.outbound_liquidity,
    channel.update_info_of_node2?.outbound_liquidity,
  ].filter((l): l is string => l !== undefined)

  if (published.length === 0) {
    return { score: 0.70 }
  }

  const liquidities  = published.map(parseHexAmount)
  const conservative = liquidities.reduce((a, b) => (a < b ? a : b))

  if (conservative === 0n) {
    return {
      score: 0.05,
      issue: `Channel ${shortId} reports zero outbound liquidity`,
    }
  }

  const ratio = Number(conservative) / Number(amountToForward)

  if (ratio >= 3.0) return { score: 0.95 }
  if (ratio >= 1.5) return { score: 0.82 }
  if (ratio >= 1.0) return { score: 0.65, issue: `Channel ${shortId} has tight liquidity` }

  return {
    score: 0.20,
    issue: `Channel ${shortId} may have insufficient liquidity for this amount`,
  }
}

/**
 * Compute an overall 0–100 confidence percentage from per-hop scores.
 *
 * Uses the minimum (weakest-link) score as the base — a payment fails
 * if ANY hop fails, so averaging scores would be misleading.
 * Applies a 3% penalty per additional hop beyond the first, reflecting
 * that longer routes have more independent failure points.
 */
function computeConfidence(hopScores: number[], hopCount: number): number {
  if (hopScores.length === 0) return 0
  const weakestHop = Math.min(...hopScores)
  const hopPenalty = Math.max(0, (hopCount - 1) * 0.03)
  return Math.round(Math.max(0, weakestHop - hopPenalty) * 100)
}

// ── PaymentChecker ────────────────────────────────────────────────────────────

/**
 * Pre-flight payment feasibility analysis for Fiber Network applications.
 *
 * @example
 * ```ts
 * const checker = new PaymentChecker(client)
 *
 * const result = await checker.canPay({ invoice: 'fibt...' })
 * if (!result.canPay) {
 *   console.error(result.error?.message)
 *   console.info(result.error?.suggestion)
 *   return
 * }
 * console.log(`Confidence: ${result.confidence}%  Fee: ${result.estimatedFee}`)
 *
 * const rx = await checker.canReceive({ amount: '0x174876e800' })
 * if (!rx.canReceive) console.warn('Low inbound capacity:', rx.issues)
 * ```
 */
export class PaymentChecker {
  constructor(private readonly client: FiberClient) {}

  /**
   * Performs a pre-flight feasibility check for an outgoing Fiber payment.
   *
   * Process:
   *   1. Calls send_payment with dry_run: true to validate routing and
   *      estimate fees without committing to the payment.
   *   2. Parses any failure into a typed FiberError with recovery guidance.
   *   3. Cross-references the discovered route against graph_channels to
   *      score per-hop liquidity and produce an overall confidence value.
   */
  async canPay(params: CanPayParams): Promise<PaymentCheckResult> {
    // Step 1: Dry-run through the Fiber router
    let payment: Payment
    try {
      payment = await this.client.sendPayment({
        invoice: params.invoice,
        dry_run: true,
        ...(params.maxFeeAmount !== undefined && { max_fee_amount: params.maxFeeAmount }),
        timeout: params.timeout ?? 30,
    })
    } catch (err) {
      const raw        = err instanceof Error ? err.message : String(err)
      const structured = FiberError.parse(raw)
      return { canPay: false, confidence: 0, issues: [structured.message], error: structured }
    }

    // Step 2: Check for a payment-level failure from the router
    if (payment.status === 'Failed') {
      const raw        = payment.failed_error ?? 'Payment failed with no error detail'
      const structured = FiberError.parse(raw)
      return { canPay: false, confidence: 0, issues: [structured.message], error: structured }
    }

    // Step 3: Extract the discovered route
    const route = payment.routers?.[0]
    if (!route?.nodes?.length) {
      return {
        canPay:       true,
        confidence:   75,
        estimatedFee: payment.fee,
        hopCount:     0,
        issues:       ['Route found but hop detail unavailable for confidence scoring'],
      }
    }

    // Step 4: Fetch graph channels and build O(1) lookup index
    const graphResult = await this.client.graphChannels(500)
    const graphIndex  = buildGraphIndex(graphResult.channels)

    // Step 5: Score each hop against published liquidity data
    const issues:    string[] = []
    const hopScores: number[] = []

    for (const node of route.nodes) {
      const amountToForward      = parseHexAmount(node.amount)
      const { score, issue }     = scoreHop(node.channel_outpoint, amountToForward, graphIndex)
      hopScores.push(score)
      if (issue) issues.push(issue)
    }

    // Step 6: Compute confidence and return
    const confidence = computeConfidence(hopScores, route.nodes.length)
    return {
      canPay:       true,
      confidence,
      estimatedFee: payment.fee,
      hopCount:     route.nodes.length,
      issues,
    }
  }

  /**
   * Checks whether this node has sufficient inbound capacity to receive a payment.
   *
   * Usable inbound per channel = remote_balance − received_tlc_balance.
   * remote_balance is the peer's current sendable amount.
   * received_tlc_balance is already committed inbound (in-flight HTLCs).
   * Only ChannelReady + enabled channels are included.
   */
  async canReceive(params: CanReceiveParams): Promise<ReceiveCheckResult> {
    const targetAmount = parseHexAmount(params.amount)
    const channels: Channel[] = await this.client.listChannels({ include_closed: false })

    const issues:    string[]               = []
    const breakdown: ChannelCapacityEntry[] = []
    let   total = 0n

    for (const ch of channels) {
      if (ch.state.state_name !== 'ChannelReady') continue

      // Asset filter: match UDT or CKB channels based on udtTypeScriptHash presence
      const isUdtChannel = ch.funding_udt_type_script !== undefined
      if (params.udtTypeScriptHash !== undefined && !isUdtChannel) continue
      if (params.udtTypeScriptHash === undefined  &&  isUdtChannel) continue

      const remoteBalance   = parseHexAmount(ch.remote_balance)
      const inflightInbound = parseHexAmount(ch.received_tlc_balance)
      const usable          = remoteBalance > inflightInbound
        ? remoteBalance - inflightInbound
        : 0n

      const entry: ChannelCapacityEntry = {
        channelId:     ch.channel_id,
        peerId:        ch.pubkey,
        usableInbound: usable,
        isEnabled:     ch.enabled,
      }
      breakdown.push(entry)

      if (!ch.enabled) {
        issues.push(`Channel ${ch.channel_id.slice(0, 14)}… is ChannelReady but disabled for forwarding`)
        continue
      }

      total += usable
    }

    if (total < targetAmount) {
      const shortfall = targetAmount - total
      issues.push(
        `Total usable inbound: ${total} shannon. ` +
        `Shortfall: ${shortfall} shannon. ` +
        `Ask a peer to push ${shortfall} shannon to your side, ` +
        `or open a new channel and request inbound liquidity.`
      )
    }

    return {
      canReceive:           total >= targetAmount,
      totalInboundCapacity: total,
      activeChannelCount:   breakdown.filter((c) => c.isEnabled).length,
      channelBreakdown:     breakdown,
      issues,
    }
  }
}
