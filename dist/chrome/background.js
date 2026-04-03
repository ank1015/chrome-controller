// src/protocol/constants.ts
var NATIVE_HOST_NAME = "com.ank1015.llm";
var MAX_HOST_TO_CHROME_MESSAGE_SIZE_BYTES = 1024 * 1024;
var MAX_CHROME_TO_HOST_MESSAGE_SIZE_BYTES = 64 * 1024 * 1024;
var MAX_TCP_MESSAGE_SIZE_BYTES = 64 * 1024 * 1024;

// src/chrome/background.ts
var nativePort = null;
var subscriptions = /* @__PURE__ */ new Map();
function connectNative() {
  const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
  port.onMessage.addListener((message) => {
    handleHostMessage(message);
  });
  port.onDisconnect.addListener(() => {
    console.warn("[bg] native host disconnected", chrome.runtime.lastError?.message ?? "");
    nativePort = null;
    subscriptions.clear();
  });
  nativePort = port;
  return port;
}
function sendToHost(message) {
  if (!nativePort) {
    connectNative();
  }
  nativePort.postMessage(message);
}
function handleHostMessage(message) {
  switch (message.type) {
    case "call":
      handleCall(message);
      break;
    case "subscribe":
      handleSubscribe(message);
      break;
    case "unsubscribe":
      handleUnsubscribe(message);
      break;
    default:
      console.warn("[bg] unknown message type:", message.type);
  }
}
async function handleCall(message) {
  try {
    let result;
    if (message.method === "debugger.evaluate") {
      result = await debuggerEvaluate(message.args);
    } else if (message.method === "debugger.attach") {
      result = await debuggerAttach(message.args);
    } else if (message.method === "debugger.sendCommand") {
      result = await debuggerSendCommand(message.args);
    } else if (message.method === "debugger.detach") {
      result = await debuggerDetach(message.args);
    } else if (message.method === "debugger.getEvents") {
      result = debuggerGetEvents(message.args);
    } else if (message.method === "scripting.executeScript" && hasCodeArg(message.args)) {
      result = await executeScriptWithCode(message.args);
    } else {
      const fn = resolveMethod(message.method);
      result = await fn(...message.args);
    }
    sendToHost({ id: message.id, type: "result", data: result });
  } catch (error) {
    sendToHost({
      id: message.id,
      type: "error",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
function hasCodeArg(args2) {
  return args2.length > 0 && typeof args2[0] === "object" && args2[0] !== null && "code" in args2[0];
}
async function executeScriptWithCode(args) {
  const { code, target, world, ...rest } = args[0];
  return chrome.scripting.executeScript({
    ...rest,
    target,
    world: world ?? "MAIN",
    // func is serialized by Chrome and executed in the TAB context (not the service worker).
    // eval is allowed in MAIN world under the page's CSP.
    func: (codeStr) => eval(codeStr),
    args: [code]
  });
}
async function debuggerEvaluate(args2) {
  const {
    tabId,
    code: code2,
    returnByValue = true,
    awaitPromise = false,
    userGesture = false
  } = args2[0];
  if (typeof tabId !== "number") {
    throw new Error("debugger.evaluate requires a numeric tabId");
  }
  if (typeof code2 !== "string" || !code2) {
    throw new Error("debugger.evaluate requires a non-empty code string");
  }
  let attachedByThisMethod = false;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    attachedByThisMethod = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Another debugger is already attached")) {
      throw new Error(`Failed to attach debugger to tab ${tabId}: ${message}`);
    }
  }
  try {
    const response = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
      expression: code2,
      returnByValue,
      awaitPromise,
      userGesture
    });
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text ?? "Unknown evaluation error";
      throw new Error(detail);
    }
    return { result: response.result?.value, type: response.result?.type };
  } finally {
    if (attachedByThisMethod) {
      try {
        await chrome.debugger.detach({ tabId });
      } catch {
      }
    }
  }
}
var debuggerSessions = /* @__PURE__ */ new Map();
function handleDebuggerEvent(source, method, params) {
  if (source.tabId === void 0) return;
  const session = debuggerSessions.get(source.tabId);
  if (session) {
    session.events.push({ method, params: params ?? {} });
  }
}
chrome.debugger.onEvent.addListener(handleDebuggerEvent);
async function debuggerAttach(args2) {
  const { tabId } = args2[0];
  if (debuggerSessions.has(tabId)) {
    return { alreadyAttached: true };
  }
  await chrome.debugger.attach({ tabId }, "1.3");
  debuggerSessions.set(tabId, { events: [] });
  return { attached: true };
}
async function debuggerSendCommand(args2) {
  const { tabId, method, params } = args2[0];
  if (!debuggerSessions.has(tabId)) {
    throw new Error(`No debugger session for tab ${tabId} \u2014 call debugger.attach first`);
  }
  return chrome.debugger.sendCommand({ tabId }, method, params);
}
async function debuggerDetach(args2) {
  const { tabId } = args2[0];
  debuggerSessions.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch {
  }
  return { detached: true };
}
function debuggerGetEvents(args2) {
  const {
    tabId,
    filter,
    clear = false
  } = args2[0];
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
function resolveMethod(method) {
  const parts = method.split(".");
  let target2 = chrome;
  let parent = chrome;
  for (const part of parts) {
    parent = target2;
    target2 = target2[part];
    if (target2 === void 0) {
      throw new Error(`chrome.${method} is not available`);
    }
  }
  if (typeof target2 !== "function") {
    throw new Error(`chrome.${method} is not a function`);
  }
  return target2.bind(parent);
}
function handleSubscribe(message) {
  try {
    const parts = message.event.split(".");
    let target2 = chrome;
    for (const part of parts) {
      target2 = target2[part];
      if (target2 === void 0) {
        throw new Error(`chrome.${message.event} is not available`);
      }
    }
    const eventTarget = target2;
    if (typeof eventTarget.addListener !== "function") {
      throw new Error(`chrome.${message.event} is not an event`);
    }
    const listener = (...args2) => {
      sendToHost({ id: message.id, type: "event", data: args2 });
    };
    eventTarget.addListener(listener);
    subscriptions.set(message.id, { target: eventTarget, listener });
  } catch (error) {
    sendToHost({
      id: message.id,
      type: "error",
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
function handleUnsubscribe(message) {
  const sub = subscriptions.get(message.id);
  if (sub) {
    sub.target.removeListener(sub.listener);
    subscriptions.delete(message.id);
  }
}
chrome.runtime.onStartup.addListener(() => {
  if (!nativePort) connectNative();
});
console.warn("[bg] background service worker loaded");
connectNative();
