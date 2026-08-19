import path from 'path'
import { defineConfig } from 'vite'

import { rollupExternals } from './src/build/native-packages'

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      external: rollupExternals
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src')
    }
  }
})
