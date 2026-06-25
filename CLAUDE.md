# Squeal

Ergonomic SQL Client for Humans. Electron desktop app with React frontend.

## Architecture

- **Main process** (`src/main.ts`): Electron app + Hono API server on port 7847
- **Renderer process** (`src/app/`): React frontend
- **API routes**: `src/main/queries/`, `src/main/auth/`, `src/main/chat/`
- **Database**: SQLite via Drizzle for app state, PostgreSQL for user queries

## Key Files

- `src/api.ts` - Hono server setup, mounts all routers
- `src/database/schema.ts` - Drizzle schema definitions
- `src/main/queries/query-runner.ts` - Executes queries against PostgreSQL
- `src/main/queries/postgres-adapter.ts` - PostgreSQL connection handling
- `src/app/App.tsx` - Main React component

## Commands

- `yarn start` - Development mode
- `yarn seed` - Seed PostgreSQL with Pagila sample data
- `yarn lint` / `yarn format` - Code quality
- `npx drizzle-kit generate` - Generate migrations after schema changes

## Notes

- Native packages (`pg`, `@libsql`) are externalized in `vite.main.config.ts`
- API base URL in frontend: `http://localhost:7847`
- Query execution is async: POST creates query, poll GET `/queries/:id` for
  results
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
