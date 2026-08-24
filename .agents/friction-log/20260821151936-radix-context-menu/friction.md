---
title:
  'Radix context-menu items cannot be activated under jsdom, so no test can
  cover a menu action'
severity: 'minor'
---

## Expected Behavior

A Radix context-menu action can be tested the way every other click is:
right-click the trigger, click the item, assert what the handler did.

## Current Behavior

Under jsdom the item resolves but `onSelect` never fires, so the assertion sees
zero calls and reads as "the handler is wrong" rather than "the interaction did
not happen". Both routes fail:

- `await user.click(screen.getByRole('menuitem', { name: 'Copy' }))`
- `await user.pointer({ keys: '[MouseRight]', target: cell })` then
  `await user.keyboard('{ArrowDown}{Enter}')`

Radix selects on `pointerup` with pointer state jsdom does not reproduce, and on
open it focuses the element with `role="menu"` rather than the first item. This
reproduces on a plain `QueryResultTable` with no search, no filtering and no
props beyond `result`, so it is the menu and not the component under test.

That is why `QueryResultTable.test.tsx`'s existing menu test asserts only that
the items are present — which is easy to read as "nobody got round to it" rather
than "this is the ceiling".

## Possible Solution

Either note the ceiling next to that test so the next person does not spend the
same half hour on it, or extract the menu's `onSelect` bodies into a plain
module (`copyCellValue(row, column)`) that can be unit-tested without the menu,
leaving the component test to assert only what it can.

## Minimal Reproducible Example

    render(<QueryResultTable result={{ fields: [{ name: 'id' }], rowCount: 1,
      rows: [{ id: 'a3f9' }], truncated: false }} />)
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('a3f9') })
    await user.click(screen.getByRole('menuitem', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalled()   // 0 calls

## Context

Hit while adding find-in-results: the sharpest guard on the filtered-row index
translation would have been "right-click a filtered row and copy it", and that
test cannot be written. Covered by asserting the rendered row number instead,
which works only because the render and the copy handlers read the same binding.
