- [x] Add Worksheets
- [ ] Store the editor content in the worksheet
- [ ] Add a Getting Started screen
- [ ] Persist the editor state
- [ ] Support for multiple queries in the editor
- [ ] List Databases
- [ ] Add Database
- [ ] Edit database

---

# Improvement Backlog (code / design / UX review)

A prioritized list from a full-codebase review. Items are grouped by category
and ordered most-impactful first within each group. `file:line` references point
at the code to change.

## 🔴 Security (do first)

- [ ] **Lock down the localhost API (CORS + auth).** `src/api.ts:32` uses
      `app.use('*', cors())` — wildcard origin, no auth — on a server that runs
      arbitrary user SQL (`POST /queries`) and returns stored DB credentials
      (`GET /databases`). Any web page the user visits can `fetch` connection
      passwords or run `DROP TABLE` against their databases. Restrict CORS to
      the app origin, add an `Origin`/`Host` allow-list (DNS-rebinding defense),
      bind explicitly to `127.0.0.1`, and require a per-session token handed to
      the renderer via `preload.ts`.
- [ ] **Stop storing database passwords in plaintext.**
      `src/main/databases/database-service.ts:22,102` writes the full
      `connectionInfo` (including `password`) as plaintext JSON into
      `~/.../squeal.sqlite3`. Encrypt secrets with Electron `safeStorage`
      (OS-keychain backed) before persisting, and never return the password to
      the renderer in `GET /databases`.
- [ ] **Build the Postgres connection with discrete fields, not string
      interpolation.** `src/databases/postgres-adapter.ts:169` interpolates
      `postgresql://${username}:${password}@...`; a password containing
      `@ / : # ?` corrupts the URL. Pass a `ClientConfig` object
      (`{ user, password, host, port, database }`) like `mysql-adapter.ts:89`
      already does.
- [x] **Harden `BrowserWindow`.** `src/main.ts:56-58` sets only `preload`. Set
      `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
      explicitly, add a `will-navigate` / `setWindowOpenHandler` deny handler,
      and ship a Content-Security-Policy on the renderer.
- [x] **Confirm CDP debug port 9222 can never ship.** `src/main.ts:8-10` guards
      it behind `!app.isPackaged` (correct) — just verify no build path leaves
      `isPackaged` false in a released artifact.

## 🟠 Correctness & robustness (backend)

- [ ] **Don't materialize whole result sets before truncating.** All three
      adapters (`postgres-adapter.ts:117-124`, `mysql-adapter.ts:51-63`,
      `sqlite-adapter.ts:78-84`) buffer _every_ row, then slice to
      `maxRows = 10000`. `SELECT * FROM huge_table` OOMs the main process. Push
      the limit into the driver (`LIMIT 10001` to detect truncation) or use a
      streaming cursor.
- [ ] **Add a statement timeout to query execution.** Timeouts are set only in
      `testConnection`, not `runQuery` (`postgres-adapter.ts:65-105`,
      `mysql-adapter.ts:39-68`). A runaway query holds a connection open
      forever. Set a configurable `statement_timeout` / `maxExecutionTime`.
- [ ] **Use a discriminated union for connection info.**
      `src/databases/schemas.ts:58-68` validates `type` and `connectionInfo`
      independently, so `type: 'sqlite'` + Postgres-shaped info passes
      validation and crashes in `createAdapter` (`sqlite-adapter.ts:146`,
      `pathToFileURL(undefined)`). Use `z.discriminatedUnion('type', …)`. (The
      mysql and postgres schemas at lines 21-43 are also byte-identical.)
- [ ] **Guard update methods against missing/deleted rows.** `updateDatabase`
      (`database-service.ts:99-110`) and `updateWorksheet`
      (`worksheet-service.ts:34-41`) don't filter `isNull(deletedAt)` and don't
      check a row came back — a bad `id` throws a 500 instead of a 404, unlike
      `getDatabase`.
- [ ] **Stop swallowing all migration errors.** `src/database/index.ts:68-87`
      runs hand-rolled `ALTER TABLE … .catch(() => {})`, hiding genuine
      failures. Use `drizzle-kit` migrations (already a dependency) or catch
      only the specific "duplicate column" error.
- [ ] **Handle SSL-cert read failures.** `fs.readFileSync(sslRootCert)`
      (`postgres-adapter.ts:184`, `mysql-adapter.ts:110`) throws a raw `ENOENT`
      to the user when the cert is missing. Wrap with a clear message.
- [ ] **Protect connection cleanup.** `client.end()` in the `finally` of
      `runQuery` (`postgres-adapter.ts:103`, `mysql-adapter.ts:66`) can reject
      and mask the original error / leak the socket. try/catch the cleanup.
- [ ] **Trim the polling payload.** `transformQuery` JSON-parses `result` on
      every `GET /queries/:id` poll and for all 250 rows in `GET /queries`
      (`src/main/queries/index.ts:30-37,100-101`). Return metadata + `truncated`
      from the list endpoint and add a lightweight status-only poll that omits
      the row payload until needed.

## 🟡 Frontend code quality

- [ ] **Delete dead code (~750 lines).** `ui/sidebar.tsx` (731 lines) is unused
      — the real sidebar is the hand-written `AppSidebar.tsx`;
      `hooks/use-mobile.ts` is only consumed by that dead file. Remove both.
      Also remove the unused `ThemeContext` / `useThemeContext` in
      `ThemeProvider.tsx:6-29` (zero consumers).
- [ ] **Fix the `useTheme` stale-closure bug.** `hooks/useTheme.ts:54-74` — the
      OS-theme listener closes over mount-time `initial` and never
      re-subscribes, so picking `dark` while in `system` gets overridden on the
      next OS switch, and switching to `system` ignores OS changes. Depend on
      current `theme.mode` and re-resolve inside `handleChange`.
- [ ] **Move side effects out of the `setState` updater.**
      `hooks/useTheme.ts:41-52` calls `localStorage.setItem` and `applyTheme`
      inside `setThemeState((previous) => …)`; StrictMode double-invokes it.
      Compute `next` purely in the updater and run side effects in a `useEffect`
      keyed on `theme`.
- [ ] **Remove `any` from `QueryResultTable`.**
      `QueryResultTable.tsx:30-45,59,70,75` uses `result: any` throughout,
      violating `CODE_STYLE.md` and hiding shape bugs (see the 0-row footer
      below). Import the real `QueryResult` type off `QueryDto`. (Same `any`
      issue in the backend `QueryDto` — `src/main/queries/index.ts:19,100`.)
- [ ] **Don't wrap every result cell in its own `<ContextMenu>`.**
      `QueryResultTable.tsx:80-144` instantiates a full Radix menu per cell
      (~2,000 subtrees for a 100×20 result). Render one shared menu and set the
      target cell/row in state `onContextMenu`.
- [ ] **Narrow worksheet subscriptions.** `App`, `DatabaseSelector`, and
      `WorksheetExplorer` all subscribe to the entire worksheets collection via
      `useWorksheets()`, so every debounced content save (`App.tsx:158`)
      re-renders the whole sidebar. Add a `useCurrentWorksheet(id)` hook that
      filters in the live query, and a `useDatabase(id)` hook — also dedupes the
      identical `find` in `App.tsx:66-69` and `DatabaseSelector.tsx:24-27`.
- [ ] **Fix floating promises.** `hooks/mutations.ts:131`
      (`queryClient.invalidateQueries` not awaited/voided) and the
      `Promise.all().then().catch().finally()` chain in
      `DatabaseForm.tsx:265-299`. Violates "No Floating Promises".
- [ ] **Factor out the collection boilerplate.** The
      `if (collection.status === 'ready') { collection.utils.write…() }` guard
      (×4 in `mutations.ts`) and
      `void transaction.isPersisted.promise.catch(() => undefined)` (5+ copies
      across `App`/`DatabaseExplorer`/`WorksheetExplorer`/`DatabaseSelector`)
      should become small helpers, or prefer collection-native
      `onInsert`/`onUpdate` so components stop poking `collection.utils`
      directly.
- [ ] **Unify Redux slice conventions.** `store/*` mixes past-tense event names
      (`editor-slice`) with imperative names (`ui-slice`,
      `database-explorer-slice`) and bundled vs named exports.
      `expandDatabase`/`expandTable` actually toggle — rename to match. Pick one
      style.
- [ ] **Smaller fixes:** `WorksheetEditor.tsx:68-75` keymap `run` returns
      `undefined` in the else path (should `return false`); untitled-numbering
      can collide after deletion (`WorksheetExplorer.tsx:71-77` — use max
      suffix + 1, not count + 1); `ResultSheet.tsx:36-53` drag listeners leak if
      unmounted mid-drag; alphabetize imports in `hooks/queries.ts` and
      `hooks/mutations.ts`.

## 🔵 UX — missing SQL-client affordances

- [ ] **Add delete/remove actions.** `WorksheetExplorer.tsx` has create + rename
      but no delete (no row context menu at all); `DatabaseExplorer.tsx:195-203`
      offers only "Edit", no "Remove". Add a right-click menu (Rename /
      Duplicate / Delete) on worksheet rows and a "Remove database" item, with
      confirmation.
- [ ] **Add query history.** `App.tsx:114-120` only ever shows `sorted[0]` (the
      latest run) though the queries collection stores more. Add a history
      dropdown in the `ResultSheet` header to browse and re-open prior runs.
- [ ] **Add schema-aware, dialect-correct autocomplete.**
      `WorksheetEditor.tsx:62,73` calls `sql()` / `autocompletion()` with no
      schema and no dialect. The schema is already fetched (`useDatabaseSchema`)
      — feed it into `sql({ schema, dialect })` for table/column completion.
      Biggest editor ergonomics win.
- [ ] **Add "Run all", SQL formatting, and a shortcuts surface.** `App.tsx:197`
      only runs the statement under the cursor (Cmd+Enter). Add run-all,
      format-SQL, a Cmd+K palette, and a discoverable keyboard-shortcuts help
      sheet.
- [ ] **Let the result panel collapse/close.** `App.tsx:312` /
      `ResultSheet.tsx:81` keeps the sheet open whenever a query exists and only
      allows resize. Add a collapse/close control and an Escape handler.
- [ ] **Let the sidebar collapse** to reclaim editor width (`App.tsx:256`).

## 🟣 UX — states, guards & feedback

- [ ] **Fix the 0-row result state.** `QueryResultTable.tsx:46-47,157` renders
      "Rows 1–0 of 0" under an empty table. Add a "No rows returned" empty state
      and a distinct state for non-SELECT statements that return `rowCount` but
      no rows (`App.tsx:358` only branches on `query.result`).
- [ ] **Add schema loading/error states in the explorer.**
      `DatabaseExplorer.tsx:132-137,206` shows nothing while `useDatabaseSchema`
      loads and nothing (silently) if the connection fails on expand. Add a
      loading skeleton and an inline error + retry.
- [ ] **Disable Run when the worksheet has no database.** `App.tsx:204-216`
      defaults `databaseId` to `''` and lets Run fire, failing only via a toast.
      Disable the button with a tooltip ("Select a database first"), mirroring
      the `!activeStatement` handling.
- [ ] **Reconcile row-count sources.** `ResultSheet.tsx:99` shows
      `result.rowCount` while `QueryResultTable.tsx:43,157` uses
      `result.rows.length` and a hardcoded "Showing first 10,000 rows" — they
      disagree on truncation. Derive both from one source tied to the real
      limit.
- [ ] **Persist the connection-test result.** `DatabaseForm.tsx:274-277,306-330`
      keeps the pass/fail reason only in a disappearing toast. Render a
      persistent inline success/error banner from `connectTestResult`.
- [ ] **Add a password reveal toggle** to the connection form
      (`DatabaseForm.tsx:625`).

## ⚪ Accessibility

- [ ] **Add `aria-label`s to icon-only buttons.** Run (`App.tsx:265`),
      add-worksheet `+` (`WorksheetExplorer.tsx:159`), add-database `+`
      (`DatabaseExplorer.tsx:66`), EditorScreen close (`EditorScreen.tsx:59`),
      and the TitleBar window controls (`TitleBar.tsx:33-45`) have no accessible
      name. Copy the correct pattern from `WorksheetEditor.tsx:159`
      (`aria-label="Focus editor"`).
- [ ] **Give custom modals dialog semantics.** `EditorScreen.tsx:54` and
      `GettingStartedScreen.tsx:8` are plain `fixed inset-0` divs — no
      `role="dialog"`/`aria-modal`, no focus trap/return, no Escape, no
      backdrop-close. Rebuild on the Radix Dialog already used in
      `ui/sheet.tsx`.
- [ ] **Fix the resize separator.** `ResultSheet.tsx:83-91` is keyboard-operable
      but missing `aria-valuenow/valuemin/valuemax` and any `focus-visible`
      style.
- [ ] **Add focus-visible rings** to hand-rolled buttons: pagination
      (`QueryResultTable.tsx:162-180`) and the focus-editor overlay
      (`WorksheetEditor.tsx:158`) lack the ring the shared `Button` has.
- [ ] **Expose the active worksheet** with `aria-current="true"`
      (`WorksheetExplorer.tsx:210-217` — currently visual-only).

## 🎨 Design & visual polish

- [ ] **Theme the toasts.** `renderer.tsx:35` renders `<Toaster />` with no
      props, so Sonner shows light-themed toasts in dark mode — and toasts are
      the primary error surface. Pass `theme={resolvedMode}`, `richColors`, and
      a chosen position.
- [ ] **Add a visible theme toggle.** The only switch is the `mod+shift+l`
      hotkey (`ThemeProvider.tsx:13`); `useTheme` even exposes `system` mode
      with no UI to pick it. Add a control in the TitleBar or a settings menu.
- [ ] **Truncate overflowing text.** Long names blow out the fixed `w-80`
      sidebar (`AppSidebar.tsx:9`; rows at `WorksheetExplorer.tsx:210`,
      `DatabaseExplorer.tsx:178,219`) and the `w-fit` DB selector trigger
      (`DatabaseSelector.tsx:61`). Add `truncate min-w-0` + `title`, and a
      `max-w` on the selector. Cap wide result cells (`ui/table.tsx:79` is
      `whitespace-nowrap`) with `max-w-* truncate` + reveal-on-hover.
- [ ] **Align numeric columns.** `QueryResultTable.tsx:77,85` right-aligns
      numbers in a proportional font — apply `font-mono tabular-nums` (as
      `App.tsx:329` already does for elapsed time).
- [ ] **Unify accent + ellipsis usage.** Text selection is `bg-blue`
      (`ui/input.tsx:11`) but mauve in the editor (`codemirror-theme.ts:18`) —
      pick one. Standardize on the "…" character (`DatabaseForm.tsx:755` and
      search placeholders use "..."). Mute the search icon
      (`SearchInput.tsx:27`, no color class) and add a clear button. Italicize
      actual `NULL` cells so they don't look like the string "null"
      (`QueryResultTable.tsx:86`).
- [ ] **Use `cursor-pointer`** on interactive tree rows
      (`DatabaseExplorer.tsx:179,220` currently `cursor-default`) and add
      tooltips to the `+` add buttons.

## 🧪 Testing, tooling & hygiene

- [ ] **Resolve the dead AI-chat feature.** `src/main/chat/routes.ts` registers
      zero routes (only an `eslint-disable`d unused schema), `saveChat`
      (`persistence.ts`) is never called, and no `@ai-sdk/*` / `ai` import
      exists in `src` — yet 5 heavy AI dependencies ship in `package.json`.
      Either wire chat up or delete `src/main/chat`, drop the AI deps, and the
      mount at `api.ts:40`. Also update stale `CONTRIBUTING.md` references to a
      nonexistent `src/main/auth/`.
- [ ] **Test the core query path.** `src/main/queries/query-runner.ts` (174
      lines) has no test — export and unit-test `createAdapter`,
      `isCancellationError` (fragile string match), and `extractErrorMessage`.
      Add tests for `middleware/error-handler.ts` and `errors.ts`
      (`ValidationError`) — both are pure and trivial. `saveChat` is also
      untested (if kept).
- [ ] **Enable TypeScript `strict`.** `tsconfig.json` sets only `noImplicitAny`
      — without `strictNullChecks` the "no non-null assertion" and "prefer
      nullish coalescing" rules can't be enforced.
- [ ] **Re-enable `@typescript-eslint/no-explicit-any`.** `.eslintrc.json:17`
      turns it off, directly contradicting `CODE_STYLE.md`; 8+ `any` uses exist
      in non-test source (`query-runner.ts:82`, `queries/index.ts:21,100`,
      `error-handler.ts:22,32`, `chat/persistence.ts:11`,
      `QueryResultTable.tsx:33,42,70`).
- [ ] **Upgrade the lint stack.** `@typescript-eslint` `^5.62` doesn't support
      TypeScript 5.7, and ESLint 8 is EOL. Move to `@typescript-eslint` v8 +
      ESLint 9 flat config — this unlocks the type-aware `no-floating-promises`
      rule.
- [ ] **Fix the test scripts and add coverage.** `"test": "vitest"` runs watch
      mode (hangs contributors). Add `"test": "vitest run"` + `"test:watch"`,
      install `@vitest/coverage-v8`, and surface coverage in CI.
- [ ] **Harden CI.** `.github/workflows/ci.yml` uses mutable `yarn install` (use
      `--frozen-lockfile`) and builds only on ubuntu — add a
      `[ubuntu, macos, windows]` matrix so native `pg`/`@libsql` packaging
      regressions are caught. Add a `prettier --check` step and consider
      `husky` + `lint-staged`.
- [ ] **Add macOS signing/notarization** to `forge.config.ts` (gated on secrets)
      — released builds are currently unsigned and Gatekeeper-blocked. Verify
      the `npm pkg set version=${GITHUB_REF_NAME#v}.0` scheme in
      `release.yml:31` (a `v1.2.3` tag becomes an invalid `1.2.3.0`).
- [ ] **Housekeeping.** Delete the orphaned `vite.renderer.config.ts` (only the
      `.mjs` variant is wired into Forge). Add a committed `.env.example`
      documenting `POSTGRES_URL` / `SQLITE_PATH` (used by
      `src/database/index.ts` and `scripts/seed.ts`) and reference it in
      `CONTRIBUTING.md`.

## ✅ Already solid (leave alone)

- Async query design: POST creates a row, background runner writes
  `result`/`error`, client polls; `runningAdapters` cleaned in `finally`.
- Postgres cancellation via a separate `pg_cancel_backend` connection.
- `postgres-identifier-fixer` uses a real tokenizer with positional replacement.
- `api-client.ts` (`handleResponse<T>` + typed `ApiError`), `AppShell.tsx` error
  boundary resets, the debounced-save flush-on-switch, and the `sql-parser/`.
- DB-layer test coverage (all adapters, identifier-fixer, schema-provider,
  services) and consistent `toEqual` / whole-object assertions.
- Electron fuses in `forge.config.ts` (RunAsNode off, ASAR integrity, cookie
  encryption).
