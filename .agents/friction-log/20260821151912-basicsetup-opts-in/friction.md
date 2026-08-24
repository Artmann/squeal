---
title:
  'basicSetup opts in to searchKeymap, so CodeMirror silently owns ⌘F, ⌘D and ⌘G'
severity: 'minor'
---

## Expected Behavior

The extensions a CodeMirror editor has are the ones listed in `createExtensions`
in `src/app/components/use-worksheet-editor.ts`. Binding a new app-level
shortcut means checking that list plus the `useHotkeys` calls.

## Current Behavior

`@uiw/codemirror-extensions-basic-setup` enables every option it is not handed a
literal `false`, and `editorBasicSetup` only names five. So the editor silently
carried `searchKeymap` and `highlightSelectionMatches`, and CodeMirror owned ⌘F,
⌘G, F3, ⌘D, ⌘⌥G and ⌘⇧L with nothing anywhere in `src/` to say so.

Adding find-in-results meant discovering this by reading
`node_modules/@uiw/react-codemirror/node_modules/@uiw/codemirror-extensions-basic-setup/esm/index.js`.
`openSearchPanel` also self-installs via `StateEffect.appendConfig`, so a search
panel appears for an extension that is not in any list.

Putting any of the dropped bindings back is worse than it looks.
`@codemirror/search` is not a direct dependency, and the tree carries **four**
copies of it at two versions:

    node_modules/@codemirror/search                                    6.7.1
    node_modules/codemirror/node_modules/@codemirror/search            6.5.11
    node_modules/@uiw/react-codemirror/node_modules/@codemirror/search 6.5.11
    node_modules/@uiw/.../codemirror-extensions-basic-setup/.../search 6.7.1

`yarn add @codemirror/search` forks the lockfile into two entries rather than
deduping. An app import then resolves to a different module instance than the
one basicSetup is built against, and CodeMirror keys its state off `Facet`
identity — so `openSearchPanel` from one copy installs state the other's keymap
never reads. That failure is silent and looks like a half-working search panel.

## Possible Solution

List the opted-in-by-default options explicitly in `editorBasicSetup` with
`false` for the ones not wanted, so the file states what the editor actually
binds. And if in-editor find is ever wanted back, flatten the CodeMirror tree
first (a `resolutions` entry for `@codemirror/search`, `@codemirror/state` and
`@codemirror/view`) rather than adding the dependency on top of four copies.

## Minimal Reproducible Example

    find node_modules -path "*@codemirror/search/package.json" \
      -exec grep -H '"version"' {} \;
    # four paths, two versions -- none of them a direct dependency

## Context

Hit while adding find-in-results (⌘F). Cost the time to find out why ⌘F opened
CodeMirror's panel, then a full add-and-revert of `@codemirror/search` once the
duplication showed up.
