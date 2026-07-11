import { AbandonChannelParams, AcceptChannelParams, AcceptChannelResult, ListChannelsParams, ListChannelsResult, OpenChannelParams, OpenChannelResult, OpenChannelWithExternalFundingParams, OpenChannelWithExternalFundingResult, ShutdownChannelParams, SubmitSignedFundingTxParams, SubmitSignedFundingTxResult, UpdateChannelParams } from "./types/channel.ts";
import { GraphChannelsParams, GraphChannelsResult, GraphNodesParams, GraphNodesResult } from "./types/graph.ts";
import { NodeInfoResult } from "./types/info.ts";
import { GetInvoiceResult, InvoiceParams, InvoiceResult, NewInvoiceParams, ParseInvoiceParams, ParseInvoiceResult } from "./types/invoice.ts";
import { BuildPaymentRouterResult, BuildRouterParams, GetPaymentCommandParams, GetPaymentCommandResult, SendPaymentCommandParams, SendPaymentWithRouterParams } from "./types/payment.ts";
import { ConnectPeerParams, DisconnectPeerParams, ListPeerResult } from "./types/peer.ts";
/**
 * A Fiber Wasm instance
 */
declare class Fiber {
    private dbWorker;
    private fiberWorker;
    private inputBuffer;
    private outputBuffer;
    private commandInvokeLock;
    /**
     * Construct a Fiber Wasm instance.
     * inputBuffer and outputBuffer are buffers used for transporting data between database and fiber wasm. Set them to appropriate sizes.
     * @param inputBufferSize Size of inputBuffer
     * @param outputBufferSize Size of outputBuffer
     */
    constructor(inputBufferSize?: number, outputBufferSize?: number);
    /**
     * Start the Fiber Wasm instance.
     * @param config Config file for fiber
     * @param fiberKeyPair keypair used for fiber
     * @param ckbSecretKey secret key for CKB (optional, signing may not require it)
     * @param chainSpec Chain spec if chain is neither testnet nor mainnet
     * @param logLevel log level, such as `trace`, `debug`, `info`, `error`
     * @param databasePrefix Name prefix of IndexedDB store. Defaults to `/wasm`
     *
     */
    start(config: string, fiberKeyPair: Uint8Array, ckbSecretKey?: Uint8Array, chainSpec?: string, logLevel?: "trace" | "debug" | "info" | "error", databasePrefix?: string): Promise<void>;
    invokeCommand(name: string, args?: any[]): Promise<any>;
    /**
     * Stop the fiber instance.
     */
    stop(): Promise<void>;
    openChannel(params: OpenChannelParams): Promise<OpenChannelResult>;
    /**
     * Open a channel with external funding and return the final negotiated unsigned
     * funding transaction. The caller should sign this tx once, without changing its
     * structure, then submit it with submitSignedFundingTx. When `funding_lock_script`
     * uses a custom wallet lock, pass `funding_lock_script_cell_deps` so the node can
     * build the initial unsigned transaction.
     */
    openChannelWithExternalFunding(params: OpenChannelWithExternalFundingParams): Promise<OpenChannelWithExternalFundingResult>;
    /**
     * Submit the externally signed funding transaction. The transaction must match the
     * unsigned_funding_tx returned by openChannelWithExternalFunding, except witnesses.
     */
    submitSignedFundingTx(params: SubmitSignedFundingTxParams): Promise<SubmitSignedFundingTxResult>;
    acceptChannel(params: AcceptChannelParams): Promise<AcceptChannelResult>;
    abandonChannel(params: AbandonChannelParams): Promise<void>;
    listChannels(params: ListChannelsParams): Promise<ListChannelsResult>;
    shutdownChannel(params: ShutdownChannelParams): Promise<void>;
    updateChannel(params: UpdateChannelParams): Promise<void>;
    graphNodes(params: GraphNodesParams): Promise<GraphNodesResult>;
    graphChannels(params: GraphChannelsParams): Promise<GraphChannelsResult>;
    nodeInfo(): Promise<NodeInfoResult>;
    newInvoice(params: NewInvoiceParams): Promise<InvoiceResult>;
    parseInvoice(params: ParseInvoiceParams): Promise<ParseInvoiceResult>;
    getInvoice(params: InvoiceParams): Promise<GetInvoiceResult>;
    cancelInvoice(params: InvoiceParams): Promise<GetInvoiceResult>;
    sendPayment(params: SendPaymentCommandParams): Promise<GetPaymentCommandResult>;
    getPayment(params: GetPaymentCommandParams): Promise<GetPaymentCommandResult>;
    buildRouter(params: BuildRouterParams): Promise<BuildPaymentRouterResult>;
    sendPaymentWithRouter(params: SendPaymentWithRouterParams): Promise<GetPaymentCommandResult>;
    connectPeer(params: ConnectPeerParams): Promise<void>;
    disconnectPeer(params: DisconnectPeerParams): Promise<void>;
    listPeers(): Promise<ListPeerResult>;
}
export { Fiber };
/**
 * Generate a random 32-byte secret key.
 * @returns The secret key.
 */
export declare function randomSecretKey(): Uint8Array;
export * from "./types/general.ts";
export * from "./types/channel.ts";
export * from "./types/graph.ts";
export * from "./types/info.ts";
export * from "./types/invoice.ts";
export * from "./types/payment.ts";
export * from "./types/peer.ts";
//# sourceMappingURL=../src/dist/index.d.ts.map