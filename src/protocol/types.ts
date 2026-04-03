// ── Host → Chrome (outbound from native host) ──────────────────────

/** Call a Chrome API method and get a single result back. */
export interface CallMessage {
  id: string;
  type: 'call';
  method: string;
  args: unknown[];
}

/** Subscribe to a Chrome event. Events stream back with the same id. */
export interface SubscribeMessage {
  id: string;
  type: 'subscribe';
  event: string;
}

/** Stop an active subscription. */
export interface UnsubscribeMessage {
  id: string;
  type: 'unsubscribe';
}

export type HostMessage = CallMessage | SubscribeMessage | UnsubscribeMessage;

// ── Chrome → Host (inbound to native host) ──────────────────────────

/** Successful result of a call. */
export interface ResultMessage {
  id: string;
  type: 'result';
  data: unknown;
}

/** Failed result of a call or subscription setup. */
export interface ErrorMessage {
  id: string;
  type: 'error';
  error: string;
}

/** An event pushed from an active subscription. */
export interface EventMessage {
  id: string;
  type: 'event';
  data: unknown;
}

export type ChromeMessage = ResultMessage | ErrorMessage | EventMessage;
