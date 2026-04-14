import {
  DEFAULT_PORT,
  MAX_CHROME_TO_HOST_MESSAGE_SIZE_BYTES,
  MAX_HOST_TO_CHROME_MESSAGE_SIZE_BYTES,
} from '../protocol/constants.js';
import { ChromeClient } from './client.js';
import { ChromeServer } from './server.js';

function defaultLog(message: string): void {
  process.stderr.write(`[host] ${message}\n`);
}

export function startNativeHost(options: {
  log?: (message: string) => void;
  port?: number;
} = {}): {
  client: ChromeClient;
  server: ChromeServer;
} {
  const log = options.log ?? defaultLog;
  const port =
    options.port ??
    (process.env.CHROME_RPC_PORT ? parseInt(process.env.CHROME_RPC_PORT, 10) : DEFAULT_PORT);

  log(`started (pid=${process.pid})`);

  const client = new ChromeClient({
    maxIncomingMessageSizeBytes: MAX_CHROME_TO_HOST_MESSAGE_SIZE_BYTES,
    maxOutgoingMessageSizeBytes: MAX_HOST_TO_CHROME_MESSAGE_SIZE_BYTES,
  });
  client.run().then(
    () => {
      log('Chrome disconnected, exiting');
      process.exit(0);
    },
    (error: unknown) => {
      log(`fatal: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  );

  const server = new ChromeServer(client, { port });
  return {
    client,
    server,
  };
}
