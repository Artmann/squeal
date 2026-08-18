// Puts both of libsql's macOS native bindings into node_modules, so a universal
// build can be stitched together.
//
// `electron-forge make --arch=universal` packages an x64 slice and an arm64
// slice and then merges them, and @electron/universal aborts the merge when a
// Mach-O file exists in only one of the two. Both slices are packaged from this
// machine's node_modules — forge's `packageAfterCopy` hook copies the
// externalized packages straight out of it — so the tree has to carry the
// binding for the other macOS architecture as well as its own. yarn will not
// install it: each binding is an optional dependency of `libsql` marked with the
// `os` and `cpu` it belongs to, and only one of them matches this machine.
//
// Carrying both is correct at runtime too. libsql resolves its binding with
// `require(`@libsql/${currentTarget()}`)`, so the merged app picks the right one
// for whichever architecture it ends up running as.
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const bindings = ['@libsql/darwin-arm64', '@libsql/darwin-x64']

// tsx runs this as CommonJS, where `import.meta.dirname` is undefined but
// `import.meta.url` is shimmed, so the URL is the portable way to get here.
const scriptDirectory = dirname(fileURLToPath(import.meta.url))

const nodeModules = resolve(scriptDirectory, '..', 'node_modules')

function packagePath(packageName: string): string {
  return join(nodeModules, ...packageName.split('/'))
}

function readVersion(packageName: string): string | null {
  const packageJsonPath = join(packagePath(packageName), 'package.json')

  if (!existsSync(packageJsonPath)) {
    return null
  }

  const packageJson: unknown = JSON.parse(
    readFileSync(packageJsonPath, 'utf-8')
  )
  const version = (packageJson as { version?: unknown }).version

  return typeof version === 'string' ? version : null
}

function readLibsqlOptionalDependencies(): Record<string, string> {
  const packageJsonPath = join(nodeModules, 'libsql', 'package.json')

  if (!existsSync(packageJsonPath)) {
    throw new Error(
      'Cannot prepare a universal macOS build: node_modules/libsql is missing. Run `yarn install` first.'
    )
  }

  const packageJson: unknown = JSON.parse(
    readFileSync(packageJsonPath, 'utf-8')
  )

  return (
    (packageJson as { optionalDependencies?: Record<string, string> })
      .optionalDependencies ?? {}
  )
}

// The versions libsql itself pins, so the binding for the other architecture can
// never drift from the one this machine already has.
function readPinnedVersions(): Record<string, string> {
  const optional = readLibsqlOptionalDependencies()
  const pinned: Record<string, string> = {}

  for (const binding of bindings) {
    const version = optional[binding]

    if (typeof version !== 'string') {
      throw new Error(
        `Cannot prepare a universal macOS build: libsql does not list ${binding} in its optionalDependencies. Check whether libsql changed how it ships its native bindings.`
      )
    }

    pinned[binding] = version
  }

  return pinned
}

function lastLine(output: string): string {
  return (output.trim().split('\n').at(-1) ?? '').trim()
}

// npm prints the tarball's name on stdout — its notices go to stderr — so the
// name never has to be guessed from the package and the version.
function pack(
  packageName: string,
  version: string,
  downloadDirectory: string
): string {
  let output = ''

  try {
    output = execFileSync(
      'npm',
      [
        'pack',
        `${packageName}@${version}`,
        '--pack-destination',
        downloadDirectory
      ],
      { encoding: 'utf-8' }
    )
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)

    throw new Error(
      `Cannot prepare a universal macOS build: fetching ${packageName}@${version} failed. ${reason} Check network access to the npm registry and retry.`
    )
  }

  const tarball = lastLine(output)

  if (tarball === '') {
    throw new Error(
      `Cannot prepare a universal macOS build: \`npm pack ${packageName}@${version}\` did not report a tarball name. Run it by hand to see what npm printed.`
    )
  }

  return join(downloadDirectory, tarball)
}

function download(packageName: string, version: string): void {
  const destination = packagePath(packageName)
  const downloadDirectory = mkdtempSync(join(tmpdir(), 'squeal-bindings-'))

  try {
    const tarball = pack(packageName, version, downloadDirectory)

    // The tarball wraps everything in a `package/` directory, which is what
    // --strip-components drops.
    mkdirSync(destination, { recursive: true })

    execFileSync('tar', [
      '-xzf',
      tarball,
      '-C',
      destination,
      '--strip-components=1'
    ])
  } finally {
    rmSync(downloadDirectory, { force: true, recursive: true })
  }
}

function main(): void {
  const pinned = readPinnedVersions()

  for (const binding of bindings) {
    const version = pinned[binding]

    if (readVersion(binding) === version) {
      console.log(`${binding}@${version} is already installed.`)

      continue
    }

    console.log(`Downloading ${binding}@${version}...`)

    download(binding, version)

    console.log(`  Installed into node_modules/${binding}.`)
  }
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))

  process.exit(1)
}
