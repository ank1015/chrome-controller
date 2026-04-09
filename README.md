# @ank1015/chrome-controller

Chrome RPC bridge with a Manifest V3 extension, native messaging host, and task-oriented CLI.

## Install

```bash
npm install @ank1015/chrome-controller
```

## CLI

```bash
npx @ank1015/chrome-controller --help
npx @ank1015/chrome-controller session create --id demo
npx @ank1015/chrome-controller tabs list --json
```

## Library

```ts
import { connectChromeController } from '@ank1015/chrome-controller';
```

See [`docs/06-sdk-automation-workflows.md`](./docs/06-sdk-automation-workflows.md) for SDK usage and automation patterns.
