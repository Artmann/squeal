import { describe, expect, it } from 'vitest'

import {
  formatMysqlServerVersion,
  formatPostgresServerVersion,
  formatSqliteServerVersion,
  requireServerVersion
} from './server-version'

describe('formatPostgresServerVersion', () => {
  it('keeps only the major release from a packaged version string', () => {
    expect(
      formatPostgresServerVersion('16.2 (Debian 16.2-1.pgdg120+2)')
    ).toEqual('PostgreSQL 16')
  })

  it('formats a bare version', () => {
    expect(formatPostgresServerVersion('17.0')).toEqual('PostgreSQL 17')
  })

  it('formats a major-only version', () => {
    expect(formatPostgresServerVersion('18')).toEqual('PostgreSQL 18')
  })

  it('keeps the minor for releases before the version scheme changed', () => {
    expect(formatPostgresServerVersion('9.6.24')).toEqual('PostgreSQL 9.6')
  })

  it('returns undefined for a string with no version in it', () => {
    expect(formatPostgresServerVersion('unknown')).toEqual(undefined)
  })

  it('returns undefined for an empty string', () => {
    expect(formatPostgresServerVersion('')).toEqual(undefined)
  })
})

describe('formatMysqlServerVersion', () => {
  it('keeps the major and minor release', () => {
    expect(formatMysqlServerVersion('8.4.0')).toEqual('MySQL 8.4')
  })

  it('drops the distribution suffix', () => {
    expect(formatMysqlServerVersion('8.0.36-0ubuntu0.22.04.1')).toEqual(
      'MySQL 8.0'
    )
  })

  it('reports MariaDB under its own name', () => {
    expect(
      formatMysqlServerVersion('10.11.6-MariaDB-1:10.11.6+maria~ubu2204')
    ).toEqual('MariaDB 10.11')
  })

  it('sees through the MariaDB 5.5.5 compatibility prefix', () => {
    expect(formatMysqlServerVersion('5.5.5-10.6.12-MariaDB')).toEqual(
      'MariaDB 10.6'
    )
  })

  it('returns undefined for a string with no version in it', () => {
    expect(formatMysqlServerVersion('not a version')).toEqual(undefined)
  })
})

describe('formatSqliteServerVersion', () => {
  it('keeps the major and minor release', () => {
    expect(formatSqliteServerVersion('3.45.1')).toEqual('SQLite 3.45')
  })

  it('formats a two-part version', () => {
    expect(formatSqliteServerVersion('3.45')).toEqual('SQLite 3.45')
  })

  it('returns undefined for a string with no version in it', () => {
    expect(formatSqliteServerVersion('')).toEqual(undefined)
  })
})

describe('requireServerVersion', () => {
  it('passes a formatted version through', () => {
    expect(requireServerVersion('SQLite 3.45', '3.45.1')).toEqual('SQLite 3.45')
  })

  it('throws with the raw string when the version could not be read', () => {
    expect(() => requireServerVersion(undefined, 'nonsense')).toThrow(
      'The database server reported an unrecognized version string: "nonsense".'
    )
  })
})
