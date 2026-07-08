# Squeal

Ergonomic SQL Client for Humans. Electron desktop app with React frontend.

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
- The API requires a per-session bearer token on every route except `/health`.
  The renderer gets it via `window.electron.getApiToken()`; in development the
  token is printed at startup, so test with
  `curl -H "Authorization: Bearer <token>" http://127.0.0.1:7847/databases`
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
