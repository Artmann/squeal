# SQL IntelliSense

A plan for turning the worksheet editor's keyword-only autocomplete into
schema-aware completion: tables, columns, aliases, and joins drawn from the
schema Squeal has already introspected.

## Where we are today

`src/app/components/use-worksheet-editor.ts` registers two extensions and hands
them nothing:

```ts
sql(),
autocompletion(),
```

`sql()` with no argument builds `StandardSQL`, so:

- **No schema.** Nothing suggests a table or a column. The one thing the app
  knows that a text editor does not is the one thing the editor does not use.
- **No dialect.** `ILIKE`, `RETURNING`, `AUTO_INCREMENT`, `PRAGMA`, `$1`
  placeholders, backtick quoting — none of it is known to the parser, so it is
  both mis-highlighted and missing from completion. The dialect is already
  threaded into this hook for the formatter (`toSqlDialect` in `sql-format.ts`);
  the language never sees it.
- **No alias resolution**, because alias resolution in `@codemirror/lang-sql` is
  a function of the schema it was given.

Meanwhile the schema is already fetched, cached, and warm. `useDatabaseSchemas`
(`src/app/hooks/queries.ts`) prefetches every connection's `SchemaInfoDto` with
`staleTime: Infinity` so the explorer tree is instant. Each `TableInfo` carries
`columns` (name, data type, nullability, primary key, ordinal position) and
`foreignKeys` (local column, referenced table and column). Completion needs a
read of that cache and a transform — no new endpoint, no new request.

## What good looks like

In rough order of how often it would earn its keep:

1. `SELECT ` + `Ctrl-Space` after a `FROM` offers that table's columns, typed
   and ordered as the table defines them.
2. `FROM ` offers tables, with the schema name as detail when the database spans
   more than one schema.
3. `FROM users u` then `u.` offers `users`' columns. Same for `JOIN orders AS o`
   and for the unaliased `users.`.
4. Quoting is handled: a column called `Created At` or `order` inserts as
   `"Created At"` on Postgres/SQLite and `` `Created At` `` on MySQL, and a
   plain `created_at` inserts bare.
5. Dialect keywords and functions are right for the connection the worksheet is
   attached to.
6. `JOIN orders ` offers `ON orders.user_id = users.id`, built from the foreign
   key. This is the one that feels like magic and it is nearly free — the
   `foreignKeys` array is already in the payload and nothing reads it.

Out of scope for this plan, written down so they are decisions rather than
oversights: `SELECT *` expansion, `search_path` introspection (we assume
`public` on Postgres), completion inside string literals, and any kind of
type-checking or linting.

## The constraint that shapes the design

`use-worksheet-editor.ts` opens with a long comment for a reason: every prop
handed to `<CodeMirror>` must keep its identity for the life of the editor.
`@uiw/react-codemirror` lists `extensions` in the deps of the effect that
dispatches `StateEffect.reconfigure`, and each reconfigure re-runs
`EditorView.theme`, which appends a new StyleModule that is never removed. An
`extensions` array rebuilt when the schema arrives would reintroduce exactly the
leak that comment exists to prevent.

So the schema must not reach the editor by rebuilding `extensions`. It reaches
it the way the active-statement gutter already does: through a `Compartment` the
hook reconfigures on its own, leaving the array — and the theme — untouched.

One compartment, not two. The dialect and the schema both belong to the
language, and both change on the same event (the worksheet's connection changes,
or its schema finishes loading), so they are reconfigured together:

```ts
const languageCompartment = useMemo(() => new Compartment(), [])
```

The reconfigure runs at most three times in an editor's life — mount, schema
arrives, user switches the worksheet's connection — so re-parsing the document
on the swap is not a cost worth designing around.

## Phase 1 — schema-aware completion

### New modules

All next to the editor, following the existing `worksheet-editor-*` / `sql-*`
split: pure, testable modules beside a thin hook.

**`src/app/components/sql-dialect.ts`**

```ts
export function findSqlDialect(
  databaseType: DatabaseType | undefined
): SQLDialect
```

Maps `DatabaseType` to `@codemirror/lang-sql`'s `MySQL`, `PostgreSQL`, or
`SQLite`, defaulting to `PostgreSQL` for a worksheet with no connection — the
same fallback and the same reasoning as `toSqlDialect`. Deliberately a second
function rather than a widening of `toSqlDialect`: that one returns a
`sql-formatter` language string, this one returns a CodeMirror `SQLDialect`
object, and collapsing them would make the return type a union nobody wants.

**`src/app/components/sql-namespace.ts`**

```ts
export function buildSqlNamespace(
  schema: SchemaInfoDto,
  databaseType: DatabaseType | undefined
): SQLNamespace
export function findDefaultSchemaName(
  schema: SchemaInfoDto,
  databaseType: DatabaseType | undefined
): string | undefined
export function quoteIdentifier(
  name: string,
  databaseType: DatabaseType | undefined
): string
```

`buildSqlNamespace` turns the flat `tables: TableInfo[]` into the nested
`SQLNamespace` lang-sql wants:

```ts
{
  public: {
    self: { label: 'public', type: 'namespace' },
    children: {
      users: {
        self: { label: 'users', type: 'type' },
        children: [
          { label: 'id', type: 'property', detail: 'integer · pk', boost: 1 },
          { label: 'email', type: 'property', detail: 'text' }
        ]
      }
    }
  }
}
```

Decisions inside it:

- **Column order is ordinal, not alphabetical.** This is the one place the
  repo's alphabetical default is wrong: a table's column order is information
  the user already has in their head and in the explorer tree, and re-sorting it
  costs them that. Primary keys get `boost: 1` so they surface first on an
  ambiguous prefix. (Schemas and tables _are_ sorted alphabetically.)
- **`detail` carries the data type**, plus `· pk` for a primary key and `· null`
  for a nullable column. Short enough to sit in the completion row without
  wrapping.
- **`apply` carries the quoted form** whenever `quoteIdentifier` changes the
  name, so accepting a completion never produces SQL that fails to parse.
  `quoteIdentifier` quotes when the name is not `/^[a-z_][a-z0-9_]*$/` or is a
  reserved word, using backticks for MySQL and double quotes otherwise.

`findDefaultSchemaName` is what makes `FROM use` complete to `users` instead of
`public.users`. Rule, in order: if every introspected table shares one
`tableSchema`, that one; otherwise `public` for Postgres, `schema.databaseName`
for MySQL, `main` for SQLite. Postgres users with a non-default `search_path`
get prefixed completions, which is correct-but-verbose rather than wrong.

**`src/app/components/sql-language.ts`**

```ts
export function createSqlLanguage(options: SqlLanguageOptions): Extension
```

The single factory the compartment holds. Takes
`{ databaseType, schema, schemaStatus }` and returns
`sql({ dialect, schema, defaultSchema, upperCaseKeywords: true })`, plus the
extra completion sources from phase 2 and the notice source described under
**Errors**. Taking the whole options object means the hook reconfigures one
compartment with one call and never has to reason about which half changed.

### Wiring

- **`src/app/hooks/queries.ts`** — export a
  `useWorksheetSchema(database: DatabaseDto | undefined)` built on the existing
  private `useDatabaseSchema`. It returns `{ data, error, status }`. The comment
  above `useDatabaseSchema` says nothing should reach past `useDatabaseSchemas`
  for a single row and names `useServerVersion` as the one exception left; this
  adds a second, and the comment should be updated to say so rather than quietly
  contradicted. It is a cache hit on the explorer's prefetch — same query key,
  no extra request — and it takes the `DatabaseDto` rather than the id for the
  same reason `useServerVersion` does: `isConnectionUnreadable` rows have no
  schema to ask for, and asking spends a failing request on an answer already
  known.
- **`src/app/App.tsx`** — read it next to `currentDatabase` and pass `schema`
  and `schemaStatus` to `<WorksheetEditor>`.
- **`use-worksheet-editor.ts`** — add `languageCompartment`, drop `sql()` and
  `autocompletion()` from `createExtensions` in favour of
  `languageCompartment.of(createSqlLanguage(...))` and a single
  `autocompletion()` (unchanged), and add an effect mirroring the existing
  gutter effect:

  ```ts
  useEffect(() => {
    const view = editorRef.current?.view

    if (!view) {
      return
    }

    view.dispatch({
      effects: languageCompartment.reconfigure(
        createSqlLanguage({ databaseType, schema, schemaStatus })
      )
    })
  }, [databaseType, languageCompartment, schema, schemaStatus])
  ```

  The deps are safe: `schema` comes from react-query with `staleTime: Infinity`,
  so its identity is stable until the schema is refreshed on purpose.

No module-level cache is introduced anywhere. `buildSqlNamespace` is memoized
per editor with `useMemo` on the schema's identity, which keeps it out of the
"unbounded module-level collection" rule entirely rather than needing an
eviction policy to satisfy it.

## Phase 2 — aliases, CTEs, and the current statement

lang-sql resolves `FROM users u` → `u.` on its own, off the Lezer tree, once it
has a schema. Three gaps it does not cover, each worth a small completion source
of its own layered into `createSqlLanguage`:

1. **CTE names.** `WITH recent AS (...) SELECT * FROM ` should offer `recent`.
2. **Subquery aliases.** `FROM (SELECT ...) t` should offer `t`.
3. **Sibling identifiers.** Any identifier already written in the same statement
   is a better guess than nothing, and covers the two above when their columns
   cannot be derived.

All three are reachable from `src/app/sql-parser/tokenizer.ts`, which already
runs on every keystroke for statement splitting, so this is a read of tokens
Squeal is producing anyway. Keep it in
`src/app/components/sql-completion-locals.ts` as a pure
`listLocalCompletions(statementText: string, offset: number): Completion[]` —
takes a string, returns completions, no CodeMirror types in the signature, one
test file, no view needed.

Column completion for a CTE would mean resolving its projection, which is a real
parser job. Not in this plan; the name alone removes most of the friction.

## Phase 3 — foreign-key joins

`TableInfo.foreignKeys` is in the payload and nothing reads it. After a `JOIN`
that names a table related to one already in the `FROM` clause, offer the whole
predicate as one completion:

```
JOIN orders ON orders.user_id = users.id
```

Both directions — the joined table referencing the existing one, and the
reverse. When a table has several relationships to the tables in scope, offer
one completion each, `detail` naming the constraint. `info` shows the full
predicate so a long one is readable before it is accepted.

This is deliberately last: it is the highest-delight item and the one most
likely to need iteration on exactly when it fires, and it should not hold up
phases 1 and 2, which are what people notice missing.

## Errors

Schema completion has one failure mode with four distinguishable causes, and the
editor's honest default for all of them is the same: **keyword completion keeps
working and nothing interrupts the user.** Silently degrading is right for
someone mid-keystroke and wrong for someone who pressed `Ctrl-Space` and got
nothing — so the explanation is attached to the explicit request, not to typing.

Bind `Mod-Space` in the editor's keymap to a command that runs `startCompletion`
and, when `schemaStatus` is anything but ready, first raises a toast. Exact
copy:

- **No connection** — title `This worksheet isn't connected to a database.`,
  description `Pick a connection in the toolbar to suggest tables and columns.`
- **Still loading** — title `Loading the schema for {name}…`, description
  `Table and column suggestions will appear in a moment.`
- **Unreadable stored secret** (`isConnectionUnreadable`) — title
  `Squeal can't read the stored password for {name}.`, description
  `Open the connection and re-enter the password to suggest tables and columns.`
- **Introspection failed** — title `Couldn't load the schema for {name}.`,
  description
  `{driver message} Check the connection, then press {⌘R} to reload it.` The
  driver message is the one the explorer already shows for the same row, and the
  shortcut comes from `getRefreshShortcut()` so it reads `⌘R` or `Ctrl+R` as the
  platform spells it.

Two failures that must not reach the user as errors, because they are not:

- **A table with zero columns.** Views and permission-limited introspection both
  produce these. The table still completes; it simply has no children.
- **A schema so large the namespace is slow to build.** Measure before
  defending: 5,000 columns is a few milliseconds of object construction, once,
  memoized. If a real database proves otherwise, the fix is to build the
  namespace lazily per table rather than to cap it — a completion list that
  silently omits tables is worse than a slow one.

`createSqlLanguage` must never throw. A malformed `SchemaInfoDto` should yield
an empty namespace and keyword completion, not a renderer crash — the editor
losing suggestions is a papercut, the editor failing to mount is a broken app.

## Testing

Per the repo's conventions: files next to the implementation, `toEqual` on whole
objects, no snapshots.

- `sql-namespace.test.ts` — the core of the work and the easiest thing to test.
  Feed `buildSqlNamespace` a `SchemaInfoDto` fixture and assert the entire
  returned namespace with one `toEqual`. Separate cases for single-schema vs
  multi-schema, quoted vs bare identifiers, MySQL backticks, primary-key boost,
  and the empty-columns table. `findDefaultSchemaName` and `quoteIdentifier` get
  their own tables of cases.
- `sql-completion-locals.test.ts` — strings in, completions out.
- `sql-language.test.ts` — the integration test that matters. Build a real
  `EditorState` with the extension (the way `worksheet-editor-format.test.ts`
  builds one without a view, so jsdom never has to measure anything), place the
  cursor after `SELECT ` / `FROM ` / `u.`, run the completion source, and assert
  the labels. This is what would catch a wrong `defaultSchema` or a namespace
  shape lang-sql quietly ignores — neither of which a unit test on the transform
  can see.
- `WorksheetEditor.test.tsx` — one RTL test that the editor still mounts and
  takes input with a schema supplied, and one that it still mounts with the
  schema query in its error state.
- Extend the existing identity-stability coverage: rendering with a new schema
  must not change the `extensions` array's identity. That is the regression this
  design exists to prevent, so it should fail loudly if someone later moves the
  schema out of the compartment.

## Sequencing

Phase 1 is the whole payoff and is self-contained: three new modules, one
exported hook, one compartment, one effect. Phases 2 and 3 layer extra
completion sources into `createSqlLanguage` without touching the wiring, so each
can ship on its own and be reverted on its own.
