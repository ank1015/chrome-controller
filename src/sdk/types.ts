import type { ConnectChromeBridgeOptions } from '../native-cli/bridge.js';
import type { CliDebuggerEvent } from '../native-cli/types.js';

export interface ChromeControllerConnectOptions extends ConnectChromeBridgeOptions {}

export interface ChromeEvaluateOptions {
  awaitPromise?: boolean;
  userGesture?: boolean;
}

export interface ChromeDebuggerEventsOptions {
  filter?: string;
  clear?: boolean;
}

export interface ChromeDebuggerSession {
  readonly tabId: number;
  readonly alreadyAttached: boolean;

  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  getEvents(options?: ChromeDebuggerEventsOptions): Promise<CliDebuggerEvent[]>;
  detach(): Promise<void>;
}

export interface ChromeControllerDebuggerApi {
  attach(tabId: number): Promise<ChromeDebuggerSession>;
}

export interface ChromeController {
  readonly debugger: ChromeControllerDebuggerApi;

  call<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
  subscribe<T = unknown>(event: string, callback: (data: T) => void): () => void;
  evaluate<T = unknown>(
    tabId: number,
    code: string,
    options?: ChromeEvaluateOptions
  ): Promise<T>;
  close(): Promise<void>;
}
