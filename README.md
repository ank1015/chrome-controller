# @ank1015/chrome-controller

Chrome RPC bridge with a Manifest V3 extension, native messaging host, and task-oriented CLI.

## Install

For the global CLI:

```bash
npm install -g @ank1015/chrome-controller
chrome-controller setup
```

For the TypeScript SDK in a project:

```bash
npm install @ank1015/chrome-controller
```

## CLI

```bash
chrome-controller --help
chrome-controller setup
chrome-controller session create --id demo
chrome-controller tabs list --json
```

The npm package requires Node.js on the target machine. If you need a no-Node install, use the standalone GitHub release artifacts instead.

## Library

```ts
import { connectChromeController } from '@ank1015/chrome-controller';
```

See [`docs/README.md`](./docs/README.md) for the docs index, CLI guide, and SDK guide.
