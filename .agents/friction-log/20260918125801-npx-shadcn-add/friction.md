---
title: '`npx shadcn add <component>` writes to a literal `@/` directory and installs `cn` and umbrella `radix-ui`'
severity: 'minor'
---

## Expected Behavior

`npx shadcn@latest add alert-dialog` should write
`src/app/components/ui/alert-dialog.tsx`, import `cn` from `@/app/lib/utils`,
and add only `@radix-ui/react-alert-dialog` — matching the individual
`@radix-ui/react-*` deps and the import style every other file in
`src/app/components/ui/` already uses.

## Current Behavior

It did none of those. One invocation produced:

- A literal `./@/app/components/ui/` directory at the repository root, holding
  `alert-dialog.tsx` and an unrequested rewrite of `button.tsx`. The `aliases`
  block in `components.json` maps `ui` to `@/app/components/ui`, and the CLI
  treated the alias as a path instead of resolving it. Nothing landed in `src/`.
- `import { cn } from "cn"` in the generated file, and `"cn": "^0.3.0"` added to
  `package.json` — an unrelated package off npm, installed because the CLI could
  not resolve the `utils` alias either.
- `"radix-ui": "^1.6.7"`, the umbrella package, rather than the single
  primitive. The generated file imports
  `import { AlertDialog as AlertDialogPrimitive } from "radix-ui"`.

The `button.tsx` overwrite is the expensive part: it is silent, it is not what
was asked for, and this repository's copy carries project-specific variants
(`primary`, the `h-[29px]` default size) and token classes (`bg-accent-btn`,
`bg-panel`, `hover:bg-hover`) that the registry version does not. It only
survived here because the alias bug put it in `@/` rather than in `src/`.

## Possible Solution

Don't use the CLI in this repository. Add the primitive by hand:

```
yarn add @radix-ui/react-alert-dialog
```

then write `src/app/components/ui/alert-dialog.tsx` in the shape
`src/app/components/ui/popover.tsx` already establishes — namespace import of
the single primitive, `cn` from `@/app/lib/utils`, project tokens (`bg-panel`,
`text-text`, `border-border`, `z-(--z-portal)`).

If the CLI is wanted later, the alias resolution needs whatever it is missing.
`components.json` has `"tailwind": { "config": "" }` and the path mappings live
in `tsconfig.renderer.json`, which is a plausible place for it to be looking and
not finding them.

## Minimal Reproducible Example

From a clean tree:

```
npx shadcn@latest add alert-dialog --yes --overwrite
```

Then:

```
find '@' -type f     # @/app/components/ui/{alert-dialog,button}.tsx
git diff package.json  # + "cn", + "radix-ui"
ls src/app/components/ui/alert-dialog.tsx   # does not exist
```

Cleanup is `rm -rf '@' && git checkout -- package.json yarn.lock`.

## Context

Hit while adding an `AlertDialog` to move the delete confirmations out of
sonner toasts and into a modal. `components.json` is checked in and the
`shadcn` CLI is the documented way to use it, so reaching for it first is the
obvious move. The cost was one wasted install plus the time to work out that a
directory named `@` had appeared and that `button.tsx` had been rewritten
inside it — a diff `git status` reports only as an untracked `@/`, which reads
like nothing happened.
