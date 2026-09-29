import { describe, expect, it } from 'vitest'

import { createDatabaseSchema, updateDatabaseSchema } from './schemas'

const serverInfo = {
  database: 'pagila',
  host: 'localhost',
  password: 'secret',
  port: '5432',
  username: 'postgres'
}

interface ParseResult {
  error?: { issues: { message: string; path: PropertyKey[] }[] }
}

function issuesOf(result: ParseResult) {
  return (result.error?.issues ?? []).map(({ message, path }) => ({
    message,
    path
  }))
}

// For fields that are missing rather than empty, where zod answers with its
// own wording; what matters there is which shape was checked.
function pathsOf(result: ParseResult) {
  return issuesOf(result).map(({ path }) => path)
}

describe('database form schemas', () => {
  it('accepts a server type with server info', () => {
    const result = createDatabaseSchema.safeParse({
      connectionInfo: serverInfo,
      environmentId: null,
      name: 'Pagila',
      type: 'postgres'
    })

    expect(result).toEqual({
      data: {
        connectionInfo: { ...serverInfo, port: 5432 },
        environmentId: null,
        name: 'Pagila',
        type: 'postgres'
      },
      success: true
    })
  })

  it('rejects SQLite with server info on create and update', () => {
    const value = {
      connectionInfo: serverInfo,
      environmentId: null,
      name: 'Mismatched',
      type: 'sqlite'
    }

    const expected = [['connectionInfo', 'path']]

    expect(pathsOf(createDatabaseSchema.safeParse(value))).toEqual(expected)
    expect(pathsOf(updateDatabaseSchema.safeParse(value))).toEqual(expected)
  })

  // One issue for the one field, which is what the form shows under the file
  // input.
  it('reports an empty SQLite path as a single field error', () => {
    const result = createDatabaseSchema.safeParse({
      connectionInfo: { path: '' },
      environmentId: null,
      name: 'Local',
      type: 'sqlite'
    })

    expect(issuesOf(result)).toEqual([
      { message: 'File path is required.', path: ['connectionInfo', 'path'] }
    ])
  })

  it('rejects a server type with SQLite info', () => {
    const result = updateDatabaseSchema.safeParse({
      connectionInfo: { path: '/tmp/pagila.sqlite3' },
      environmentId: null,
      name: 'Mismatched',
      type: 'mysql'
    })

    expect(pathsOf(result)).toEqual([
      ['connectionInfo', 'database'],
      ['connectionInfo', 'host'],
      ['connectionInfo', 'username']
    ])
  })

  it('lets an update omit the password', () => {
    const result = updateDatabaseSchema.safeParse({
      connectionInfo: { ...serverInfo, password: undefined },
      environmentId: null,
      name: 'Pagila',
      type: 'postgres'
    })

    expect(result.success).toEqual(true)
  })
})
