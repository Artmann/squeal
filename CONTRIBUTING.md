# Contributing

## Tech Stack

- **Electron** - Desktop application framework
- **React** - UI framework
- **Vite** - Build tool
- **Hono** - API server (runs in main process)
- **Drizzle ORM** - Database ORM for app state (SQLite)
- **PostgreSQL** - Target database for user queries
- **CodeMirror** - SQL editor
- **Tailwind CSS** - Styling

## Project Structure

```
src/
├── app/           # React frontend (renderer process)
├── main/          # Electron main process
│   ├── auth/      # Authentication routes
│   ├── chat/      # AI chat routes
│   └── queries/   # Query execution
├── database/      # Drizzle schema and connection
├── api.ts         # Hono API server setup
└── main.ts        # Electron entry point
```

## Scripts

- `yarn start` - Run in development mode
- `yarn lint` - Run ESLint
- `yarn format` - Format code with Prettier
- `yarn seed` - Seed PostgreSQL with sample data
- `yarn package` - Package the app
- `yarn make` - Build distributable

## Releases

Releases are automated with
[release-please](https://github.com/googleapis/release-please). PR titles must
follow [Conventional Commits](https://www.conventionalcommits.org/) (enforced by
the PR Title check) because squash-merged titles drive versioning:

- `feat:` bumps the minor version
- `fix:` bumps the patch version
- Other types (`chore:`, `docs:`, `refactor:`, ...) don't trigger a release
- `feat!:` or a `BREAKING CHANGE:` footer bumps the major version — use with
  care

release-please maintains a release PR on `main` that accumulates changes.
Merging it tags `vX.Y.Z`, creates the GitHub Release, updates `CHANGELOG.md`,
and CI builds and uploads installers for Windows, macOS, and Linux.

## Database Migrations

Generate migrations after schema changes:

```bash
npx drizzle-kit generate
```
