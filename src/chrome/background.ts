/**
 * Background service worker — thin RPC proxy for native messaging.
 *
 * Receives call/subscribe/unsubscribe messages from the native host,
 * executes the corresponding Chrome API, and sends back results/errors/events.
 */

import { NATIVE_HOST_NAME } from '../protocol/constants.js';

import type {
  HostMessage,
  CallMessage,
  SubscribeMessage,
  UnsubscribeMessage,
  ChromeMessage,
} from '../protocol/types.js';

// ── State ───────────────────────────────────────────────────────────

let nativePort: chrome.runtime.Port | null = null;

interface ActiveSubscription {
  target: chrome.events.Event<(...args: unknown[]) => void>;
  listener: (...args: unknown[]) => void;
}

const subscriptions = new Map<string, ActiveSubscription>();

// ── Native host connection ──────────────────────────────────────────

function connectNative(): chrome.runtime.Port {
  const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);

  port.onMessage.addListener((message: HostMessage) => {
    handleHostMessage(message);
  });

  port.onDisconnect.addListener(() => {
    console.warn('[bg] native host disconnected', chrome.runtime.lastError?.message ?? '');
    nativePort = null;
    subscriptions.clear();
  });

  nativePort = port;
  return port;
}

function sendToHost(message: ChromeMessage): void {
  if (!nativePort) {
    connectNative();
  }
  nativePort!.postMessage(message);
}

// ── Message routing ─────────────────────────────────────────────────

function handleHostMessage(message: HostMessage): void {
  switch (message.type) {
    case 'call':
      handleCall(message);
      break;
    case 'subscribe':
      handleSubscribe(message);
      break;
    case 'unsubscribe':
      handleUnsubscribe(message);
      break;
    default:
      console.warn('[bg] unknown message type:', (message as { type: string }).type);
  }
}

// ── Call handler ────────────────────────────────────────────────────

async function handleCall(message: CallMessage): Promise<void> {
  try {
    let result: unknown;

    if (message.method === 'debugger.evaluate') {
      result = await debuggerEvaluate(message.args);
    } else if (message.method === 'debugger.attach') {
      result = await debuggerAttach(message.args);
    } else if (message.method === 'debugger.sendCommand') {
      result = await debuggerSendCommand(message.args);
    } else if (message.method === 'debugger.detach') {
      result = await debuggerDetach(message.args);
    } else if (message.method === 'debugger.getEvents') {
      result = debuggerGetEvents(message.args);
    } else if (message.method === 'scripting.executeScript' && hasCodeArg(message.args)) {
      result = await executeScriptWithCode(message.args);
    } else {
      const fn = resolveMethod(message.method);
      result = await fn(...message.args);
    }

    sendToHost({ id: message.id, type: 'result', data: result });
  } catch (error) {
    sendToHost({
      id: message.id,
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ── scripting.executeScript special case ────────────────────────────

/**
 * Handles executeScript calls where the host passes a `code` string
 * instead of a function reference (which can't be serialized over JSON).
 *
 * The code runs in the page's MAIN world by default, where new Function()
 * is available on most pages.
 */

function hasCodeArg(args: unknown[]): boolean {
  return (
    args.length > 0 &&
    typeof args[0] === 'object' &&
    args[0] !== null &&
    'code' in (args[0] as Record<string, unknown>)
  );
}

async function executeScriptWithCode(args: unknown[]): Promise<unknown> {
  const { code, target, world, ...rest } = args[0] as {
    code: string;
    target: chrome.scripting.InjectionTarget;
    world?: string;
    [key: string]: unknown;
  };

  return chrome.scripting.executeScript({
    ...rest,
    target,
    world: (world as chrome.scripting.ExecutionWorld) ?? 'MAIN',
    // func is serialized by Chrome and executed in the TAB context (not the service worker).
    // eval is allowed in MAIN world under the page's CSP.

    func: (codeStr: string) => eval(codeStr),
    args: [code],
  });
}

// ── debugger.evaluate — CSP-bypassing code execution ────────────────

/**
 * Evaluates arbitrary JS in a tab via Chrome DevTools Protocol.
 *
 * Uses chrome.debugger to attach, run Runtime.evaluate, and detach.
 * This bypasses page CSP because the debugger protocol operates at the
 * browser level, not within the page's JS context.
 *
 * Tradeoff: shows a brief yellow "debugging" banner in the tab.
 */
async function debuggerEvaluate(args: unknown[]): Promise<unknown> {
  const {
    tabId,
    code,
    returnByValue = true,
    awaitPromise = false,
    userGesture = false,
  } = args[0] as {
    tabId: number;
    code: string;
    returnByValue?: boolean;
    awaitPromise?: boolean;
    userGesture?: boolean;
  };

  if (typeof tabId !== 'number') {
    throw new Error('debugger.evaluate requires a numeric tabId');
  }
  if (typeof code !== 'string' || !code) {
    throw new Error('debugger.evaluate requires a non-empty code string');
  }

  let attachedByThisMethod = false;

  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    attachedByThisMethod = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Allow evaluate inside an existing debugger session (for example after attach+Page.bringToFront).
    if (!message.includes('Another debugger is already attached')) {
      throw new Error(`Failed to attach debugger to tab ${tabId}: ${message}`);
    }
  }

  try {
    const response = (await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: code,
      returnByValue,
      awaitPromise,
      userGesture,
    })) as {
      result?: { value?: unknown; type?: string };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };

    if (response.exceptionDetails) {
      const detail =
        response.exceptionDetails.exception?.description ??
        response.exceptionDetails.text ??
        'Unknown evaluation error';
      throw new Error(detail);
    }

    return { result: response.result?.value, type: response.result?.type };
  } finally {
    if (attachedByThisMethod) {
      try {
        await chrome.debugger.detach({ tabId });
      } catch {
        // Tab may have closed — safe to ignore
      }
    }
  }
}

// ── General-purpose debugger session methods ────────────────────────

/**
 * Long-lived debugger sessions for CDP domains like Network, DOM, etc.
 *
 * Unlike debugger.evaluate (which attaches/detaches per call), these
 * methods keep the debugger attached so CDP events can be collected.
 *
 *   debugger.attach      — attach to a tab (keeps session open)
 *   debugger.sendCommand — send any CDP command to an attached tab
 *   debugger.detach      — detach and clean up
 *   debugger.getEvents   — return collected CDP events (optionally filtered)
 */

interface DebuggerSession {
  events: { method: string; params: unknown }[];
}

const debuggerSessions = new Map<number, DebuggerSession>();

function handleDebuggerEvent(
  source: chrome.debugger.Debuggee,
  method: string,
  params?: object
): void {
  if (source.tabId === undefined) return;
  const session = debuggerSessions.get(source.tabId);
  if (session) {
    session.events.push({ method, params: params ?? {} });
  }
}

// Register the global listener once
chrome.debugger.onEvent.addListener(handleDebuggerEvent);

async function debuggerAttach(args: unknown[]): Promise<unknown> {
  const { tabId } = args[0] as { tabId: number };

  if (debuggerSessions.has(tabId)) {
    return { alreadyAttached: true };
  }

  await chrome.debugger.attach({ tabId }, '1.3');
  debuggerSessions.set(tabId, { events: [] });
  return { attached: true };
}

async function debuggerSendCommand(args: unknown[]): Promise<unknown> {
  const { tabId, method, params } = args[0] as {
    tabId: number;
    method: string;
    params?: object;
  };

  if (!debuggerSessions.has(tabId)) {
    throw new Error(`No debugger session for tab ${tabId} — call debugger.attach first`);
  }

  return chrome.debugger.sendCommand({ tabId }, method, params);
}

async function debuggerDetach(args: unknown[]): Promise<unknown> {
  const { tabId } = args[0] as { tabId: number };

  debuggerSessions.delete(tabId);

  try {
    await chrome.debugger.detach({ tabId });
  } catch {
    // Already detached or tab closed
  }
  return { detached: true };
}

function debuggerGetEvents(args: unknown[]): unknown {
  const {
    tabId,
    filter,
    clear = false,
  } = args[0] as {
    tabId: number;
    filter?: string;
    clear?: boolean;
  };

  const session = debuggerSessions.get(tabId);
  if (!session) {
    throw new Error(`No debugger session for tab ${tabId}`);
  }

  let events = session.events;
  if (filter) {
    events = events.filter((e) => e.method.startsWith(filter));
  }

  const result = [...events];
  if (clear) {
    if (filter) {
      session.events = session.events.filter((e) => !e.method.startsWith(filter));
    } else {
      session.events = [];
    }
  }

  return result;
}

// ── Method resolver ─────────────────────────────────────────────────

function resolveMethod(method: string): (...args: unknown[]) => unknown {
  const parts = method.split('.');
  let target: unknown = chrome;
  let parent: unknown = chrome;

  for (const part of parts) {
    parent = target;
    target = (target as Record<string, unknown>)[part];
    if (target === undefined) {
      throw new Error(`chrome.${method} is not available`);
    }
  }

  if (typeof target !== 'function') {
    throw new Error(`chrome.${method} is not a function`);
  }

  return (target as (...args: unknown[]) => unknown).bind(parent);
}

// ── Subscribe handler ───────────────────────────────────────────────

function handleSubscribe(message: SubscribeMessage): void {
  try {
    const parts = message.event.split('.');
    let target: unknown = chrome;

    for (const part of parts) {
      target = (target as Record<string, unknown>)[part];
      if (target === undefined) {
        throw new Error(`chrome.${message.event} is not available`);
      }
    }

    const eventTarget = target as chrome.events.Event<(...args: unknown[]) => void>;

    if (typeof eventTarget.addListener !== 'function') {
      throw new Error(`chrome.${message.event} is not an event`);
    }

    const listener = (...args: unknown[]): void => {
      sendToHost({ id: message.id, type: 'event', data: args });
    };

    eventTarget.addListener(listener);
    subscriptions.set(message.id, { target: eventTarget, listener });
  } catch (error) {
    sendToHost({
      id: message.id,
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// ── Unsubscribe handler ─────────────────────────────────────────────

function handleUnsubscribe(message: UnsubscribeMessage): void {
  const sub = subscriptions.get(message.id);
  if (sub) {
    sub.target.removeListener(sub.listener);
    subscriptions.delete(message.id);
  }
}

// ── Startup ─────────────────────────────────────────────────────────

// Ensure the service worker wakes on Chrome launch (MV3 is lazy).
chrome.runtime.onStartup.addListener(() => {
  if (!nativePort) connectNative();
});

console.warn('[bg] background service worker loaded');
connectNative();
