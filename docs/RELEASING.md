# Release Maintenance

## Approval and Branches

The user has delegated release management to coding agents. An explicit
`/version-up`, "version up", or equivalent release request authorizes this
repository's release commit, annotated tag, push, and GitHub publication without
another routine approval prompt. Unexpected risks, secrets, conflicts, failed
checks, permissions, history rewrites, and visibility changes still require a stop.

Use the existing `main` branch for releases. Do not create or assume a
`Development_Rusty` branch. If work is on another branch, inspect and safely merge
the intended changes into an up-to-date `main` before preparing the release. Never
force-push as part of normal release maintenance. Respect branch protection and
use a pull request if required rather than bypassing it.

## Agent Procedure

1. Read AGENTS.md. Inspect `git status`, pending diffs, recent commits, tags, and
   GitHub access. Fetch origin and tags. Ensure `main` contains the latest remote
   changes without discarding local work. Audit all files to be included and do
   not silently stage unrelated work or private configuration.
2. Maintain README.md and CHANGELOG.md. Keep factual entries under the first
   `## [Unreleased]` heading as work progresses. Review changes and commits since
   the latest `vX.Y.Z` tag, or the initial untagged baseline if none exists.
3. Choose the highest necessary SemVer bump: major for breaking behavior, minor
   for new capabilities, patch for compatible fixes or maintenance. State the
   chosen bump. The first release is based on the existing package version; do
   not fabricate a prior release or reuse an existing version.
4. Run `npm ci`, then `npm run release:prepare -- minor` (substitute the chosen
   bump). This updates package.json and package-lock.json and moves the Unreleased
   entries to `## [X.Y.Z] - YYYY-MM-DD`, leaving an empty Unreleased section at
   the top. An empty Unreleased section cannot be released. The automatic default
   `npm run release:prepare` also examines changelog headings and commit messages;
   the agent must still review whether its inferred bump fits the actual changes.
5. Run `npm run check`, `npm test`, `npm audit`, `npm run test:electron`,
   `npm run release:verify`, and `npm run package` on Windows. The native smoke
   test uses temporary settings and captures light/dark screenshots under dist/.
   Inspect the final diff and artifact layout. Confirm that
   local configuration, archives, secrets, and development tools are not bundled.
   Local installer and live-update testing should be reported separately from
   mocked tests; never claim it occurred when it did not.
6. Stage only the audited release changes. Commit with a clear message such as
   `chore(release): prepare vX.Y.Z`. Create an annotated tag:
   `git tag -a vX.Y.Z -m "Release vX.Y.Z: concise change summary"`.
7. Push the release commit and its tag together:
   `git push --atomic origin main vX.Y.Z`. This starts the Release workflow.
   If push fails, resolve the actual cause; never retry with force automatically.
8. Locate the workflow with `gh run list --workflow release.yml --commit <sha>`
   and watch the matching run with `gh run watch <run-id> --exit-status`.
   A failed workflow is not a published release. Diagnose the failing step and
   fix it without moving or reusing an already published tag.
9. Verify `gh release view vX.Y.Z --json url,tagName,isDraft,assets`. It must be
   public and not a draft, with the versioned setup executable, its blockmap,
   latest.yml, and raw Windows ZIP. Confirm latest.yml's version and SHA-512
   checksum match the installer. Report the version, release URL, validation
   results, and update timing. Return to the original branch if appropriate,
   without overwriting work, and keep it synchronized safely.

## GitHub Automation

`.github/workflows/ci.yml` runs syntax and regression tests on Linux and Windows.
It also audits dependencies and runs the native Electron smoke test on Windows.
`.github/workflows/release.yml` builds on a Windows runner for pushed version
tags. It verifies tag/package/lockfile/changelog agreement, tests the app, builds
both distributions, derives release notes from the versioned changelog, and
creates a draft release. It uploads all assets before publishing the release as
latest, preventing clients from seeing partially uploaded update assets.

Publishing uses GitHub's short-lived workflow token with `contents: write`.
No personal token belongs in the application or repository. GitHub Actions must
be enabled and organization policies must allow the workflow to publish releases.
The operator needs authenticated Git/`gh` access to push commits and tags.

If a build fails before publication, fix the problem first. A workflow-only
transient failure can be rerun. The workflow also supports manual dispatch with
an existing version tag to retry an unpublished release. It refuses to modify a
release that has already been published. For changes to a published release,
create a new version instead of replacing its installer.

## Client Updates

Installed copies check the public `rustydahlin/networkmap-tray-app` releases at
startup and every six hours while running. They download a higher version and
restart after a five-second notification to install it. Network failures are
logged and monitoring continues. Offline, sleeping, or blocked clients receive
updates after a later successful check; "within hours" is not a guarantee.

Users may download the initial installer from GitHub Releases or Teams. Teams
does not host the update feed. Existing raw copies do not update automatically;
users must install the setup executable first. Existing installed settings are
preserved under `%APPDATA%/Network Map Tray/`.

## Distribution Limitations

Installers are unsigned unless a trusted code-signing certificate is configured,
so Windows SmartScreen or organizational policy may warn or block installation.
Release v1.2.0 uses Electron 45.2.3, and the dependency audit reports zero
vulnerabilities after targeted glob/minimatch overrides. Older v1.1.0 copies use
Electron 26 and should update to the latest release. Re-run
the audit before releasing; dependency advisories change over time, and successful
packaging or a clean dependency audit does not establish overall application security.