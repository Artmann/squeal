import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

import { databaseFilePath } from '@/database'

export default defineConfig({
  out: './drizzle',
  schema: './src/database/schema.ts',
  dialect: 'sqlite',
  dbCredentials: {
    url: databaseFilePath
  }
})
