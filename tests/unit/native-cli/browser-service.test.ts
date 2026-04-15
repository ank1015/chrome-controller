import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('updates window bounds and state through the Chrome windows API', async () => {
    const call = vi.fn(async (method: string, ...args: unknown[]) => {
      if (method === 'windows.update') {
        expect(args).toEqual([
          11,
          {
            state: 'normal',
            left: 10,
            top: 20,
            width: 1280,
            height: 900,
          },
        ]);

        return {
          id: 11,
          focused: false,
          incognito: false,
          state: 'normal',
          type: 'normal',
          tabs: [],
          left: 10,
          top: 20,
          width: 1280,
          height: 900,
        };
      }

      if (method === 'windows.get') {
        expect(args).toEqual([
          11,
          {
            populate: true,
          },
        ]);

        return {
          id: 11,
          focused: true,
          incognito: false,
          state: 'normal',
          type: 'normal',
          tabs: [
            {
              id: 101,
              active: true,
              url: 'https://example.com/current',
            },
            {
              id: 102,
              active: false,
              url: 'https://example.com/other',
            },
          ],
          left: 10,
          top: 20,
          width: 1280,
          height: 900,
        };
      }

      throw new Error(`Unexpected method: ${method}`);
    });
    const close = vi.fn(async () => {});

    connectManagedChromeBridgeMock.mockResolvedValue({
      launched: false,
      client: {
        call,
        subscribe: vi.fn(() => () => {}),
      },
      close,
    });

    const window = await new ChromeBrowserService().updateWindow(createSession(), 11, {
      state: 'normal',
      left: 10,
      top: 20,
      width: 1280,
      height: 900,
    });

    expect(window).toEqual({
      id: 11,
      focused: true,
      incognito: false,
      state: 'normal',
      type: 'normal',
      tabCount: 2,
      tabs: [
        {
          id: 101,
          active: true,
          url: 'https://example.com/current',
        },
        {
          id: 102,
          active: false,
          url: 'https://example.com/other',
        },
      ],
      activeTab: {
        id: 101,
        active: true,
        url: 'https://example.com/current',
      },
      bounds: {
        left: 10,
        top: 20,
        width: 1280,
        height: 900,
      },
    });
    expect(call).toHaveBeenNthCalledWith(1, 'windows.update', 11, {
      state: 'normal',
      left: 10,
      top: 20,
      width: 1280,
      height: 900,
    });
    expect(call).toHaveBeenNthCalledWith(2, 'windows.get', 11, {
      populate: true,
    });
    expect(close).toHaveBeenCalledTimes(2);
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

  it('falls back to synthetic in-page upload when DOM.setFileInputFiles is rejected', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'chrome-controller-upload-fallback-'));
    const filePath = join(tempDir, 'note.txt');
    await writeFile(filePath, 'hello from fallback\n', 'utf8');

    const call = vi.fn(async (method: string, payload: Record<string, unknown>) => {
      if (method === 'debugger.attach') {
        expect(payload).toEqual({ tabId: 101 });
        return {
          attached: true,
          alreadyAttached: false,
        };
      }

      if (method === 'debugger.detach') {
        expect(payload).toEqual({ tabId: 101 });
        return {
          detached: true,
        };
      }

      if (method === 'debugger.sendCommand') {
        if (payload.method === 'DOM.enable' || payload.method === 'Runtime.enable') {
          return {};
        }

        if (payload.method === 'Runtime.evaluate') {
          const params = payload.params as Record<string, unknown>;
          const expression = String(params.expression ?? '');

          if (expression.includes('isFileInput')) {
            return {
              result: {
                value: {
                  found: true,
                  isFileInput: true,
                },
              },
            };
          }

          if (
            expression.includes('document.querySelector(') &&
            expression.includes('Filedata')
          ) {
            return {
              result: {
                objectId: 'obj-1',
              },
            };
          }
        }

        if (payload.method === 'DOM.requestNode') {
          expect(payload.params).toEqual({ objectId: 'obj-1' });
          return {
            nodeId: 42,
          };
        }

        if (payload.method === 'DOM.setFileInputFiles') {
          expect(payload.params).toEqual({
            nodeId: 42,
            files: [filePath],
          });
          throw new Error('{"code":-32000,"message":"Not allowed"}');
        }

        throw new Error(`Unexpected debugger.sendCommand payload: ${JSON.stringify(payload)}`);
      }

      if (method === 'debugger.evaluate') {
        expect(payload.tabId).toBe(101);
        expect(String(payload.code ?? '')).toContain('new DataTransfer()');
        expect(String(payload.code ?? '')).toContain('"note.txt"');
        return {
          result: {
            assignedCount: 1,
            names: ['note.txt'],
          },
        };
      }

      throw new Error(`Unexpected method: ${method}`);
    });
    const close = vi.fn(async () => {});

    connectManagedChromeBridgeMock.mockResolvedValue({
      launched: false,
      client: {
        call,
        subscribe: vi.fn(() => () => {}),
      },
      close,
    });

    try {
      const result = await new ChromeBrowserService().uploadFiles(
        createSession(),
        101,
        'input[name="Filedata"]',
        [filePath]
      );

      expect(result).toEqual({
        selector: 'input[name="Filedata"]',
        files: [filePath],
      });
      expect(call).toHaveBeenCalledWith('debugger.evaluate', expect.objectContaining({
        tabId: 101,
        returnByValue: true,
        awaitPromise: true,
        userGesture: true,
      }));
      expect(close).toHaveBeenCalled();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
