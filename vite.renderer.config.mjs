import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

// Applied to packaged builds only: the dev server needs HMR websockets and
// react-refresh's inline preamble, which a strict policy would block. The
// policy ships as a meta tag because the packaged renderer loads from
// file://, where injecting response headers is not an option.
const contentSecurityPolicy = [
  "default-src 'self'",
  "connect-src 'self' http://127.0.0.1:7847 http://localhost:7847",
  "font-src 'self' data:",
  "img-src 'self' data:",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'"
].join('; ')

function injectContentSecurityPolicy() {
  return {
    apply: 'build',
    name: 'inject-content-security-policy',
    transformIndexHtml() {
      return [
        {
          attrs: {
            content: contentSecurityPolicy,
            'http-equiv': 'Content-Security-Policy'
          },
          injectTo: 'head-prepend',
          tag: 'meta'
        }
      ]
    }
  }
}

// https://vitejs.dev/config
export default defineConfig({
  plugins: [injectContentSecurityPolicy(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src')
    }
  }
})
