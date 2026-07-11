/**
 * FiberClient — fully typed wrapper over the Fiber Network Node RPC.
 *
 * Replaces raw invokeCommand() calls (stringly typed, no autocomplete)
 * with a typed API that validates inputs and outputs at compile time.
 *
 * @example
 * ```ts
 * const client = new FiberClient(fiber)
 * const channels = await client.listChannels()
 * const payment  = await client.sendPayment({ invoice: 'fibt...', dry_run: true })
 * ```
 */

import type { Fiber } from '@nervosnetwork/fiber-js'
import type {
  Channel,
  Payment,
  SendPaymentParams,
  InvoiceResult,
  NewInvoiceParams,
  ListChannelsResult,
  ListPeersResult,
  GraphChannelsResult,
  NodeInfo,
  RouterHop,
  Hash256,
} from './types.js'

export class FiberClient {
  constructor(private readonly fiber: Fiber) {}

  // ── Node ─────────────────────────────────────────────────────────────────

  /** Returns identifying information about the running FNN node. */
  async nodeInfo(): Promise<NodeInfo> {
    return this.fiber.invokeCommand('node_info', [])
  }

  // ── Peers ─────────────────────────────────────────────────────────────────

  /** Lists all peers currently connected to this node. */
  async listPeers(): Promise<ListPeersResult> {
    return this.fiber.invokeCommand('list_peers', [])
  }

  /**
   * Connects to a remote Fiber peer by address.
   * @param address - Multiaddr of the remote peer, e.g. "/ip4/1.2.3.4/tcp/8228/p2p/..."
   * @param save    - Persist this peer address for reconnection on restart. Defaults to true.
   */
  async connectPeer(address: string, save = true): Promise<void> {
    return this.fiber.invokeCommand('connect_peer', [{ address, save }])
  }

  // ── Channels ──────────────────────────────────────────────────────────────

  /**
   * Lists channels on this node, optionally filtered by peer.
   * @param options.peer_id       - Filter to channels with a specific peer
   * @param options.include_closed - Include closed channels in results. Defaults to false.
   */
  async listChannels(
    options: { peer_id?: string; include_closed?: boolean } = {}
  ): Promise<Channel[]> {
    const result: ListChannelsResult = await this.fiber.invokeCommand(
      'list_channels',
      [options]
    )
    return result.channels
  }

  /**
   * Opens a new payment channel with a connected peer.
   * The peer must already be connected via connectPeer().
   *
   * @param params.peer_id        - Peer to open the channel with
   * @param params.funding_amount - CKB capacity to fund the channel (hex u128, in shannon)
   * @param params.public         - Broadcast this channel to the network graph. Defaults to true.
   */
  async openChannel(params: {
    peer_id:        string
    funding_amount: string
    public?:        boolean
  }): Promise<{ temporary_channel_id: Hash256 }> {
    return this.fiber.invokeCommand('open_channel', [params])
  }

  /**
   * Initiates a cooperative shutdown of a channel.
   * Both parties must be online for cooperative close. Use force=true only as a last resort.
   *
   * @param channel_id - The channel to close
   * @param force      - Force-close unilaterally. Incurs a time-lock penalty. Defaults to false.
   */
  async shutdownChannel(channel_id: Hash256, force = false): Promise<void> {
    return this.fiber.invokeCommand('shutdown_channel', [{ channel_id, force }])
  }

  // ── Payments ──────────────────────────────────────────────────────────────

  /**
   * Sends a payment, or performs a dry-run feasibility check.
   *
   * Set dry_run: true to validate routing and estimate fees without
   * broadcasting the payment to the network.
   */
  async sendPayment(params: SendPaymentParams): Promise<Payment> {
    return this.fiber.invokeCommand('send_payment', [params])
  }

  /**
   * Fetches the current status and details of a payment by its hash.
   * Poll this after sendPayment() to track Inflight → Success/Failed transitions.
   */
  async getPayment(payment_hash: Hash256): Promise<Payment> {
    return this.fiber.invokeCommand('get_payment', [{ payment_hash }])
  }

  /**
   * Builds and validates a payment route without sending.
   * Use this to inspect hop details and confirm a path exists.
   */
  async buildRouter(params: {
    amount?:    string
    hops_info:  { pubkey: string; channel_outpoint?: string }[]
  }): Promise<{ router_hops: RouterHop[] }> {
    return this.fiber.invokeCommand('build_router', [params])
  }

  // ── Invoices ──────────────────────────────────────────────────────────────

  /**
   * Creates a new Fiber invoice for receiving a payment.
   * @param params.amount   - Amount in shannon (hex u128)
   * @param params.currency - Network: Fibb (mainnet), Fibt (testnet), Fibd (devnet)
   */
  async newInvoice(params: NewInvoiceParams): Promise<InvoiceResult> {
    return this.fiber.invokeCommand('new_invoice', [params])
  }

  /** Fetches an invoice and its current payment status by payment hash. */
  async getInvoice(payment_hash: Hash256): Promise<InvoiceResult> {
    return this.fiber.invokeCommand('get_invoice', [{ payment_hash }])
  }

  /** Cancels an Open invoice, preventing it from being paid. */
  async cancelInvoice(payment_hash: Hash256): Promise<InvoiceResult> {
    return this.fiber.invokeCommand('cancel_invoice', [{ payment_hash }])
  }

  // ── Network Graph ─────────────────────────────────────────────────────────

  /**
   * Fetches public channels from the network graph.
   * Used by PaymentChecker to score route liquidity during canPay() analysis.
   *
   * @param limit - Maximum channels to return. Defaults to 100.
   */
  async graphChannels(limit = 100): Promise<GraphChannelsResult> {
    return this.fiber.invokeCommand('graph_channels', [{ limit }])
  }
}