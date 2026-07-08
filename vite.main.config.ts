import path from 'path'
import { defineConfig } from 'vite'

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      external: [
        '@libsql/client',
        '@libsql/win32-x64-msvc',
        /^@libsql(\/.*)?$/,
        /^libsql(\/.*)?$/,
        /^mysql2(\/.*)?$/,
        /^pg(\/.*)?$/,
        /^pg-cursor(\/.*)?$/
      ]
    }
  },
  optimizeDeps: {
    // don't try to pre-bundle these native packages
    exclude: [
      '@libsql/client',
      '@libsql/win32-x64-msvc',
      '@libsql',
      'libsql',
      'mysql2',
      'mysql2/promise',
      'pg',
      'pg-cursor'
    ]
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src')
    }
  }
})
