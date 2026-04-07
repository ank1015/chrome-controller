import {
  clearTrackedDebuggerSession,
  ensureTrackedDebuggerSession,
  sendTrackedDebuggerCommand,
} from '../../../src/chrome/debugger-session.js';

import type {
  ChromeDebuggerApi,
  ChromeDebuggerTarget,
  TrackedDebuggerSession,
} from '../../../src/chrome/debugger-session.js';

class MockChromeDebuggerApi implements ChromeDebuggerApi {
  readonly calls: Array<{ method: string; payload?: unknown }> = [];

  private targets: ChromeDebuggerTarget[] = [];
  private sendFailures = new Map<string, Error[]>();

  setTargets(targets: ChromeDebuggerTarget[]): void {
    this.targets = [...targets];
  }

  failSendCommand(method: string, error: Error): void {
    const failures = this.sendFailures.get(method) ?? [];
    failures.push(error);
    this.sendFailures.set(method, failures);
  }

  async attach(target: { tabId: number }, version: string): Promise<void> {
    this.calls.push({
      method: 'attach',
      payload: { target, version },
    });

    const existing = this.targets.find((item) => item.tabId === target.tabId);
    if (existing) {
      existing.attached = true;
    } else {
      this.targets.push({
        tabId: target.tabId,
        attached: true,
      });
    }
  }

  async sendCommand(
    target: { tabId: number },
    method: string,
    params?: object
  ): Promise<unknown> {
    this.calls.push({
      method: 'sendCommand',
      payload: { target, method, params: params ?? null },
    });

    const failures = this.sendFailures.get(method);
    if (failures && failures.length > 0) {
      throw failures.shift() as Error;
    }

    return {
      ok: true,
      method,
    };
  }

  async detach(target: { tabId: number }): Promise<void> {
    this.calls.push({
      method: 'detach',
      payload: target,
    });
  }

  async getTargets(): Promise<ChromeDebuggerTarget[]> {
    this.calls.push({
      method: 'getTargets',
    });

    return this.targets.map((target) => ({ ...target }));
  }
}

describe('debugger session recovery helpers', () => {
  it('reattaches when a tracked session exists but Chrome no longer reports it attached', async () => {
    const api = new MockChromeDebuggerApi();
    api.setTargets([{ tabId: 123, attached: false }]);

    const sessions = new Map<number, TrackedDebuggerSession>([
      [123, { events: [{ method: 'Network.requestWillBeSent', params: {} }] }],
    ]);

    const result = await ensureTrackedDebuggerSession(api, sessions, 123);

    expect(result).toEqual({
      attached: true,
      alreadyAttached: false,
    });
    expect(api.calls).toEqual([
      { method: 'getTargets' },
      {
        method: 'attach',
        payload: {
          target: { tabId: 123 },
          version: '1.3',
        },
      },
    ]);
    expect(sessions.get(123)?.events).toEqual([
      { method: 'Network.requestWillBeSent', params: {} },
    ]);
  });

  it('retries sendCommand after a detached-debugger error on a tracked session', async () => {
    const api = new MockChromeDebuggerApi();
    api.setTargets([{ tabId: 456, attached: true }]);
    api.failSendCommand(
      'Runtime.enable',
      new Error('Debugger is not attached to the tab with id: 456.')
    );

    const sessions = new Map<number, TrackedDebuggerSession>([[456, { events: [] }]]);

    const result = await sendTrackedDebuggerCommand(
      api,
      sessions,
      456,
      'Runtime.enable'
    );

    expect(result).toEqual({
      ok: true,
      method: 'Runtime.enable',
    });
    expect(api.calls).toEqual([
      {
        method: 'sendCommand',
        payload: {
          target: { tabId: 456 },
          method: 'Runtime.enable',
          params: null,
        },
      },
      {
        method: 'attach',
        payload: {
          target: { tabId: 456 },
          version: '1.3',
        },
      },
      {
        method: 'sendCommand',
        payload: {
          target: { tabId: 456 },
          method: 'Runtime.enable',
          params: null,
        },
      },
    ]);
  });

  it('clears a tracked session when Chrome detaches the debugger externally', () => {
    const sessions = new Map<number, TrackedDebuggerSession>([
      [789, { events: [{ method: 'Runtime.consoleAPICalled', params: {} }] }],
    ]);

    clearTrackedDebuggerSession(sessions, { tabId: 789 });

    expect(sessions.has(789)).toBe(false);
  });
});
