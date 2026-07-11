// ============================================================
// Fiber Network RPC Types — derived from official RPC README
// ============================================================

export type Hash256 = string   // 0x-prefixed 64-char hex
export type Pubkey  = string   // 0x-prefixed 66-char compressed pubkey hex
export type PeerId  = string

// ── Channel ──────────────────────────────────────────────────

export type ChannelState =
  | 'NegotiatingFunding'
  | 'CollaboratingFundingTx'
  | 'SigningCommitment'
  | 'AwaitingTxSignatures'
  | 'AwaitingChannelReady'
  | 'ChannelReady'
  | 'ShuttingDown'
  | 'Closed'

export interface Channel {
  channel_id: Hash256
  is_public: boolean
  channel_outpoint?: string
  peer_id: PeerId
  funding_udt_type_script?: object
  state: ChannelState
  local_balance: string          // hex u128
  remote_balance: string         // hex u128
  offered_tlc_balance: string
  received_tlc_balance: string
  pending_tlcs: Htlc[]
  created_at: number
  enabled: boolean
  tlc_expiry_delta: number
  tlc_fee_proportional_millionths: string
  shutdown_transaction_hash?: Hash256
}

export interface Htlc {
  id: number
  amount: string
  payment_hash: Hash256
  expiry: number
  status: { Outbound: string } | { Inbound: string }
}

export interface ListChannelsResult {
  channels: Channel[]
}

// ── Payment ──────────────────────────────────────────────────

export type PaymentStatus = 'Created' | 'Inflight' | 'Success' | 'Failed'

export interface SessionRouteNode {
  pubkey: Pubkey
  amount: string
  channel_outpoint: string
}

export interface SessionRoute {
  nodes: SessionRouteNode[]
}

export interface Payment {
  payment_hash: Hash256
  status: PaymentStatus
  created_at: number
  last_updated_at: number
  failed_error?: string
  fee: string                    // hex u128
  routers: SessionRoute[]
}

export interface SendPaymentParams {
  invoice?: string
  target_pubkey?: Pubkey
  amount?: string
  payment_hash?: Hash256
  max_fee_amount?: string
  timeout?: number
  keysend?: boolean
  dry_run?: boolean
  allow_self_payment?: boolean
}

// ── Invoice ──────────────────────────────────────────────────

export type InvoiceStatus = 'Open' | 'Cancelled' | 'Expired' | 'Received' | 'Paid'

export interface InvoiceResult {
  invoice_address: string
  invoice: object
  status: InvoiceStatus
}

export interface NewInvoiceParams {
  amount: string                 // hex u128
  currency: 'Fibb' | 'Fibt' | 'Fibd'
  description?: string
  expiry?: number
  final_expiry_delta?: number
}

// ── Graph ────────────────────────────────────────────────────

export interface ChannelUpdateInfo {
  timestamp: number
  enabled: boolean
  outbound_liquidity?: string    // hex u128, may be absent for private channels
  tlc_expiry_delta: number
  tlc_minimum_value: string
  fee_rate: number
}

export interface GraphChannel {
  channel_outpoint: string
  node1: Pubkey
  node2: Pubkey
  capacity: string               // hex u128
  update_info_of_node1?: ChannelUpdateInfo
  update_info_of_node2?: ChannelUpdateInfo
  udt_type_script?: object
}

export interface GraphChannelsResult {
  channels: GraphChannel[]
  last_cursor: string
}

// ── Node info ────────────────────────────────────────────────

export interface NodeInfo {
  version: string
  node_id: Pubkey
  node_name?: string
  addresses: string[]
  channel_count: number
  peers_count: number
}

// ── Peers ────────────────────────────────────────────────────

export interface PeerInfo {
  pubkey: Pubkey
  peer_id: PeerId
  address: string
}

export interface ListPeersResult {
  peers: PeerInfo[]
}

// ── Router ────────────────────────────────────────────────────

export interface RouterHop {
  target: Pubkey
  channel_outpoint: string
  amount_received: string
  incoming_tlc_expiry: number
}