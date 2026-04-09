import { vi } from 'vitest';

const { connectManagedChromeBridgeMock } = vi.hoisted(() => ({
  connectManagedChromeBridgeMock: vi.fn(),
}));

vi.mock('../../../src/native-cli/bridge.js', () => ({
  connectManagedChromeBridge: connectManagedChromeBridgeMock,
}));

import { connectChromeController } from '../../../src/sdk/index.js';

describe('sdk chrome controller', () => {
  const callMock = vi.fn();
  const subscribeMock = vi.fn();
  const closeMock = vi.fn();

  beforeEach(() => {
    callMock.mockReset();
    subscribeMock.mockReset();
    closeMock.mockReset();
    connectManagedChromeBridgeMock.mockReset();

    connectManagedChromeBridgeMock.mockResolvedValue({
      client: {
        call: callMock,
        subscribe: subscribeMock,
      },
      close: closeMock,
    });
  });

  it('connects with launch enabled by default and proxies raw calls', async () => {
    callMock.mockResolvedValue([{ id: 101, url: 'https://example.com' }]);

    const controller = await connectChromeController({
      host: '127.0.0.1',
      port: 9224,
    });
    const tabs = await controller.call<Array<{ id: number; url: string }>>(
      'tabs.query',
      { active: true }
    );

    expect(connectManagedChromeBridgeMock).toHaveBeenCalledWith({
      host: '127.0.0.1',
      port: 9224,
      launch: true,
    });
    expect(callMock).toHaveBeenCalledWith('tabs.query', { active: true });
    expect(tabs).toEqual([{ id: 101, url: 'https://example.com' }]);
  });

  it('supports raw subscriptions', async () => {
    const unsubscribe = vi.fn();
    const handler = vi.fn();
    subscribeMock.mockReturnValue(unsubscribe);

    const controller = await connectChromeController();
    const returnedUnsubscribe = controller.subscribe('tabs.onUpdated', handler);

    expect(subscribeMock).toHaveBeenCalledWith('tabs.onUpdated', handler);
    expect(returnedUnsubscribe).toBe(unsubscribe);
  });

  it('unwraps evaluate results', async () => {
    callMock.mockResolvedValue({
      result: { title: 'Dashboard' },
      type: 'object',
    });

    const controller = await connectChromeController();
    const value = await controller.evaluate<{ title: string }>(
      101,
      '({ title: document.title })',
      {
        awaitPromise: true,
      }
    );

    expect(callMock).toHaveBeenCalledWith('debugger.evaluate', {
      tabId: 101,
      code: '({ title: document.title })',
      returnByValue: true,
      awaitPromise: true,
    });
    expect(value).toEqual({ title: 'Dashboard' });
  });

  it('creates debugger sessions and cleans up owned sessions on close', async () => {
    callMock
      .mockResolvedValueOnce({
        attached: true,
        alreadyAttached: false,
      })
      .mockResolvedValueOnce({ acknowledged: true })
      .mockResolvedValueOnce([
        {
          method: 'Network.requestWillBeSent',
          params: { requestId: '1' },
        },
      ])
      .mockResolvedValueOnce({ detached: true });

    const controller = await connectChromeController();
    const session = await controller.debugger.attach(101);
    const commandResult = await session.send<{ acknowledged: boolean }>('Network.enable');
    const events = await session.getEvents({ filter: 'Network.' });

    expect(session.alreadyAttached).toBe(false);
    expect(commandResult).toEqual({ acknowledged: true });
    expect(events).toEqual([
      {
        method: 'Network.requestWillBeSent',
        params: { requestId: '1' },
      },
    ]);

    await controller.close();

    expect(callMock).toHaveBeenNthCalledWith(1, 'debugger.attach', { tabId: 101 });
    expect(callMock).toHaveBeenNthCalledWith(2, 'debugger.sendCommand', {
      tabId: 101,
      method: 'Network.enable',
    });
    expect(callMock).toHaveBeenNthCalledWith(3, 'debugger.getEvents', {
      tabId: 101,
      filter: 'Network.',
    });
    expect(callMock).toHaveBeenNthCalledWith(4, 'debugger.detach', { tabId: 101 });
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('does not detach debugger sessions it did not attach', async () => {
    callMock.mockResolvedValueOnce({
      attached: true,
      alreadyAttached: true,
    });

    const controller = await connectChromeController();
    const session = await controller.debugger.attach(101);

    await controller.close();

    expect(session.alreadyAttached).toBe(true);
    expect(callMock).toHaveBeenCalledTimes(1);
    expect(callMock).toHaveBeenCalledWith('debugger.attach', { tabId: 101 });
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it('marks debugger sessions as detached after explicit detach', async () => {
    callMock
      .mockResolvedValueOnce({
        attached: true,
        alreadyAttached: false,
      })
      .mockResolvedValueOnce({ detached: true });

    const controller = await connectChromeController();
    const session = await controller.debugger.attach(101);

    await session.detach();

    await expect(session.send('Network.enable')).rejects.toThrow(
      'Debugger session for tab 101 is detached'
    );
    expect(callMock).toHaveBeenNthCalledWith(1, 'debugger.attach', { tabId: 101 });
    expect(callMock).toHaveBeenNthCalledWith(2, 'debugger.detach', { tabId: 101 });
  });

  it('rejects invalid evaluate input and use after close', async () => {
    callMock.mockResolvedValue([]);

    const controller = await connectChromeController();

    await expect(controller.evaluate(0, 'document.title')).rejects.toThrow('Invalid tab id: 0');
    await expect(controller.evaluate(101, '   ')).rejects.toThrow(
      'Evaluation code must be a non-empty string'
    );

    await controller.close();

    await expect(controller.call('tabs.query', { active: true })).rejects.toThrow(
      'Chrome controller connection is closed'
    );
  });
});
