import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, relative, resolve } from 'path'
import invariant from 'tiny-invariant'
import { describe, expect, it } from 'vitest'

// Nothing at build or run time reads `components.json`. It is consumed only by
// the `shadcn` CLI, which is not a dependency of this repository and appears in
// no script and no CI job — which is why a path to a file that has never
// existed survived from the first commit, and why the doubled slash in two of
// its aliases reached six generated components before anyone noticed. These
// assertions are the only reader it has.
describe('components.json', () => {
  const root = resolve(import.meta.dirname, '..')
  const configuration = JSON.parse(
    readFileSync(join(root, 'components.json'), 'utf-8')
  ) as {
    aliases?: Record<string, string>
    tailwind?: { config: string; css: string }
  }

  const { aliases, tailwind } = configuration

  invariant(aliases, 'components.json declares no aliases.')
  invariant(tailwind, 'components.json declares no tailwind block.')

  // The encoding is what keeps this `string[]`; without it the version-agnostic
  // overload widens to `Buffer[]`.
  const sourceFiles = readdirSync(join(root, 'src'), {
    encoding: 'utf-8',
    recursive: true
  })
    .filter((entry) => /\.tsx?$/.test(entry))
    .map((entry) => join(root, 'src', entry))

  // `@/` is `src/` in every tsconfig and every Vite config here.
  function aliasTarget(alias: string): string {
    return join(root, 'src', alias.replace('@/', ''))
  }

  // An empty `tailwind.config` puts the CLI in Tailwind v4 mode, where there is
  // no `tailwind.config.js` to hold anything: every theme token and `@layer`
  // addition a registry item ships is written to the file named here. Naming one
  // that does not exist aborts an add halfway through — verified against shadcn
  // 4.18 with the pre-fix config, where `add sidebar` wrote all eight component
  // files and installed their dependencies, then read this path without
  // guarding it and died with `ENOENT ... src/index.css`. The components were
  // left on disk with their custom properties defined nowhere.
  it('names a stylesheet that exists', () => {
    const { css } = tailwind

    expect({ css, exists: existsSync(join(root, css)) }).toEqual({
      css,
      exists: true
    })
  })

  // Existing is not enough. It has to be the stylesheet Tailwind actually
  // processes, and the one that reaches Tailwind is the one the renderer
  // imports — so that is what it is compared against rather than a path
  // repeated here.
  //
  // Worth knowing before the next add: with the path correct, the same
  // `add sidebar` succeeds and writes shadcn's own `:root` and `.dark` token
  // names into this file, which has a vocabulary of its own (`--panel`,
  // `--text`, `--border`) and its own ThemeProvider. A quiet stylesheet edit
  // rather than a loud failure, and worth reading before committing.
  it('names the stylesheet the renderer imports', () => {
    const renderer = readFileSync(join(root, 'src', 'renderer.tsx'), 'utf-8')
    const imported = /import '(\.[^']*\.css)'/.exec(renderer)?.[1]

    invariant(
      imported,
      'src/renderer.tsx has no relative .css import. If the stylesheet moved to an aliased import, update this test to match both spellings.'
    )

    expect(resolve(root, tailwind.css)).toEqual(resolve(root, 'src', imported))
  })

  // A doubled separator resolves: TypeScript normalizes one away when it
  // substitutes a `paths` entry, and Vite's alias is a string replacement the OS
  // then collapses. So this is cosmetic on its own — but `import/no-unresolved`
  // is off, nothing else will ever mention it, and every `shadcn add` mints
  // another copy.
  it('spells every alias with single separators', () => {
    const doubled = Object.entries(aliases).filter(([, alias]) =>
      alias.includes('//')
    )

    expect(doubled).toEqual([])
  })

  // The same defect as the stylesheet path, on the other five entries. An alias
  // pointing nowhere is milder — the CLI creates directories it does not find —
  // but it is the same class of thing, and this file has no other reader.
  it('resolves every alias it declares', () => {
    const missing = Object.entries(aliases).filter(
      ([, alias]) =>
        !['', '.ts', '.tsx'].some((extension) =>
          existsSync(`${aliasTarget(alias)}${extension}`)
        )
    )

    expect(missing).toEqual([])
  })

  // Any doubled separator in an aliased import, not just the one spelling this
  // config happened to produce: `components`, `ui` and `hooks` are substituted
  // the same way, and the generator copies whatever the alias says. The pattern
  // does not match its own source, since the `@/` here is written `@\/`.
  it('has not been copied into any import', () => {
    invariant(
      sourceFiles.includes(join(root, 'src', 'renderer.tsx')),
      'The walk of src/ did not find renderer.tsx, so it read nothing and the assertion below proves nothing.'
    )

    const offenders = sourceFiles
      .filter((file) => /'@\/[^']*\/\//.test(readFileSync(file, 'utf-8')))
      .map((file) => relative(root, file))

    expect(offenders).toEqual([])
  })
})
