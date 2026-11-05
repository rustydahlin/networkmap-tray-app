# Network Map Tray App

Windows x64 tray application for network map monitoring.

Current release: [v1.2.0](https://github.com/rustydahlin/networkmap-tray-app/releases/tag/v1.2.0).

## Install

Download the setup executable from
[GitHub Releases](https://github.com/rustydahlin/networkmap-tray-app/releases)
or your organization's Teams distribution location. Run it to install for the
current user without an administrator prompt. The app launches into the tray.

Right-click the tray icon and choose Settings to set the monitoring hostname and
port and choose HTTP or HTTPS. The settings form fits without scrolling and follows
the Windows light or dark appearance. Start with Windows is enabled by default and can be disabled in the tray
menu. No registry file is needed. Remove any old manually created autostart entry
when switching from a raw-folder copy.

Packaged settings and logs live in `%APPDATA%/Network Map Tray/`, outside the
installation folder, and survive upgrades and uninstalling. A new installation
starts with localhost defaults; deployment-specific endpoints are never bundled.

Installers are currently unsigned, so Windows SmartScreen may show a warning or
an organization may block them. Trusted Windows code signing remains outstanding.
Release v1.2.0 includes Electron 45.2.3, the updated settings form, and the tray
menu's Check for Updates command.

## Automatic Updates

Installed copies check the public GitHub Releases feed at startup and every six
hours while running. A higher version downloads in the background, then a tray
notification announces a restart in five seconds to install it. Settings persist.
Internet access and permission to download GitHub release assets are required.
Offline or sleeping machines catch up after a later successful check.

Right-click the tray icon and choose Check for Updates to check immediately.
The command reports when the app is up to date, a download starts, or a check
fails, and prevents duplicate checks while checking or downloading. It is disabled
for development and raw-folder copies, which do not have an installed update feed.

Development and raw-folder copies do not enable automatic updates or login
startup. Teams is only an initial distribution location, not the update source.
Editing code or rebuilding the same version does not update installed apps:
publish a higher version through the release workflow.

## Develop

Use Node.js 22.12.0 or newer (a supported LTS release is recommended) and npm.
The current development runtime is pinned to Electron 45.2.3. Build Windows
distributions on Windows.

```powershell
npm ci
npm start
```

Development settings are written to ignored `src/config/local.json`, seeded from
`src/config/default.json` on first run. Never commit production endpoints,
credentials, tokens, private keys, or signing certificates.

```powershell
npm run check
npm test
npm audit
npm run test:electron
```

CI runs syntax checks, regression tests, and dependency auditing on Linux and
Windows. Windows CI and release builds also run the native Electron smoke test.
It uses temporary settings, does not install the app or modify Windows startup,
and writes light/dark screenshots under dist/ for inspection.

Keep package.json, package-lock.json, and the ignored node_modules/ at the root:
this is one npm package shared by the app and build/release tooling. Only runtime
code and assets belong under src/. Moving dependencies into src/ would require
separate manifests and packaging rules without benefiting this application.
Use npm install when changing dependencies, and npm ci for reproducible installs.
The lockfile's current full npm audit reports zero vulnerabilities. Scoped overrides
patch the affected modern glob/minimatch chains without changing unrelated legacy
APIs; validate both packaging formats whenever updating or removing those overrides.

## Repository Layout

```text
src/
   main/main.js             Electron main process and tray behavior
   main/preload.cjs          Sandboxed settings IPC bridge
   renderer/settings.html   Connection settings window
   renderer/settings.js     Settings form behavior
   config/default.json      Safe bundled defaults
   config/local.json        Ignored development configuration
   assets/icons/            Tray icons
   assets/sounds/           Notification audio
scripts/                   Build staging and version/changelog tooling
tests/                     Runtime and release regression tests
docs/RELEASING.md           Agent-operated release procedure
.github/workflows/         CI and Windows release publishing
.github/prompts/           Workspace version-up command
AGENTS.md                  Repository-wide coding-agent instructions
CHANGELOG.md               Unreleased changes and dated release history
package.json               Application version, dependencies, and build configuration
package-lock.json          Reproducible dependency lockfile
dist/                      Ignored build output
```

Obsolete backups and duplicate legacy assets are preserved locally in ignored
`archive/`; Git history is the long-term source for older application versions.

## Build and Share

```powershell
npm run package
```

This builds both distribution formats without publishing anything:

- `dist/network-map-tray-win32-x64/`: the raw application folder, as before.
- `dist/installer/Network-Map-Tray-Setup.exe`: the single installer to share in Teams.
- `dist/release/`: versioned installer, `latest.yml`, `.exe.blockmap`, and build intermediates.

Share only the setup executable from `dist/installer/` in Teams. Build just one
format with `npm run package:raw` or `npm run package:installer`. The first build
needs internet access to download Electron and installer tools. Build inputs
exclude local configuration, archives, documentation, tests, and repository tools.

## Agent-Managed Releases

Coding agents must read [AGENTS.md](AGENTS.md), maintain this README, and record
meaningful work under the top Unreleased section in [CHANGELOG.md](CHANGELOG.md).
The detailed procedure is in [docs/RELEASING.md](docs/RELEASING.md).

Ask the agent to **version up**, or use the workspace **/version-up** prompt. That
explicit request authorizes the release commit, annotated tag, push, and GitHub
publication. The agent chooses the appropriate next version, moves Unreleased
entries into a dated release, validates and builds the app, and pushes the release.
GitHub Actions then creates the installer, update metadata, and raw Windows ZIP,
uploads all assets to a draft, and publishes the completed release. The agent
watches the workflow and verifies its result before reporting completion.

Normal development and `npm run package` never publish a release or change the
app version. GitHub Actions uses its short-lived built-in token; no release token
is distributed with the app. Repository access, Actions availability, and signing
or network policy can still block a release and must be reported honestly.

Update downloads require valid HTTPS certificates. Only monitoring-server
requests retain the existing self-signed certificate exception.