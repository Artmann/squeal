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
- Query execution is async: POST creates query, poll GET `/queries/:id` for results
