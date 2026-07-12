/**
 * Fiber Network RPC Types — derived from the official FNN RPC specification.
 * All hex values are 0x-prefixed strings representing u128 amounts in shannon.
 */

export type Hash256 = string
export type Pubkey  = string
export type PeerId  = string
export type ChannelStateName =
  | 'NegotiatingFunding'
  | 'CollaboratingFundingTx'
  | 'SigningCommitment'
  | 'AwaitingTxSignatures'
  | 'AwaitingChannelReady'
  | 'ChannelReady'
  | 'ShuttingDown'
  | 'Closed'

/** Channel state as returned by the RPC: an object, not a bare string. */
export interface ChannelState {
  state_name:   ChannelStateName
  state_flags?: string
}

export interface Channel {
  channel_id:                 Hash256
  is_public:                  boolean
  is_acceptor:                boolean
  is_one_way:                 boolean
  channel_outpoint?:          string
  pubkey:                     Pubkey
  funding_udt_type_script?:   object
  state:                      ChannelState
  local_balance:              string
  remote_balance:             string
  offered_tlc_balance:        string
  received_tlc_balance:       string
  pending_tlcs:               Htlc[]
  latest_commitment_transaction_hash?: Hash256
  created_at:                 string
  enabled:                    boolean
  tlc_expiry_delta:           number
  tlc_fee_proportional_millionths: string
  shutdown_transaction_hash?: Hash256
  failure_detail?:            string | null
}

export interface Htlc {
  id:           number
  amount:       string
  payment_hash: Hash256
  expiry:       number
  status:       { Outbound: string } | { Inbound: string }
}

export interface ListChannelsResult {
  channels: Channel[]
}

// ── Payment ──────────────────────────────────────────────────────────────────

export type PaymentStatus = 'Created' | 'Inflight' | 'Success' | 'Failed'

export interface SessionRouteNode {
  pubkey:           Pubkey
  amount:           string
  channel_outpoint: string
}

export interface SessionRoute {
  nodes: SessionRouteNode[]
}

export interface Payment {
  payment_hash:    Hash256
  status:          PaymentStatus
  created_at:      number
  last_updated_at: number
  failed_error?:   string
  fee:             string
  routers:         SessionRoute[]
}

export interface SendPaymentParams {
  invoice?:         string
  target_pubkey?:   Pubkey
  amount?:          string
  payment_hash?:    Hash256
  max_fee_amount?:  string
  timeout?:         number
  keysend?:         boolean
  dry_run?:         boolean
  allow_self_payment?: boolean
}

// ── Invoice ──────────────────────────────────────────────────────────────────

export type InvoiceStatus = 'Open' | 'Cancelled' | 'Expired' | 'Received' | 'Paid'

export interface InvoiceResult {
  invoice_address: string
  invoice:         object
  status:          InvoiceStatus
}

export interface NewInvoiceParams {
  amount:               string
  currency:             'Fibb' | 'Fibt' | 'Fibd'
  description?:         string
  expiry?:              number
  final_expiry_delta?:  number
}

// ── Graph ─────────────────────────────────────────────────────────────────────

export interface ChannelUpdateInfo {
  timestamp:                    number
  enabled:                      boolean
  outbound_liquidity?:          string
  tlc_expiry_delta:             number
  tlc_minimum_value:            string
  fee_rate:                     number
}

export interface GraphChannel {
  channel_outpoint:       string
  node1:                  Pubkey
  node2:                  Pubkey
  capacity:               string
  update_info_of_node1?:  ChannelUpdateInfo
  update_info_of_node2?:  ChannelUpdateInfo
  udt_type_script?:       object
}

export interface GraphChannelsResult {
  channels:    GraphChannel[]
  last_cursor: string
}

// ── Node ─────────────────────────────────────────────────────────────────────

export interface NodeInfo {
  version:       string
  pubkey:       Pubkey
  node_name?:    string
  addresses:     string[]
  channel_count: number
  peers_count:   number
}

// ── Peers ─────────────────────────────────────────────────────────────────────

export interface PeerInfo {
  pubkey:  Pubkey
  address: string
}

export interface ListPeersResult {
  peers: PeerInfo[]
}

// ── Router ────────────────────────────────────────────────────────────────────

export interface RouterHop {
  target:              Pubkey
  channel_outpoint:    string
  amount_received:     string
  incoming_tlc_expiry: number
}export interface ParsedInvoiceAttr {
  description?: string
  final_htlc_minimum_expiry_delta?: string
  payee_public_key?: Pubkey
  expiry?: string
}

export interface ParsedInvoiceData {
  timestamp:    string
  payment_hash: Hash256
  attrs:        ParsedInvoiceAttr[]
}

export interface ParsedInvoice {
  currency:  'Fibb' | 'Fibt' | 'Fibd'
  amount:    string
  signature: string
  data:      ParsedInvoiceData
}

export interface ParseInvoiceResult {
  invoice: ParsedInvoice
}
