import type { Readable, Writable } from 'node:stream';
export interface ChromeClientOptions {
    input?: Readable;
    output?: Writable;
    maxIncomingMessageSizeBytes?: number;
    maxOutgoingMessageSizeBytes?: number;
    callTimeoutMs?: number;
}
/**
 * RPC client for calling Chrome APIs over native messaging.
 *
 * Sends call/subscribe/unsubscribe messages to Chrome and routes
 * incoming result/error/event responses to the correct handlers.
 */
export declare class ChromeClient {
    private input;
    private output;
    private pendingCalls;
    private eventCallbacks;
    private closed;
    private maxIncomingMessageSizeBytes;
    private maxOutgoingMessageSizeBytes;
    private callTimeoutMs;
    constructor(opts?: ChromeClientOptions);
    /** Call a Chrome API method and wait for the result. */
    call(method: string, ...args: unknown[]): Promise<unknown>;
    /**
     * Subscribe to a Chrome event. Returns an unsubscribe function.
     *
     * The callback is invoked with the event arguments array each time
     * the Chrome event fires.
     */
    subscribe(event: string, callback: (data: unknown) => void): () => void;
    /**
     * Start the read loop. Runs until stdin closes (EOF).
     *
     * Must be running for `call()` and `subscribe()` to receive responses.
     * The returned promise resolves on clean disconnect, rejects on read errors.
     */
    run(): Promise<void>;
    private send;
    private readNextMessage;
    private handleMessage;
    private resolvePendingCall;
    private rejectPendingCall;
    private cleanup;
}
//# sourceMappingURL=client.d.ts.map