import { LENGTH_PREFIX_BYTES, MAX_MESSAGE_SIZE_BYTES } from '../protocol/constants.js';

import type { Readable, Writable } from 'node:stream';

export interface MessageIOOptions {
  maxMessageSizeBytes?: number;
}

/**
 * Reads exactly `size` bytes from a readable stream.
 * Returns `null` on EOF before any bytes are read.
 * Throws if the stream ends mid-read (partial data).
 */
function readExactly(input: Readable, size: number): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let remaining = size;

    const onReadable = (): void => {
      while (remaining > 0) {
        const chunk = input.read(
          Math.min(remaining, input.readableLength || remaining)
        ) as Buffer | null;
        if (chunk === null) return; // wait for more data
        chunks.push(chunk);
        remaining -= chunk.length;
      }
      cleanup();
      resolve(Buffer.concat(chunks));
    };

    const onEnd = (): void => {
      cleanup();
      if (chunks.length === 0 && remaining === size) {
        resolve(null); // clean EOF
      } else {
        reject(new Error(`Stream ended after ${size - remaining}/${size} bytes`));
      }
    };

    const onError = (err: Error): void => {
      cleanup();
      reject(err);
    };

    const cleanup = (): void => {
      input.removeListener('readable', onReadable);
      input.removeListener('end', onEnd);
      input.removeListener('error', onError);
    };

    input.on('readable', onReadable);
    input.on('end', onEnd);
    input.on('error', onError);

    // Try reading immediately if data is already buffered
    onReadable();
  });
}

/**
 * Reads one length-prefixed JSON message from the input stream.
 * Returns `null` on clean EOF (no more messages).
 *
 * @param input - Readable stream (defaults to `process.stdin`)
 */
export async function readMessage<T>(input: Readable = process.stdin): Promise<T | null> {
  return await readMessageWithOptions<T>(input);
}

export async function readMessageWithOptions<T>(
  input: Readable = process.stdin,
  options?: MessageIOOptions
): Promise<T | null> {
  const lengthBuf = await readExactly(input, LENGTH_PREFIX_BYTES);
  if (lengthBuf === null) return null;

  const messageLength = lengthBuf.readUInt32LE(0);
  const maxMessageSizeBytes = options?.maxMessageSizeBytes ?? MAX_MESSAGE_SIZE_BYTES;

  if (messageLength === 0) {
    throw new Error('Received zero-length message');
  }
  if (messageLength > maxMessageSizeBytes) {
    throw new Error(`Message size ${messageLength} exceeds maximum ${maxMessageSizeBytes}`);
  }

  const messageBuf = await readExactly(input, messageLength);
  if (messageBuf === null) {
    throw new Error('Stream ended before message body could be read');
  }

  return JSON.parse(messageBuf.toString('utf-8')) as T;
}

/**
 * Writes one length-prefixed JSON message to the output stream.
 *
 * @param message - Object to serialize as JSON
 * @param output - Writable stream (defaults to `process.stdout`)
 */
export function writeMessage(message: unknown, output: Writable = process.stdout): void {
  writeMessageWithOptions(message, output);
}

export function writeMessageWithOptions(
  message: unknown,
  output: Writable = process.stdout,
  options?: MessageIOOptions
): void {
  const json = Buffer.from(JSON.stringify(message), 'utf-8');
  const maxMessageSizeBytes = options?.maxMessageSizeBytes ?? MAX_MESSAGE_SIZE_BYTES;

  if (json.length > maxMessageSizeBytes) {
    throw new Error(
      `Serialized message size ${json.length} exceeds maximum ${maxMessageSizeBytes}`
    );
  }

  const lengthBuf = Buffer.alloc(LENGTH_PREFIX_BYTES);
  lengthBuf.writeUInt32LE(json.length, 0);

  output.write(lengthBuf);
  output.write(json);
}
