import fs from 'fs'

import type { SslMode } from './schemas'

export interface SslOptions {
  ca?: string
  rejectUnauthorized: boolean
}

interface SslConnectionInfo {
  sslMode?: SslMode
  sslRootCert?: string
}

// Maps the shared sslMode/sslRootCert connection fields to the ssl options
// both pg and mysql2 accept. Returns undefined when TLS is disabled.
export function createSslOptions(
  connectionInfo: SslConnectionInfo
): SslOptions | undefined {
  const { sslMode, sslRootCert } = connectionInfo

  if (!sslMode || sslMode === 'disable') {
    return undefined
  }

  if (sslMode === 'require') {
    return { rejectUnauthorized: false }
  }

  // verify-full
  if (sslRootCert && sslRootCert !== 'system') {
    return {
      ca: fs.readFileSync(sslRootCert).toString(),
      rejectUnauthorized: true
    }
  }

  return { rejectUnauthorized: true }
}
