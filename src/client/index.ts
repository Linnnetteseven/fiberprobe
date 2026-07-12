/**
 * FiberClient — fully typed HTTP JSON-RPC client for Fiber Network Node (FNN).
 *
 * Communicates with a running FNN instance via its JSON-RPC endpoint
 * (default: http://127.0.0.1:8227). Every method is typed against the
 * official FNN RPC specification so callers get compile-time safety and
 * inline documentation instead of raw invokeCommand() calls.
 *
 * @example
 * ```ts
 * const client = new FiberClient('http://127.0.0.1:8227')
 * const info    = await client.nodeInfo()
 * console.log(info.pubkey, info.channel_count)
 * ```
 */

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
  ParseInvoiceResult,
  Hash256,
} from './types.js'

// ── JSON-RPC transport ────────────────────────────────────────────────────────

let requestId = 0

/**
 * Send a single JSON-RPC 2.0 request to the FNN node and return the result.
 * Throws if the response contains a JSON-RPC error object.
 *
 * @param url    - Full HTTP URL of the FNN RPC endpoint
 * @param method - JSON-RPC method name
 * @param params - Method parameters (passed as the first array element per FNN convention)
 */
async function rpc<T>(url: string, method: string, params: unknown = {}): Promise<T> {
  const id       = ++requestId
  const response = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ jsonrpc: '2.0', id, method, params: [params] }),
  })

  if (!response.ok) {
    throw new Error(`FNN RPC HTTP error ${response.status}: ${response.statusText}`)
  }

  const json = await response.json() as { result?: T; error?: { code: number; message: string } }

  if (json.error) {
    throw new Error(`FNN RPC error [${json.error.code}]: ${json.error.message}`)
  }

  return json.result as T
}

// ── FiberClient ───────────────────────────────────────────────────────────────

export class FiberClient {
  /**
   * @param rpcUrl - HTTP URL of the FNN RPC endpoint. Defaults to the standard
   *                 local node address. Override for remote nodes or custom ports.
   */
  constructor(private readonly rpcUrl: string = 'http://127.0.0.1:8227') {}

  // ── Node ───────────────────────────────────────────────────────────────────

  /** Returns identifying information and operational stats for the running FNN node. */
  async nodeInfo(): Promise<NodeInfo> {
    return rpc<NodeInfo>(this.rpcUrl, 'node_info')
  }

  // ── Peers ──────────────────────────────────────────────────────────────────

  /** Lists all peers currently connected to this node. */
  async listPeers(): Promise<ListPeersResult> {
    return rpc<ListPeersResult>(this.rpcUrl, 'list_peers')
  }

  /**
   * Connects to a remote Fiber peer by multiaddr.
   * @param address - Multiaddr of the remote peer
   * @param save    - Persist this address for reconnection on restart
   */
  async connectPeer(address: string, save = true): Promise<void> {
    return rpc<void>(this.rpcUrl, 'connect_peer', { address, save })
  }

  // ── Channels ───────────────────────────────────────────────────────────────

  /**
   * Lists channels on this node, optionally filtered by peer pubkey.
   * @param options.pubkey         - Filter to channels with a specific peer
   * @param options.include_closed - Include closed channels. Defaults to false.
   */
  async listChannels(
    options: { pubkey?: string; include_closed?: boolean } = {}
  ): Promise<Channel[]> {
    const result = await rpc<ListChannelsResult>(this.rpcUrl, 'list_channels', options)
    return result.channels
  }

  /**
   * Opens a new payment channel with a connected peer.
   * @param params.pubkey         - Peer pubkey to open the channel with
   * @param params.funding_amount - CKB to lock in the channel (hex u128, shannon)
   * @param params.public         - Announce to the network graph
   */
  async openChannel(params: {
    pubkey:          string
    funding_amount:  string
    public?:         boolean
  }): Promise<{ temporary_channel_id: Hash256 }> {
    return rpc(this.rpcUrl, 'open_channel', params)
  }

  /**
   * Initiates cooperative shutdown of a channel.
   * @param channel_id - Channel to close
   * @param force      - Force-close unilaterally. Incurs a time-lock penalty.
   */
  async shutdownChannel(channel_id: Hash256, force = false): Promise<void> {
    return rpc<void>(this.rpcUrl, 'shutdown_channel', { channel_id, force })
  }

  // ── Payments ───────────────────────────────────────────────────────────────

  /**
   * Sends a payment or performs a dry-run feasibility check.
   * Set dry_run: true to validate routing and estimate fees without
   * broadcasting the payment.
   */
  async sendPayment(params: SendPaymentParams): Promise<Payment> {
    return rpc<Payment>(this.rpcUrl, 'send_payment', params)
  }

  /**
   * Fetches current status and details of a payment by its hash.
   * Poll this after sendPayment() to track Inflight → Success/Failed transitions.
   */
  async getPayment(payment_hash: Hash256): Promise<Payment> {
    return rpc<Payment>(this.rpcUrl, 'get_payment', { payment_hash })
  }

  /**
   * Builds and validates a payment route without sending.
   * Use this to inspect hop details and confirm a path exists before committing.
   */
  async buildRouter(params: {
    amount?:   string
    hops_info: { pubkey: string; channel_outpoint?: string }[]
  }): Promise<{ router_hops: RouterHop[] }> {
    return rpc(this.rpcUrl, 'build_router', params)
  }

  // ── Invoices ───────────────────────────────────────────────────────────────

  /**
   * Creates a new Fiber invoice for receiving a payment.
   * @param params.amount   - Amount in shannon (hex u128)
   * @param params.currency - Fibb (mainnet) | Fibt (testnet) | Fibd (devnet)
   */
  async newInvoice(params: NewInvoiceParams): Promise<InvoiceResult> {
    return rpc<InvoiceResult>(this.rpcUrl, 'new_invoice', params)
  }

  /** Fetches an invoice and its current payment status by payment hash. */
  async getInvoice(payment_hash: Hash256): Promise<InvoiceResult> {
    return rpc<InvoiceResult>(this.rpcUrl, 'get_invoice', { payment_hash })
  }

  /** Cancels an Open invoice, preventing it from being paid. */
  async cancelInvoice(payment_hash: Hash256): Promise<InvoiceResult> {
    return rpc<InvoiceResult>(this.rpcUrl, 'cancel_invoice', { payment_hash })
  }

  // ── Network Graph ──────────────────────────────────────────────────────────

  /**
   * Fetches public channels from the Fiber network graph.
   * Used by PaymentChecker to score route liquidity during canPay() analysis.
   * @param limit - Maximum channels to return. Defaults to 100.
   */
  async graphChannels(limit = 100): Promise<GraphChannelsResult> {
    return rpc<GraphChannelsResult>(this.rpcUrl, 'graph_channels', { limit })

  }

  // ── Invoice Parsing ──────────────────────────────────────────────────────────

  /**
   * Parses an encoded Fiber invoice string without attempting payment.
   * Extracts amount, payment_hash, and the destination pubkey (payee_public_key)
   * from the attrs array. Used by PaymentChecker.canPay() to resolve the
   * payment destination before running graph reachability analysis.
   *
   * @param invoice - The encoded invoice string (fibb.../fibt.../fibd...)
   */
  async parseInvoice(invoice: string): Promise<ParseInvoiceResult> {
    return rpc<ParseInvoiceResult>(this.rpcUrl, 'parse_invoice', { invoice })
  }
}
