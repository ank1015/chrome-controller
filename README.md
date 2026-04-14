# @ank1015/chrome-controller

Chrome RPC bridge with a Manifest V3 extension, native messaging host, and task-oriented CLI.

## Install

```bash
npm install @ank1015/chrome-controller
```

For macOS and Windows CLI-only usage, you can also use the standalone release zip artifacts. The standalone release includes:

- `chrome-controller`
- `chrome-controller-host`
- the platform setup script

The SDK remains npm-only.

## CLI

```bash
npx @ank1015/chrome-controller --help
npx @ank1015/chrome-controller setup
npx @ank1015/chrome-controller session create --id demo
npx @ank1015/chrome-controller tabs list --json
```

## Library

```ts
import { connectChromeController } from '@ank1015/chrome-controller';
```

See [`docs/README.md`](./docs/README.md) for the docs index, CLI guide, and SDK guide.
