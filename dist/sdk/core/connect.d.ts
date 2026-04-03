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
export declare function connect(opts?: ConnectOptions): Promise<ChromeClient>;
//# sourceMappingURL=connect.d.ts.map