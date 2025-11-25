import path from 'path'
import { defineConfig } from 'vite'

// https://vitejs.dev/config
export default defineConfig({
  build: {
    commonjsOptions: {
      // allow the CommonJS plugin to see dynamic requires under @libsql at runtime
      dynamicRequireTargets: ['node_modules/@libsql/**']
    },
    rollupOptions: {
      external: ['@libsql/win32-x64-msvc', /^@libsql(\/.*)?$/, 'pg']
    }
  },
  optimizeDeps: {
    // don't try to pre-bundle these native packages
    exclude: ['@libsql/win32-x64-msvc', '@libsql', 'pg']
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src')
    }
  }
})
