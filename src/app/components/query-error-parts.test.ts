import { describe, expect, it } from 'vitest'

import { toQueryErrorParts } from './query-error-parts'

describe('toQueryErrorParts', () => {
  it('keeps a single-line error as the title with no detail', () => {
    expect(
      toQueryErrorParts('ERROR 42P01: relation "Employes" does not exist')
    ).toEqual({
      title: 'ERROR 42P01: relation "Employes" does not exist'
    })
  })

  it('splits a Postgres error into its first line and its context', () => {
    const error = [
      'ERROR 42P01: relation "Employes" does not exist',
      'LINE 1: SELECT * FROM Employes LIMIT 20',
      '                      ^',
      'HINT:  Perhaps you meant to reference the table "Employees".'
    ].join('\n')

    expect(toQueryErrorParts(error)).toEqual({
      detail: [
        'LINE 1: SELECT * FROM Employes LIMIT 20',
        '                      ^',
        'HINT:  Perhaps you meant to reference the table "Employees".'
      ].join('\n'),
      title: 'ERROR 42P01: relation "Employes" does not exist'
    })
  })

  it('falls back to a usable title for an empty error', () => {
    expect(toQueryErrorParts('   ')).toEqual({ title: 'Query failed' })
  })

  it('drops a detail that is only whitespace', () => {
    expect(toQueryErrorParts('Something broke\n\n  \n')).toEqual({
      title: 'Something broke'
    })
  })

  it('trims surrounding whitespace before splitting', () => {
    expect(toQueryErrorParts('\n  Table missing\n  and here is why\n')).toEqual({
      detail: 'and here is why',
      title: 'Table missing'
    })
  })
})
