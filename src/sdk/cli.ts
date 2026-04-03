#!/usr/bin/env node

import { runComposeDraftCli } from './tasks/gmail/compose-draft.js';
import { runFetchNMailsCli } from './tasks/gmail/fetch-n-mails.js';
import { runGetEmailCli } from './tasks/gmail/get-email.js';
import { runReplyToEmailCli } from './tasks/gmail/reply-to-email.js';
import { runSearchInboxCli } from './tasks/gmail/search-inbox.js';
import { runGoogleSearchCli } from './tasks/google/search.js';

type CliCommand = {
  description: string;
  usage: string;
  aliases?: readonly string[];
  run: (args: string[]) => Promise<void>;
};

type CliGroup = {
  description: string;
  commands: Record<string, CliCommand>;
};

const PACKAGE_COMMAND = 'npx @ank1015/llm-extension';

const CLI_GROUPS: Record<string, CliGroup> = {
  gmail: {
    description: 'Gmail-specific browser tasks',
    commands: {
      'fetch-n-mails': {
        description: 'Fetch the top visible inbox mails',
        usage: `${PACKAGE_COMMAND} gmail fetch-n-mails [--count <n>] [--no-launch]`,
        aliases: ['fetch', 'top-mails', 'fetch-mails'],
        run: runFetchNMailsCli,
      },
      'search-inbox': {
        description: 'Search Gmail inbox and return matching mails',
        usage: `${PACKAGE_COMMAND} gmail search-inbox --query <words> [--count <n>] [--no-launch]`,
        aliases: ['search'],
        run: runSearchInboxCli,
      },
      'get-email': {
        description: 'Open a Gmail thread and extract its content',
        usage: `${PACKAGE_COMMAND} gmail get-email --url <gmail-thread-url> [--download-attachments-to <dir>] [--no-launch]`,
        aliases: ['get', 'read-email'],
        run: runGetEmailCli,
      },
      'compose-email': {
        description: 'Create or send a new Gmail draft',
        usage: `${PACKAGE_COMMAND} gmail compose-email [--to <emails>] [--cc <emails>] [--bcc <emails>] [--subject <text>] [--body <text>] [--attachment <path>] [--send] [--no-launch]`,
        aliases: ['compose', 'compose-draft'],
        run: runComposeDraftCli,
      },
      'reply-to-email': {
        description: 'Create or send a Gmail reply',
        usage: `${PACKAGE_COMMAND} gmail reply-to-email --url <gmail-thread-url> [--body <text>] [--attachment <path>] [--send] [--no-launch]`,
        aliases: ['reply'],
        run: runReplyToEmailCli,
      },
    },
  },
  google: {
    description: 'Google-specific browser tasks',
    commands: {
      search: {
        description: 'Run an advanced Google search and collect organic results',
        usage: `${PACKAGE_COMMAND} google search [--query <text>] [--exact-phrase <text>] [--site <domain>] [--count <n>] [--no-launch]`,
        aliases: ['advanced-search'],
        run: runGoogleSearchCli,
      },
    },
  },
};

function findGroup(name: string): [string, CliGroup] | null {
  const entry = CLI_GROUPS[name];
  return entry ? [name, entry] : null;
}

function findCommand(
  group: CliGroup,
  name: string
): [string, CliCommand] | null {
  const direct = group.commands[name];
  if (direct) {
    return [name, direct];
  }

  for (const [commandName, command] of Object.entries(group.commands)) {
    if (command.aliases?.includes(name)) {
      return [commandName, command];
    }
  }

  return null;
}

function printTopLevelHelp(): void {
  const lines = [
    'Chrome browser task CLI',
    '',
    'Usage:',
    `  ${PACKAGE_COMMAND} <group> <command> [options]`,
    `  ${PACKAGE_COMMAND} <group> --help`,
    `  ${PACKAGE_COMMAND} --help`,
    '',
    'Groups:',
  ];

  for (const [groupName, group] of Object.entries(CLI_GROUPS)) {
    lines.push(`  ${groupName.padEnd(8)} ${group.description}`);
  }

  lines.push('', 'Examples:');
  lines.push(`  ${PACKAGE_COMMAND} gmail fetch-n-mails --count 5`);
  lines.push(`  ${PACKAGE_COMMAND} gmail compose-email --to "person@example.com" --subject "Hello"`);
  lines.push(`  ${PACKAGE_COMMAND} google search --query "openai" --count 5`);

  process.stdout.write(`${lines.join('\n')}\n`);
}

function printGroupHelp(groupName: string, group: CliGroup): void {
  const lines = [
    `${groupName} commands`,
    '',
    'Usage:',
    `  ${PACKAGE_COMMAND} ${groupName} <command> [options]`,
    '',
    'Commands:',
  ];

  for (const [commandName, command] of Object.entries(group.commands)) {
    const aliasText =
      command.aliases && command.aliases.length > 0
        ? ` (aliases: ${command.aliases.join(', ')})`
        : '';
    lines.push(`  ${commandName.padEnd(16)} ${command.description}${aliasText}`);
  }

  lines.push('', `Run \`${PACKAGE_COMMAND} ${groupName} <command> --help\` for command usage.`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

function printCommandHelp(groupName: string, commandName: string, command: CliCommand): void {
  const lines = [
    `${groupName} ${commandName}`,
    '',
    command.description,
    '',
    'Usage:',
    `  ${command.usage}`,
  ];

  if (command.aliases && command.aliases.length > 0) {
    lines.push('', `Aliases: ${command.aliases.join(', ')}`);
  }

  process.stdout.write(`${lines.join('\n')}\n`);
}

function isHelpFlag(value: string | undefined): boolean {
  return value === '--help' || value === '-h' || value === 'help';
}

async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const [groupArg, commandArg, ...rest] = argv;

  if (!groupArg || isHelpFlag(groupArg)) {
    printTopLevelHelp();
    return;
  }

  const groupEntry = findGroup(groupArg);
  if (!groupEntry) {
    throw new Error(`Unknown command group: ${groupArg}`);
  }

  const [groupName, group] = groupEntry;

  if (!commandArg || isHelpFlag(commandArg)) {
    printGroupHelp(groupName, group);
    return;
  }

  const commandEntry = findCommand(group, commandArg);
  if (!commandEntry) {
    throw new Error(`Unknown ${groupName} command: ${commandArg}`);
  }

  const [commandName, command] = commandEntry;

  if (rest.some(isHelpFlag)) {
    printCommandHelp(groupName, commandName, command);
    return;
  }

  await command.run(rest);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
