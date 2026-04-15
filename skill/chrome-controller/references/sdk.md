# SDK

The TypeScript SDK is intentionally low level.

Use it for automations and repeatable scripts once you already know the workflow.

## Install

```bash
npm install @ank1015/chrome-controller
```

## Import

```ts
import { connectChromeController } from '@ank1015/chrome-controller';
```

## Design

The SDK does not mirror the CLI's opinionated session model.

It does not track:

- sessions
- managed windows
- a current tab
- snapshot caches
- `@eN` refs

You are expected to resolve and manage `tabId` values explicitly.

## Entry Point

```ts
const chrome = await connectChromeController(options?);
```

Exported from [src/sdk/index.ts](/Users/notacoder/Desktop/agents/chrome-controller/src/sdk/index.ts:1).

## Connect Options

`ChromeControllerConnectOptions` extends the bridge connection options from [src/native-cli/bridge.ts](/Users/notacoder/Desktop/agents/chrome-controller/src/native-cli/bridge.ts:14).

```ts
interface ChromeControllerConnectOptions {
  port?: number;
  host?: string;
  launch?: boolean;
  launchTimeout?: number;
  callTimeoutMs?: number;
}
```

Notes:

- `launch` defaults to `true` in the SDK implementation
- launch uses the same Chrome auto-launch path as the CLI
- that means it uses the same profile-aware launcher and central config

## Public Types

The main exported SDK types live in [src/sdk/types.ts](/Users/notacoder/Desktop/agents/chrome-controller/src/sdk/types.ts:1).

```ts
interface ChromeEvaluateOptions {
  awaitPromise?: boolean;
  userGesture?: boolean;
}

interface ChromeDebuggerEventsOptions {
  filter?: string;
  clear?: boolean;
}

interface ChromeDebuggerSession {
  readonly tabId: number;
  readonly alreadyAttached: boolean;

  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  getEvents(options?: ChromeDebuggerEventsOptions): Promise<CliDebuggerEvent[]>;
  detach(): Promise<void>;
}

interface ChromeControllerDebuggerApi {
  attach(tabId: number): Promise<ChromeDebuggerSession>;
}

interface ChromeController {
  readonly debugger: ChromeControllerDebuggerApi;

  call<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
  subscribe<T = unknown>(event: string, callback: (data: T) => void): () => void;
  evaluate<T = unknown>(tabId: number, code: string, options?: ChromeEvaluateOptions): Promise<T>;
  close(): Promise<void>;
}
```

## Core Methods

### `connectChromeController(options?)`

Creates a persistent connection to the Chrome bridge.

Implementation: [src/sdk/controller.ts](/Users/notacoder/Desktop/agents/chrome-controller/src/sdk/controller.ts:231)

```ts
const chrome = await connectChromeController();
```

### `chrome.call(method, ...args)`

Low-level access to bridge methods.

Implementation: [src/sdk/controller.ts](/Users/notacoder/Desktop/agents/chrome-controller/src/sdk/controller.ts:148)

Use this for raw browser operations such as querying or creating tabs and windows.

```ts
const tabs = await chrome.call<Array<{ id?: number; url?: string }>>(
  'tabs.query',
  [{ currentWindow: true }]
);
```

### `chrome.subscribe(event, callback)`

Subscribes to bridge events and returns an unsubscribe function.

Implementation: [src/sdk/controller.ts](/Users/notacoder/Desktop/agents/chrome-controller/src/sdk/controller.ts:153)

```ts
const unsubscribe = chrome.subscribe('tabs.onUpdated', (event) => {
  console.log(event);
});
```

### `chrome.evaluate(tabId, code, options?)`

Evaluates JavaScript in a tab and returns the unwrapped value.

Implementation: [src/sdk/controller.ts](/Users/notacoder/Desktop/agents/chrome-controller/src/sdk/controller.ts:158)

Options:

- `awaitPromise`
- `userGesture`

```ts
const title = await chrome.evaluate<string>(tabId, 'document.title');
```

### `chrome.debugger.attach(tabId)`

Attaches to a tab and returns a `ChromeDebuggerSession`.

Implementation: [src/sdk/controller.ts](/Users/notacoder/Desktop/agents/chrome-controller/src/sdk/controller.ts:109)

```ts
const session = await chrome.debugger.attach(tabId);
```

### `debuggerSession.send(method, params?)`

Sends a CDP command through the debugger session.

Implementation: [src/sdk/controller.ts](/Users/notacoder/Desktop/agents/chrome-controller/src/sdk/controller.ts:49)

```ts
await session.send('Network.enable');
```

### `debuggerSession.getEvents(options?)`

Reads stored debugger events.

Implementation: [src/sdk/controller.ts](/Users/notacoder/Desktop/agents/chrome-controller/src/sdk/controller.ts:59)

```ts
const events = await session.getEvents({ filter: 'Network.' });
```

### `debuggerSession.detach()`

Detaches the debugger session.

Implementation: [src/sdk/controller.ts](/Users/notacoder/Desktop/agents/chrome-controller/src/sdk/controller.ts:70)

### `chrome.close()`

Closes the controller connection.

Implementation: [src/sdk/controller.ts](/Users/notacoder/Desktop/agents/chrome-controller/src/sdk/controller.ts:179)

If the controller attached debugger sessions itself, it detaches them on close.

## Minimal Example

```ts
import { connectChromeController } from '@ank1015/chrome-controller';

async function main() {
  const chrome = await connectChromeController();

  try {
    const tabs = await chrome.call<Array<{ id?: number; url?: string }>>(
      'tabs.query',
      [{ currentWindow: true }]
    );

    const tabId = tabs.find((tab) => tab.url?.includes('example.com'))?.id;
    if (!tabId) {
      throw new Error('Could not resolve target tab');
    }

    const title = await chrome.evaluate<string>(tabId, 'document.title');
    console.log({ tabId, title });
  } finally {
    await chrome.close();
  }
}
```

## When To Use The SDK

Use the SDK when:

- you want repeatable scripts
- you already know the page shape
- you want explicit tab-id-driven automation
- you want direct access to raw bridge methods and CDP

Use the CLI instead when:

- you are still exploring the page
- you want session-managed windows and tabs
- you want `page snapshot`, `page find`, and `@eN` refs
- you are doing one-off browser tasks
