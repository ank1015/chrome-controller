import { exec } from 'node:child_process';
import { connect as tcpConnect } from 'node:net';

import { DEFAULT_PORT, MAX_TCP_MESSAGE_SIZE_BYTES } from '../../protocol/constants.js';

import { ChromeClient } from './client.js';

export interface ConnectOptions {
  port?: number;
  host?: string;
  /** Launch Chrome automatically if connection fails. Default: false */
  launch?: boolean;
  /** Max ms to wait for Chrome + native host to be ready. Default: 30000 */
  launchTimeout?: number;
  /** Max ms to wait for an individual Chrome RPC call. Default: no timeout */
  callTimeoutMs?: number;
}

const DEFAULT_LAUNCH_TIMEOUT = 30_000;

/**
 * Connect to the Chrome RPC server over TCP.
 *
 * Returns a ChromeClient with the same `call()` and `subscribe()` API
 * as the native host uses directly. The connection is multiplexed —
 * multiple calls and subscriptions can be in-flight simultaneously.
 *
 * When `launch: true` is set, Chrome will be opened automatically
 * if the connection fails, then retried until the native host is ready.
 *
 * @example
 * ```ts
 * import { connect } from '@ank1015/llm-extension';
 *
 * const chrome = await connect({ launch: true });
 * const tabs = await chrome.call('tabs.query', { active: true });
 * ```
 */
export async function connect(opts?: ConnectOptions): Promise<ChromeClient> {
  const port = opts?.port ?? DEFAULT_PORT;
  const host = opts?.host ?? '127.0.0.1';

  try {
    return await tryConnect(port, host, opts?.callTimeoutMs);
  } catch (error) {
    if (!opts?.launch || !isConnectionRefused(error)) {
      throw error;
    }

    await launchChrome();

    const timeout = opts.launchTimeout ?? DEFAULT_LAUNCH_TIMEOUT;
    const deadline = Date.now() + timeout;
    let delay = 200;

    while (Date.now() < deadline) {
      await sleep(delay);
      try {
        return await tryConnect(port, host, opts?.callTimeoutMs);
      } catch (retryError) {
        if (!isConnectionRefused(retryError)) throw retryError;
      }
      delay = Math.min(delay * 2, 2000);
    }

    throw new Error(
      `Chrome did not become available on ${host}:${port} within ${timeout}ms. ` +
        'Ensure the extension is installed and the native host is registered.'
    );
  }
}

function tryConnect(port: number, host: string, callTimeoutMs?: number): Promise<ChromeClient> {
  return new Promise<ChromeClient>((resolve, reject) => {
    const socket = tcpConnect({ port, host }, () => {
      const client = new ChromeClient({
        input: socket,
        output: socket,
        maxIncomingMessageSizeBytes: MAX_TCP_MESSAGE_SIZE_BYTES,
        maxOutgoingMessageSizeBytes: MAX_TCP_MESSAGE_SIZE_BYTES,
        ...(callTimeoutMs === undefined ? {} : { callTimeoutMs }),
      });
      client.run().catch(() => {
        // Errors propagate to pending calls via client.closed
      });
      resolve(client);
    });
    socket.once('error', reject);
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
