import type { CliCommandResult } from './types.js';

export class CliPartialResultError extends Error {
  readonly result: CliCommandResult;

  constructor(message: string, result: CliCommandResult) {
    super(message);
    this.name = 'CliPartialResultError';
    this.result = result;
  }
}

export function isCliPartialResultError(error: unknown): error is CliPartialResultError {
  return error instanceof CliPartialResultError;
}
