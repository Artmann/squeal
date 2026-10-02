import { readdirSync, readFileSync } from 'fs'
import { dirname, join, matchesGlob, relative, resolve, sep } from 'path'
import invariant from 'tiny-invariant'
import { describe, expect, it } from 'vitest'

import { backendTestPatterns } from '../vitest.projects'

// `backendTestPatterns` is a list of folders someone remembered to add. The
// renderer project is everything else, so a folder that was forgotten does not
// fail anywhere: its tests run under jsdom and pass, with `window` and
// `document` defined for code that will never see either. That is how
// `src/databases` -- the adapters, imported by `src/server` -- ran in the
// project called `renderer`.
//
// So the list is checked against the imports instead. Every top-level folder
// that the main process or the backend imports from is main-process code, and
// every test in it belongs to the backend project. `src/app` is the one folder
// that may never be on that list: it is the renderer.
describe('vitest projects', () => {
  const root = resolve(import.meta.dirname, '..')
  const source = join(root, 'src')

  // The encoding is what keeps this `string[]`; without it the
  // version-agnostic overload widens to `Buffer[]`.
  const sourceFiles = readdirSync(source, {
    encoding: 'utf-8',
    recursive: true
  })
    .filter((entry) => /\.tsx?$/.test(entry))
    .map((entry) => entry.split(sep).join('/'))

  const mainProcessFiles = sourceFiles.filter(
    (file) =>
      file === 'main.ts' ||
      file.startsWith('main/') ||
      file.startsWith('server/')
  )

  // The top-level folder under `src/` that an import specifier points at, or
  // undefined for a package import or a file directly in `src/`.
  function importedFolder(file: string, specifier: string): string | undefined {
    if (specifier.startsWith('@/')) {
      const segments = specifier.slice(2).split('/')

      return segments.length > 1 ? segments[0] : undefined
    }

    if (!specifier.startsWith('.')) {
      return undefined
    }

    const target = relative(source, resolve(source, dirname(file), specifier))
    const segments = target.split(sep)

    return segments.length > 1 ? segments[0] : undefined
  }

  function isBackendTest(file: string): boolean {
    return backendTestPatterns.some((pattern) => matchesGlob(file, pattern))
  }

  const importedFolders = [
    ...new Set(
      mainProcessFiles.flatMap((file) => {
        const contents = readFileSync(join(source, file), 'utf-8')
        const specifiers = [
          ...contents.matchAll(/(?:from|import|mock)\s*\(?\s*'([^']+)'/g)
        ].map((match) => match[1])

        return specifiers
          .map((specifier) => importedFolder(file, specifier))
          .filter((folder) => folder !== undefined)
      })
    )
  ].sort()

  it('finds the imports it checks', () => {
    invariant(
      mainProcessFiles.includes('server/runtime.ts'),
      'The walk of src/ did not find server/runtime.ts, so it read nothing and the assertions below prove nothing.'
    )

    expect(importedFolders).toContain('server')
  })

  it('never puts the renderer in the backend project', () => {
    expect(importedFolders).not.toContain('app')
  })

  it('runs every test in a folder the backend imports from under node', () => {
    const misplaced = sourceFiles
      .filter((file) => /\.test\.tsx?$/.test(file))
      .filter((file) => importedFolders.includes(file.split('/')[0]))
      .map((file) => `src/${file}`)
      .filter((file) => !isBackendTest(file))

    expect(misplaced).toEqual([])
  })
})
