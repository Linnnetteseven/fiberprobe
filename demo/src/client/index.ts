import { Fiber } from '@nervosnetwork/fiber-js'
import type {
  Channel, Payment, SendPaymentParams, InvoiceResult,
  NewInvoiceParams, ListChannelsResult, ListPeersResult,
  GraphChannelsResult, NodeInfo, RouterHop, Hash256
} from './types.js'

export class FiberClient {
  private fiber: Fiber

  constructor(fiber: Fiber) {
    this.fiber = fiber
  }

  // ── Node ───────────────────────────────────────────────────
  async nodeInfo(): Promise<NodeInfo> {
    return this.fiber.invokeCommand('node_info', [])
  }

  // ── Peers ──────────────────────────────────────────────────
  async listPeers(): Promise<ListPeersResult> {
    return this.fiber.invokeCommand('list_peers', [])
  }

  async connectPeer(address: string, save = true): Promise<void> {
    return this.fiber.invokeCommand('connect_peer', [{ address, save }])
  }

  // ── Channels ───────────────────────────────────────────────
  async listChannels(options: { peer_id?: string; include_closed?: boolean } = {}): Promise<Channel[]> {
    const result: ListChannelsResult = await this.fiber.invokeCommand('list_channels', [options])
    return result.channels
  }

  async openChannel(params: {
    peer_id: string
    funding_amount: string
    public?: boolean
  }): Promise<{ temporary_channel_id: Hash256 }> {
    return this.fiber.invokeCommand('open_channel', [params])
  }

  async shutdownChannel(channel_id: Hash256, force = false): Promise<void> {
    return this.fiber.invokeCommand('shutdown_channel', [{ channel_id, force }])
  }

  // ── Payments ───────────────────────────────────────────────
  async sendPayment(params: SendPaymentParams): Promise<Payment> {
    return this.fiber.invokeCommand('send_payment', [params])
  }

  async getPayment(payment_hash: Hash256): Promise<Payment> {
    return this.fiber.invokeCommand('get_payment', [{ payment_hash }])
  }

  async buildRouter(params: {
    amount?: string
    hops_info: { pubkey: string; channel_outpoint?: string }[]
  }): Promise<{ router_hops: RouterHop[] }> {
    return this.fiber.invokeCommand('build_router', [params])
  }

  // ── Invoices ───────────────────────────────────────────────
  async newInvoice(params: NewInvoiceParams): Promise<InvoiceResult> {
    return this.fiber.invokeCommand('new_invoice', [params])
  }

  async getInvoice(payment_hash: Hash256): Promise<InvoiceResult> {
    return this.fiber.invokeCommand('get_invoice', [{ payment_hash }])
  }

  async cancelInvoice(payment_hash: Hash256): Promise<InvoiceResult> {
    return this.fiber.invokeCommand('cancel_invoice', [{ payment_hash }])
  }

  // ── Graph ──────────────────────────────────────────────────
  async graphChannels(limit = 100): Promise<GraphChannelsResult> {
    return this.fiber.invokeCommand('graph_channels', [{ limit }])
  }
}