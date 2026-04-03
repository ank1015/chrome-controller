import { createServer } from 'node:net';
import { DEFAULT_PORT, MAX_TCP_MESSAGE_SIZE_BYTES } from '../protocol/constants.js';
import { readMessageWithOptions, writeMessageWithOptions } from './stdio.js';
/**
 * TCP server that proxies Chrome API calls from external agents
 * through a ChromeClient connected to Chrome's native messaging.
 *
 * Each TCP connection gets its own read loop and subscription tracking.
 * Multiple agents can connect simultaneously.
 */
export class ChromeServer {
    server;
    chromeClient;
    constructor(chromeClient, opts) {
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
    async handleConnection(socket) {
        const clientSubs = new Map();
        socket.on('error', () => {
            // Client disconnected unexpectedly — cleanup happens below
        });
        while (true) {
            let msg;
            try {
                msg = await readMessageWithOptions(socket, {
                    maxMessageSizeBytes: MAX_TCP_MESSAGE_SIZE_BYTES,
                });
            }
            catch {
                break;
            }
            if (msg === null)
                break;
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
        for (const unsub of clientSubs.values())
            unsub();
        clientSubs.clear();
    }
    async handleCall(socket, msg) {
        try {
            const result = await this.chromeClient.call(msg.method, ...msg.args);
            this.send(socket, { id: msg.id, type: 'result', data: result });
        }
        catch (e) {
            this.send(socket, {
                id: msg.id,
                type: 'error',
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }
    handleSubscribe(socket, msg, clientSubs) {
        const unsub = this.chromeClient.subscribe(msg.event, (data) => {
            this.send(socket, { id: msg.id, type: 'event', data });
        });
        clientSubs.set(msg.id, unsub);
    }
    handleUnsubscribe(msg, clientSubs) {
        const unsub = clientSubs.get(msg.id);
        if (unsub) {
            unsub();
            clientSubs.delete(msg.id);
        }
    }
    send(socket, message) {
        try {
            if (!socket.destroyed) {
                writeMessageWithOptions(message, socket, {
                    maxMessageSizeBytes: MAX_TCP_MESSAGE_SIZE_BYTES,
                });
            }
        }
        catch {
            // Socket write failed — client likely disconnected
        }
    }
    close() {
        this.server.close();
    }
    get address() {
        const addr = this.server.address();
        if (addr && typeof addr === 'object') {
            return { port: addr.port, host: addr.address };
        }
        return null;
    }
}
//# sourceMappingURL=server.js.map