import { describe, expect, it } from 'vitest'

import { formatSql, SqlFormatError, toSqlDialect } from './sql-format'

describe('toSqlDialect', () => {
  it('maps every database type to a formatter dialect', () => {
    expect({
      mysql: toSqlDialect('mysql'),
      postgres: toSqlDialect('postgres'),
      sqlite: toSqlDialect('sqlite')
    }).toEqual({
      mysql: 'mysql',
      postgres: 'postgresql',
      sqlite: 'sqlite'
    })
  })

  it('falls back to postgresql when the worksheet has no database', () => {
    expect(toSqlDialect(undefined)).toEqual('postgresql')
  })
})

describe('formatSql', () => {
  it('formats a statement', () => {
    expect(
      formatSql('select id, name from actor where id = 1', 'postgresql')
    ).toEqual('select\n  id,\n  name\nfrom\n  actor\nwhere\n  id = 1')
  })

  it('formats with the dialect it is given', () => {
    expect(formatSql('SELECT `id` FROM `actor`', 'mysql')).toEqual(
      'SELECT\n  `id`\nFROM\n  `actor`'
    )
  })

  it('throws instead of returning partial output for a malformed statement', () => {
    let thrown: unknown = null

    try {
      formatSql('SELECT * FROM (', 'postgresql')
    } catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(SqlFormatError)
    expect((thrown as SqlFormatError).message).toEqual(
      'Could not format this SQL'
    )
    expect((thrown as SqlFormatError).details).toContain('Parse error')
  })
})
