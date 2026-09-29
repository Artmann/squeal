---
title: 'A real CodeMirror editor in a renderer test throws on Range.getClientRects, which jsdom does not implement'
severity: 'minor'
---

## Expected Behavior

Rendering the real `WorksheetEditor` (unmocked `@uiw/react-codemirror`) in a
renderer test should work, since the renderer project runs under jsdom.

## Current Behavior

Anything that makes CodeMirror measure -- `view.lineBlockAtHeight`, a
selection layer redraw -- throws `TypeError: textRange(...).getClientRects is
not a function`, because jsdom leaves `Range.prototype.getClientRects` and
`Range.prototype.getBoundingClientRect` out. `vitest.setup.ts` stubs the
Pointer Capture API for Sonner but not these, and the only other editor test
(`WorksheetEditor.test.tsx`) mocks CodeMirror away, so nothing in the tree
shows the fix.

## Possible Solution

Stub both in `vitest.setup.ts` next to the pointer-capture stubs.
`src/app/components/worksheet-editor-view.test.tsx` carries a local copy in a
`beforeAll` that can move there:

```ts
Range.prototype.getBoundingClientRect ??= () => new DOMRect()
Range.prototype.getClientRects ??= () =>
  Object.assign([], { item: () => null }) as unknown as DOMRectList
```

## Minimal Reproducible Example

Render `<WorksheetEditor>` from `src/app/components/WorksheetEditor.tsx` with
RTL, without mocking `@uiw/react-codemirror`, and dispatch a selection change on
its view. The test fails with the `getClientRects` TypeError.

## Context

Hit while writing RTL tests for the per-worksheet caret and scroll memory,
which only make sense with the real library swapping the document.
