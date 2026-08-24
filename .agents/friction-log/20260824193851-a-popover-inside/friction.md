---
title:
  'A Popover inside the editor screen renders behind the card, because portaled
  content keeps z-50 under a z-100 overlay'
severity: 'minor'
---

## Expected Behavior

Putting a `Popover` inside the editor screen's card shows the popover over the
card, the way `Select` already does from the same place.

## Current Behavior

It renders _behind_ the card. `PopoverContent` in
`src/app/components/ui/popover.tsx` carries `z-50` and portals to the body,
while the editor screen's overlay is `z-100`
(`src/app/components/EditorScreen.tsx`) — so the popover lands under it. What is
visible is a sliver of the popover poking out past the card's left edge, which
reads as a layout bug in the popover rather than a stacking one.

`SelectContent` does not have the problem because it carries `z-[200]`
(`src/app/components/ui/select.tsx:67`) — but nothing at that line says why, so
the number looks arbitrary and the constraint it encodes is invisible until the
next portaled surface hits it. `ContextMenuContent` and `TooltipContent` are
both still `z-50`, so they will hit it too.

## Possible Solution

Comment the `z-[200]` in `select.tsx` with the overlay it has to clear, or raise
all four portaled primitives to a shared token above `z-100` so the question
does not come up per component.

## Minimal Reproducible Example

Render any `Popover` inside the `EditorScreen` card — for example the
connection-string control in `src/app/components/DatabaseForm.tsx` — and open
it. The content is in the DOM and has a non-zero bounding box, so an assertion
on `popoverOpen` passes while nothing is readable on screen.

## Context

Hit while moving the "paste a connection string" control out of the field flow
and into a popover. The test asserted the popover opened and passed; only a
screenshot showed it was behind the modal.
