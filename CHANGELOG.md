# Changelog

All notable changes to this project are documented here using
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-11-05

### Added
- Added a tray-menu update check with checking, downloading, up-to-date, and failure feedback.
- Added a native Electron smoke test for settings layout, isolated IPC, keyboard navigation, validation, and saving.

### Changed
- Upgraded the application runtime from Electron 26 to Electron 45.2.3.
- Replaced the deprecated electron-packager package with maintained @electron/packager 20.3.0.
- Removed the unused electron-store dependency and declared Node.js 22.12.0 as the minimum toolchain.
- Reorganized Settings into a compact, light/dark-aware form with all controls visible without scrolling.

### Fixed
- Removed the default application menu from the settings window and sized its content area correctly.
- Honored the selected HTTP or HTTPS protocol and validated connection values before saving.
- Waited for settings to save successfully before closing the form and displayed failures inline.
- Preserved externally readable audio assets after the upgraded raw packager enabled archiving by default.

### Security
- Updated vulnerable Electron and build-tool dependencies; the current full npm audit reported zero vulnerabilities.
- Isolated the settings renderer behind a sandboxed preload bridge, restricted its IPC senders, and blocked remote navigation.
- Added dependency auditing and native Windows smoke checks to CI and release validation.

## [1.1.0] - 2026-11-05

### Added
- Added a single-file, per-user Windows installer alongside the raw application folder.
- Added automatic GitHub release downloads and installation with a tray notification and restart.
- Added default Windows login startup with a tray-menu opt-out.
- Added automated Windows release builds, GitHub asset publishing, and cross-platform CI checks.
- Added agent instructions and a version-up workflow for versioning, changelog maintenance, and publishing.
- Added regression tests for startup, settings, source paths, and release preparation.

### Changed
- Organized runtime code, settings UI, defaults, icons, and sounds under src/.
- Moved packaged settings and logs outside the application folder to preserve them across upgrades.
- Kept deployment-specific configuration local and excluded it from source control and build outputs.
- Tracked the dependency lockfile for reproducible local and GitHub builds.

### Fixed
- Removed the packaging command's reference to a nonexistent Windows icon file.
- Kept alert sound files accessible to the external Windows audio player in installed builds.
- Preserved the login-startup option after saving connection settings.
- Prevented first-release preparation from adding a trailing blank line to the changelog.

### Security
- Restricted the existing self-signed certificate exception to monitoring requests instead of disabling TLS verification globally.
- Replaced the bundled production monitoring endpoint with localhost defaults.
