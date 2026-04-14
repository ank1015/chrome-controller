import {
  clearTrackedDebuggerSession,
  ensureTrackedDebuggerSession,
  releaseTrackedDebuggerSession,
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
  private attachFailures: Error[] = [];

  setTargets(targets: ChromeDebuggerTarget[]): void {
    this.targets = [...targets];
  }

  failSendCommand(method: string, error: Error): void {
    const failures = this.sendFailures.get(method) ?? [];
    failures.push(error);
    this.sendFailures.set(method, failures);
  }

  failAttach(error: Error): void {
    this.attachFailures.push(error);
  }

  async attach(target: { tabId: number }, version: string): Promise<void> {
    this.calls.push({
      method: 'attach',
      payload: { target, version },
    });

    if (this.attachFailures.length > 0) {
      throw this.attachFailures.shift() as Error;
    }

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

    const existing = this.targets.find((item) => item.tabId === target.tabId);
    if (existing) {
      existing.attached = false;
    }
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

  it('treats a concurrent attach race as already attached when Chrome reports the tab attached', async () => {
    const api = new MockChromeDebuggerApi();
    api.setTargets([{ tabId: 321, attached: true }]);
    api.failAttach(new Error('Another debugger is already attached to the tab with id: 321.'));

    const sessions = new Map<number, TrackedDebuggerSession>();

    const result = await ensureTrackedDebuggerSession(api, sessions, 321);

    expect(result).toEqual({
      attached: true,
      alreadyAttached: true,
    });
    expect(api.calls).toEqual([
      {
        method: 'attach',
        payload: {
          target: { tabId: 321 },
          version: '1.3',
        },
      },
      { method: 'getTargets' },
    ]);
    expect(sessions.get(321)?.events).toEqual([]);
    expect(sessions.get(321)?.holds).toBe(1);
  });

  it('retries attach when a transient already-attached race clears before targets report attached', async () => {
    const api = new MockChromeDebuggerApi();
    api.failAttach(new Error('Another debugger is already attached to the tab with id: 654.'));

    const sessions = new Map<number, TrackedDebuggerSession>();

    const result = await ensureTrackedDebuggerSession(api, sessions, 654);

    expect(result).toEqual({
      attached: true,
      alreadyAttached: false,
    });
    expect(api.calls).toEqual([
      {
        method: 'attach',
        payload: {
          target: { tabId: 654 },
          version: '1.3',
        },
      },
      { method: 'getTargets' },
      {
        method: 'attach',
        payload: {
          target: { tabId: 654 },
          version: '1.3',
        },
      },
    ]);
    expect(sessions.get(654)?.events).toEqual([]);
    expect(sessions.get(654)?.holds).toBe(1);
  });

  it('increments holds for concurrent tracked attaches and detaches only on final release', async () => {
    const api = new MockChromeDebuggerApi();
    api.setTargets([{ tabId: 777, attached: true }]);

    const sessions = new Map<number, TrackedDebuggerSession>([[777, { events: [], holds: 1 }]]);

    const attachResult = await ensureTrackedDebuggerSession(api, sessions, 777);
    const firstRelease = await releaseTrackedDebuggerSession(api, sessions, 777);
    const secondRelease = await releaseTrackedDebuggerSession(api, sessions, 777);

    expect(attachResult).toEqual({
      attached: true,
      alreadyAttached: true,
    });
    expect(firstRelease).toEqual({
      detached: false,
      remainingHolds: 1,
    });
    expect(secondRelease).toEqual({
      detached: true,
      remainingHolds: 0,
    });
    expect(api.calls).toEqual([
      { method: 'getTargets' },
      { method: 'detach', payload: { tabId: 777 } },
    ]);
    expect(sessions.has(777)).toBe(false);
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
