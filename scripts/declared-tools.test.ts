import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, it } from 'vitest'

import {
  invokedTools,
  npxSpecifiers,
  toolsInvokedByScript,
  unpinnedNpxTools,
  yarnScripts
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

describe('npxSpecifiers', () => {
  it('names what an unpinned invocation would fetch', () => {
    expect(npxSpecifiers('npx prettier --check .')).toEqual(['prettier'])
  })

  // Kept whole, where `unpinnedNpxTools` drops the invocation entirely. A
  // repository whose every `npx` names its own version gives that function
  // nothing to return, and a guard reading only what the scan rejected cannot
  // then tell "the workflows are clean" from "the scan stopped matching".
  it('names a pinned invocation with the version it pins', () => {
    expect(npxSpecifiers('npx --yes fallow@3.2.0')).toEqual(['fallow@3.2.0'])
  })

  it('names the package an invocation asks for rather than the bin', () => {
    expect(npxSpecifiers('npx --package=typescript tsc --noEmit')).toEqual([
      'typescript'
    ])
  })

  it('names an invocation once however often a block runs it', () => {
    expect(
      npxSpecifiers('npx prettier --check .\nnpx prettier --write .')
    ).toEqual(['prettier'])
  })

  it('finds nothing in a block that runs no npx', () => {
    expect(npxSpecifiers('yarn typecheck')).toEqual([])
  })

  it('names every invocation in a block, in one order', () => {
    expect(npxSpecifiers('npx tsx build.ts\nnpx fallow@3.2.0')).toEqual([
      'fallow@3.2.0',
      'tsx'
    ])
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

describe('yarnScripts', () => {
  it('names the script a step runs', () => {
    expect(yarnScripts('        run: yarn typecheck\n')).toEqual(['typecheck'])
  })

  it('names a script whose name carries a colon', () => {
    expect(yarnScripts('run: yarn format:check')).toEqual(['format:check'])
  })

  it('reads the script out of an explicit run', () => {
    expect(yarnScripts('yarn run --silent test')).toEqual(['test'])
  })

  // `install` is yarn's own, and the one every workflow starts with. Reported
  // as a script it would be reported as missing, since package.json declares no
  // such thing and never should.
  it('says nothing about a command yarn answers itself', () => {
    expect(yarnScripts('yarn install --frozen-lockfile')).toEqual([])
  })

  it('says nothing about a bare yarn', () => {
    expect(yarnScripts('        cache: yarn\n')).toEqual([])
  })

  // Prose is scanned along with the steps, because a `run:` value may be a
  // block scalar spanning lines that no line-oriented scan would reach. What
  // keeps the prose out is the shape of a script name: the backticks a comment
  // quotes its commands with are not part of one, and a token that cannot be a
  // script name ends the invocation rather than passing the search to the next
  // word — which would otherwise report the sentence's own vocabulary.
  it('says nothing about a script quoted in a comment', () => {
    expect(
      yarnScripts('# One macOS runner: `yarn make:mac` builds a universal app')
    ).toEqual([])
  })

  it('names a script once however many steps run it', () => {
    expect(yarnScripts('run: yarn test\nrun: yarn test')).toEqual(['test'])
  })

  it('names every script a block runs, in one order', () => {
    expect(yarnScripts('run: yarn typecheck\nrun: yarn lint')).toEqual([
      'lint',
      'typecheck'
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

  // And the same for the workflows, which the two guards below read the same
  // way: both are satisfied by an empty result, so a scan that stopped matching
  // reads exactly like a repository with nothing to report. Neither can say
  // which it is, and this is what asks.
  //
  // Not the version, though — `fallow@3.2.0` is a dependency someone will bump,
  // and a bump is not a scan that stopped working. What must not change is that
  // each scan still finds the invocation ci.yml really makes.
  it('reads the workflows', () => {
    const workflow = readFileSync(join(workflowsDirectory, 'ci.yml'), 'utf-8')

    expect({
      npx: npxSpecifiers(workflow).some((specifier) =>
        specifier.startsWith('fallow@')
      ),
      yarn: yarnScripts(workflow).includes('format:check')
    }).toEqual({ npx: true, yarn: true })
  })

  // The direction that makes moving a command out of `npx` and into a script
  // safe: the script has to be there. Renamed, every workflow that calls it
  // keeps looking correct and fails at the moment CI runs it — with a yarn
  // error naming the script, and nothing naming the five steps that expected
  // it.
  it('runs no script the package.json does not declare', () => {
    const undeclared = readdirSync(workflowsDirectory).flatMap((fileName) =>
      yarnScripts(readFileSync(join(workflowsDirectory, fileName), 'utf-8'))
        .filter((script) => manifest.scripts[script] === undefined)
        .map((script) => ({ script, workflow: fileName }))
    )

    expect(
      undeclared,
      'A workflow runs a yarn script package.json does not declare. Declare it under `scripts`, or — if this is a command yarn answers itself, or a bin it falls back to running out of node_modules — move it into a script so `yarn run` resolves it. The scan reads whole files, so prose can land here too: a comment writing a command name as a bare word after "yarn" is read as an invocation.'
    ).toEqual([])
  })

  // Being declared is not enough for something a workflow reaches through
  // `npx`, which only *prefers* the copy in node_modules. Rename or drop the
  // dependency and the same command fetches whatever the registry serves that
  // day, and the job keeps passing against a version nobody chose. An
  // invocation that pins its own version answers for itself; anything else
  // belongs in a package.json script, where `yarn run` resolves the bin from
  // node_modules and fails outright when it is not there.
  it('fetches nothing a workflow has not pinned', () => {
    const unpinned = readdirSync(workflowsDirectory)
      .map((fileName) => ({
        tools: unpinnedNpxTools(
          readFileSync(join(workflowsDirectory, fileName), 'utf-8')
        ),
        workflow: fileName
      }))
      .filter((entry) => entry.tools.length > 0)

    expect(
      unpinned,
      'A workflow fetches a tool through `npx` without saying which version, so the job runs whatever the registry serves that day. Pin it as `name@1.2.3`, or move the command into a package.json script, where `yarn run` resolves the bin from node_modules and fails outright when it is not there. The scan reads whole files, so prose can land here too: a comment writing a package name as a bare word after "npx" is read as an invocation.'
    ).toEqual([])
  })
})
