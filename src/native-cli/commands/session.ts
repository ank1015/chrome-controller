import { SessionStore } from '../session-store.js';

import type { CliCommandResult } from '../types.js';

interface SessionCommandOptions {
  args: string[];
  json: boolean;
  explicitSessionId?: string;
  sessionStore: SessionStore;
}

export async function runSessionCommand(
  options: SessionCommandOptions
): Promise<CliCommandResult> {
  const [subcommand = 'current', ...rest] = options.args;

  switch (subcommand) {
    case 'create':
    case 'new':
      return await runCreateSessionCommand(rest, options);
    case 'current':
      return await runCurrentSessionCommand(options);
    case 'list':
      return await runListSessionsCommand(options);
    case 'use':
      return await runUseSessionCommand(rest, options);
    case 'close':
      return await runCloseSessionCommand(rest, options);
    case 'close-all':
      return await runCloseAllSessionsCommand(options);
    case 'help':
    case '--help':
    case '-h':
      return {
        lines: createSessionHelpLines(),
      };
    default:
      throw new Error(`Unknown session command: ${subcommand}`);
  }
}

async function runCreateSessionCommand(
  args: string[],
  options: SessionCommandOptions
): Promise<CliCommandResult> {
  const sessionId = readOptionalFlagValue(args, '--id');
  const session = await options.sessionStore.createSession(sessionId ?? undefined);

  return {
    session,
    data: {
      session,
      created: true,
    },
    lines: [`Created session ${session.id}`],
  };
}

async function runCurrentSessionCommand(
  options: SessionCommandOptions
): Promise<CliCommandResult> {
  const session = await options.sessionStore.getCurrentSession();
  if (!session) {
    return {
      session: null,
      data: {
        session: null,
      },
      lines: ['No current session'],
    };
  }

  return {
    session,
    data: {
      session,
    },
    lines: createSessionDetailLines(session.id, session),
  };
}

async function runListSessionsCommand(
  options: SessionCommandOptions
): Promise<CliCommandResult> {
  const sessions = await options.sessionStore.listSessions();
  if (sessions.length === 0) {
    return {
      data: {
        sessions: [],
        currentSessionId: null,
      },
      lines: ['No sessions found'],
    };
  }

  const currentSession = sessions.find((session) => session.current) ?? null;
  return {
    session: currentSession,
    data: {
      sessions,
      currentSessionId: currentSession?.id ?? null,
    },
    lines: createSessionListLines(sessions),
  };
}

async function runUseSessionCommand(
  args: string[],
  options: SessionCommandOptions
): Promise<CliCommandResult> {
  const sessionId = args[0];
  if (!sessionId) {
    throw new Error('Missing session id. Usage: chrome-controller session use <id>');
  }

  const session = await options.sessionStore.useSession(sessionId);
  return {
    session,
    data: {
      session,
    },
    lines: [`Current session set to ${session.id}`],
  };
}

async function runCloseSessionCommand(
  args: string[],
  options: SessionCommandOptions
): Promise<CliCommandResult> {
  const sessionId = args[0] ?? options.explicitSessionId ?? null;
  const outcome = sessionId
    ? await options.sessionStore.closeSession(sessionId)
    : await options.sessionStore.closeCurrentSession();

  return {
    data: {
      closed: outcome.closed,
      wasCurrent: outcome.wasCurrent,
      session: outcome.session,
    },
    lines: [
      outcome.closed && outcome.session
        ? `Closed session ${outcome.session.id}`
        : sessionId
          ? `Session "${sessionId}" was not found`
          : 'No current session to close',
    ],
  };
}

async function runCloseAllSessionsCommand(
  options: SessionCommandOptions
): Promise<CliCommandResult> {
  const outcome = await options.sessionStore.closeAllSessions();
  return {
    data: {
      closedSessionIds: outcome.closedSessions.map((session) => session.id),
      closedCount: outcome.closedSessions.length,
    },
    lines: [
      outcome.closedSessions.length === 0
        ? 'No sessions to close'
        : `Closed ${outcome.closedSessions.length} session${
            outcome.closedSessions.length === 1 ? '' : 's'
          }`,
    ],
  };
}

function readOptionalFlagValue(args: string[], flagName: string): string | null {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === flagName) {
      const nextValue = args[index + 1];
      if (!nextValue) {
        throw new Error(`Missing value for ${flagName}`);
      }
      return nextValue;
    }

    if (arg.startsWith(`${flagName}=`)) {
      return arg.slice(flagName.length + 1);
    }
  }

  return null;
}

function createSessionHelpLines(): string[] {
  return [
    'Session commands',
    '',
    'Usage:',
    '  chrome-controller session create [--id <id>]',
    '  chrome-controller session current',
    '  chrome-controller session list',
    '  chrome-controller session use <id>',
    '  chrome-controller session close [<id>]',
    '  chrome-controller session close-all',
  ];
}

function createSessionDetailLines(
  id: string,
  session: { createdAt: string; updatedAt: string; lastUsedAt: string }
): string[] {
  return [
    `Session ${id}`,
    `Created: ${session.createdAt}`,
    `Updated: ${session.updatedAt}`,
    `Last used: ${session.lastUsedAt}`,
  ];
}

function createSessionListLines(
  sessions: Array<{ id: string; current: boolean; updatedAt: string }>
): string[] {
  const lines = ['Sessions'];

  for (const session of sessions) {
    lines.push(
      `${session.current ? '*' : ' '} ${session.id}  updated=${session.updatedAt}`
    );
  }

  return lines;
}
