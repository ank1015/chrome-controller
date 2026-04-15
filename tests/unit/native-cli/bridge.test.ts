import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { connectMock, launchChromeMock } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  launchChromeMock: vi.fn(),
}));

vi.mock('node:net', async () => {
  const actual = await vi.importActual<typeof import('node:net')>('node:net');
  return {
    ...actual,
    connect: connectMock,
  };
});

vi.mock('../../../src/native-cli/chrome-launcher.js', () => ({
  launchChrome: launchChromeMock,
}));

import { connectManagedChromeBridge } from '../../../src/native-cli/bridge.js';

class FakeSocket extends EventEmitter {
  destroyed = false;
  private timeoutId: NodeJS.Timeout | null = null;

  setTimeout(ms: number): this {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }

    if (ms > 0) {
      this.timeoutId = setTimeout(() => {
        this.emit('timeout');
      }, ms);
    }

    return this;
  }

  end(): this {
    this.destroyed = true;
    this.emit('close');
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    this.emit('close');
    return this;
  }

  write(): boolean {
    return true;
  }
}

function createRefusedSocket(): FakeSocket {
  const socket = new FakeSocket();
  queueMicrotask(() => {
    const error = new Error('connect ECONNREFUSED 127.0.0.1:9222') as NodeJS.ErrnoException;
    error.code = 'ECONNREFUSED';
    socket.emit('error', error);
  });
  return socket;
}

describe('connectManagedChromeBridge', () => {
  beforeEach(() => {
    connectMock.mockReset();
    launchChromeMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fails fast with a clear bridge-unavailable error when the socket never responds', async () => {
    connectMock.mockImplementation(() => new FakeSocket());

    await expect(
      connectManagedChromeBridge({
        launch: false,
        connectTimeoutMs: 5,
      })
    ).rejects.toThrow(
      'Could not connect to the chrome-controller bridge on 127.0.0.1:9224.'
    );

    await expect(
      connectManagedChromeBridge({
        launch: false,
        connectTimeoutMs: 5,
      })
    ).rejects.toThrow('Ensure Chrome is running with the extension installed and enabled');
  });

  it('reports a missing bridge clearly after launching Chrome when the extension is unavailable', async () => {
    connectMock.mockImplementation(() => createRefusedSocket());
    launchChromeMock.mockResolvedValue(undefined);

    await expect(
      connectManagedChromeBridge({
        launch: true,
        launchTimeout: 10,
        connectTimeoutMs: 5,
      })
    ).rejects.toThrow('Chrome opened, but the chrome-controller bridge did not become available');

    expect(launchChromeMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalled();
  });
});
