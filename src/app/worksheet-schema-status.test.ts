import { describe, expect, it } from 'vitest'

import { makeDatabase } from './test-fixtures'
import {
  findSchemaNotice,
  toWorksheetSchemaStatus
} from './worksheet-schema-status'

describe('toWorksheetSchemaStatus', () => {
  it('reports a worksheet with no connection', () => {
    expect(
      toWorksheetSchemaStatus({
        database: undefined,
        error: null,
        isLoaded: false
      })
    ).toEqual({ state: 'no-database' })
  })

  // Checked before the error, because a row whose secret cannot be read is
  // never asked for a schema in the first place.
  it('reports a connection whose stored secret cannot be read', () => {
    expect(
      toWorksheetSchemaStatus({
        database: makeDatabase({ connectionInfo: null, name: 'Pagila' }),
        error: null,
        isLoaded: false
      })
    ).toEqual({ databaseName: 'Pagila', state: 'unreadable' })
  })

  it('reports a failed introspection with the driver message', () => {
    expect(
      toWorksheetSchemaStatus({
        database: makeDatabase({ name: 'Pagila' }),
        error: new Error('connection refused'),
        isLoaded: false
      })
    ).toEqual({
      databaseName: 'Pagila',
      message: 'connection refused',
      state: 'error'
    })
  })

  it('reports a request still in flight', () => {
    expect(
      toWorksheetSchemaStatus({
        database: makeDatabase({ name: 'Pagila' }),
        error: null,
        isLoaded: false
      })
    ).toEqual({ databaseName: 'Pagila', state: 'loading' })
  })

  it('reports a loaded schema', () => {
    expect(
      toWorksheetSchemaStatus({
        database: makeDatabase({ name: 'Pagila' }),
        error: null,
        isLoaded: true
      })
    ).toEqual({ databaseName: 'Pagila', state: 'ready' })
  })
})

describe('findSchemaNotice', () => {
  it('has nothing to say once the schema is loaded', () => {
    expect(
      findSchemaNotice({ databaseName: 'Pagila', state: 'ready' })
    ).toBeUndefined()
  })

  it('tells an unconnected worksheet where the connection picker is', () => {
    expect(findSchemaNotice({ state: 'no-database' })).toEqual({
      description:
        'Pick a connection in the toolbar to suggest tables and columns.',
      title: "This worksheet isn't connected to a database."
    })
  })

  it('names the database it is still loading', () => {
    expect(
      findSchemaNotice({ databaseName: 'Pagila', state: 'loading' })
    ).toEqual({
      description: 'Table and column suggestions will appear in a moment.',
      title: 'Loading the schema for Pagila…'
    })
  })

  it('tells the user to re-enter a password it cannot read', () => {
    expect(
      findSchemaNotice({ databaseName: 'Pagila', state: 'unreadable' })
    ).toEqual({
      description:
        'Open the connection and re-enter the password to suggest tables and columns.',
      title: "Squeal can't read the stored password for Pagila."
    })
  })

  // The driver's own message plus the key that retries it: what went wrong and
  // what to do about it, in one sentence each.
  it('carries the driver message and the refresh shortcut', () => {
    expect(
      findSchemaNotice({
        databaseName: 'Pagila',
        message: 'connection refused.',
        state: 'error'
      })
    ).toEqual({
      description:
        'connection refused. Check the connection, then press Ctrl+R to reload it.',
      title: "Couldn't load the schema for Pagila."
    })
  })
})
