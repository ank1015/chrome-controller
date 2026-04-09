import { connectManagedChromeBridge } from '../native-cli/bridge.js';

import type { ManagedChromeBridge } from '../native-cli/bridge.js';
import type { CliDebuggerEvent } from '../native-cli/types.js';
import type {
  ChromeController,
  ChromeControllerConnectOptions,
  ChromeControllerDebuggerApi,
  ChromeDebuggerEventsOptions,
  ChromeDebuggerSession,
  ChromeEvaluateOptions,
} from './types.js';

interface DebuggerAttachResult {
  attached?: boolean;
  alreadyAttached?: boolean;
}

interface DebuggerEvaluateResult<T> {
  result?: T;
  type?: string;
}

class ChromeDebuggerSessionImpl implements ChromeDebuggerSession {
  readonly tabId: number;
  readonly alreadyAttached: boolean;

  #controller: ChromeControllerImpl;
  #detached = false;
  #ownedByController: boolean;

  constructor(
    controller: ChromeControllerImpl,
    tabId: number,
    options: { alreadyAttached: boolean; ownedByController: boolean }
  ) {
    this.#controller = controller;
    this.tabId = tabId;
    this.alreadyAttached = options.alreadyAttached;
    this.#ownedByController = options.ownedByController;
  }

  get detached(): boolean {
    return this.#detached;
  }

  get ownedByController(): boolean {
    return this.#ownedByController;
  }

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.#assertAttached();
    return await this.#controller.call<T>(
      'debugger.sendCommand',
      {
        tabId: this.tabId,
        method,
        ...(params ? { params } : {}),
      }
    );
  }

  async getEvents(options: ChromeDebuggerEventsOptions = {}): Promise<CliDebuggerEvent[]> {
    this.#assertAttached();
    return await this.#controller.call<CliDebuggerEvent[]>(
      'debugger.getEvents',
      {
        tabId: this.tabId,
        ...(options.filter ? { filter: options.filter } : {}),
        ...(options.clear === true ? { clear: true } : {}),
      }
    );
  }

  async detach(): Promise<void> {
    if (this.#detached) {
      return;
    }

    this.#controller.assertOpen();
    await this.#controller.callBridge('debugger.detach', {
      tabId: this.tabId,
    });
    this.markDetached();
  }

  markDetached(): void {
    this.#detached = true;
    this.#controller.unregisterDebuggerSession(this.tabId);
  }

  #assertAttached(): void {
    this.#controller.assertOpen();

    if (this.#detached) {
      throw new Error(`Debugger session for tab ${this.tabId} is detached`);
    }
  }
}

class ChromeControllerDebuggerApiImpl implements ChromeControllerDebuggerApi {
  #controller: ChromeControllerImpl;

  constructor(controller: ChromeControllerImpl) {
    this.#controller = controller;
  }

  async attach(tabId: number): Promise<ChromeDebuggerSession> {
    this.#controller.assertOpen();
    assertTabId(tabId);

    const existing = this.#controller.getDebuggerSession(tabId);
    if (existing && !existing.detached) {
      return existing;
    }

    const result = await this.#controller.callBridge<DebuggerAttachResult>(
      'debugger.attach',
      { tabId }
    );

    if (result.attached !== true && result.alreadyAttached !== true) {
      throw new Error(`Failed to attach debugger to tab ${tabId}`);
    }

    const session = new ChromeDebuggerSessionImpl(this.#controller, tabId, {
      alreadyAttached: result.alreadyAttached === true,
      ownedByController: result.alreadyAttached !== true,
    });
    this.#controller.registerDebuggerSession(session);

    return session;
  }
}

class ChromeControllerImpl implements ChromeController {
  readonly debugger: ChromeControllerDebuggerApi;

  #bridge: ManagedChromeBridge;
  #closed = false;
  #debuggerSessions = new Map<number, ChromeDebuggerSessionImpl>();

  constructor(bridge: ManagedChromeBridge) {
    this.#bridge = bridge;
    this.debugger = new ChromeControllerDebuggerApiImpl(this);
  }

  async call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    this.assertOpen();
    return await this.callBridge<T>(method, ...args);
  }

  subscribe<T = unknown>(event: string, callback: (data: T) => void): () => void {
    this.assertOpen();
    return this.#bridge.client.subscribe<T>(event, callback);
  }

  async evaluate<T = unknown>(
    tabId: number,
    code: string,
    options: ChromeEvaluateOptions = {}
  ): Promise<T> {
    this.assertOpen();
    assertTabId(tabId);
    assertCode(code);

    const result = await this.callBridge<DebuggerEvaluateResult<T>>(
      'debugger.evaluate',
      {
        tabId,
        code,
        returnByValue: true,
        ...(options.awaitPromise === true ? { awaitPromise: true } : {}),
        ...(options.userGesture === true ? { userGesture: true } : {}),
      }
    );

    return result.result as T;
  }

  async close(): Promise<void> {
    if (this.#closed) {
      return;
    }

    const sessions = [...this.#debuggerSessions.values()];
    this.#closed = true;

    await Promise.allSettled(
      sessions.map(async (session) => {
        if (session.detached) {
          return;
        }

        if (session.ownedByController) {
          await this.callBridge('debugger.detach', {
            tabId: session.tabId,
          });
        }

        session.markDetached();
      })
    );

    await this.#bridge.close();
  }

  async callBridge<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    return await this.#bridge.client.call<T>(method, ...args);
  }

  assertOpen(): void {
    if (this.#closed) {
      throw new Error('Chrome controller connection is closed');
    }
  }

  registerDebuggerSession(session: ChromeDebuggerSessionImpl): void {
    this.#debuggerSessions.set(session.tabId, session);
  }

  unregisterDebuggerSession(tabId: number): void {
    this.#debuggerSessions.delete(tabId);
  }

  getDebuggerSession(tabId: number): ChromeDebuggerSessionImpl | null {
    return this.#debuggerSessions.get(tabId) ?? null;
  }
}

export async function connectChromeController(
  options: ChromeControllerConnectOptions = {}
): Promise<ChromeController> {
  const bridge = await connectManagedChromeBridge({
    ...options,
    launch: options.launch ?? true,
  });

  return new ChromeControllerImpl(bridge);
}

function assertTabId(tabId: number): void {
  if (!Number.isInteger(tabId) || tabId <= 0) {
    throw new Error(`Invalid tab id: ${String(tabId)}`);
  }
}

function assertCode(code: string): void {
  if (typeof code !== 'string' || code.trim().length === 0) {
    throw new Error('Evaluation code must be a non-empty string');
  }
}
