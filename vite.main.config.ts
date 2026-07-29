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
        /^pg-cursor(\/.*)?$/,

        // Optional native accelerators of `ws` (pulled in via
        // @effect/platform-node). Not installed — ws catches the failed
        // require at runtime, but Vite must not try to resolve them.
        'bufferutil',
        'utf-8-validate'
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
