# Squeal

Ergonomic SQL Client for Humans. Electron desktop app with React frontend.

- Design for mobile first. Then use Tailwind modifiers to expand the design for
  larger devices and desktop.
- Use assertions like tiny-invariant to throw on invalid states.
- Use Conventional Commits.

## Friction log

Papercuts in this project's own tooling, docs, APIs, tests, and conventions get
written down as they are hit, so the next person does not rediscover them.
Entries live in `.agents/friction-log/`, one directory each, committed with the
code.

- Run `npx frog list` first — the friction may already be known.
- Log what cost you time with `npx frog log`, at the moment you hit it.
- Only friction belonging to _this_ project. Global, system, and internal
  friction does not go here.

No GitHub automation is wired up: entries stay in the repo as files. The issue
form at `.github/ISSUE_TEMPLATE/friction.yml` is for humans filing friction by
hand, and `npx frog publish` is a deliberate, manual step.

## Code Style

- Don't use CONSTANT_CASE. This is not JAVA.
- Use entire words as variable names. This is not Go. For example `request`
  instead of `req`.
- Use punctuation.
- Use whitespace to break up code to make it easier to read. Put a blank like
  after const groups and control flows and before return statements.
- Order things in alphabetical order by default. If applicable order by
  accessiblity level first, then alphabetical order.
- No any: Use proper types or unknown
- Prefer Nullish Coalescing: Use ?? over ||
- No Floating Promises: Always await or handle promises
- No Non-null Assertions: Avoid ! operator
- Single quotes
- No semicolons
- Always use bracers for control statements.

## Memory

The services are long-running processes; small per-request retention becomes a
production leak. Rules for all TypeScript code:

- No unbounded module-level collections. Any module-scope `Map`, `Set`, array,
  or object that grows per request needs an eviction strategy (TTL, LRU, max
  size) — or should live per-request instead.
- Pair every acquire with a release in a `finally`: remove listeners, clear
  timers, close sockets, cursors, and sessions — including on the error path.
- Give every external await a timeout. Pass `AbortSignal.timeout(...)` to
  `fetch` and SDK calls so a hung call becomes a settled rejection instead of
  retained state (counters, Sets, closures) that never releases.
- Create per-request objects (DataLoaders, request contexts) per request. Never
  retain them at module scope.
- Create long-lived singletons (DB clients, runtimes) once at boot with bounded
  pools, and release them on shutdown.
- Bound what you accept and return: body-size limits, pagination caps, and
  projections that exclude large fields.

## Error handling

- Always handle errors.
- User facing errors should be easy to understand and actionable.
- Error messages must be **actionable** — tell the user what went wrong and what
  they can do about it
- When planning features, always consider what errors can occur and include the
  exact error messages in the plan

## Testing

- Put test files next to the implementation.
- Prefer `toEqual` over `toBe`
- Compare entire objects instead of single properties.
  `expect(product).toEqual({ id: 1, name: 'Cup' })`
- Use RTL to test React components.
- Unit test small, side effect free modules.
- We prefer "integration tests" that only mocks a small set of dependencies.
- Normally, we test the entire endpoint, using a mock database in esix. A good
  API test should perform a request and then assert that the correct documents
  have been created in the database.

## Prefered Tools

- Bun
- Effect-TS (the whole backend; also the renderer's API client)
- Tailwind CSS
- shadcn/ui
- Lucide icons
- React hook form
- tiny-invariant
- tiny-typescript-logger
- Zod (renderer form validation only — the API contract uses Effect Schema)

## Architecture

The backend is written in Effect-TS. Services are `Effect.Service` classes with
`accessors: true` that declare their own dependencies; the whole backend is one
layer graph owned by a `ManagedRuntime` that Electron builds on `ready` and
disposes on `before-quit`.

- **Main process** (`src/main.ts`): Electron app; builds the runtime, mints the
  session token, owns process exit
- **Backend** (`src/server/`): HTTP layer, services, tracing, retention
- **Shared contract** (`src/glue/api/`): the `HttpApi` definition, Effect Schema
  request/response types, and the tagged error catalog — imported by both
  processes, so it must stay free of main-process imports
- **Renderer process** (`src/app/`): React frontend; its API client is derived
  from the shared contract
- **Database**: SQLite via Drizzle for app state, PostgreSQL/MySQL/SQLite
  adapters for user queries (promise-based, wrapped in services)

## Key Files

- `src/glue/api/api.ts` - the `SquealApi` definition (single source of truth for
  routes, payloads, and errors)
- `src/glue/api/errors.ts` - tagged errors with their HTTP statuses
- `src/server/runtime.ts` - the layer graph and `ManagedRuntime`
- `src/server/http/server.ts` - handlers, CORS, and the loopback server layer
- `src/server/services/query-runner.ts` - async query execution and cancel
- `src/server/tracing/effect-tracer.ts` - Effect tracer writing to the spans
  table
- `src/database/schema.ts` - Drizzle schema definitions
- `src/databases/postgres-adapter.ts` - PostgreSQL connection handling
- `src/app/api-client.ts` - typed client derived from the contract
- `src/app/App.tsx` - Main React component

## Commands

- `yarn start` - Development mode
- `yarn seed` - Seed PostgreSQL with Pagila sample data
- `yarn lint` / `yarn format` - Code quality (`yarn format:check` is the
  read-only form CI runs)
- `yarn typecheck` - Runs two projects: `tsconfig.backend.json` (strict, covers
  `src/server` and `src/glue`) and `tsconfig.renderer.json`
- `yarn test` - Vitest, split into a `backend` project (node environment) and a
  `renderer` project (jsdom)

Schema changes do **not** go through a migration tool. There is no generated
migration in the tree and nothing that would apply one; `drizzle-kit` and the
`drizzle/` folder it wrote were deleted, and `migration-tooling.test.ts` fails
if either comes back without something to run it. `src/database/index.ts` runs
`createTables` from `src/database/tables.ts` (hand-written
`CREATE TABLE IF NOT EXISTS` — the real DDL, and what in-memory test databases
are built from) and then `reconcileColumns`, which ALTER-adds columns missing
from older databases. A new table or column goes in both
`src/database/schema.ts` and `tables.ts`; the guard test in
`reconcile-columns.test.ts` fails if they disagree.

## Notes

- The application menu is replaced at boot by `src/main/menu.ts`. Electron's
  default menu binds Reload to ⌘R and Force Reload to ⌘⇧R, and a menu
  accelerator beats anything the renderer registers — so an app shortcut on
  either key reloads the window instead, with nothing on a frameless window to
  suggest a menu is doing it. `Menu.setApplicationMenu(null)` is worse: on macOS
  the Edit menu is what supplies ⌘C/⌘V/⌘X/⌘A/⌘Z. The template is the default
  minus `reload` and `forceReload`, and `menu.test.ts` fails if either comes
  back.
- Native packages (`pg`, `@libsql`) are externalized in `vite.main.config.ts`
- API base URL in frontend: `http://127.0.0.1:7847` (the server binds loopback
  only)
- The API requires a per-session bearer token on every route except `/health`
  (which answers `{ status: 'ok' }` from nothing at all, so the one
  unauthenticated route cannot reach the keychain) and, in dev, GET `/traces*`.
  The renderer gets it via `window.electron.getApiToken()`; the token is not
  printed at startup. Auth is an `HttpApiMiddleware`, applied per group — the
  trace-read carve-out is a separate middleware tag rather than path matching.
- Errors are `Schema.TaggedError`s: the body is the serialized error
  (`{ _tag, message, ... }`) and the status comes from its annotation, so the
  renderer discriminates on `_tag`. Errors internal to the backend
  (`src/server/errors.ts`) are never in the contract — they become defects and
  surface as a 500.
- Query execution is async: POST creates query, poll GET `/queries/:id` for
  results. The background fiber lives in a `FiberMap` owned by the runtime
  scope, so shutdown interrupts it; user cancel goes through the adapter
  (`pg_cancel_backend`), never fiber interruption, and there is deliberately no
  timeout on user queries.
- Database `connectionInfo` is encrypted at rest with Electron `safeStorage`
  once the user has granted permission (`enc:v1:` prefix in the `databases`
  table; see Secret storage below). API responses never include passwords —
  internal callers use `getDatabaseWithSecrets()`. A request that omits the
  password borrows the stored one (an update by its own id, a connection test by
  the `databaseId` it sends), and both go through
  `DatabaseService.resolveConnection`, which lends the secret only back to the
  server it was saved for: `host` and `port` must match. Everything else keeps
  borrowing — the username, the database name, and both SSL fields; moving the
  host or the port answers `DifferentServerError` (400) on the update and a
  `success: false` message on the test, and the user re-types the password. An
  empty stored password counts as no stored password, so a row repaired after an
  unreadable secret is never refused over a password it does not have. The
  update route used to merge the password in on its own, without any of that,
  which made a PATCH a two-step way around the connection test's refusal.
- `sslMode` and `sslRootCert` were once part of that comparison, on the grounds
  that they decide how the secret travels rather than where it goes. They were
  taken out because the cost was a re-typed password on every SSL edit — in both
  directions, tightening included — and the app never shows a stored password,
  so "re-type it" meant going and finding it. The exposure left behind is a
  downgrade that puts the secret in front of someone already on the network path
  to a host the user chose, which is a much higher bar than being handed it
  outright; redirecting it to another host is still refused.
- Don't include the Claude footer in commits

## Secret storage

Nothing in the app touches the OS keychain until the user has agreed to it. That
consent is a persisted three-state mode — `undecided`, `keychain`, `plaintext` —
in the single-row `settings` table, and it exists because reaching the keychain
raises an OS prompt: on macOS even `safeStorage.isEncryptionAvailable()` does,
since Chromium's `IsEncryptionAvailable()` fetches the key from the Keychain. So
"just check first" is not available.

- **The invariant**: `src/main/databases/secret-storage.ts` is the only module
  permitted to import `safeStorage`, and it enforces the mode itself. Outside
  `mode === 'keychain'`, `encrypt` returns its input and `decrypt` refuses an
  `enc:v1:` value. The gate lives in that module rather than in the
  `SecretStorage` Effect service because the plain `safeStorageSecretStorage`
  object is reached from Effect code and promise code alike, and
  `isEncryptionAvailable()` is called _inside_ `encrypt`, below the service
  boundary.
- **The one deliberate touch** is `probeEncryption()`, reached only through
  `POST /secret-storage/grant` — i.e. only when the user clicks the button
  asking for it. It round-trips a value rather than checking availability,
  because `isEncryptionAvailable()` can answer for a key that then fails to
  seal. On Linux, `getSelectedStorageBackend() === 'basic_text'` counts as
  failure: that backend obfuscates with a hardcoded key while reporting
  encryption as available, so accepting it would tell the user their passwords
  are protected when they are not.
- **Existing installs never see the screen.** `SecretStorageSettings.resolve()`
  runs at boot; when no decision is stored it looks for an `enc:v1:` prefix on
  any stored `connectionInfo` (a string test — no keychain) and infers
  `keychain`. Soft-deleted rows count, because deleting a connection overwrites
  its secret with an encrypted `{}`.
- **Contract**: `GET /secret-storage` (resolves and returns
  `{ message, mode, storageName }`), `POST /secret-storage/grant`,
  `POST /secret-storage/skip`. No error channel — a refused prompt is the user's
  answer, so it is a 200 carrying `mode: 'undecided'` and a message, the same
  way a failed connection test is a 200. `storageName` is the platform's word
  for its keychain, resolved in the main process so the renderer never touches
  the deprecated `navigator.platform`.
- **UI**: `src/app/components/SecretStorageConsentScreen.tsx`, gated in
  `AppDataLoader` (`src/app/AppShell.tsx`) _below_ `failIfLoadFailed` — that
  order is what stops a broken backend from rendering as a welcome screen.
  Returning the screen instead of `children` means `App` never mounts, so it
  cannot stack with `GettingStartedScreen` and no poller starts behind it. The
  read suspends; a non-suspending default would flash the screen at returning
  users. The screen includes `TitleBar` because the window is frameless.
- **Reversal** is offered in one place: the "stored unencrypted" notice in a
  connection's Authentication section. Granting re-encrypts every stored
  password, so it is a complete reversal. The other direction is deliberately
  not offered.
- **Encryption state**: everything the process knows about its own encryption is
  one value in `secret-storage.ts` — `{ mode: 'keychain', sealing }` or
  `{ mode: 'plaintext' | 'undecided', warnedAboutPlaintext }`. The union is what
  keeps a "the keychain is broken" flag from outliving the mode it was learned
  about: applying a mode replaces the whole value. It is process-local and never
  persisted, because a `'failed'` written to disk would outlive the restart that
  fixed the keychain. `sealing` starts at `working` on every mode change, which
  is optimism at boot (the stored mode probed nothing) and safe only because
  nothing reports `working` — a warning needs a seal attempt that failed.
- **A keychain that breaks after permission is granted** — a locked login
  keyring answers `isEncryptionAvailable()` and then throws — is caught inside
  `encrypt`, which returns the plaintext it was handed rather than letting a
  defect turn an otherwise fine save into a 500. It warns on the transition into
  failure rather than latching, so a keychain that breaks, is repaired, and
  breaks again says so both times. `POST /secret-storage/grant` reports the same
  thing to the user: it counts the rows re-encryption left as plaintext and
  returns `mode: 'keychain'` with a `message`, which both callers check before
  announcing a success.
- **Known gap**: an ordinary save (`POST`/`PUT /databases`) that hits a broken
  keychain still stores the password as plaintext with only a `log.warn` — the
  response says nothing, so the user is told about it on the next grant and not
  before. Carrying the sealing state on `DatabaseDto` would close it without
  probing anything.

## Updates

Squeal updates itself through Electron's built-in `autoUpdater`, pointed at
[update.electronjs.org](https://update.electronjs.org) — the free Squirrel feed
for public repos. The feed URL is
`https://update.electronjs.org/Artmann/squeal/<platform>-<arch>/<version>`.

Two constraints in the release pipeline are invisible until updates silently
stop working, so both have comments at the code:

- **Release tags must be valid semver.** The service skips any release where
  `semver.valid(release.tag_name)` is false, so `squeal-v1.2.0` was invisible to
  it — hence `include-component-in-tag: false` in `release-please-config.json`.
  Tags are `v1.3.0`.
- **macOS needs the ZIP, not the DMG.** Squirrel.Mac cannot install from a DMG.
  `forge.config.ts` ships both: the DMG for first install, `MakerZIP` for
  updates. Removing the ZIP maker breaks macOS updates while every build still
  passes, which is how it was lost once already.

macOS ships **one universal build** rather than an asset per architecture:
`yarn make:mac` (`electron-forge make --arch=universal`), which the release
workflow runs in place of `yarn make` on the single macOS runner. Two things
make that work, and both are load-bearing:

- `scripts/fetch-macos-bindings.ts` puts _both_ of libsql's macOS native
  bindings into `node_modules` before the build. The x64 and arm64 slices are
  packaged from the same host tree, and `@electron/universal` aborts the merge
  when a Mach-O file exists in only one of them. `forge.config.ts` names those
  bindings in `osxUniversal.x64ArchFiles` for the same reason.
- The feed serves the universal asset to `darwin-x64` and `darwin-arm64` clients
  alike, as soon as it is newer than the newest arch-specific asset
  (`handleUpdate` in `update.electronjs.org`). That is what migrates an install
  running under Rosetta — `process.arch` reports `x64` there, so a per-arch
  release would keep feeding it the Intel build forever.

Windows needs nothing special — the Squirrel `Setup.exe`, `RELEASES`, and
`-full.nupkg` are already uploaded, and the feed serves the channel from them.
Linux has no Electron updater support at all, so it takes a separate path: a
`GET` on the GitHub releases API, and a popover offering the release page.

- **Layout**: `src/main/updates/updater.ts` is the state machine (no Electron,
  no `fetch` — both arrive through an `UpdateBackend`, which is what makes it
  unit-testable). `src/main/updates/electron-updater.ts` builds the real
  backends and decides whether this build can update itself at all.
  `src/server/services/updater.ts` wraps it as a scoped `Effect.Service`;
  `src/server/updates.ts` is the check schedule.
- **Contract**: `GET /updates` (never fails — a failed check is `state: 'error'`
  with a message) and `POST /updates/install` (409 `UpdateNotReadyError` when
  nothing is ready). There is no check endpoint on purpose: the backend checks
  on its own schedule and no UI asks for one.
- **UI**: `src/app/components/UpdateIndicator.tsx` in the status bar, absent
  unless the state is `ready` or `available`. There is deliberately no manual
  "check for updates" affordance — the app has no menu bar to hang one off.
- **Schedule**: 30 seconds after boot, then every 6 hours. The updater refuses
  to start a second check while one is in flight or an update is already waiting
  — `autoUpdater.checkForUpdates()` downloads the update again on every call.
- **Untraced**: `GET /updates` is in `src/server/tracing/trace-skip.ts`; polling
  it every minute for a whole session would eat a large share of the span
  retention budget. `POST /updates/install` stays traced.
- **In development** the status is always `state: 'unsupported'` with "Updates
  are only available in a packaged build." — `setFeedURL` throws on an unsigned
  build, so nothing is ever attached. On macOS the same applies when the app is
  not in `/Applications`, because Squirrel.Mac cannot swap a bundle on the
  read-only volume a DMG mounts as.
- **`quitAndInstall` routes through the `before-quit` handler** in
  `src/main.ts`, which prevents the default, disposes the runtime, and then
  calls `app.exit(0)`. The installer is already primed and finishes once the
  process is gone. If it ever does not, a downloaded update is applied on the
  next launch regardless.
- The `ready` state cannot be reached in development, so the popover is covered
  by `UpdateIndicator.test.tsx` and the real download-and-restart path can only
  be verified against an actual release.

## Tracing

OTEL-style tracing is built in: the renderer and main process emit spans (W3C
`traceparent` propagation) into the `spans` table of the app SQLite database.
Retention: 7 days / 50,000 spans, swept by scoped fibers in
`src/server/retention.ts`.

In the main process this is Effect's own tracing: a custom `Tracer`
(`src/server/tracing/effect-tracer.ts`) writes finished spans straight into the
table, so anything wrapped in `Effect.fn('Service.method')` or `Effect.withSpan`
shows up in the dashboard for free. Server spans are renamed at write time to
`METHOD /route` so the trace list keeps its familiar names. The renderer's
tracer stays hand-rolled and batches spans to `POST /traces/spans`.

- **Agent access (dev only, no token needed)**:
  `curl 'http://127.0.0.1:7847/traces?limit=20'` lists traces (filters:
  `errorOnly=true`, `search=<name>`, `before=<epoch-ms>`);
  `curl http://127.0.0.1:7847/traces/<traceId>` returns the span tree with
  attributes and exception events. Span ingest (`POST /traces/spans`) always
  requires the bearer token. In packaged builds every trace route is
  authenticated.
- **In-app dashboard**: press `mod+shift+t` or click the Activity icon at the
  bottom of the sidebar — full-page trace list, span waterfall, and span details
  including exception stack traces. `Esc` steps back one level at a time (span →
  trace → list → close).
- Running a query produces one trace rooted in the renderer: `query.run` →
  `HTTP POST /queries` → `POST /queries` (server) → `QueryRunner.createAndRun` →
  `query.execute` → `query.loadConnection` / `db.query` / `query.saveResult`.
  The background fiber inherits the request span as its parent automatically.
- Deliberately untraced: `/health`, `/traces*`, and the 250ms result poller
  (`GET /queries/:id`) — see `src/server/tracing/trace-skip.ts`. Service methods
  on those paths use an unnamed `Effect.fn` so they do not emit parentless root
  traces. Uncaught renderer errors and unhandled rejections appear as
  `renderer.error` traces.

## Testing the running app with agent-browser

The app exposes Chrome DevTools Protocol on port `9222` whenever it isn't
packaged (set in `src/main.ts` via `app.commandLine.appendSwitch`). Start the
app with `yarn start`, then drive the renderer with
[agent-browser](https://github.com/vercel-labs/agent-browser):

```bash
agent-browser --cdp 9222 snapshot -i
agent-browser --cdp 9222 click @e1
agent-browser --cdp 9222 screenshot
```

Use `--cdp 9222` (not `--auto-connect`) so it attaches to the Electron window
rather than the user's regular Chrome. Refs invalidate after navigation or DOM
changes — re-snapshot before re-interacting.
