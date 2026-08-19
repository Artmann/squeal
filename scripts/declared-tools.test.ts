import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

import {
  invokedTools,
  toolsInvokedByScript,
  unpinnedNpxTools
} from './declared-tools'

const repositoryRoot = join(import.meta.dirname, '..')

describe('invokedTools', () => {
  it('reports what the scripts run and what the workflows fetch', () => {
    expect(
      invokedTools({
        scripts: { format: 'prettier --write .' },
        workflows: ['      - name: Audit\n        run: npx license-checker\n']
      })
    ).toEqual(['license-checker', 'prettier'])
  })

  it('reports a tool both places name only once', () => {
    expect(
      invokedTools({
        scripts: { format: 'prettier --write .' },
        workflows: ['        run: npx prettier --check .\n']
      })
    ).toEqual(['prettier'])
  })
})

describe('toolsInvokedByScript', () => {
  it('names the command a script runs', () => {
    expect(toolsInvokedByScript('prettier --write .')).toEqual(['prettier'])
  })

  it('names the command in every segment of a chain', () => {
    expect(
      toolsInvokedByScript(
        'tsx scripts/fetch-macos-bindings.ts && electron-forge make'
      )
    ).toEqual(['electron-forge', 'tsx'])
  })

  it('names a command once however often a script runs it', () => {
    expect(
      toolsInvokedByScript(
        'tsc --noEmit -p tsconfig.backend.json && tsc --noEmit -p tsconfig.renderer.json'
      )
    ).toEqual(['tsc'])
  })

  it('looks past an environment assignment', () => {
    expect(toolsInvokedByScript('NODE_ENV=test vitest run')).toEqual(['vitest'])
  })

  it('ignores the runtimes the machine already has', () => {
    expect(toolsInvokedByScript('bun run scripts/generate-icons.ts')).toEqual(
      []
    )
  })

  it('names what npx would fetch rather than npx', () => {
    expect(toolsInvokedByScript('npx prettier --check .')).toEqual(['prettier'])
  })

  it('says nothing about an npx invocation that pins its own version', () => {
    expect(toolsInvokedByScript('npx --yes fallow@3.2.0')).toEqual([])
  })
})

describe('unpinnedNpxTools', () => {
  it('finds an npx invocation inside a shell block', () => {
    expect(
      unpinnedNpxTools('yarn install --frozen-lockfile\nnpx prettier --check .')
    ).toEqual(['prettier'])
  })

  it('leaves a pinned invocation alone', () => {
    expect(unpinnedNpxTools('npx --yes fallow@3.2.0')).toEqual([])
  })

  it('leaves a scoped pinned invocation alone', () => {
    expect(unpinnedNpxTools('npx --yes @biomejs/biome@2.0.0 check')).toEqual([])
  })

  it('reports a scoped package with no version', () => {
    expect(unpinnedNpxTools('npx @biomejs/biome check')).toEqual([
      '@biomejs/biome'
    ])
  })

  // A scope may begin with a digit, so a specifier's leading `@` cannot be read
  // as the start of a version even by shape — `@11ty/eleventy` would otherwise
  // pass for a pinned invocation and drop off the list entirely.
  it('reports a scoped package whose scope begins with a digit', () => {
    expect(unpinnedNpxTools('npx @11ty/eleventy --serve')).toEqual([
      '@11ty/eleventy'
    ])
  })

  it('finds nothing in a block that runs no npx', () => {
    expect(unpinnedNpxTools('yarn typecheck')).toEqual([])
  })

  // A tag is the float this guard is for, not an exemption from it. Reported
  // under the name it was written with, because that is the thing invoked and
  // nothing declares it — `prettier` being in devDependencies does not constrain
  // what `@latest` fetches.
  it('reports an invocation pinned to a tag rather than a version', () => {
    expect(unpinnedNpxTools('npx prettier@latest --check .')).toEqual([
      'prettier@latest'
    ])
  })

  it('reports a prerelease version as pinned', () => {
    expect(unpinnedNpxTools('npx fallow@4.0.0-beta.1')).toEqual([])
  })

  // The command after `--package` is a bin inside it, and a bin name is not what
  // a dependency list declares — `tsc` would be reported as undeclared while
  // `typescript` sat in devDependencies.
  it('names the package an invocation asks for rather than the bin', () => {
    expect(unpinnedNpxTools('npx --package=typescript tsc --noEmit')).toEqual([
      'typescript'
    ])
  })

  // Which needs nothing of its own to work, the package being the first token
  // that is not an option — but it is the spelling this repository would most
  // likely be written with, so it is held down.
  it('reads the spaced spelling of the package option', () => {
    expect(unpinnedNpxTools('npx -p typescript tsc --noEmit')).toEqual([
      'typescript'
    ])
  })
})

// The version of a tool the repository runs is part of the repository, not of
// whatever the registry served the day a job happened to run. A tool that is
// invoked but not declared has no version of its own here: it is whatever
// yarn.lock happens to hold for some other package's range, or — where nothing
// depends on it at all — whatever the registry serves. The lockfile keeps that
// deterministic between installs, so this is not a live CI failure; what it
// means is that the version this project formats and lints against is chosen by
// someone else, and moves when their range does or when the lockfile is
// regenerated.
//
// Only two places are checked, because they are the two that run this project's
// own Node tooling: every package.json script, and every `npx` anywhere in the
// workflows. The shell blocks in release.yml reach for `openssl`, `xcrun` and
// `find`, which the runner image owns and package.json has no say over.
describe('the tools this repository invokes', () => {
  const manifest = JSON.parse(
    readFileSync(join(repositoryRoot, 'package.json'), 'utf-8')
  ) as {
    dependencies: Record<string, string>
    devDependencies: Record<string, string>
    scripts: Record<string, string>
  }

  const declaredPackages = [
    ...Object.keys(manifest.dependencies),
    ...Object.keys(manifest.devDependencies)
  ]

  // Which package provides which command, read off the installed tree rather
  // than written down here — a hand-kept map of `tsc` to `typescript` would be
  // one more thing to get wrong.
  const providers = new Map<string, string>()

  for (const packageName of declaredPackages) {
    const manifestPath = join(
      repositoryRoot,
      'node_modules',
      packageName,
      'package.json'
    )

    if (!existsSync(manifestPath)) {
      continue
    }

    const installed = JSON.parse(readFileSync(manifestPath, 'utf-8')) as {
      bin?: Record<string, string> | string
    }

    if (typeof installed.bin === 'string') {
      providers.set(packageName.split('/').at(-1) ?? packageName, packageName)

      continue
    }

    for (const binaryName of Object.keys(installed.bin ?? {})) {
      providers.set(binaryName, packageName)
    }
  }

  const workflowsDirectory = join(repositoryRoot, '.github', 'workflows')
  const invoked = invokedTools({
    scripts: manifest.scripts,
    workflows: readdirSync(workflowsDirectory).map((fileName) =>
      readFileSync(join(workflowsDirectory, fileName), 'utf-8')
    )
  })

  it.each(invoked)('%s is a declared dependency', (tool) => {
    expect(
      { tool, provider: providers.get(tool) },
      `\`${tool}\` is invoked by a package.json script or a workflow, but no declared dependency provides a bin by that name. Add the package that owns it to devDependencies with an exact version — or, if it is \`name@latest\`, name the version instead of the tag.`
    ).toEqual({ tool, provider: expect.any(String) })
  })

  // An empty list would satisfy every assertion above, and so would a list that
  // had quietly stopped covering package.json. `electron-forge` is named by four
  // scripts and by nothing else, so it is the one tool whose presence says the
  // scripts were read.
  it('reads the package.json scripts', () => {
    expect(invoked).toContain('electron-forge')
  })

  // And the same for the other half. Every tool the workflows reach for through
  // `npx` is also named by a script, so the union above would look identical if
  // the workflow scan silently stopped matching — this is the one assertion that
  // fails when it does.
  it('reads the workflows', () => {
    const workflow = readFileSync(join(workflowsDirectory, 'ci.yml'), 'utf-8')

    expect(unpinnedNpxTools(workflow)).toEqual(['prettier'])
  })
})
