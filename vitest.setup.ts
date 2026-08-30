import '@testing-library/jest-dom/vitest'

if (typeof window !== 'undefined') {
  // Testing Library's async utilities have their own budget, and it is not the
  // `testTimeout` raised in `vitest.config.ts` -- `findBy*` and `waitFor` give
  // up after 1000ms of their own regardless. That is not a budget for a loaded
  // machine: with several vitest processes competing for CPU this suite varies
  // from 19s to 40s on an unchanged tree, and a `findByRole` that would have
  // resolved at 1.2s reads as "the element never appeared", in a file nowhere
  // near whatever was just changed. Raised to match the reasoning that raised
  // `testTimeout`: still short enough that a genuinely missing element fails
  // the run rather than hanging it.
  const { configure } = await import('@testing-library/react')

  configure({ asyncUtilTimeout: 5000 })

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
  //
  // Assigned one at a time rather than in a loop: `hasPointerCapture` answers a
  // boolean while the other two return void, so a single shared stub does not
  // satisfy all three signatures.
  Element.prototype.hasPointerCapture ??= () => false
  Element.prototype.releasePointerCapture ??= () => undefined
  Element.prototype.setPointerCapture ??= () => undefined
}
