import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'

function getUserDataPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { app } = require('electron')

    return app.isPackaged ? app.getPath('userData') : process.cwd()
  } catch {
    // Not running in Electron (e.g., drizzle-kit CLI)
    return process.cwd()
  }
}

const userDataPath = getUserDataPath()

if (!existsSync(userDataPath)) {
  mkdirSync(userDataPath, { recursive: true })
}

const absolutePath = join(userDataPath, 'squeal.sqlite3')

export const databaseFilePath = pathToFileURL(absolutePath).toString()
