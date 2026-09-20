import type { Completion } from '@codemirror/autocomplete'

import {
  isNameToken,
  isWord,
  listStatementTokens,
  notATableAlias,
  toName
} from './sql-statement-tokens'
import type { Token } from '../sql-parser/tokenizer'

/**
 * Names introduced by `WITH x AS (...)`.
 *
 * The rule is the shape rather than the `WITH`: any name directly followed by
 * `AS (` is one. That catches every CTE in a chain without tracking where the
 * `WITH` list ends, and the only other construct it matches — `CREATE VIEW x AS
 * (...)` — introduces a name worth completing too.
 */
function listCteNames(tokens: Token[]): string[] {
  const names: string[] = []

  for (let index = 0; index + 2 < tokens.length; index++) {
    const isCte =
      isNameToken(tokens[index]) &&
      isWord(tokens[index + 1], 'AS') &&
      tokens[index + 2].value === '('

    if (isCte) {
      names.push(toName(tokens[index]))
    }
  }

  return names
}

// Steps past a balanced parenthesised group, returning the index just after its
// closing paren. An unclosed group runs to the end of the statement, which is
// the common case while the user is still typing it.
function skipParens(tokens: Token[], start: number): number {
  let depth = 0
  let index = start

  while (index < tokens.length) {
    if (tokens[index].value === '(') {
      depth++
    } else if (tokens[index].value === ')') {
      depth--

      if (depth === 0) {
        return index + 1
      }
    }

    index++
  }

  return tokens.length
}

/**
 * Names introduced by a subquery in a `FROM` or `JOIN` clause —
 * `FROM (SELECT ...) recent`.
 *
 * lang-sql resolves `FROM users u` on its own, off the syntax tree, so plain
 * table aliases are deliberately not collected here: two sources offering the
 * same name would show it twice. It walks siblings looking for an identifier
 * after an identifier, which a parenthesised group is not, so these are the
 * ones it cannot see.
 */
function listSubqueryAliases(tokens: Token[]): string[] {
  const names: string[] = []

  for (let index = 0; index < tokens.length; index++) {
    const startsTableReference =
      isWord(tokens[index], 'FROM') || isWord(tokens[index], 'JOIN')

    if (!startsTableReference || tokens[index + 1]?.value !== '(') {
      continue
    }

    let next = skipParens(tokens, index + 1)

    if (isWord(tokens[next], 'AS')) {
      next++
    }

    const alias = tokens[next]

    if (isNameToken(alias) && !notATableAlias.has(alias.value.toUpperCase())) {
      names.push(toName(alias))
    }

    index = next
  }

  return names
}

/**
 * The names a statement introduces itself — CTEs and subquery aliases — which
 * exist nowhere in the schema and so cannot come from the schema source.
 *
 * Takes the whole document and an offset rather than one statement, because a
 * completion source only ever has those two, and answers for the statement the
 * cursor is in: a CTE declared before the previous semicolon is not in scope
 * here.
 *
 * Only names, never their columns. Resolving a CTE's projection means
 * type-checking a `SELECT`, which is a parser's job, not a completion source's;
 * the name alone is what removes the friction of retyping it.
 */
export function listLocalCompletions(
  documentText: string,
  offset: number
): Completion[] {
  // The whole statement, not only what precedes the cursor: a subquery alias
  // can be written after the column list that wants it.
  const tokens = listStatementTokens(documentText, offset)

  const names = [...listCteNames(tokens), ...listSubqueryAliases(tokens)]

  // Deduplicated by name: the same alias can be introduced in two branches of a
  // union, and a completion list that repeats it is noise.
  return [...new Set(names)]
    .sort()
    .map((name) => ({ detail: 'in this query', label: name, type: 'constant' }))
}
