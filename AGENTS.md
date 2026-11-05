# Agent Instructions

Read this file before working in this repository. These are project-specific
instructions for all coding agents; keep them current when workflows change.

## Ownership and Layout

- Maintain Git history, README.md, CHANGELOG.md, tests, and release automation as
  part of the work, not as optional follow-up tasks.
- Runtime code, views, defaults, and assets belong under src/. Keep package.json,
  package-lock.json, documentation, tests, scripts, and .github/ at the root.
- Preserve the application ID, product name, executable name, update repository,
  and per-user settings location across releases. Changes require a migration plan.
- src/config/local.json and archive/ are private, ignored local files. Never add
  them, tokens, certificates, deployment hostnames, generated dist/, or node_modules/.
- Do not remove the lockfile. Use npm ci in CI and commit dependency lock changes.
- Keep monitoring behavior and existing UI unchanged unless the task needs changes.
- See docs/RELEASING.md for release implementation details and current limitations.

## Every Change

- Update the root README.md whenever setup, behavior, commands, or distribution change.
- Record meaningful changes immediately under the top ## [Unreleased] section in
  CHANGELOG.md using Keep a Changelog categories: Added, Changed, Deprecated,
  Removed, Fixed, Security. Use concise, factual, past-tense entries.
- Do not move Unreleased entries or bump versions during ordinary development.
- Run npm run check and npm test. Build with npm run package after changes to
  runtime paths, assets, dependencies, packaging, or update/release configuration.
- Review git status and diffs, preserve unrelated user work, and report checks and
  blockers honestly. Never claim an upload, live upgrade, or CI run was verified
  unless it actually was.

## Version Control and Releases

- The user has delegated this project's version control and release maintenance.
  An explicit /version-up, "version up", or equivalent request to release is
  standing approval to prepare release commits, create an annotated version tag,
  push this project's release changes, and publish its GitHub release. Merely
  discussing the command is not a request to release.
- Follow docs/RELEASING.md end to end. Project-specific branch and changelog rules
  take precedence over generic release templates: main is the release branch;
  do not invent a Development_Rusty branch or require it to exist.
- Infer the highest required semantic bump from actual changes, Unreleased, and
  commits since the last version tag. Breaking behavior is major, a new capability
  is minor, and fixes/documentation/tooling alone are patch. Explain the selection.
- Update README.md and use npm run release:prepare -- <patch|minor|major> to update
  both manifests and move Unreleased entries into a dated version section while
  preserving an empty Unreleased section at the top.
- Audit all pending changes before staging a coherent release. Do not silently
  include unrelated changes. Validate, commit, tag vX.Y.Z, and push main and that
  tag atomically. GitHub Actions, not a local token or manual upload, publishes assets.
- Watch the tag's release workflow to completion and verify its published assets.
  A pushed tag alone is not a finished release. Never reuse a published version.
- Stop for merge conflicts, failed checks, missing access, protected-branch
  restrictions, sensitive data, or unexpected changes. Never force-push, rewrite
  history, change visibility, or bypass security controls as routine release work;
  those need separate explicit authorization.
- The original 1.0.0 package version was an untagged baseline, not a published
  release. Determine the current release from package.json, Git tags, and GitHub;
  keep the README release link current when publishing a new version.