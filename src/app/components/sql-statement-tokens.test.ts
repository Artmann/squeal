import { describe, expect, it } from 'vitest'

import { listStatementTokens } from './sql-statement-tokens'

// `|` marks the cursor; the assertion is on the token text, which is what every
// caller actually reads.
function valuesAt(documentWithCursor: string): string[] {
  const offset = documentWithCursor.indexOf('|')

  return listStatementTokens(documentWithCursor.replace('|', ''), offset).map(
    (token) => token.value
  )
}

describe('listStatementTokens', () => {
  it('returns the whole document when it holds one statement', () => {
    expect(valuesAt('select 1|')).toEqual(['select', '1'])
  })

  it('returns only the statement the cursor is in', () => {
    expect(valuesAt('select 1;\nselect 2|;\nselect 3')).toEqual(['select', '2'])
  })

  it('returns the last statement when the cursor is past the last semicolon', () => {
    expect(valuesAt('select 1;\nselect 2|')).toEqual(['select', '2'])
  })

  it('returns the first statement when the cursor is before the first semicolon', () => {
    expect(valuesAt('select |1;\nselect 2')).toEqual(['select', '1'])
  })

  it('drops whitespace and comments', () => {
    expect(valuesAt('select\n  -- a note\n  1|')).toEqual(['select', '1'])
  })

  // The reason this tokenizes instead of splitting on the character.
  it('does not end a statement on a semicolon inside a string', () => {
    expect(valuesAt("select 'a;b', 2|")).toEqual(['select', "'a;b'", ',', '2'])
  })

  it('does not end a statement on a semicolon inside a comment', () => {
    expect(valuesAt('select -- a; b\n  2|')).toEqual(['select', '2'])
  })

  // A `WITH` and the select that uses it are one statement, which is the whole
  // reason this does not use `createAstFromSql` — that splits them apart.
  it('keeps a CTE and the select that uses it together', () => {
    expect(valuesAt('with recent as (select 1) select * from rec|')).toEqual([
      'with',
      'recent',
      'as',
      '(',
      'select',
      '1',
      ')',
      'select',
      '*',
      'from',
      'rec'
    ])
  })

  it('returns nothing for an empty document', () => {
    expect(valuesAt('|')).toEqual([])
  })
})
