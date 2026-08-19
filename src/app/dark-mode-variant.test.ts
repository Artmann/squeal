// @vitest-environment node
import { existsSync, readFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { compile } from 'tailwindcss'
import { describe, expect, it } from 'vitest'

const repositoryRoot = resolve(import.meta.dirname, '..', '..')
const stylesheetPath = join(repositoryRoot, 'src', 'app', 'index.css')

// Assembled rather than written out, because Tailwind scans `src/**` for class
// names and this file is under it. Spelled in one piece, the class below would
// be scanned out of this very test and compiled into the CSS the app ships, for
// a rule nothing uses. Neither half is a utility on its own, so neither is.
const candidate = ['dark:bg', 'red-500'].join('-')

/** The app's real stylesheet, compiled for the class names given. */
async function compileStylesheet(candidates: string[]): Promise<string> {
  const compiler = await compile(readFileSync(stylesheetPath, 'utf-8'), {
    base: dirname(stylesheetPath),
    loadStylesheet: (id, base) => {
      const path = resolveImport(id, base)

      return Promise.resolve({
        base: dirname(path),
        content: readFileSync(path, 'utf-8'),
        path
      })
    }
  })

  return compiler.build(candidates)
}

/**
 * Resolve an `@import` the way the browser build does.
 *
 * `@tailwindcss/vite` hands Tailwind a resolver that honours the `style` export
 * condition, which is how `@import 'tailwindcss'` reaches a stylesheet rather
 * than `dist/lib.js`. Node's own resolver has no way to ask for that condition,
 * so the few lines below stand in for it — enough for the three shapes
 * `index.css` actually imports: a bare package, a package subpath, and a
 * relative path.
 *
 * It is deliberately stricter than the real thing rather than looser. A package
 * that declares no stylesheet says so here, instead of handing back its
 * JavaScript entry for the CSS parser to swallow in silence — which it does:
 * feeding it `semver` compiles, and every assertion below still passes.
 */
function resolveImport(id: string, base: string): string {
  if (id.startsWith('.') || id.startsWith('/')) {
    return resolve(base, id)
  }

  const segments = id.split('/')
  const name = id.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
  const subpath = id.slice(name.length)
  const directory = join(repositoryRoot, 'node_modules', name)

  if (subpath !== '') {
    // The real resolver reads the package's `exports` map for a subpath too.
    // These two guesses cover what `index.css` imports, and the documented
    // `@import 'tailwindcss/theme'` form besides; anything else says which
    // import it was rather than surfacing as a bare ENOENT from the reader.
    const path = join(directory, subpath)
    const found = [path, `${path}.css`].find((each) => existsSync(each))

    if (found === undefined) {
      throw new Error(
        `\`${id}\` names no file under \`${name}\`, and this stand-in resolver does not read \`exports\` maps for subpaths. Import the file by relative path, or teach \`resolveImport\` the shape \`${name}\` uses.`
      )
    }

    return found
  }

  const manifest = JSON.parse(
    readFileSync(join(directory, 'package.json'), 'utf-8')
  ) as {
    exports?: { '.'?: { style?: string } }
    style?: string
  }
  const entry = manifest.exports?.['.']?.style ?? manifest.style

  if (entry === undefined) {
    throw new Error(
      `\`${name}\` declares no stylesheet entry, so \`index.css\` cannot import it by name. Import the file directly instead.`
    )
  }

  return join(directory, entry)
}

/** Everything the compiler emitted for one utility, braces balanced. */
function ruleFor(stylesheet: string, className: string): string {
  const selector = new RegExp(
    `\\.${className.replace(/[.:/[\]]/g, '\\\\$&')}\\s*\\{`
  )
  const start = stylesheet.search(selector)

  if (start === -1) {
    throw new Error(
      `Tailwind emitted nothing for \`${className}\`, so there is no rule to inspect. The compiler produced ${stylesheet.length} characters.`
    )
  }

  let depth = 0

  for (let index = start; index < stylesheet.length; index += 1) {
    if (stylesheet[index] === '{') {
      depth += 1
    }

    if (stylesheet[index] === '}') {
      depth -= 1

      if (depth === 0) {
        return stylesheet.slice(start, index + 1)
      }
    }
  }

  throw new Error(`The rule for \`${className}\` is never closed.`)
}

/**
 * Both kinds of quote taken out.
 *
 * `[data-mode=dark]`, `[data-mode='dark']` and `[data-mode="dark"]` are one
 * selector, and which one comes out is the compiler's business — the minifier
 * that runs after it picks the unquoted form regardless.
 */
function stripQuotes(text: string): string {
  return text.replace(/['"]/g, '')
}

// The app's dark mode is a DOM attribute this application sets itself:
// `useTheme.ts` resolves `'system'` against the OS and then writes `data-mode`
// on the root element, and every theme variable keys off that attribute.
// Tailwind's `dark:` variant does not know about any of it — left alone it
// compiles to `@media (prefers-color-scheme: dark)`, which is a second, unowned
// answer to the same question.
//
// They disagree exactly when the user has overridden the OS: someone on a dark
// desktop who picks Light gets `data-mode="light"`, the themes go light, and
// every `dark:` rule keeps matching.
//
// This is checked by compiling the real `index.css` because there is nowhere
// else to check it. The variant is a stylesheet declaration, jsdom does not run
// Tailwind, and a grep for the declaration would assert that a line exists
// rather than that it does anything.
describe('the dark variant', () => {
  it('follows the mode the app sets, not the operating system', async () => {
    const stylesheet = await compileStylesheet([candidate])
    const rule = ruleFor(stylesheet, candidate)

    expect({
      followsAttribute: rule.includes('data-mode'),
      followsOperatingSystem: rule.includes('prefers-color-scheme')
    }).toEqual({ followsAttribute: true, followsOperatingSystem: false })
  })

  // The attribute is set on the root element, so a variant matching only the
  // element that carries it would leave `dark:` doing nothing on every
  // component in the tree — which is all of them.
  it('applies to the element carrying the attribute and to its descendants', async () => {
    const stylesheet = await compileStylesheet([candidate])
    // The attribute cannot appear anywhere in this rule except in a selector,
    // so the whole rule — the utility's own selector and the condition nested
    // under it alike — is the honest thing to read.
    const rule = stripQuotes(ruleFor(stylesheet, candidate))
    const descendant = '[data-mode=dark] *'

    expect({
      descendants: rule.includes(descendant),
      // With every descendant selector taken out, what is left still has to
      // name the attribute — otherwise the variant skips the root element that
      // carries it.
      itself: rule.split(descendant).join('').includes('[data-mode=dark]')
    }).toEqual({ descendants: true, itself: true })
  })

  // A raw `@media (prefers-color-scheme: dark)` block written into any of these
  // sheets would sit beside the variant as a second answer to the same
  // question, and nothing above would notice.
  //
  // Compiled with no candidates, so this reads the sheets as they are imported.
  // Utilities Tailwind emits only when something uses them are out of its reach
  // — it guards what `index.css` and its imports declare, not everything the
  // app could compile.
  it('imports no stylesheet that keys a rule off the OS preference', async () => {
    const stylesheet = await compileStylesheet([])

    expect(stylesheet).not.toContain('prefers-color-scheme')
  })
})
