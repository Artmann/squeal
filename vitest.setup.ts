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

  // jsdom implements no part of the Pointer Capture API, and Sonner calls
  // setPointerCapture on pointer-down for its swipe-to-dismiss. Without these
  // every click on a toast throws an uncaught TypeError, which vitest reports
  // as an unhandled error and warns can cause false positives.
  for (const name of [
    'hasPointerCapture',
    'releasePointerCapture',
    'setPointerCapture'
  ] as const) {
    if (typeof Element.prototype[name] !== 'function') {
      Element.prototype[name] = () => undefined
    }
  }
}
