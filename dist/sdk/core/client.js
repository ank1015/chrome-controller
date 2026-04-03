import { randomUUID } from 'node:crypto';
import { readMessageWithOptions, writeMessageWithOptions } from '../../native/stdio.js';
import { MAX_MESSAGE_SIZE_BYTES } from '../../protocol/constants.js';
const CONNECTION_CLOSED_MESSAGE = 'ChromeClient connection is closed';
/**
 * RPC client for calling Chrome APIs over native messaging.
 *
 * Sends call/subscribe/unsubscribe messages to Chrome and routes
 * incoming result/error/event responses to the correct handlers.
 */
export class ChromeClient {
    input;
    output;
    pendingCalls = new Map();
    eventCallbacks = new Map();
    closed = false;
    maxIncomingMessageSizeBytes;
    maxOutgoingMessageSizeBytes;
    callTimeoutMs;
    constructor(opts) {
        this.input = opts?.input;
        this.output = opts?.output;
        this.maxIncomingMessageSizeBytes = opts?.maxIncomingMessageSizeBytes ?? MAX_MESSAGE_SIZE_BYTES;
        this.maxOutgoingMessageSizeBytes = opts?.maxOutgoingMessageSizeBytes ?? MAX_MESSAGE_SIZE_BYTES;
        this.callTimeoutMs = opts?.callTimeoutMs;
    }
    /** Call a Chrome API method and wait for the result. */
    async call(method, ...args) {
        if (this.closed) {
            throw new Error(CONNECTION_CLOSED_MESSAGE);
        }
        const id = randomUUID();
        return new Promise((resolve, reject) => {
            const pending = { resolve, reject };
            if (typeof this.callTimeoutMs === 'number') {
                pending.timeout = setTimeout(() => {
                    const timedOut = this.pendingCalls.get(id);
                    if (!timedOut) {
                        return;
                    }
                    this.pendingCalls.delete(id);
                    timedOut.reject(new Error(`ChromeClient call to ${method} timed out after ${this.callTimeoutMs}ms`));
                }, this.callTimeoutMs);
            }
            this.pendingCalls.set(id, pending);
            this.send({ id, type: 'call', method, args });
        });
    }
    /**
     * Subscribe to a Chrome event. Returns an unsubscribe function.
     *
     * The callback is invoked with the event arguments array each time
     * the Chrome event fires.
     */
    subscribe(event, callback) {
        if (this.closed) {
            throw new Error(CONNECTION_CLOSED_MESSAGE);
        }
        const id = randomUUID();
        this.send({ id, type: 'subscribe', event });
        this.eventCallbacks.set(id, callback);
        return () => {
            this.send({ id, type: 'unsubscribe' });
            this.eventCallbacks.delete(id);
        };
    }
    /**
     * Start the read loop. Runs until stdin closes (EOF).
     *
     * Must be running for `call()` and `subscribe()` to receive responses.
     * The returned promise resolves on clean disconnect, rejects on read errors.
     */
    async run() {
        while (true) {
            const message = await this.readNextMessage();
            if (message === null) {
                this.cleanup(new Error('Connection closed'));
                return;
            }
            this.handleMessage(message);
        }
    }
    send(message) {
        writeMessageWithOptions(message, this.output, {
            maxMessageSizeBytes: this.maxOutgoingMessageSizeBytes,
        });
    }
    async readNextMessage() {
        try {
            return await readMessageWithOptions(this.input, {
                maxMessageSizeBytes: this.maxIncomingMessageSizeBytes,
            });
        }
        catch (error) {
            this.cleanup(error instanceof Error ? error : new Error(String(error)));
            throw error;
        }
    }
    handleMessage(message) {
        switch (message.type) {
            case 'result':
                this.resolvePendingCall(message.id, message.data);
                break;
            case 'error':
                this.rejectPendingCall(message.id, message.error);
                break;
            case 'event':
                this.eventCallbacks.get(message.id)?.(message.data);
                break;
        }
    }
    resolvePendingCall(id, data) {
        const pending = this.pendingCalls.get(id);
        if (!pending) {
            return;
        }
        if (pending.timeout) {
            clearTimeout(pending.timeout);
        }
        this.pendingCalls.delete(id);
        pending.resolve(data);
    }
    rejectPendingCall(id, errorMessage) {
        const pending = this.pendingCalls.get(id);
        if (pending) {
            if (pending.timeout) {
                clearTimeout(pending.timeout);
            }
            this.pendingCalls.delete(id);
            pending.reject(new Error(errorMessage));
        }
        this.eventCallbacks.delete(id);
    }
    cleanup(error) {
        this.closed = true;
        for (const [, pending] of this.pendingCalls) {
            if (pending.timeout) {
                clearTimeout(pending.timeout);
            }
            pending.reject(error);
        }
        this.pendingCalls.clear();
        this.eventCallbacks.clear();
    }
}
//# sourceMappingURL=client.js.map