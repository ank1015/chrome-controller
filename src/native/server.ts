import { createServer } from 'node:net';

import { DEFAULT_PORT, MAX_TCP_MESSAGE_SIZE_BYTES } from '../protocol/constants.js';

import { readMessageWithOptions, writeMessageWithOptions } from './stdio.js';

import type {
  HostMessage,
  CallMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  ChromeMessage,
} from '../protocol/types.js';
import type { ChromeClient } from '../sdk/core/client.js';
import type { Server, Socket } from 'node:net';

export interface ChromeServerOptions {
  port?: number;
  host?: string;
}

/**
 * TCP server that proxies Chrome API calls from external agents
 * through a ChromeClient connected to Chrome's native messaging.
 *
 * Each TCP connection gets its own read loop and subscription tracking.
 * Multiple agents can connect simultaneously.
 */
export class ChromeServer {
  private server: Server;
  private chromeClient: ChromeClient;

  constructor(chromeClient: ChromeClient, opts?: ChromeServerOptions) {
    this.chromeClient = chromeClient;

    const port = opts?.port ?? DEFAULT_PORT;
    const host = opts?.host ?? '127.0.0.1';

    this.server = createServer((socket) => {
      this.handleConnection(socket);
    });

    this.server.on('error', (err) => {
      process.stderr.write(`[server] error: ${err.message}\n`);
    });

    this.server.listen(port, host, () => {
      process.stderr.write(`[server] listening on ${host}:${port}\n`);
    });
  }

  private async handleConnection(socket: Socket): Promise<void> {
    const clientSubs = new Map<string, () => void>();

    socket.on('error', () => {
      // Client disconnected unexpectedly — cleanup happens below
    });

    while (true) {
      let msg: HostMessage | null;

      try {
        msg = await readMessageWithOptions<HostMessage>(socket, {
          maxMessageSizeBytes: MAX_TCP_MESSAGE_SIZE_BYTES,
        });
      } catch {
        break;
      }

      if (msg === null) break;

      switch (msg.type) {
        case 'call':
          // Fire-and-forget — multiple calls can be in-flight
          this.handleCall(socket, msg);
          break;
        case 'subscribe':
          this.handleSubscribe(socket, msg, clientSubs);
          break;
        case 'unsubscribe':
          this.handleUnsubscribe(msg, clientSubs);
          break;
      }
    }

    // Client disconnected — clean up all subscriptions
    for (const unsub of clientSubs.values()) unsub();
    clientSubs.clear();
  }

  private async handleCall(socket: Socket, msg: CallMessage): Promise<void> {
    try {
      const result = await this.chromeClient.call(msg.method, ...msg.args);
      this.send(socket, { id: msg.id, type: 'result', data: result });
    } catch (e) {
      this.send(socket, {
        id: msg.id,
        type: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  private handleSubscribe(
    socket: Socket,
    msg: SubscribeMessage,
    clientSubs: Map<string, () => void>
  ): void {
    const unsub = this.chromeClient.subscribe(msg.event, (data: unknown) => {
      this.send(socket, { id: msg.id, type: 'event', data });
    });
    clientSubs.set(msg.id, unsub);
  }

  private handleUnsubscribe(msg: UnsubscribeMessage, clientSubs: Map<string, () => void>): void {
    const unsub = clientSubs.get(msg.id);
    if (unsub) {
      unsub();
      clientSubs.delete(msg.id);
    }
  }

  private send(socket: Socket, message: ChromeMessage): void {
    try {
      if (!socket.destroyed) {
        writeMessageWithOptions(message, socket, {
          maxMessageSizeBytes: MAX_TCP_MESSAGE_SIZE_BYTES,
        });
      }
    } catch {
      // Socket write failed — client likely disconnected
    }
  }

  close(): void {
    this.server.close();
  }

  get address(): { port: number; host: string } | null {
    const addr = this.server.address();
    if (addr && typeof addr === 'object') {
      return { port: addr.port, host: addr.address };
    }
    return null;
  }
}
