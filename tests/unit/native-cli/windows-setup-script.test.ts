import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

describe('Windows setup installer script', () => {
  it('runs the Chrome preferences update through a temporary script file instead of node -e', async () => {
    const script = await readFile('install_ext_and_restart_chrome_windows.ps1', 'utf8');

    expect(script).toContain('$tempScriptPath');
    expect(script).toContain('const prefsPath = process.argv[2];');
    expect(script).toContain('const extId = process.argv[3];');
    expect(script).toContain('$utf8NoBom = New-Object System.Text.UTF8Encoding($false)');
    expect(script).toContain('[System.IO.File]::WriteAllText($tempScriptPath, $js, $utf8NoBom)');
    expect(script).toContain('& $NodePath $tempScriptPath $PrefsPath $ExtensionId');
    expect(script).not.toContain('& $NodePath -e $js $PrefsPath $ExtensionId');
    expect(script).not.toContain('const prefsPath = process.argv[1];');
  });
});
