import 'dotenv/config'
import { drizzle } from 'drizzle-orm/libsql'
import { resolve } from 'path'
import invariant from 'tiny-invariant'
import { pathToFileURL } from 'url'

const absolutePath = resolve('code-monkey.sqlite3')
export const databaseFilePath = pathToFileURL(absolutePath).toString()

invariant(databaseFilePath, 'Database file name must be provided.')

export const database = drizzle(databaseFilePath)
