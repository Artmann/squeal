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

  // A Radix modal sets `pointer-events: none` on `<body>` so clicks cannot
  // reach the app behind it, and restores it when the last layer closes. A
  // test that leaves the dialog open -- "does not delete when the confirmation
  // is dismissed" leaves it open on purpose -- is torn down by Testing
  // Library's cleanup instead of closing, and the restore never runs. The
  // style then belongs to the shared jsdom document, so the next test in the
  // file fails on `user.click` with "the element has pointer-events: none",
  // pointing at whatever it clicked rather than at the dialog.
  //
  // `beforeEach` rather than `afterEach`: vitest runs afterEach hooks in
  // reverse registration order, so an afterEach registered here runs before
  // Testing Library's cleanup -- that is, before the unmount that leaks the
  // style. Clearing it on the way in is not subject to that ordering.
  const { beforeEach } = await import('vitest')

  beforeEach(() => {
    document.body.style.pointerEvents = ''
  })
}
