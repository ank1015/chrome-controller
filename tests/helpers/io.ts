import type { CliWritable } from '../../src/native-cli/types.js';

export interface CapturedOutput {
  stream: CliWritable;
  read(): string;
}

export function createCapturedOutput(): CapturedOutput {
  let buffer = '';

  return {
    stream: {
      write(chunk: string): boolean {
        buffer += chunk;
        return true;
      },
    },
    read(): string {
      return buffer;
    },
  };
}
