# @ank1015/llm-extension

Chrome RPC bridge with a Manifest V3 extension, native messaging host, and task-oriented CLI.

## Install

```bash
npm install @ank1015/llm-extension
```

## CLI

```bash
npx @ank1015/llm-extension --help
npx @ank1015/llm-extension session create --id demo
npx @ank1015/llm-extension tabs list --json
```

## Library

```ts
import { connectChromeController } from '@ank1015/llm-extension';
```

See [`docs/06-sdk-automation-workflows.md`](./docs/06-sdk-automation-workflows.md) for SDK usage and automation patterns.
