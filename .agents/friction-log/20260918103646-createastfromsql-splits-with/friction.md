---
title: '`createAstFromSql` splits `WITH … SELECT` in two, so Mod-Enter runs the select without its CTE'
severity: 'major'
---

## Expected Behavior

`createAstFromSql` should treat `WITH recent AS (...) SELECT * FROM recent` as
one statement, because that is what the database will be asked to run.

## Current Behavior

It splits on any top-level `SELECT`, so the CTE and the select that uses it
become two statements:

```
statements[0] = "with recent as (select 1)"
statements[1] = "select * from recent"
```

Two things follow from that. `Mod-Enter` with the cursor anywhere in the select
sends `select * from recent` on its own, and the server answers
`relation "recent" does not exist` — the query the user is looking at is not the
query that runs. And anything scoping by statement gets the wrong scope: a CTE
name is only ever in scope for the select that follows it, which is the
statement the splitter just put it outside of.

## Possible Solution

Treat the `WITH` prefix as part of the statement it introduces: when a
statement's first significant token is `WITH`, do not split on the first
top-level statement keyword that follows its declaration list. The paren
tracking that already exists in `consumeToken` is most of what it needs — what
is missing is knowing that the top-level `SELECT` after the closing paren of a
CTE list continues the statement rather than starting one.

Worth checking `INSERT ... RETURNING` inside a CTE, and `WITH RECURSIVE`, in the
same pass.

## Minimal Reproducible Example

```ts
import { createAstFromSql } from '@/app/sql-parser'

const script = createAstFromSql('with recent as (select 1) select * from recent')

// Two statements, not one.
expect(script.statements.length).toEqual(2)
```

## Context

Hit while building schema-aware completion. CTE names have to complete inside
the select that uses them, so `listLocalCompletions` needed the statement the
cursor is in — and `createAstFromSql` reported a statement that did not contain
the `WITH`. The workaround was `sql-statement-tokens.ts`, which scopes by
semicolon instead, so the completion side is covered. The run-the-statement-
under-the-cursor bug is not: a CTE query still runs as a fragment.
