import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('standalone installer assets', () => {
  it('keeps the macOS installer binary-first for standalone releases', async () => {
    const script = await readFile(
      join(process.cwd(), 'install_ext_and_restart_chrome_mac.sh'),
      'utf8'
    );

    expect(script).toContain('CHROME_CONTROLLER_HOST_EXECUTABLE');
    expect(script).toContain('chrome-controller-host');
    expect(script).toContain('"path": "$HOST_BINARY_INSTALL_PATH"');
  });

  it('keeps the Windows installer binary-first for standalone releases', async () => {
    const script = await readFile(
      join(process.cwd(), 'install_ext_and_restart_chrome_windows.ps1'),
      'utf8'
    );

    expect(script).toContain('CHROME_CONTROLLER_HOST_EXECUTABLE');
    expect(script).toContain('chrome-controller-host.exe');
    expect(script).toContain('path = $HostBinaryInstallPath');
  });
});
