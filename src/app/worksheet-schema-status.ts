import { getRefreshShortcut } from './refresh-shortcut'
import { isConnectionUnreadable, type DatabaseDto } from '@/glue/databases'

/**
 * Why the editor does or does not have a schema to complete from. Every state
 * but `ready` degrades to keyword-only completion, and each one needs a
 * different sentence to fix it — which is the whole reason this is a union and
 * not a boolean.
 */
export type WorksheetSchemaStatus =
  | { databaseName: string; message: string; state: 'error' }
  | { databaseName: string; state: 'loading' }
  | { databaseName: string; state: 'ready' }
  | { databaseName: string; state: 'unreadable' }
  | { state: 'no-database' }

export interface SchemaNotice {
  description: string
  title: string
}

export interface WorksheetSchemaStatusOptions {
  database: DatabaseDto | undefined
  error: Error | null
  isLoaded: boolean
}

/**
 * Resolves the four ways a worksheet can be without a schema, in the order
 * they rule each other out: no connection at all, a connection whose stored
 * secret cannot be read (so nothing was ever asked for), a failed
 * introspection, and a request still in flight.
 */
export function toWorksheetSchemaStatus(
  options: WorksheetSchemaStatusOptions
): WorksheetSchemaStatus {
  const { database, error, isLoaded } = options

  if (!database) {
    return { state: 'no-database' }
  }

  if (isConnectionUnreadable(database)) {
    return { databaseName: database.name, state: 'unreadable' }
  }

  if (error) {
    return {
      databaseName: database.name,
      message: error.message,
      state: 'error'
    }
  }

  if (!isLoaded) {
    return { databaseName: database.name, state: 'loading' }
  }

  return { databaseName: database.name, state: 'ready' }
}

/**
 * What to tell someone who explicitly asked for completion and is about to get
 * keywords only. Undefined when the schema is there and the question does not
 * arise.
 *
 * Nothing here is raised while typing. An editor that interrupts on every
 * keystroke it cannot help with is worse than one that quietly offers less, so
 * the explanation is attached to the moment the user asks for it and nowhere
 * else.
 */
export function findSchemaNotice(
  status: WorksheetSchemaStatus
): SchemaNotice | undefined {
  if (status.state === 'ready') {
    return undefined
  }

  if (status.state === 'no-database') {
    return {
      description:
        'Pick a connection in the toolbar to suggest tables and columns.',
      title: "This worksheet isn't connected to a database."
    }
  }

  if (status.state === 'loading') {
    return {
      description: 'Table and column suggestions will appear in a moment.',
      title: `Loading the schema for ${status.databaseName}…`
    }
  }

  if (status.state === 'unreadable') {
    return {
      description:
        'Open the connection and re-enter the password to suggest tables and columns.',
      title: `Squeal can't read the stored password for ${status.databaseName}.`
    }
  }

  return {
    description: `${status.message} Check the connection, then press ${getRefreshShortcut()} to reload it.`,
    title: `Couldn't load the schema for ${status.databaseName}.`
  }
}
