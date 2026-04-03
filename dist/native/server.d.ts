import type { ChromeClient } from '../sdk/core/client.js';
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
export declare class ChromeServer {
    private server;
    private chromeClient;
    constructor(chromeClient: ChromeClient, opts?: ChromeServerOptions);
    private handleConnection;
    private handleCall;
    private handleSubscribe;
    private handleUnsubscribe;
    private send;
    close(): void;
    get address(): {
        port: number;
        host: string;
    } | null;
}
//# sourceMappingURL=server.d.ts.map