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
  connectTimeoutMs?: number;
}

const DEFAULT_LAUNCH_TIMEOUT = 12_000;
const DEFAULT_CONNECT_TIMEOUT = 2_000;

export async function connectManagedChromeBridge(
  options?: ConnectChromeBridgeOptions
): Promise<ManagedChromeBridge> {
  const port = options?.port ?? DEFAULT_PORT;
  const host = options?.host ?? '127.0.0.1';
  const connectTimeoutMs = options?.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT;

  try {
    return await tryConnect(port, host, options?.callTimeoutMs, connectTimeoutMs, false);
  } catch (error) {
    if (!isBridgeUnavailableError(error)) {
      throw error;
    }

    if (!options?.launch) {
      throw createBridgeUnavailableError({
        host,
        port,
        launched: false,
        connectTimeoutMs,
      });
    }

    await launchChrome();

    const timeout = options.launchTimeout ?? DEFAULT_LAUNCH_TIMEOUT;
    const deadline = Date.now() + timeout;
    let delay = 200;

    while (Date.now() < deadline) {
      await sleep(delay);
      try {
        return await tryConnect(port, host, options?.callTimeoutMs, connectTimeoutMs, true);
      } catch (retryError) {
        if (!isBridgeUnavailableError(retryError)) {
          throw retryError;
        }
      }

      delay = Math.min(delay * 2, 2_000);
    }

    throw createBridgeUnavailableError({
      host,
      port,
      launched: true,
      launchTimeoutMs: timeout,
      connectTimeoutMs,
    });
  }
}

function tryConnect(
  port: number,
  host: string,
  callTimeoutMs?: number,
  connectTimeoutMs = DEFAULT_CONNECT_TIMEOUT,
  launched = false
): Promise<ManagedChromeBridge> {
  return new Promise<ManagedChromeBridge>((resolve, reject) => {
    const socket = tcpConnect({ port, host });
    socket.setTimeout(connectTimeoutMs);

    let settled = false;

    const cleanup = (): void => {
      socket.removeListener('error', handleError);
      socket.removeListener('connect', handleConnect);
      socket.removeListener('timeout', handleTimeout);
    };

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      socket.destroy();
      reject(error);
    };

    const handleError = (error: Error): void => {
      fail(error);
    };

    const handleTimeout = (): void => {
      fail(createBridgeConnectTimeoutError(host, port, connectTimeoutMs));
    };

    const handleConnect = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      socket.setTimeout(0);

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
    socket.once('timeout', handleTimeout);
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

function isConnectionTimedOut(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
  );
}

function isBridgeUnavailableError(error: unknown): boolean {
  return isConnectionRefused(error) || isConnectionTimedOut(error);
}

function createBridgeConnectTimeoutError(
  host: string,
  port: number,
  timeoutMs: number
): Error {
  const error = new Error(
    `Timed out connecting to the Chrome bridge on ${host}:${port} after ${timeoutMs}ms`
  ) as NodeJS.ErrnoException;
  error.code = 'ETIMEDOUT';
  return error;
}

function createBridgeUnavailableError(options: {
  host: string;
  port: number;
  launched: boolean;
  connectTimeoutMs: number;
  launchTimeoutMs?: number;
}): Error {
  if (options.launched) {
    return new Error(
      `Chrome opened, but the chrome-controller bridge did not become available on ${options.host}:${options.port} ` +
        `within ${options.launchTimeoutMs ?? DEFAULT_LAUNCH_TIMEOUT}ms. ` +
        'Ensure the extension is installed and enabled in the selected Chrome profile, and that the native host is registered. ' +
        'Run `chrome-controller setup` to choose a profile and install the extension.'
    );
  }

  return new Error(
    `Could not connect to the chrome-controller bridge on ${options.host}:${options.port}. ` +
      `The bridge did not respond within ${options.connectTimeoutMs}ms or refused the connection. ` +
      'Ensure Chrome is running with the extension installed and enabled in the selected profile, and that the native host is registered. ' +
      'Run `chrome-controller setup` to choose a profile and install the extension.'
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
