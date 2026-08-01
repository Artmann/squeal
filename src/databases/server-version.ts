// The status bar wants a short product label ("PostgreSQL 16"), but the
// drivers report the version with the vendor's build noise attached — Postgres
// adds the packager ("16.2 (Debian 16.2-1.pgdg120+2)"), MySQL the distribution
// ("8.0.36-0ubuntu0.22.04.1"). These helpers do the normalization and stay free
// of driver imports so they can be unit tested on their own.

interface VersionParts {
  major: number
  minor: number | undefined
}

// MariaDB still answers clients with a "5.5.5-" prefix in front of its real
// version, a compatibility hack from the days when clients refused to talk to
// a server claiming to be 10.x. Strip it or every MariaDB 10 reads as 5.5.
const mariaDbPrefixPattern = /^5\.5\.5-/

// Anchored at the start: every driver reports the version first, so matching
// anywhere in the string would pick up a build number from the trailing noise.
const versionPattern = /^\s*v?(\d+)(?:\.(\d+))?/

export function formatMysqlServerVersion(
  rawVersion: string
): string | undefined {
  // MariaDB speaks the MySQL protocol and names itself inside the same string;
  // labelling it "MySQL" would report a product the user is not running.
  const isMariaDb = rawVersion.toLowerCase().includes('mariadb')
  const parts = parseVersion(
    isMariaDb ? rawVersion.replace(mariaDbPrefixPattern, '') : rawVersion
  )

  if (parts === undefined) {
    return undefined
  }

  return `${isMariaDb ? 'MariaDB' : 'MySQL'} ${toReleaseNumber(parts)}`
}

export function formatPostgresServerVersion(
  rawVersion: string
): string | undefined {
  const parts = parseVersion(rawVersion)

  if (parts === undefined) {
    return undefined
  }

  // Postgres only moved to a single-number major release at 10, so 16.2 is
  // release 16 while 9.6.24 is release 9.6 — reporting "PostgreSQL 9" would
  // name a release that never existed.
  if (parts.major < 10) {
    return `PostgreSQL ${toReleaseNumber(parts)}`
  }

  return `PostgreSQL ${parts.major}`
}

export function formatSqliteServerVersion(
  rawVersion: string
): string | undefined {
  const parts = parseVersion(rawVersion)

  if (parts === undefined) {
    return undefined
  }

  return `SQLite ${toReleaseNumber(parts)}`
}

// The version probe is best effort — its caller turns a rejection into "no
// version" — so a string we cannot make sense of fails here instead of putting
// something meaningless in front of the user.
export function requireServerVersion(
  formatted: string | undefined,
  rawVersion: string
): string {
  if (formatted === undefined) {
    throw new Error(
      `The database server reported an unrecognized version string: "${rawVersion}".`
    )
  }

  return formatted
}

function parseVersion(rawVersion: string): VersionParts | undefined {
  const match = versionPattern.exec(rawVersion)

  if (match === null) {
    return undefined
  }

  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? undefined : Number(match[2])
  }
}

function toReleaseNumber(parts: VersionParts): string {
  if (parts.minor === undefined) {
    return String(parts.major)
  }

  return `${parts.major}.${parts.minor}`
}
