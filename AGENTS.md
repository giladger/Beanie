# Beanie

## Workflow

- **Finish every task by committing.** When a task is complete and verified, commit the
  changes. Use a clear sentence-style commit subject. Pushing is separate and happens
  only when explicitly requested.
- **Commit directly to `main`.** Do not create a feature branch unless the user explicitly
  requests a git worktree; in that case commit on the worktree branch.

## Architecture changes

- Read `docs/architecture.md` and `docs/runtime-ownership-and-consistency.md` before
  changing command ownership, startup, settings, inventory, caching, or async flows.
- Preserve the single gateway scheduler and the typed machine/inventory/deletion owners.
  Inject narrow capabilities; do not add new gateway or cache singleton imports to flows.
- Run `npx tsx src/test/commandArchitectureGuard.test.ts`, `npm test`, and the relevant
  focused tests before committing an architecture change.
