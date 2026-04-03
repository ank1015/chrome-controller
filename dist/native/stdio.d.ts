import type { Readable, Writable } from 'node:stream';
export interface MessageIOOptions {
    maxMessageSizeBytes?: number;
}
/**
 * Reads one length-prefixed JSON message from the input stream.
 * Returns `null` on clean EOF (no more messages).
 *
 * @param input - Readable stream (defaults to `process.stdin`)
 */
export declare function readMessage<T>(input?: Readable): Promise<T | null>;
export declare function readMessageWithOptions<T>(input?: Readable, options?: MessageIOOptions): Promise<T | null>;
/**
 * Writes one length-prefixed JSON message to the output stream.
 *
 * @param message - Object to serialize as JSON
 * @param output - Writable stream (defaults to `process.stdout`)
 */
export declare function writeMessage(message: unknown, output?: Writable): void;
export declare function writeMessageWithOptions(message: unknown, output?: Writable, options?: MessageIOOptions): void;
//# sourceMappingURL=stdio.d.ts.map