---
name: version-up
description: "Prepare, validate, tag, push, and publish the next Network Map Tray release."
agent: agent
---

The user is explicitly requesting a release of this repository. Read and follow
[AGENTS.md](../../AGENTS.md) and [docs/RELEASING.md](../../docs/RELEASING.md).

Handle the full workflow: audit changes, update README and the Unreleased changelog,
infer the correct SemVer bump, prepare versions, run all checks and builds, commit,
tag, push, watch GitHub Actions, and verify the published update assets. The user's
explicit release request is approval to commit and publish this project's release.
Do not claim success until the published GitHub release and required assets exist.
Stop and explain concrete blockers rather than skipping checks or security controls.