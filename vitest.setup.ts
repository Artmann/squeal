import '@testing-library/jest-dom/vitest'

if (typeof window !== 'undefined') {
  Object.assign(window, {
    electron: {
      getApiToken: () => Promise.resolve('test-token'),
      openFileDialog: () => Promise.resolve(null),
      windowClose: () => Promise.resolve(),
      windowMaximize: () => Promise.resolve(),
      windowMinimize: () => Promise.resolve()
    }
  })
}
