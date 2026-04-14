import { getChromeLaunchCommands } from '../../../src/native-cli/chrome-launcher.js';

describe('chrome launcher commands', () => {
  it('builds background mac launch commands for a configured profile directory', () => {
    expect(
      getChromeLaunchCommands('darwin', {
        chromeProfileDirectory: 'Profile 1',
        chromeProfileEmail: null,
      })
    ).toEqual([
      'open -g -a "Google Chrome" --args --profile-directory="Profile 1"',
      'open -g -a "Chromium" --args --profile-directory="Profile 1"',
    ]);
  });

  it('builds Windows launch commands with profile email when configured', () => {
    expect(
      getChromeLaunchCommands('win32', {
        chromeProfileDirectory: 'Default',
        chromeProfileEmail: 'agent@example.com',
      })
    ).toEqual([
      'start "" "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" --profile-email="agent@example.com"',
      'start "" "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" --profile-email="agent@example.com"',
      'start "" "%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe" --profile-email="agent@example.com"',
    ]);
  });

  it('builds Linux launch commands with the configured profile directory', () => {
    expect(
      getChromeLaunchCommands('linux', {
        chromeProfileDirectory: 'Default',
        chromeProfileEmail: null,
      })
    ).toEqual([
      'google-chrome --profile-directory="Default" &',
      'google-chrome-stable --profile-directory="Default" &',
      'chromium --profile-directory="Default" &',
      'chromium-browser --profile-directory="Default" &',
    ]);
  });
});
