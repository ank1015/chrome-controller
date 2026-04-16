import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('Windows setup installer script', () => {
  it('runs the Chrome preferences update through a temporary script file instead of node -e', async () => {
    const script = await readFile('install_ext_and_restart_chrome_windows.ps1', 'utf8');

    expect(script).toContain('$tempScriptPath');
    expect(script).toContain("Set-Content -LiteralPath $tempScriptPath -Value $js -Encoding UTF8");
    expect(script).toContain('& $NodePath $tempScriptPath $PrefsPath $ExtensionId');
    expect(script).not.toContain('& $NodePath -e $js $PrefsPath $ExtensionId');
  });
});
