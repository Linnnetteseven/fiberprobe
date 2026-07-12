/**
 * fnn-ts — TypeScript SDK for Fiber Network Node (FNN)
 *
 * @packageDocumentation
 */

export { FiberClient }                   from './client/index.js'
export { PaymentChecker }                from './payment/checker.js'

export {
  FiberError,
  RouteNotFoundError,
  InsufficientCapacityError,
  TemporaryChannelFailureError,
  PeerUnreachableError,
  PaymentTimeoutError,
  FeeInsufficientError,
  AmountBelowMinimumError,
  UnknownFiberError,
}                                        from './client/errors.js'

export type {
  Hash256, Pubkey, PeerId,
  Channel, ChannelState,
  Payment, PaymentStatus, SendPaymentParams,
  InvoiceResult, InvoiceStatus, NewInvoiceParams,
  GraphChannel, GraphChannelsResult,
  NodeInfo, ListPeersResult,
}                                        from './client/types.js'

export type {
  CanPayParams, PaymentCheckResult,
  ProbePayParams, ProbeResult,
  CanReceiveParams, ReceiveCheckResult,
  ChannelCapacityEntry,
}                                        from './payment/checker.js'

export { FiberEventEmitter }             from './payment/events.js'

export type {
  WatchPaymentOptions,
  WatchInvoiceOptions,
  WatchChannelOptions,
  BackoffProfile,
  CancelFn,
}                                        from './payment/events.js'
