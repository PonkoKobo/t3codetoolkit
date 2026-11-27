# T3CodeToolkit Agent Instructions

## Upgrading T3CodeToolkit for a New T3 Code Version

Whenever T3 Code updates to a new version (or the user asks to check compatibility / upgrade Toolkit for a new T3 Code release), follow the full runbook in [docs/T3CODE_UPGRADE_CHECKLIST.md](docs/T3CODE_UPGRADE_CHECKLIST.md).

## Key Repository Rules

- **Never modify `~/.t3/userdata` or the user's live T3 Code profile/database.** Always run live verification in an isolated user-data directory, scratch `t3 --base-dir`, or isolated browser profile.
- **Never kill the user's running T3 Code window.** After installing locally, let the user quit T3 Code and reopen **T3 Code + Toolkit** when ready.
- **Keep version bumps tied to releases.** Use `npm run release:version -- <patch|minor|major>` to keep `package.json`, `package-lock.json`, and `extension/manifest.json` in sync, and push a matching annotated tag `vX.Y.Z` (with a short user-facing first-line message) on the same commit as the version bump so `.github/workflows/ci.yml` passes and publishes the release.
- **Always run `npm run package && npm test`** before finishing code changes.
