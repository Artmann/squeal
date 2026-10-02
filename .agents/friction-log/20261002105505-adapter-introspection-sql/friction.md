---
title: 'Adapter introspection SQL is never run against a real database, and src/databases tests run under jsdom'
severity: 'major'
---

### Expected Behavior

The introspection SQL in `src/databases/schema-provider.ts` can be tested
against a real server, the same way the rest of the backend is tested against a
real (in-memory) SQLite database.

### Current Behavior

Every Postgres and MySQL adapter test mocks the driver (`vi.mock('pg')`), so no
test ever executes the introspection queries. A mocked driver returns whatever
rows the fixture says, so a query that cross-joins (as
`postgresForeignKeysQuery` did for composite foreign keys, issue #78) passes
every test while returning wrong rows to real users. There is no Postgres
service in CI and no helper for starting one.

On top of that, `src/databases/**` is not in `backendTestPatterns`, so these
adapter tests run in the `renderer` project under jsdom, even though the
adapters are main-process code. A test that opens a real `pg` connection needs a
`// @vitest-environment node` docblock to be safe.

### Possible Solution

Add `src/databases/**/*.test.ts` to `backendTestPatterns`. Add a Postgres
service to the CI test job, and turn the opt-in
`src/databases/schema-provider.postgres.test.ts` (skipped unless
`SQUEAL_TEST_POSTGRES_URL` is set) into one that always runs there.

### Minimal Reproducible Example

`yarn test schema-provider.postgres` reports the test as skipped. It only runs
with a throwaway container and the URL set:

```bash
docker run -d --rm -e POSTGRES_PASSWORD=postgres -p 5499:5432 postgres:16
SQUEAL_TEST_POSTGRES_URL=postgres://postgres:postgres@localhost:5499/postgres \
  yarn test schema-provider.postgres
```

### Context

Hit while fixing the composite foreign key bug from issue #78. The fix was
verified only because a throwaway container was started by hand.

A smaller papercut on the way: `frog log --body` rejects a body whose headings
are `##`, because the form scaffolds `###`. The error ("Missing or out-of-order
headings: `Expected Behavior`") does not say the heading level is the problem.
