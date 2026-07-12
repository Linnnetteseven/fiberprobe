/**
 * PaymentChecker — pre-flight payment feasibility analysis for Fiber Network.
 *
 * Solves two problems every Fiber application faces:
 *
 *  1. canPay()     — Will this payment succeed before I try to send it?
 *  2. canReceive() — Do I have enough inbound capacity to receive a payment?
 *
 * Design note: send_payment's dry_run flag was evaluated as a data source
 * for canPay() and rejected. Live testnet testing confirmed dry-run payment
 * sessions are never queryable via get_payment, even immediately after
 * creation — the RPC returns "Payment session not found" on instant lookup.
 * This means dry_run cannot supply route or fee detail synchronously or
 * asynchronously.
 *
 * canPay() instead performs static graph reachability analysis:
 *   1. parseInvoice() resolves the destination pubkey and amount
 *   2. listChannels() checks for a direct channel to the destination
 *   3. graphChannels() + BFS finds a multi-hop path if no direct channel exists
 *   4. Each hop is scored against published outbound_liquidity, exactly as
 *      a live router would need to evaluate route viability
 *
 * canReceive() scans open ChannelReady channels and sums usable inbound
 * capacity, correctly accounting for in-flight received TLCs.
 */

import type { FiberClient }          from '../client/index.js'
import type { Channel, GraphChannel, Pubkey } from '../client/types.js'
import { FiberError, RouteNotFoundError } from '../client/errors.js'

// ── Public types ──────────────────────────────────────────────────────────────

export interface CanPayParams {
  /** Fiber invoice string (fibb… / fibt… / fibd…) */
  invoice: string
  /** Maximum hops to search when pathfinding through the public graph. Defaults to 5. */
  maxHops?: number
}

export interface PaymentCheckResult {
  /** Whether a viable route was found through direct or public-graph channels. */
  canPay: boolean
  /**
   * Confidence score: 0–100.
   *
   *   80–100  High.     Route is liquid, short, and well-capitalised.
   *   60–79   Moderate. Route found but some liquidity is uncertain.
   *   30–59   Low.      Route exists but liquidity is thin or unverifiable.
   *   0       None.     No route found.
   *
   * This reflects known liquidity at the time of the check — actual channel
   * balances can shift before a real payment is attempted. Treat this as a
   * probability signal, not a guarantee.
   */
  confidence: number
  /** Destination pubkey resolved from the invoice. */
  destinationPubkey?: Pubkey
  /** Amount requested by the invoice, in shannon (hex). */
  amount?: string
  /** Number of hops in the discovered route. 0 if paid via a direct channel. */
  hopCount?: number
  /** Human-readable issues identified during analysis. */
  issues: string[]
  /** Structured error when no route could be found. */
  error?: FiberError
}

export interface CanReceiveParams {
  /** Amount in shannon to check receivability for (hex string). */
  amount: string
  /** Optional UDT type script hash for multi-asset capacity checks. */
  udtTypeScriptHash?: string
}

export interface ReceiveCheckResult {
  canReceive: boolean
  totalInboundCapacity: bigint
  activeChannelCount: number
  channelBreakdown: ChannelCapacityEntry[]
  issues: string[]
}

export interface ChannelCapacityEntry {
  channelId:     string
  pubkey:        string
  usableInbound: bigint
  isEnabled:     boolean
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function parseHexAmount(hex: string): bigint {
  if (!hex.startsWith('0x') && !hex.startsWith('0X')) {
    throw new Error(`Expected hex amount string, got: ${hex}`)
  }
  return BigInt(hex)
}

/**
 * Score a single hop against published graph liquidity data.
 * Same rationale as the original dry-run-based scoring, applied here to
 * statically discovered graph edges instead of live router hop data.
 */
function scoreHop(channel: GraphChannel, amountToForward: bigint): { score: number; issue?: string } {
  const shortId = channel.channel_outpoint.slice(0, 14) + '…'

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
    return { score: 0.05, issue: `Channel ${shortId} reports zero outbound liquidity` }
  }

  const ratio = Number(conservative) / Number(amountToForward)

  if (ratio >= 3.0) return { score: 0.95 }
  if (ratio >= 1.5) return { score: 0.82 }
  if (ratio >= 1.0) return { score: 0.65, issue: `Channel ${shortId} has tight liquidity` }

  return { score: 0.20, issue: `Channel ${shortId} may have insufficient liquidity for this amount` }
}

function computeConfidence(hopScores: number[], hopCount: number): number {
  if (hopScores.length === 0) return 0
  const weakestHop = Math.min(...hopScores)
  const hopPenalty = Math.max(0, (hopCount - 1) * 0.03)
  return Math.round(Math.max(0, weakestHop - hopPenalty) * 100)
}

/**
 * Breadth-first search over the public channel graph to find a path from
 * `from` to `to`. Returns the sequence of GraphChannel edges forming the
 * path, or null if no path exists within maxHops.
 *
 * BFS guarantees the shortest hop-count path is found first, which is the
 * most useful default for a payment router — fewer hops means fewer points
 * of failure and typically lower cumulative fees.
 */
function findPath(
  from: Pubkey,
  to: Pubkey,
  channels: GraphChannel[],
  maxHops: number
): GraphChannel[] | null {
  // Build adjacency: pubkey -> list of { neighbor, channel }
  const adjacency = new Map<Pubkey, { neighbor: Pubkey; channel: GraphChannel }[]>()

  for (const ch of channels) {
    if (!adjacency.has(ch.node1)) adjacency.set(ch.node1, [])
    if (!adjacency.has(ch.node2)) adjacency.set(ch.node2, [])
    adjacency.get(ch.node1)!.push({ neighbor: ch.node2, channel: ch })
    adjacency.get(ch.node2)!.push({ neighbor: ch.node1, channel: ch })
  }

  if (from === to) return []

  const visited = new Set<Pubkey>([from])
  const queue: { node: Pubkey; path: GraphChannel[] }[] = [{ node: from, path: [] }]

  while (queue.length > 0) {
    const { node, path } = queue.shift()!

    if (path.length >= maxHops) continue

    const edges = adjacency.get(node) ?? []
    for (const { neighbor, channel } of edges) {
      if (neighbor === to) {
        return [...path, channel]
      }
      if (!visited.has(neighbor)) {
        visited.add(neighbor)
        queue.push({ node: neighbor, path: [...path, channel] })
      }
    }
  }

  return null
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
 *   return
 * }
 * console.log(`Confidence: ${result.confidence}%  Hops: ${result.hopCount}`)
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
   *   1. Resolves the destination pubkey and amount from the invoice.
   *   2. Checks for a direct ChannelReady channel to the destination —
   *      if found, this is the highest-confidence path.
   *   3. Otherwise, searches the public network graph via BFS to find
   *      the shortest multi-hop path to the destination.
   *   4. Scores each hop against published outbound liquidity data and
   *      combines scores using weakest-link logic, since a payment fails
   *      if any single hop lacks capacity.
   */
  async canPay(params: CanPayParams): Promise<PaymentCheckResult> {
    const maxHops = params.maxHops ?? 5

    // Step 1: Resolve destination from the invoice
    let destinationPubkey: Pubkey
    let amount: string
    try {
      const parsed = await this.client.parseInvoice(params.invoice)
      const payeeAttr = parsed.invoice.data.attrs.find(
        (a): a is { payee_public_key: Pubkey } => 'payee_public_key' in a
      )
      if (!payeeAttr?.payee_public_key) {
        return {
          canPay: false,
          confidence: 0,
          issues: ['Invoice does not specify a destination public key'],
          error: new RouteNotFoundError('Invoice missing payee_public_key'),
        }
      }
      destinationPubkey = payeeAttr.payee_public_key
      amount = parsed.invoice.amount
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      return {
        canPay: false,
        confidence: 0,
        issues: [`Failed to parse invoice: ${raw}`],
        error: FiberError.parse(raw),
      }
    }

    const amountToForward = parseHexAmount(amount)

    // Step 2: Check for a direct ChannelReady channel to the destination
    const myChannels = await this.client.listChannels({ include_closed: false })
    const directChannel = myChannels.find(
      (ch) => ch.pubkey === destinationPubkey && ch.state.state_name === 'ChannelReady'
    )

    if (directChannel) {
      const localBalance = parseHexAmount(directChannel.local_balance)
      const issues: string[] = []
      let confidence: number

      if (localBalance >= amountToForward * 3n) {
        confidence = 95
      } else if (localBalance >= amountToForward) {
        confidence = 75
        issues.push('Direct channel capacity is limited relative to payment amount')
      } else {
        return {
          canPay: false,
          confidence: 0,
          destinationPubkey,
          amount,
          issues: ['Direct channel exists but local balance is insufficient'],
          error: FiberError.parse('insufficient_capacity'),
        }
      }

      return {
        canPay: true,
        confidence,
        destinationPubkey,
        amount,
        hopCount: 0,
        issues,
      }
    }

    // Step 3: No direct channel — search the public graph
    const graphResult = await this.client.graphChannels(500)

    // We need our own node's pubkey to start the search from
    const myNodeInfo = await this.client.nodeInfo()
    const path = findPath(myNodeInfo.pubkey, destinationPubkey, graphResult.channels, maxHops)

    if (!path) {
      return {
        canPay: false,
        confidence: 0,
        destinationPubkey,
        amount,
        issues: [`No route found to destination within ${maxHops} hops`],
        error: new RouteNotFoundError(`No path to ${destinationPubkey} within ${maxHops} hops`),
      }
    }

    // Step 4: Score each hop
    const issues: string[] = []
    const hopScores: number[] = []

    for (const channel of path) {
      const { score, issue } = scoreHop(channel, amountToForward)
      hopScores.push(score)
      if (issue) issues.push(issue)
    }

    const confidence = computeConfidence(hopScores, path.length)

    return {
      canPay: true,
      confidence,
      destinationPubkey,
      amount,
      hopCount: path.length,
      issues,
    }
  }

  /**
   * Checks whether this node has sufficient inbound capacity to receive a payment.
   *
   * Usable inbound per channel = remote_balance − received_tlc_balance.
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

      const isUdtChannel = ch.funding_udt_type_script != null
      if (params.udtTypeScriptHash !== undefined && !isUdtChannel) continue
      if (params.udtTypeScriptHash === undefined  &&  isUdtChannel) continue

      const remoteBalance   = parseHexAmount(ch.remote_balance)
      const inflightInbound = parseHexAmount(ch.received_tlc_balance)
      const usable          = remoteBalance > inflightInbound
        ? remoteBalance - inflightInbound
        : 0n

      const entry: ChannelCapacityEntry = {
        channelId:     ch.channel_id,
        pubkey:        ch.pubkey,
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
        `Total usable inbound: ${total} shannon. Shortfall: ${shortfall} shannon. ` +
        `Ask a peer to push liquidity to your side, or open a new channel.`
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
