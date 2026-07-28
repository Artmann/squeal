import fs from 'fs'

import type { SslMode } from './schemas'

export interface SslOptions {
  ca?: string
  checkServerIdentity?: () => undefined
  rejectUnauthorized: boolean
}

interface SslConnectionInfo {
  sslMode?: SslMode
  sslRootCert?: string
}

// Largest realistic corporate CA bundle; anything bigger is a mistake (or a
// device file) and would otherwise be slurped into memory.
const maxRootCertificateBytes = 1024 * 1024

// Maps the shared sslMode/sslRootCert connection fields to the ssl options
// both pg and mysql2 accept. Returns undefined when TLS is disabled.
export function createSslOptions(
  connectionInfo: SslConnectionInfo
): SslOptions | undefined {
  const { sslMode, sslRootCert } = connectionInfo

  if (!sslMode || sslMode === 'disable') {
    return undefined
  }

  // libpq parity: 'require' encrypts but does not verify the server's
  // identity. Users who want verification pick verify-ca or verify-full.
  if (sslMode === 'require') {
    return { rejectUnauthorized: false }
  }

  const ca =
    sslRootCert && sslRootCert !== 'system'
      ? readRootCertificate(sslRootCert)
      : undefined

  // verify-ca validates the certificate chain but not the hostname. Both pg
  // and mysql2 hand these options to tls.connect, where a checkServerIdentity
  // returning undefined skips the hostname check.
  if (sslMode === 'verify-ca') {
    return {
      ...(ca === undefined ? {} : { ca }),
      checkServerIdentity: () => undefined,
      rejectUnauthorized: true
    }
  }

  // verify-full
  return {
    ...(ca === undefined ? {} : { ca }),
    rejectUnauthorized: true
  }
}

function readRootCertificate(filePath: string): string {
  let stats: fs.Stats

  try {
    stats = fs.statSync(filePath)
  } catch {
    throw new Error(
      `Could not read CA certificate at ${filePath}: the file does not exist.`
    )
  }

  if (!stats.isFile()) {
    throw new Error(
      `Could not read CA certificate at ${filePath}: the path is not a file.`
    )
  }

  if (stats.size > maxRootCertificateBytes) {
    throw new Error(
      `Could not read CA certificate at ${filePath}: the file is larger than 1 MB.`
    )
  }

  return fs.readFileSync(filePath).toString()
}
