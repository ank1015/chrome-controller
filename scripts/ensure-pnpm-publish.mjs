#!/usr/bin/env node

const userAgent = process.env.npm_config_user_agent ?? '';
const packageName = process.env.npm_package_name ?? 'This package';

if (!userAgent.startsWith('pnpm/')) {
  console.error(
    `${packageName} must be published with pnpm so workspace dependencies are rewritten in the packed manifest.`,
  );
  process.exit(1);
}
