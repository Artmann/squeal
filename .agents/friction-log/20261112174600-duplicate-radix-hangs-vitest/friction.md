---
title: 'A Radix test hangs the vitest worker instead of failing when two Radix copies are installed'
severity: 'minor'
---

### Expected Behavior

A renderer test that opens a dialog from a context menu fails with an assertion
when something is wrong.

### Current Behavior

With two versions of `@radix-ui/react-focus-scope` and
`@radix-ui/react-dismissable-layer` in `yarn.lock` (Select, ContextMenu and
Tooltip on one; Dialog and Popover on the other), the test never reaches its
assertion. The vitest worker prints `RangeError: Maximum call stack size
exceeded` from its RPC `send` in a loop and the run never ends. A 30-minute
background run was killed with no output, while other renderer tests passed in
3 seconds in the same checkout.

### Possible Solution

`src/app/components/ui/modal-layers.test.tsx` now asserts that `yarn.lock`
resolves every `@radix-ui/*` package to one version, which fails cleanly and
names the duplicates. Upgrade every `@radix-ui` package together
(`yarn upgrade --latest --pattern @radix-ui`), never one at a time.
