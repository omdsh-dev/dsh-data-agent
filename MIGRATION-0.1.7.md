# DSH 0.1.7-rc.1 compatibility

This source revision is plugin **0.2.0**, targeting exactly **DSH 0.1.7-rc.1**. Source migration and subsequent, explicitly authorized local Web installation were validated separately.

## Baseline and evidence

- Baseline plugin: 0.1.5, commit `6657771`; declared DSH dependencies: 0.1.2-alpha.2. The previously installed local host was 0.1.5-rc.3, upgraded to 0.1.7-rc.1 before this source migration.
- Baseline host typecheck and build passed. Vitest found 437 passing tests and three skipped database tests, but also collected two failing Skill-owned Node test suites outside `tests/`. The test script now explicitly targets `tests`.
- Target dependencies and packed declarations are pinned in `package.json` and `pnpm-lock.yaml`: DSH 0.1.7-rc.1, Cordis 4.0.4. The lockfile contains no old DSH cohort or retired `dsh-agent-presets` package.
- Validation environment: macOS, Node 25.9.0, pnpm 11.20.0, local SQLite CLI. The target is the npm prerelease track, not a moving dist-tag.
- Primary contract: the installed exact-version declarations and implementation of `dsh-agent-preset-registry`, `dsh-api-session-controller`, `dsh-client-ui-agent-preset`, `dsh-client-ui-primitives`, and `dsh-llm`, from [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Skill version cards stop before the target; intermediate release edges after those cards are not independently verified. Conclusions here apply to the exact target runtime, not every intervening version.

## Changed contracts

| Version boundary | Change | Implementation and regression |
| --- | --- | --- |
| Old preset service → target registry | Breaking: filesystem discovery and `standingKeyFor()` are unavailable. | The host row reads its installed preset, validates it, and calls `agentPresets.register`. The registry owns scope creation, revision retention, rebinding and disposal. The packaged CLI smoke checks scoped tools, blank-session selection, unload and reload. |
| Old Web session list → target controller | Breaking: `list.current` is absent. | The workbench finds the session retained by `mainView`. A background-only session must not open it. The hero uses the slot's `sessionId`. |
| Old preset seat → target slot contract | Breaking: injection receives `sessionId`, with updated host hooks. | Forward the session id and retain all host hooks. Tests cover session-bound and unbound calls and wrapper disposal. Client typechecking is now part of `pnpm typecheck`. |
| Old primitives → target icons | Breaking: `IconDataOutline16` no longer exists. | Use `IconDataOutlineRegular`; client typecheck, build and component tests cover the import and controls. |
| Old LLM message source → target request input | Breaking: `source.kind = plugin` is no longer accepted. | Catalog auxiliary calls use `RequestUserInput`, without inventing durable message identity or attribution. A regression asserts the exact request input. |

Existing preset files remain the customization source. Recognized package-owned files may be migrated; modified files and adjacent metadata remain intact. Existing `/tool` and `/command` rows retain their config and are resolved beside this artifact. Otherwise these rows are appended in memory. No private scope symbols or registry maps are inspected. Setting `installPreset: false` leaves declaration to another host plugin.

## Seven touchpoints

| Touchpoint | Finding and validation |
| --- | --- |
| Source patches | `cordis.patch.yml` remains a two-row host bundle; no upstream source patch. The packaged runtime consumes it through the real CLI Loader. |
| Events | Existing session/catalog/storage handling remains shared. Persistence and rendering regressions pass; the runtime verifies persisted SQL output and resumes that session after preset reload. |
| Services / Remote | Connection and Catalog services remain host-owned. Registry migration uses the public declaration API. Route and service tests pass; real browser RPC was not exercised. |
| Host filesystem | Preset installation/migration tests use temporary `DSH_HOME` directories and assert unchanged custom files. Runtime profiles, sessions, storage and SQLite fixture all live under a disposable directory. |
| UI / commands / tools | Real Loader verifies the eight-tool data mode, blank-session switching, headless command gating, disposal and re-registration. Component and scope tests cover Web and TUI adapters; no real TUI PTY or browser acceptance claim. |
| Custom channels | No new channel or endpoint. Existing host route and secret-redaction tests pass. |
| Subprocess / output | Existing shell-free database execution tests pass. Packaged runtime uses native Node and the exact CLI entry, a real SQLite subprocess, bounded timeout and process exit, then independently checks that database bytes are unchanged. |

## Reproduction and limits

Final checks: frozen offline installation, host/client typecheck, build, and package dry-run passed. The full suite passed **443 tests**, with **3 optional external-database tests skipped** (38 passing test files, one skipped). The packaged runtime also passed session restoration after registry reload.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm build
pnpm test
npm pack --dry-run
git diff --check
```

`tests/packaged-runtime.spec.ts` packs and extracts the artifact, resolves its installed dependencies from this repository's exact lockfile environment, and launches DSH with a disposable profile. It does not use source aliases for plugin code. Only the LLM is scripted; the Agent loop, registry, Loader, SQL tool, SQLite client and session persistence are real. Its stable result is asserted as an inline snapshot. This proves the built artifact against the installed dependency graph, not a second clean network installation.

After the isolated tests, the packed artifact was installed into the local Web profile with explicit authorization and a backup. Following a full restart, authenticated, read-only status requests confirmed that the host entry and routes were active and the data-agent preset was available. The advertised client batch was fetched and its registration evaluated in a Node VM; it registered the data-agent factory once. Other profile package fields and the profile patch remained unchanged. This was a local status check, not browser interaction or a real database query.

Not verified: a real model/provider API, remote databases (three existing optional tests skipped), real Web/browser interaction (user requested local checks only), TUI PTY, Electron ASAR, Windows/Linux, or arbitrary prior user sessions. No real database was used. Docker release smoke testing was unavailable because the local Docker daemon was not running.

React Doctor was run with `--verbose --diff`. Its maintainability analysis did not complete and it supplied no score, so a score regression cannot be ruled out by that tool. Reported warnings concern existing workbench complexity/fetching and generated output; the generated `zod` warning refers to the existing Schemastery alias. Host/client typechecks and the repository's behavior tests remain the completed checks.

`git diff --check` reports two trailing-whitespace lines in the relocated, generated tslib license comment in `lib/client.js`. The same comment and whitespace exist in the baseline artifact. Source and configuration diffs pass `git diff --check -- . ':!lib'`; generated files were not edited by hand to suppress this inherited formatting issue.
