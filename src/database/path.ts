import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'

function getUserDataPath(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { app } = require('electron')

    return app.isPackaged ? app.getPath('userData') : process.cwd()
  } catch {
    // Not running in Electron — the backend test project runs this module
    // in a plain node environment, where there is no `electron` to require.
    return process.cwd()
  }
}

const userDataPath = getUserDataPath()

if (!existsSync(userDataPath)) {
  mkdirSync(userDataPath, { recursive: true })
}

const absolutePath = join(userDataPath, 'squeal.sqlite3')

export const databaseFilePath = pathToFileURL(absolutePath).toString()
