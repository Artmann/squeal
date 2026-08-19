# Contributing

## Tech Stack

- **Electron** - Desktop application framework
- **React** - UI framework
- **Vite** - Build tool
- **Effect-TS** - The backend: services, layers, and the HTTP API
- **Drizzle ORM** - Database ORM for app state (SQLite)
- **PostgreSQL / MySQL / SQLite** - Target databases for user queries
- **CodeMirror** - SQL editor
- **Tailwind CSS** - Styling

## Project Structure

```
src/
├── app/           # React frontend (renderer process)
├── glue/          # Shared contract: HttpApi definition, schemas, errors
├── server/        # Effect backend: HTTP layer, services, tracing, retention
├── main/          # Main-process helpers (secret storage, retention sweeps)
├── database/      # Drizzle schema and connection for app state
├── databases/     # Adapters for the databases the user queries
└── main.ts        # Electron entry point
```

The contract in `src/glue/api/` is imported by both processes, so it must stay
free of main-process imports. See `CLAUDE.md` for the architecture in detail.

## Scripts

- `yarn start` - Run in development mode
- `yarn typecheck` - Type-check both projects (backend and renderer)
- `yarn test` - Run the test suite once
- `yarn test:watch` - Run the test suite in watch mode
- `yarn lint` - Run ESLint
- `yarn format` - Format code with Prettier
- `yarn format:check` - Check formatting without writing (what CI runs)
- `yarn seed` - Seed the sample databases
- `yarn package` - Package the app
- `yarn make` - Build distributable

## Environment

Nothing is required to run the app. `yarn seed` reads two optional variables —
copy `.env.example` to `.env` to override the defaults, which match the services
in `docker-compose.yml`:

```bash
cp .env.example .env
docker compose up -d
yarn seed
```

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
and CI builds and uploads installers for Windows, macOS, and Linux. macOS ships
two DMGs — one for Apple silicon, one for Intel.

### macOS signing

macOS refuses to launch an app that isn't signed and notarized, reporting it as
_damaged_. The release workflow therefore needs five repository secrets under
**Settings → Secrets and variables → Actions**:

| Secret                        | What it is                                    |
| ----------------------------- | --------------------------------------------- |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com  |
| `APPLE_CERTIFICATE`           | Base64 of the Developer ID Application `.p12` |
| `APPLE_CERTIFICATE_PASSWORD`  | The `.p12` export password                    |
| `APPLE_ID`                    | Apple Developer account email                 |
| `APPLE_TEAM_ID`               | Apple Developer team ID                       |

Export the certificate with Keychain Access, then `base64 -i cert.p12 | pbcopy`.
The macOS jobs fail with a message naming the missing secrets if any are absent,
rather than publishing an app that can't be opened.

Local `yarn make` skips signing when `APPLE_TEAM_ID` is unset. Those builds run
fine from `out/` because nothing quarantines them, but they are not
distributable — their signature doesn't verify, and macOS calls a quarantined
app with a bad signature _damaged_. To produce a real signed build locally, set
`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`; notarization
adds a few minutes to the build.

## Database Migrations

Generate migrations after schema changes:

```bash
npx drizzle-kit generate
```
