import { vi } from 'vitest';

const connectManagedChromeBridgeMock = vi.hoisted(() => vi.fn());

vi.mock('../../../src/native-cli/bridge.js', () => ({
  connectManagedChromeBridge: connectManagedChromeBridgeMock,
}));

import { ChromeBrowserService } from '../../../src/native-cli/browser-service.js';

import type { CliSessionRecord } from '../../../src/native-cli/types.js';

function createSession(): CliSessionRecord {
  return {
    id: 'alpha',
    createdAt: '2026-04-14T00:00:00.000Z',
    updatedAt: '2026-04-14T00:00:00.000Z',
    lastUsedAt: '2026-04-14T00:00:00.000Z',
    windowId: null,
    targetTabId: null,
  };
}

describe('ChromeBrowserService managed session windows', () => {
  beforeEach(() => {
    connectManagedChromeBridgeMock.mockReset();
  });

  it('adopts a safe auto-launched startup window instead of opening a second one', async () => {
    const call = vi.fn(async (method: string) => {
      if (method === 'windows.getAll') {
        return [
          {
            id: 11,
            focused: false,
            incognito: false,
            state: 'normal',
            type: 'normal',
            tabs: [{ id: 101, active: true, url: 'chrome://newtab/' }],
            left: 0,
            top: 0,
            width: 1200,
            height: 800,
          },
        ];
      }

      throw new Error(`Unexpected method: ${method}`);
    });
    const close = vi.fn(async () => {});

    connectManagedChromeBridgeMock.mockResolvedValue({
      launched: true,
      client: {
        call,
        subscribe: vi.fn(() => () => {}),
      },
      close,
    });

    const window = await new ChromeBrowserService().createManagedSessionWindow(createSession());

    expect(window.id).toBe(11);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith('windows.getAll', { populate: true });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('creates a new background window when the auto-launched startup window is not disposable', async () => {
    const call = vi.fn(async (method: string, ...args: unknown[]) => {
      if (method === 'windows.getAll') {
        return [
          {
            id: 11,
            focused: false,
            incognito: false,
            state: 'normal',
            type: 'normal',
            tabs: [{ id: 101, active: true, url: 'https://example.com' }],
            left: 0,
            top: 0,
            width: 1200,
            height: 800,
          },
        ];
      }

      if (method === 'windows.create') {
        expect(args[0]).toEqual({ focused: false });
        return {
          id: 22,
          focused: false,
          incognito: false,
          state: 'normal',
          type: 'normal',
          tabs: [],
          left: 10,
          top: 10,
          width: 1280,
          height: 900,
        };
      }

      throw new Error(`Unexpected method: ${method}`);
    });

    connectManagedChromeBridgeMock.mockResolvedValue({
      launched: true,
      client: {
        call,
        subscribe: vi.fn(() => () => {}),
      },
      close: vi.fn(async () => {}),
    });

    const window = await new ChromeBrowserService().createManagedSessionWindow(createSession());

    expect(window.id).toBe(22);
    expect(call).toHaveBeenNthCalledWith(1, 'windows.getAll', { populate: true });
    expect(call).toHaveBeenNthCalledWith(2, 'windows.create', { focused: false });
  });

  it('closes disposable startup windows after creating a dedicated managed window', async () => {
    const call = vi.fn(async (method: string, ...args: unknown[]) => {
      if (method === 'windows.getAll') {
        return [
          {
            id: 11,
            focused: false,
            incognito: false,
            state: 'normal',
            type: 'normal',
            tabs: [{ id: 101, active: true, url: 'chrome://newtab/' }],
          },
          {
            id: 12,
            focused: false,
            incognito: false,
            state: 'normal',
            type: 'normal',
            tabs: [{ id: 102, active: true, url: 'about:blank' }],
          },
        ];
      }

      if (method === 'windows.create') {
        expect(args[0]).toEqual({ focused: false });
        return {
          id: 30,
          focused: false,
          incognito: false,
          state: 'normal',
          type: 'normal',
          tabs: [],
        };
      }

      if (method === 'windows.remove') {
        return undefined;
      }

      throw new Error(`Unexpected method: ${method}`);
    });

    connectManagedChromeBridgeMock.mockResolvedValue({
      launched: true,
      client: {
        call,
        subscribe: vi.fn(() => () => {}),
      },
      close: vi.fn(async () => {}),
    });

    const window = await new ChromeBrowserService().createManagedSessionWindow(createSession());

    expect(window.id).toBe(30);
    expect(call).toHaveBeenNthCalledWith(1, 'windows.getAll', { populate: true });
    expect(call).toHaveBeenNthCalledWith(2, 'windows.create', { focused: false });
    expect(call).toHaveBeenNthCalledWith(3, 'windows.remove', 11);
    expect(call).toHaveBeenNthCalledWith(4, 'windows.remove', 12);
  });
});
