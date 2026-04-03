import { ConnectOptions } from './connect.js';
export interface ManagedChromeBridgeClient {
    call<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
}
export interface ManagedChromeBridge {
    client: ManagedChromeBridgeClient;
    close(): Promise<void>;
}
export interface ConnectWebTransportOptions extends ConnectOptions {
}
export declare function connectManagedChromeBridge(options?: ConnectWebTransportOptions): Promise<ManagedChromeBridge>;
//# sourceMappingURL=transport.d.ts.map