# Squeal

Ergonomic SQL Client for Humans. Electron desktop app with React frontend.

- Design for mobile first. Then use Tailwind modifiers to expand the design for
  larger devices and desktop.
- Use assertions like tiny-invariant to throw on invalid states.
- Use Conventional Commits.

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
- Tailwind CSS
- shadcn/ui
- Lucide icons
- React hook form
- tiny-invariant
- tiny-typescript-logger
- Zod

## Architecture

- **Main process** (`src/main.ts`): Electron app + Hono API server on port 7847
- **Renderer process** (`src/app/`): React frontend
- **API routes**: `src/databases/`, `src/main/chat/`, `src/main/queries/`,
  `src/main/worksheets/`
- **Database**: SQLite via Drizzle for app state, PostgreSQL for user queries

## Key Files

- `src/api.ts` - Hono server setup, mounts all routers
- `src/database/schema.ts` - Drizzle schema definitions
- `src/main/queries/query-runner.ts` - Executes queries against PostgreSQL
- `src/databases/postgres-adapter.ts` - PostgreSQL connection handling
- `src/app/App.tsx` - Main React component

## Commands

- `yarn start` - Development mode
- `yarn seed` - Seed PostgreSQL with Pagila sample data
- `yarn lint` / `yarn format` - Code quality
- `npx drizzle-kit generate` - Generate migrations after schema changes

## Notes

- Native packages (`pg`, `@libsql`) are externalized in `vite.main.config.ts`
- API base URL in frontend: `http://127.0.0.1:7847` (the server binds loopback
  only)
- The API requires a per-session bearer token on every route except `/health`
  (and, in dev, GET `/traces*`). The renderer gets it via
  `window.electron.getApiToken()`; the token is not printed at startup.
- Query execution is async: POST creates query, poll GET `/queries/:id` for
  results
- Database `connectionInfo` is encrypted at rest with Electron `safeStorage`
  (`enc:v1:` prefix in the `databases` table; see
  `src/main/databases/secret-storage.ts`). API responses never include passwords
  — internal callers use `getDatabaseWithSecrets()`, updates with a blank
  password keep the stored one, and connection tests can pass a `databaseId` to
  borrow it.
- Refer to @CODE_STYLE.md
- Don't include the Claude footer in commits

## Tracing

OTEL-style tracing is built in: the renderer and main process emit spans (W3C
`traceparent` propagation) into the `spans` table of the app SQLite database.
Retention: 7 days / 50,000 spans (`src/main/tracing/`).

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
  `HTTP POST /queries` → `POST /queries` (server) → `query.execute` →
  `query.loadConnection` / `db.query` / `query.saveResult`.
- Deliberately untraced: `/health`, `/traces*`, and the 250ms result poller
  (`GET /queries/:id`). Uncaught renderer errors and unhandled rejections appear
  as `renderer.error` traces.

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
