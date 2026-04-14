import { connect as tcpConnect } from 'node:net';

import { DEFAULT_PORT, MAX_TCP_MESSAGE_SIZE_BYTES } from '../protocol/constants.js';
import { ChromeClient } from '../native/client.js';
import { launchChrome } from './chrome-launcher.js';

import type { Socket } from 'node:net';

export interface ManagedChromeBridgeClient {
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
  subscribe<T = unknown>(event: string, callback: (data: T) => void): () => void;
}

export interface ManagedChromeBridge {
  client: ManagedChromeBridgeClient;
  close(): Promise<void>;
  launched: boolean;
}

export interface ConnectChromeBridgeOptions {
  port?: number;
  host?: string;
  launch?: boolean;
  launchTimeout?: number;
  callTimeoutMs?: number;
}

const DEFAULT_LAUNCH_TIMEOUT = 30_000;

export async function connectManagedChromeBridge(
  options?: ConnectChromeBridgeOptions
): Promise<ManagedChromeBridge> {
  const port = options?.port ?? DEFAULT_PORT;
  const host = options?.host ?? '127.0.0.1';

  try {
    return await tryConnect(port, host, options?.callTimeoutMs, false);
  } catch (error) {
    if (!options?.launch || !isConnectionRefused(error)) {
      throw error;
    }

    await launchChrome();

    const timeout = options.launchTimeout ?? DEFAULT_LAUNCH_TIMEOUT;
    const deadline = Date.now() + timeout;
    let delay = 200;

    while (Date.now() < deadline) {
      await sleep(delay);
      try {
        return await tryConnect(port, host, options?.callTimeoutMs, true);
      } catch (retryError) {
        if (!isConnectionRefused(retryError)) {
          throw retryError;
        }
      }

      delay = Math.min(delay * 2, 2_000);
    }

    throw new Error(
      `Chrome did not become available on ${host}:${port} within ${timeout}ms. ` +
        'Ensure the extension is installed and the native host is registered.'
    );
  }
}

function tryConnect(
  port: number,
  host: string,
  callTimeoutMs?: number,
  launched = false
): Promise<ManagedChromeBridge> {
  return new Promise<ManagedChromeBridge>((resolve, reject) => {
    const socket = tcpConnect({ port, host });

    const handleError = (error: Error): void => {
      socket.removeListener('connect', handleConnect);
      reject(error);
    };

    const handleConnect = (): void => {
      socket.removeListener('error', handleError);

      const client = new ChromeClient({
        input: socket,
        output: socket,
        maxIncomingMessageSizeBytes: MAX_TCP_MESSAGE_SIZE_BYTES,
        maxOutgoingMessageSizeBytes: MAX_TCP_MESSAGE_SIZE_BYTES,
        ...(callTimeoutMs === undefined ? {} : { callTimeoutMs }),
      });

      client.run().catch(() => {
        // Pending requests are rejected by the underlying client cleanup.
      });

      resolve({
        client: {
          call: async <T = unknown>(method: string, ...args: unknown[]): Promise<T> => {
            return (await client.call(method, ...args)) as T;
          },
          subscribe: <T = unknown>(event: string, callback: (data: T) => void): (() => void) => {
            return client.subscribe(event, (data: unknown) => {
              callback(data as T);
            });
          },
        },
        close: async (): Promise<void> => {
          await closeSocket(socket);
        },
        launched,
      });
    };

    socket.once('error', handleError);
    socket.once('connect', handleConnect);
  });
}

async function closeSocket(socket: Socket): Promise<void> {
  if (socket.destroyed) {
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;

    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      resolve();
    };

    const timeoutId = setTimeout(() => {
      socket.destroy();
      finish();
    }, 500);

    socket.once('close', finish);
    socket.once('error', finish);
    socket.end();
  });
}

function isConnectionRefused(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ECONNREFUSED'
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
