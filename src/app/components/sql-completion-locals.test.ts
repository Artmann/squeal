import { describe, expect, it } from 'vitest'

import { listLocalCompletions } from './sql-completion-locals'

// The cursor is written as `|` so each case reads as the document the user is
// looking at, rather than as a string and a number that have to be counted
// against each other.
function completionsAt(documentWithCursor: string) {
  const offset = documentWithCursor.indexOf('|')

  return listLocalCompletions(documentWithCursor.replace('|', ''), offset)
}

function labelsAt(documentWithCursor: string): string[] {
  return completionsAt(documentWithCursor).map((completion) => completion.label)
}

describe('listLocalCompletions', () => {
  it('offers a CTE the statement declares', () => {
    expect(
      completionsAt('with recent as (select 1) select * from re|')
    ).toEqual([{ detail: 'in this query', label: 'recent', type: 'constant' }])
  })

  it('offers every CTE in a chain', () => {
    expect(
      labelsAt(
        'with recent as (select 1), older as (select 2) select * from re|'
      )
    ).toEqual(['older', 'recent'])
  })

  it('offers the alias of a subquery in a FROM clause', () => {
    expect(labelsAt('select * from (select 1) totals where t|')).toEqual([
      'totals'
    ])
  })

  it('offers the alias of a subquery written with AS', () => {
    expect(labelsAt('select * from (select 1) as totals where t|')).toEqual([
      'totals'
    ])
  })

  it('offers the alias of a subquery joined in', () => {
    expect(
      labelsAt('select * from users u join (select 1) totals on t|')
    ).toEqual(['totals'])
  })

  // lang-sql resolves these from the syntax tree already, and two sources
  // offering the same name would show it twice.
  it('leaves a plain table alias to the schema source', () => {
    expect(labelsAt('select * from users u where u|')).toEqual([])
  })

  it('unwraps a quoted CTE name', () => {
    expect(
      labelsAt('with "Recent Orders" as (select 1) select * from R|')
    ).toEqual(['Recent Orders'])
  })

  it('offers each name once however many times it is declared', () => {
    expect(
      labelsAt(
        'select * from (select 1) totals union select * from (select 2) totals where t|'
      )
    ).toEqual(['totals'])
  })

  // A CTE declared in the statement above is out of scope here, and the
  // statement the cursor is in has nothing of its own.
  it('does not carry a name across a statement boundary', () => {
    expect(
      labelsAt(
        'with recent as (select 1) select * from recent;\nselect * from r|'
      )
    ).toEqual([])
  })

  it('offers nothing for an empty document', () => {
    expect(labelsAt('|')).toEqual([])
  })

  it('offers nothing for a statement that declares no names of its own', () => {
    expect(labelsAt('select * from users where id = 1|')).toEqual([])
  })
})
