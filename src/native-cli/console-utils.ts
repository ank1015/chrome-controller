import type { CliDebuggerEvent } from './types.js';

export interface CliConsoleEntry {
  source: 'console' | 'log' | 'exception';
  level: string;
  text: string;
  method: string;
  url: string | null;
  line: number | null;
  column: number | null;
  timestamp: number | null;
}

export function toConsoleEntries(events: CliDebuggerEvent[]): CliConsoleEntry[] {
  const entries: CliConsoleEntry[] = [];

  for (const event of events) {
    const entry = toConsoleEntry(event);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

export function isConsoleEventMethod(method: string): boolean {
  return (
    method === 'Runtime.consoleAPICalled' ||
    method === 'Runtime.exceptionThrown' ||
    method === 'Log.entryAdded'
  );
}

export const CONSOLE_EVENT_PREFIXES = [
  'Runtime.consoleAPICalled',
  'Runtime.exceptionThrown',
  'Log.entryAdded',
] as const;

function toConsoleEntry(event: CliDebuggerEvent): CliConsoleEntry | null {
  if (event.method === 'Runtime.consoleAPICalled') {
    const params = event.params as {
      type?: string;
      args?: Array<Record<string, unknown>>;
      timestamp?: number;
      stackTrace?: {
        callFrames?: Array<{
          url?: string;
          lineNumber?: number;
          columnNumber?: number;
        }>;
      };
    };
    const frame = params.stackTrace?.callFrames?.[0];

    return {
      source: 'console',
      level: typeof params.type === 'string' ? params.type : 'log',
      text: normalizeConsoleArgs(params.args),
      method: event.method,
      url: typeof frame?.url === 'string' ? frame.url : null,
      line: typeof frame?.lineNumber === 'number' ? frame.lineNumber + 1 : null,
      column: typeof frame?.columnNumber === 'number' ? frame.columnNumber + 1 : null,
      timestamp: typeof params.timestamp === 'number' ? params.timestamp : null,
    };
  }

  if (event.method === 'Runtime.exceptionThrown') {
    const params = event.params as {
      timestamp?: number;
      exceptionDetails?: {
        text?: string;
        url?: string;
        lineNumber?: number;
        columnNumber?: number;
        exception?: {
          description?: string;
        };
      };
    };
    const details = params.exceptionDetails ?? {};

    return {
      source: 'exception',
      level: 'error',
      text:
        typeof details.exception?.description === 'string'
          ? details.exception.description
          : typeof details.text === 'string'
            ? details.text
            : 'Unhandled exception',
      method: event.method,
      url: typeof details.url === 'string' ? details.url : null,
      line: typeof details.lineNumber === 'number' ? details.lineNumber + 1 : null,
      column: typeof details.columnNumber === 'number' ? details.columnNumber + 1 : null,
      timestamp: typeof params.timestamp === 'number' ? params.timestamp : null,
    };
  }

  if (event.method === 'Log.entryAdded') {
    const params = event.params as {
      entry?: {
        level?: string;
        text?: string;
        url?: string;
        source?: string;
        lineNumber?: number;
        timestamp?: number;
      };
    };
    const entry = params.entry ?? {};

    return {
      source: 'log',
      level: typeof entry.level === 'string' ? entry.level : 'info',
      text: typeof entry.text === 'string' ? entry.text : '',
      method: event.method,
      url: typeof entry.url === 'string' ? entry.url : null,
      line: typeof entry.lineNumber === 'number' ? entry.lineNumber + 1 : null,
      column: null,
      timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : null,
    };
  }

  return null;
}

function normalizeConsoleArgs(args: Array<Record<string, unknown>> | undefined): string {
  if (!Array.isArray(args) || args.length === 0) {
    return '';
  }

  return args
    .map((arg) => {
      if (typeof arg.value === 'string') {
        return arg.value;
      }
      if (typeof arg.value === 'number' || typeof arg.value === 'boolean') {
        return String(arg.value);
      }
      if (typeof arg.unserializableValue === 'string') {
        return arg.unserializableValue;
      }
      if (typeof arg.description === 'string') {
        return arg.description;
      }

      return '[object]';
    })
    .join(' ');
}
