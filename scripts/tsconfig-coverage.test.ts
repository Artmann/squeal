import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { join } from 'path'
import invariant from 'tiny-invariant'
import { describe, expect, it } from 'vitest'

import {
  normalize,
  typecheckedProjects,
  uncoveredFiles
} from './tsconfig-coverage'

const repositoryRoot = join(import.meta.dirname, '..')

describe('uncoveredFiles', () => {
  it('names a file no project resolved', () => {
    expect(
      uncoveredFiles(
        ['scripts/seed.ts', 'src/main.ts'],
        [{ files: ['./src/main.ts'], name: 'tsconfig.renderer.json' }]
      )
    ).toEqual(['scripts/seed.ts'])
  })

  it('says nothing when every file is in some project', () => {
    expect(
      uncoveredFiles(
        ['scripts/seed.ts', 'src/main.ts'],
        [
          { files: ['./scripts/seed.ts'], name: 'tsconfig.tooling.json' },
          { files: ['./src/main.ts'], name: 'tsconfig.renderer.json' }
        ]
      )
    ).toEqual([])
  })

  // `tsc --showConfig` writes the paths it resolved with a `./` on the front
  // and `git ls-files` does not, so a comparison that took them at face value
  // would report every file in the repository.
  it('reads a resolved path as the file git names without the prefix', () => {
    expect(
      uncoveredFiles(
        ['src/main.ts'],
        [{ files: ['./src/main.ts'], name: 'tsconfig.renderer.json' }]
      )
    ).toEqual([])
  })

  // Neither producer spells a path with a backslash today — `git ls-files` and
  // `tsc --showConfig` both emit forward slashes, on Windows included. This is
  // what says the comparison does not depend on that staying true: a separator
  // is a separator, not a different file, so the guard can never answer "add
  // every file in the repository to a project" over a spelling.
  it('reads a windows separator as the same file', () => {
    expect(
      uncoveredFiles(
        ['src/main.ts'],
        [{ files: ['.\\src\\main.ts'], name: 'tsconfig.renderer.json' }]
      )
    ).toEqual([])
  })

  // Missing from every project is still one missing file, not one per project.
  it('names a file once however many projects leave it out', () => {
    expect(
      uncoveredFiles(
        ['forge.config.ts'],
        [
          { files: ['./src/main.ts'], name: 'tsconfig.renderer.json' },
          { files: ['./src/server/runtime.ts'], name: 'tsconfig.backend.json' }
        ]
      )
    ).toEqual(['forge.config.ts'])
  })

  it('names what it found in one order', () => {
    expect(uncoveredFiles(['vitest.config.ts', 'forge.config.ts'], [])).toEqual(
      ['forge.config.ts', 'vitest.config.ts']
    )
  })
})

describe('typecheckedProjects', () => {
  it('names the project a command line checks', () => {
    expect(
      typecheckedProjects('tsc --noEmit -p tsconfig.backend.json')
    ).toEqual(['tsconfig.backend.json'])
  })

  it('names every project in a chain', () => {
    expect(
      typecheckedProjects(
        'tsc --noEmit -p tsconfig.backend.json && tsc --noEmit -p tsconfig.renderer.json'
      )
    ).toEqual(['tsconfig.backend.json', 'tsconfig.renderer.json'])
  })

  it('reads the long spelling of the project option', () => {
    expect(typecheckedProjects('tsc --project tsconfig.tooling.json')).toEqual([
      'tsconfig.tooling.json'
    ])
  })

  // `tsconfig.json`'s references write the same paths with a `./` on the front,
  // and a command line may too — `tsc -p ./tsconfig.backend.json` typechecks
  // exactly the same project. Read literally, the guard below would call that a
  // disagreement about which projects exist and say so in those words.
  it('reads a project named with a leading prefix as the same project', () => {
    expect(
      typecheckedProjects('tsc --noEmit -p ./tsconfig.backend.json')
    ).toEqual(['tsconfig.backend.json'])
  })

  it('reads the joined spelling of the project option', () => {
    expect(typecheckedProjects('tsc --project=tsconfig.tooling.json')).toEqual([
      'tsconfig.tooling.json'
    ])
  })

  it('finds nothing in a command line that checks no project', () => {
    expect(typecheckedProjects('tsc --noEmit')).toEqual([])
  })
})

// `yarn typecheck` is only as wide as the projects it runs, and a file in none
// of them is not checked by anything: it compiles when someone runs it and not
// before. That is how `scripts/seed.ts` went unchecked for the life of the
// repository.
//
// The projects are read out of `tsconfig.json`'s references rather than listed
// here, so the references block is what the guard and the editor both go by. A
// fourth project has to be referenced for this to see it, which is the same
// step that makes it real.
describe('the typecheck projects', () => {
  const references = (
    JSON.parse(
      readFileSync(join(repositoryRoot, 'tsconfig.json'), 'utf-8')
    ) as { references: { path: string }[] }
  ).references.map((reference) => reference.path)

  // `--showConfig` resolves the include globs and prints the result without
  // typechecking anything, so this is the compiler's own answer to "which files
  // is this project" rather than a reimplementation of its glob rules.
  const projects = references.map((path) => {
    const configuration = JSON.parse(
      execFileSync(
        process.execPath,
        [
          join(repositoryRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
          '--showConfig',
          '-p',
          path
        ],
        { cwd: repositoryRoot, encoding: 'utf-8', timeout: 15_000 }
      )
    ) as {
      compilerOptions: {
        lib?: string[]
        noEmit?: boolean
        strict?: boolean
      }
      files?: string[]
    }

    return {
      compilerOptions: configuration.compilerOptions,
      files: configuration.files ?? [],
      name: path
    }
  })

  const repositoryFiles = execFileSync('git', ['ls-files', '*.ts', '*.tsx'], {
    cwd: repositoryRoot,
    encoding: 'utf-8',
    timeout: 15_000
  })
    .split('\n')
    .filter((line) => line.length > 0)

  it('covers every TypeScript file in the repository', () => {
    expect(
      uncoveredFiles(repositoryFiles, projects),
      'These files are in no tsconfig project, so `yarn typecheck` never sees them. Add them to the include list of whichever project fits — `tsconfig.tooling.json` for build scripts and root configs — or, if a file is genuinely not meant to compile, say so where it lives rather than by leaving it out.'
    ).toEqual([])
  })

  // An empty result above is what a passing repository looks like and also what
  // a guard reading nothing looks like. These are what tell them apart: three
  // projects that each really resolved the files they exist for.
  it('reads the files each project resolved', () => {
    expect({
      backend: projects
        .find((project) => project.name.includes('backend'))
        ?.files.includes('./src/server/runtime.ts'),
      renderer: projects
        .find((project) => project.name.includes('renderer'))
        ?.files.includes('./src/app/App.tsx'),
      tooling: projects
        .find((project) => project.name.includes('tooling'))
        ?.files.includes('./scripts/seed.ts')
    }).toEqual({ backend: true, renderer: true, tooling: true })
  })

  // The tooling project overrides three things from the base config, and
  // nothing else in the repository notices when one of them goes. Without
  // `strict` a build script can dereference an undefined value; without the
  // narrowed `lib` it can reference `document` and compile against a DOM that
  // is not there at runtime; without `noEmit` a bare
  // `tsc -p tsconfig.tooling.json` writes into `dist`. Every one of those
  // survives all three typechecks and every other case in this file, so the
  // overrides are read back from the config the compiler resolved.
  //
  // Only the tooling project, deliberately. `tsconfig.backend.json` inherits
  // the base `dom` too and has the same problem, but changing what the backend
  // compiles against is a separate change with its own failures to work
  // through.
  it('checks the tooling project the way it says it does', () => {
    const tooling = projects.find((project) => project.name.includes('tooling'))

    invariant(tooling, 'tsconfig.json references no tooling project.')

    expect(tooling.compilerOptions).toMatchObject({
      noEmit: true,
      strict: true
    })
    expect(tooling.compilerOptions.lib).toEqual(['esnext'])
  })

  it('reads the repository file list', () => {
    expect(repositoryFiles).toContain('scripts/seed.ts')
  })

  // Being referenced is not being checked. The references block is what the
  // editor and the guard above read, and `yarn typecheck` is a separate command
  // line that has to name each project again — a fourth project added to one
  // and not the other looks covered here while CI never compiles it.
  it('are the projects the typecheck script runs', () => {
    const manifest = JSON.parse(
      readFileSync(join(repositoryRoot, 'package.json'), 'utf-8')
    ) as { scripts: Record<string, string> }

    expect(
      typecheckedProjects(manifest.scripts.typecheck).sort(),
      "The `typecheck` script and `tsconfig.json`'s references disagree about which projects exist. Every referenced project needs its own `tsc --noEmit -p` in the script, or CI never compiles it."
    ).toEqual(references.map(normalize).sort())
  })
})
