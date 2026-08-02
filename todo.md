- [x] Add Worksheets
- [x] Store the editor content in the worksheet
- [x] Add a Getting Started screen
- [ ] Persist the editor cursor, scroll position and selection. Open tabs, the
      active tab (`ui:tabs:v1`, `store/tabs-storage.ts`), the sidebar width and
      the results height (`hooks/use-persisted-size.ts`) already survive a
      restart — the caret does not.
- [x] Support for multiple queries in the editor
- [x] List Databases
- [x] Add Database
- [x] Edit database

---

# Improvement Backlog (code / design / UX review)

A prioritized list from a full-codebase review. Items are grouped by category
and ordered most-impactful first within each group. `file:line` references point
at the code to change.

> **Reviewed against `e504d05` on 2026-08-01.** The list was first written on
> 2026-07-08, before the Effect-TS backend migration (Hono `src/api.ts` →
> `src/server/`) and the UI redesign (tokens, worksheet tabs, docked results
> pane, status bar). Both moved most of the code it was written against. Items
> resolved since then are checked off with a `Fixed:` line naming the current
> code; the original body is kept as history, so **paths inside a checked item
> may no longer exist**. Open items were re-verified and their references are
> current as of this review.

## 🔴 Security (do first)

- [x] **Lock down the localhost API (CORS + auth).** `src/api.ts:32` uses
      `app.use('*', cors())` — wildcard origin, no auth — on a server that runs
      arbitrary user SQL (`POST /queries`) and returns stored DB credentials
      (`GET /databases`). Any web page the user visits can `fetch` connection
      passwords or run `DROP TABLE` against their databases. Restrict CORS to
      the app origin, add an `Origin`/`Host` allow-list (DNS-rebinding defense),
      bind explicitly to `127.0.0.1`, and require a per-session token handed to
      the renderer via `preload.ts`.
- [x] **Stop storing database passwords in plaintext.**
      `src/main/databases/database-service.ts:22,102` writes the full
      `connectionInfo` (including `password`) as plaintext JSON into
      `~/.../squeal.sqlite3`. Encrypt secrets with Electron `safeStorage`
      (OS-keychain backed) before persisting, and never return the password to
      the renderer in `GET /databases`.
- [x] **Build the Postgres connection with discrete fields, not string
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

- [x] **Don't materialize whole result sets before truncating.** All three
      adapters (`postgres-adapter.ts:117-124`, `mysql-adapter.ts:51-63`,
      `sqlite-adapter.ts:78-84`) buffer _every_ row, then slice to
      `maxRows = 10000`. `SELECT * FROM huge_table` OOMs the main process. Push
      the limit into the driver (`LIMIT 10001` to detect truncation) or use a
      streaming cursor.
- [ ] **Use a discriminated union for connection info.** The contract now lives
      in Effect Schema, and the hole moved with it: `src/glue/api/schemas.ts:86`
      is `Schema.Union(ServerConnectionInfo, SqliteConnectionInfo)`, validated
      independently of `type`, and `src/databases/create-adapter.ts:19-23` casts
      to whichever shape the `type` implies. So `type: 'sqlite'` with
      server-shaped info still decodes, then reaches `sqlite-adapter.ts:81` with
      `path` undefined. Key the union on `type` (`Schema.Union` of two structs
      each carrying its own `type` literal, or a `Schema.TaggedStruct`) so the
      cast disappears. `src/databases/schemas.ts` is renderer-form zod only and
      should follow whatever the contract does.
- [ ] **Protect connection cleanup.** Narrower than first written:
      `acquireConnection` and `cancel` already try/catch their teardown
      (`postgres-adapter.ts:50-54,85-89,205-213`). Still unguarded — an
      `await client.end()` alone in a `finally`, which can reject and mask the
      original error or leak the socket — at `postgres-adapter.ts:101,128,177`
      and `mysql-adapter.ts:44`.
- [ ] **Trim the polling payload.** `QueryRunner.list()`
      (`src/server/services/query-runner.ts:294-303`) JSON-parses the stored
      `result` of all 250 rows it returns, and `get()` re-parses the row payload
      on every 250 ms poll (`src/app/hooks/queries.ts:11`,
      `query-runner.ts:273-291`). This matters more than it did: the Messages
      tab now reads the whole list through `useQueriesList`. Return metadata +
      `truncated` from the list endpoint and add a status-only poll that omits
      the rows until they are needed.
- [x] **Add a statement timeout to query execution.** Timeouts are set only in
      `testConnection`, not `runQuery` (`postgres-adapter.ts:65-105`,
      `mysql-adapter.ts:39-68`). A runaway query holds a connection open
      forever. Set a configurable `statement_timeout` / `maxExecutionTime`.
      Dropped: user queries are now deliberately untimed — see `CLAUDE.md`,
      "there is deliberately no timeout on user queries" — because cancel goes
      through `pg_cancel_backend` instead. The unbounded-hold risk the item
      describes is covered where it is not the user's choice: introspection uses
      `statement_timeout: 30_000` (`postgres-adapter.ts:96`) and the version
      probe `5000` (`:112`), and `mysql-adapter.ts:63-80` destroys the socket on
      a stalled probe.
- [x] **Guard update methods against missing/deleted rows.** `updateDatabase`
      (`database-service.ts:99-110`) and `updateWorksheet`
      (`worksheet-service.ts:34-41`) don't filter `isNull(deletedAt)` and don't
      check a row came back — a bad `id` throws a 500 instead of a 404, unlike
      `getDatabase`. Fixed: both services filter `isNull(deletedAt)` and raise
      `DatabaseNotFoundError` / `WorksheetNotFoundError`
      (`src/server/services/database-service.ts:327-336`,
      `worksheet-service.ts:120-155`).
- [x] **Stop swallowing all migration errors.** `src/database/index.ts:68-87`
      runs hand-rolled `ALTER TABLE … .catch(() => {})`, hiding genuine
      failures. Use `drizzle-kit` migrations (already a dependency) or catch
      only the specific "duplicate column" error. Fixed:
      `src/database/add-column-if-missing.ts` rethrows anything that is not a
      duplicate-column error, walking the cause chain to find the driver
      message.
- [x] **Handle SSL-cert read failures.** `fs.readFileSync(sslRootCert)`
      (`postgres-adapter.ts:184`, `mysql-adapter.ts:110`) throws a raw `ENOENT`
      to the user when the cert is missing. Wrap with a clear message. Fixed:
      `src/databases/ssl-options.ts` `readRootCertificate` stats the path first
      and reports missing / not-a-file / larger-than-1 MB distinctly.

## 🟡 Frontend code quality

- [x] **Delete dead code (~750 lines).** `ui/sidebar.tsx` (731 lines) is unused
      — the real sidebar is the hand-written `AppSidebar.tsx`;
      `hooks/use-mobile.ts` is only consumed by that dead file. Remove both.
      Also remove the unused `ThemeContext` / `useThemeContext` in
      `ThemeProvider.tsx:6-29` (zero consumers). Fixed: all three are gone;
      `ThemeProvider.tsx` is now just the hotkey host.
- [x] **Fix the `useTheme` stale-closure bug.** `hooks/useTheme.ts:54-74` — the
      OS-theme listener closes over mount-time `initial` and never
      re-subscribes, so picking `dark` while in `system` gets overridden on the
      next OS switch, and switching to `system` ignores OS changes. Depend on
      current `theme.mode` and re-resolve inside `handleChange`. Fixed:
      `hooks/useTheme.ts` was rebuilt on `useSyncExternalStore` over a
      module-level store, and `handleChange` reads live state rather than a
      captured value.
- [x] **Move side effects out of the `setState` updater.**
      `hooks/useTheme.ts:41-52` calls `localStorage.setItem` and `applyTheme`
      inside `setThemeState((previous) => …)`; StrictMode double-invokes it.
      Compute `next` purely in the updater and run side effects in a `useEffect`
      keyed on `theme`. Fixed: there is no `setState` updater left — writes go
      through `updateTheme` → `writeStoredTheme` + `publishTheme`.
- [x] **Remove `any` from `QueryResultTable`.**
      `QueryResultTable.tsx:30-45,59,70,75` uses `result: any` throughout,
      violating `CODE_STYLE.md` and hiding shape bugs (see the 0-row footer
      below). Import the real `QueryResult` type off `QueryDto`. (Same `any`
      issue in the backend `QueryDto` — `src/main/queries/index.ts:19,100`.)
      Fixed: zero `any` in non-test `src/`. The table takes `QueryResultDto` and
      the backend shape is Effect Schema (`src/glue/api/schemas.ts:207-237`).
- [ ] **Don't wrap every result cell in its own `<ContextMenu>`.** Still
      per-cell at `QueryResultTable.tsx:131`, but much smaller than first
      written: the table virtualizes, so the cost is the visible window (~20
      rows) rather than ~2,000 Radix subtrees for a 100×20 result. Now a polish
      item — render one shared menu and set the target cell/row in state
      `onContextMenu`.
- [ ] **Narrow worksheet subscriptions.** Five components subscribe to the whole
      worksheets collection via `useWorksheets()` (`App`, `AppShell`,
      `WorksheetTabs`, `WorksheetExplorer`, `ConnectionPicker`), so every
      debounced content save (`hooks/useWorksheetAutosave.ts`) re-renders the
      sidebar and the tab bar. Add a `useCurrentWorksheet(id)` hook that filters
      in the live query, and a `useDatabase(id)` hook — both belong next to the
      existing hooks in `src/app/hooks/queries.ts`.
- [ ] **Fix floating promises.** One left: `hooks/mutations.ts:207`
      `queryClient.invalidateQueries` is neither awaited nor voided, while every
      other call site in the file is (`:131,158,185`). Violates "No Floating
      Promises". (The `DatabaseForm` promise chain is gone.)
- [ ] **Factor out the collection boilerplate.** The
      `if (collection.status === 'ready') { collection.utils.write…() }` guard
      and `void transaction.isPersisted.promise.catch(…)` are still copied by
      hand — seven of the latter, across `App.tsx:149`,
      `DatabaseExplorer.tsx:158`, `WorksheetExplorer.tsx:85,175`,
      `ConnectionPicker.tsx:181`, `useWorksheetAutosave.ts:38` and
      `mutations.ts:70`. Make them small helpers, or prefer collection-native
      `onInsert`/`onUpdate` so components stop poking `collection.utils`
      directly.
- [ ] **Unify Redux slice conventions.** Four slices, three export styles:
      `database-explorer-slice` exports named actions, `tabs-slice`/`ui-slice`
      export a bundled `tabsActions`/`uiActions`, and `editor-slice` exports
      named actions with past-tense names (`databaseSearchQueryUpdated`).
      `expandDatabase`/`expandTable` (`database-explorer-slice.ts:17,22`) still
      toggle rather than expand — rename to match. Pick one style.
- [x] **Keymap `run` returns `undefined` in the else path.**
      `WorksheetEditor.tsx:68-75` should `return false`. Fixed:
      `WorksheetEditor.tsx:130-138` returns `false` when there is no run
      handler, so CodeMirror falls through to the next binding.
- [ ] **Untitled-numbering can collide.** `worksheet-naming.ts:9-14` counts the
      worksheets already named `Untitled`/`Untitled N`, so renaming `Untitled`
      to something else makes the next new worksheet `Untitled 2` when that name
      is already taken. Use max existing suffix + 1, not count + 1. (Deleting a
      worksheet triggers the same collision — see the delete item below.)
- [x] **`ResultSheet.tsx:36-53` drag listeners leak if unmounted mid-drag.**
      Fixed: the sheet was replaced by `ResizeHandle.tsx`, which keeps its
      teardown in `detachRef` and runs it on unmount as well as on `mouseup`.
- [ ] **Order imports consistently in `hooks/queries.ts` and
      `hooks/mutations.ts`.** Both trail their `@/glue/…` imports after the
      relative ones, and `mutations.ts:7` puts `./queries` between two `../`
      imports. Alphabetize within groups, per the Code Style section of
      `CLAUDE.md`.

## 🔵 UX — missing SQL-client affordances

> `redesign-tasks.md` is the active work list for this surface and owns the
> shell, tabs, toolbar, results pane and status bar. Check it before starting
> anything here.

- [ ] **Add worksheet delete and duplicate.** `WorksheetExplorer.tsx` has
      create + rename but no delete, and there is no route to call: the contract
      (`src/glue/api/groups/worksheets.ts`) exposes only list / create / reorder
      / update. Needs a `DELETE /worksheets/:id` endpoint, a soft delete in
      `WorksheetService` mirroring `deleteDatabase`
      (`database-service.ts:218-245`), tab eviction in `tabs-slice`, and a
      right-click menu (Rename / Duplicate / Delete) with confirmation.
- [x] **Add a "Remove database" action.** `DatabaseExplorer.tsx:195-203` offers
      only "Edit". Fixed: the row context menu has Delete
      (`DatabaseExplorer.tsx:442-445`) behind a confirmation that spells out the
      stored password is removed and worksheets are kept (`:102-125`), and the
      service purges the secret.
- [ ] **Add query history.** The Messages tab logs each past run as a line of
      text (`hooks/use-worksheet-messages.ts`), but the results pane only ever
      shows the latest run — no earlier result can be reopened. Add a history
      dropdown in the results header that loads a prior query's rows.
- [ ] **Add schema-aware, dialect-correct autocomplete.**
      `WorksheetEditor.tsx:123-125` still calls `sql()` and `autocompletion()`
      with no schema and no dialect. The schema is already fetched
      (`useDatabaseSchema`) and the type is already threaded through the editor
      for formatting (`databaseTypeRef`) — feed both into
      `sql({ schema, dialect })` for table/column completion. Biggest editor
      ergonomics win left.
- [ ] **Add "Run all", a command palette, and a shortcuts surface.** Cmd+Enter
      runs only the statement under the cursor. Add run-all, a Cmd+K palette,
      and a discoverable keyboard-shortcuts help sheet. (SQL formatting landed:
      `components/sql-format.ts`, `Mod-Shift-f`, and the floating Format
      button.)
- [x] **Let the result panel collapse/close.** `App.tsx:312` /
      `ResultSheet.tsx:81` keeps the sheet open whenever a query exists and only
      allows resize. Add a collapse/close control and an Escape handler.
      Dropped: the redesign replaced the overlay sheet with a docked pane
      (`ResultsPane.tsx`) that is always visible, shows an idle empty state, and
      resizes 120–620px. There is nothing left to close. A collapse toggle would
      be a new feature, not a fix.
- [ ] **Let the sidebar collapse** to reclaim editor width. It resizes 200–380px
      (`AppShell.tsx`, `hooks/use-persisted-size.ts`) but cannot be hidden.

## 🟣 UX — states, guards & feedback

> Also covered in part by `redesign-tasks.md` — check there first.

- [ ] **Add a "No rows returned" state.** Idle is handled
      (`QueryResultEmpty.tsx`) and DML feedback lands in the Messages tab, but a
      `SELECT` that returns zero rows still renders column headers over an empty
      `<tbody>` (`QueryResultContent.tsx:41-43` → `QueryResultTable`). Show an
      explicit empty state instead.
- [ ] **Add schema loading/error states in the explorer.**
      `DatabaseExplorer.tsx:201-202` tracks `isLoadingSchemas` only while
      searching. Expanding a database shows nothing while its schema loads and
      fails silently if the connection is down. Add a loading skeleton on the
      expand path and an inline error + retry.
- [x] **Disable Run when the worksheet has no database.** `App.tsx:204-216`
      defaults `databaseId` to `''` and lets Run fire, failing only via a toast.
      Disable the button with a tooltip ("Select a database first"), mirroring
      the `!activeStatement` handling. Fixed: `WorksheetToolbar.tsx:34-59` wraps
      the Run button in a `Tooltip` and drives `disabled={isRunDisabled}`.
- [x] **Reconcile row-count sources.** `ResultSheet.tsx:99` shows
      `result.rowCount` while `QueryResultTable.tsx:43,157` uses
      `result.rows.length` and a hardcoded "Showing first 10,000 rows" — they
      disagree on truncation. Derive both from one source tied to the real
      limit. Fixed: the adapters report a single `truncated` flag on
      `QueryResultDto`, and `ResultsPane.tsx:28-37`, `StatusBar.tsx:60` and the
      Messages log all format from `rowCount` + `truncated`.
- [ ] **Show the connection-test failure reason inline.** A persistent
      success/failure icon exists (`DatabaseForm.tsx:399-423`), but the reason
      still only appears in a disappearing toast (`:381`). Render
      `connectTestResult.message` in the form as a success/error banner.
- [ ] **Add a password reveal toggle** to the connection form
      (`DatabaseForm.tsx:758`, a bare `type="password"`).

## ⚪ Accessibility

- [x] **Add `aria-label`s to icon-only buttons.** Run (`App.tsx:265`),
      add-worksheet `+` (`WorksheetExplorer.tsx:159`), add-database `+`
      (`DatabaseExplorer.tsx:66`), EditorScreen close (`EditorScreen.tsx:59`),
      and the TitleBar window controls (`TitleBar.tsx:33-45`) have no accessible
      name. Copy the correct pattern from `WorksheetEditor.tsx:159`
      (`aria-label="Focus editor"`). Fixed: every icon-only control now has one
      — `DatabaseExplorer.tsx:244`, `WorksheetExplorer.tsx:223`,
      `WorksheetTabs.tsx:144,161`, `TitleBar.tsx:75,105`, `StatusBar.tsx:114`,
      `ConnectionPicker.tsx:437,449` — and Run carries a visible text label.
- [ ] **Give custom modals dialog semantics.** `EditorScreen.tsx` and
      `GettingStartedScreen.tsx` are still plain `fixed inset-0` divs — no
      `role="dialog"`/`aria-modal`, no focus trap/return, no Escape, no
      backdrop-close. Rebuild on Radix Dialog.
- [ ] **Finish the resize separator.** `ResizeHandle.tsx:110-125` now has
      `role="separator"`, `aria-label`, `aria-orientation`, `tabIndex` and arrow
      keys, but still no `aria-valuenow`/`valuemin`/`valuemax` (so the current
      size is unannounced) and no `focus-visible` style.
- [ ] **Add a focus-visible ring** to the focus-editor overlay button
      (`WorksheetEditor.tsx:205-210`) — or, better, take it out of the tab order
      entirely, since it exists only to catch clicks below the editor. (The
      pagination controls this item also named are gone with virtualization.)
- [ ] **Expose the active worksheet** with `aria-current`. There is no
      `aria-current` anywhere in the app; it is now needed in two places — the
      explorer row (`WorksheetExplorer.tsx:378`) and the tab bar
      (`WorksheetTabs.tsx:125`), both of which signal the active worksheet
      visually only.

## 🎨 Design & visual polish

> Mostly delivered by the redesign — see `redesign-tasks.md` for what remains of
> it.

- [x] **Theme the toasts.** `renderer.tsx:35` renders `<Toaster />` with no
      props, so Sonner shows light-themed toasts in dark mode — and toasts are
      the primary error surface. Pass `theme={resolvedMode}`, `richColors`, and
      a chosen position. Fixed: `renderer.tsx:44-51` styles the toaster from the
      `--panel`/`--border` tokens, so it follows the theme in both modes without
      a mode prop.
- [x] **Add a visible theme toggle.** The only switch is the `mod+shift+l`
      hotkey (`ThemeProvider.tsx:13`); `useTheme` even exposes `system` mode
      with no UI to pick it. Add a control in the TitleBar or a settings menu.
      Fixed: `TitleBar.tsx:68-77` calls the same `toggleMode` as the hotkey.
      (Picking `system` explicitly is still hotkey-and-storage only, by design —
      the toggle lands on `light`/`dark`.)
- [x] **Truncate overflowing text.** Long names blow out the fixed `w-80`
      sidebar (`AppSidebar.tsx:9`; rows at `WorksheetExplorer.tsx:210`,
      `DatabaseExplorer.tsx:178,219`) and the `w-fit` DB selector trigger
      (`DatabaseSelector.tsx:61`). Add `truncate min-w-0` + `title`, and a
      `max-w` on the selector. Cap wide result cells (`ui/table.tsx:79` is
      `whitespace-nowrap`) with `max-w-* truncate` + reveal-on-hover. Fixed:
      `truncate min-w-0` throughout the explorers, tabs and picker
      (`DatabaseExplorer.tsx:425,533,563`, `WorksheetExplorer.tsx:378,383`,
      `WorksheetTabs.tsx:125`), with `max-w` caps on the connection trigger
      (`ConnectionPicker.tsx:359,475`). Result cells are width-budgeted by
      `query-result-columns.ts` instead.
- [x] **Align numeric columns.** `QueryResultTable.tsx:77,85` right-aligns
      numbers in a proportional font — apply `font-mono tabular-nums` (as
      `App.tsx:329` already does for elapsed time). Fixed:
      `QueryResultTable.tsx:135-137` renders every cell `font-mono` and adds
      `text-right` for numeric columns.
- [x] **Unify the accent, and standardize the ellipsis and search icon.**
      Selection was `bg-blue` in `ui/input.tsx:11` but mauve in
      `codemirror-theme.ts:18`; `DatabaseForm.tsx:755` and the search
      placeholders used `"..."`; `SearchInput.tsx:27` had no color on the icon.
      Fixed by the redesign: one `--accent` and a shared `--sel` token
      (`ui/input.tsx:11`, `codemirror-theme.ts:22`), no `"..."` left, and the
      search icon is `text-text3` (`SearchInput.tsx:37`).
- [ ] **Italicize actual `NULL` cells** so they don't look like the string
      "null". `query-result-format.ts:2-3` returns the bare string `'null'` with
      no styling hook — return a marker (or render the null case in
      `QueryResultTable`) so it can be styled.
- [ ] **Add a clear button to `SearchInput`** (`SearchInput.tsx`).
- [ ] **Use `cursor-pointer`** on interactive tree rows —
      `DatabaseExplorer.tsx:412,520` are still `cursor-default` — and add
      tooltips to the `+` add buttons.

## 🧪 Testing, tooling & hygiene

- [x] **Resolve the dead AI-chat feature.** `src/main/chat/routes.ts` registers
      zero routes (only an `eslint-disable`d unused schema), `saveChat`
      (`persistence.ts`) is never called, and no `@ai-sdk/*` / `ai` import
      exists in `src` — yet 5 heavy AI dependencies ship in `package.json`.
      Either wire chat up or delete `src/main/chat`, drop the AI deps, and the
      mount at `api.ts:40`. Also update stale `CONTRIBUTING.md` references to a
      nonexistent `src/main/auth/`. Fixed: `src/main/chat` is gone, no AI
      dependency remains in `package.json`, and `CONTRIBUTING.md` no longer
      names any dead path.
- [x] **Test the core query path.** `src/main/queries/query-runner.ts` (174
      lines) has no test — export and unit-test `createAdapter`,
      `isCancellationError` (fragile string match), and `extractErrorMessage`.
      Add tests for `middleware/error-handler.ts` and `errors.ts`
      (`ValidationError`) — both are pure and trivial. `saveChat` is also
      untested (if kept). Fixed: the runner is
      `src/server/services/query-runner.ts` with `query-runner.test.ts` beside
      it, adapter construction is its own module
      (`src/server/services/adapter-factory.ts`), and error mapping is covered
      by the HTTP tests in `src/server/http/*.test.ts`.
- [ ] **Enable TypeScript `strict` for the renderer.** Half done:
      `tsconfig.backend.json` sets `strict: true` for `src/server` and
      `src/glue`, but `tsconfig.renderer.json` inherits only `noImplicitAny`
      from `tsconfig.base.json` — so across `src/app` the "no non-null
      assertion" and "prefer nullish coalescing" rules still can't be enforced.
- [ ] **Re-enable `@typescript-eslint/no-explicit-any`.** `.eslintrc.json:17`
      still turns it off, contradicting `CLAUDE.md`'s "No any" rule. Now free:
      there is no `any` left in non-test `src/`, so flipping the rule to `error`
      should pass as-is.
- [ ] **Upgrade the lint stack.** `@typescript-eslint` `^5.62` doesn't support
      TypeScript 5.7, and ESLint 8 is EOL. Move to `@typescript-eslint` v8 +
      ESLint 9 flat config — this unlocks the type-aware `no-floating-promises`
      rule.
- [ ] **Fix the test scripts and add coverage.** `"test": "vitest"` still runs
      watch mode (hangs contributors; CI gets away with it only because vitest
      detects `CI`). Add `"test": "vitest run"` + `"test:watch"`, install
      `@vitest/coverage-v8`, and surface coverage in CI.
- [ ] **Harden CI.** `.github/workflows/ci.yml` uses mutable `yarn install` in
      all five jobs (use `--frozen-lockfile`), builds only on ubuntu — add a
      `[ubuntu, macos, windows]` matrix to the `build` job so native
      `pg`/`@libsql` packaging regressions are caught on PR rather than at
      release, where `release.yml` already runs all three — and has no
      `prettier --check` step. Consider `husky` + `lint-staged`.
- [ ] **Add macOS signing/notarization** to `forge.config.ts` (gated on secrets)
      — released builds are unsigned and Gatekeeper-blocked. (The version-scheme
      half of this item is obsolete: release-please owns versions now, so the
      `npm pkg set version=${GITHUB_REF_NAME#v}.0` line is gone.)
- [ ] **Add a committed `.env.example`** documenting `POSTGRES_URL` /
      `SQLITE_PATH` (used by `src/database/index.ts` and `scripts/seed.ts`) and
      reference it in `CONTRIBUTING.md`. (The orphaned `vite.renderer.config.ts`
      this item also named has been deleted.)
- [ ] **Fix the dangling `CODE_STYLE.md` reference.** `CLAUDE.md:152` still says
      "Refer to @CODE_STYLE.md", but that file was deleted in `42ba6f0` when its
      content was folded into `CLAUDE.md`'s own "Code Style" section — so the
      pointer resolves to nothing for every agent that reads it. Drop the line.

## ✅ Already solid (leave alone)

- Async query design: POST creates a row, a background fiber in a runtime-scoped
  `FiberMap` writes `result`/`error`, client polls; adapters cleaned in
  `finally`.
- Postgres cancellation via a separate `pg_cancel_backend` connection, with an
  in-flight connect abortable through `connectingClient`.
- `postgres-identifier-fixer` uses a real tokenizer with positional replacement.
- The renderer API client derived from the shared contract
  (`src/app/api-client.ts`), `AppShell.tsx` error boundary resets, the
  debounced-save flush-on-switch (`hooks/useWorksheetAutosave.ts`), and the
  `sql-parser/`.
- DB-layer test coverage (all adapters, identifier-fixer, schema-provider,
  ssl-options, services) and consistent `toEqual` / whole-object assertions.
- Electron fuses in `forge.config.ts` (RunAsNode off, ASAR integrity, cookie
  encryption).
- Tracing: the custom Effect `Tracer` writing straight into the `spans` table,
  W3C `traceparent` propagation, and retention swept by scoped fibers.
