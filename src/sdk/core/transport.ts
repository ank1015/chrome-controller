import { exec } from 'node:child_process';
import { connect as tcpConnect } from 'node:net';

import { ChromeClient  } from './client.js';
import { ConnectOptions } from './connect.js';

import { MAX_TCP_MESSAGE_SIZE_BYTES, DEFAULT_PORT } from '../../protocol/constants.js';

import type { Socket } from 'node:net';

export interface ManagedChromeBridgeClient {
  call<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
}

export interface ManagedChromeBridge {
  client: ManagedChromeBridgeClient;
  close(): Promise<void>;
}

export interface ConnectWebTransportOptions extends ConnectOptions {}

const DEFAULT_LAUNCH_TIMEOUT = 30_000;

export async function connectManagedChromeBridge(
  options?: ConnectWebTransportOptions
): Promise<ManagedChromeBridge> {
  const port = options?.port ?? DEFAULT_PORT;
  const host = options?.host ?? '127.0.0.1';

  try {
    return await tryConnect(port, host);
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
        return await tryConnect(port, host);
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

function tryConnect(port: number, host: string): Promise<ManagedChromeBridge> {
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
      });

      client.run().catch(() => {
        // Pending requests are rejected by the underlying client cleanup.
      });

      resolve({
        client: {
          call: async <T = unknown>(method: string, ...args: unknown[]): Promise<T> => {
            return (await client.call(method, ...args)) as T;
          },
        },
        close: async (): Promise<void> => {
          await closeSocket(socket);
        },
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

function launchChrome(): Promise<void> {
  const commands = getChromeLaunchCommands(process.platform);
  if (commands.length === 0) {
    return Promise.reject(new Error(`Auto-launch is not supported on ${process.platform}`));
  }

  return tryLaunchCommands(commands);
}

function getChromeLaunchCommands(platform: NodeJS.Platform): string[] {
  if (platform === 'darwin') {
    return ['open -a "Google Chrome"', 'open -a "Chromium"'];
  }

  if (platform === 'linux') {
    return [
      'google-chrome --no-first-run &',
      'google-chrome-stable --no-first-run &',
      'chromium --no-first-run &',
      'chromium-browser --no-first-run &',
    ];
  }

  if (platform === 'win32') {
    return [
      'start "" chrome --no-first-run',
      'start "" "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" --no-first-run',
      'start "" "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" --no-first-run',
      'start "" "%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe" --no-first-run',
    ];
  }

  return [];
}

async function tryLaunchCommands(commands: string[]): Promise<void> {
  const failures: string[] = [];

  for (const command of commands) {
    try {
      await execCommand(command);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${command}: ${message}`);
    }
  }

  throw new Error(`Failed to launch Chrome: ${failures.join(' | ')}`);
}

function execCommand(command: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    exec(command, { windowsHide: true }, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
