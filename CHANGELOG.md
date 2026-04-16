# Changelog

## 0.0.4

- Fix Windows `chrome-controller setup` argument handling when the Preferences cleanup runs through a temporary Node script file.
- Write the temporary script without a UTF-8 BOM so PowerShell 5.1 does not introduce parsing surprises.

## 0.0.3

- Fix Windows `chrome-controller setup` so Chrome Preferences updates run through a temporary script file instead of a fragile inline `node -e` command.
- Add a regression test to keep the Windows installer path stable.

## 0.0.2

- Prepare the package for npm distribution with global CLI installation.
- Include docs in the npm package tarball.
- Declare the TypeScript build dependency for clean publish environments.

## 0.0.1

- Initial public package.
