import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createSslOptions } from './ssl-options'

describe('createSslOptions', () => {
  let temporaryDirectory: string
  let certificatePath: string

  beforeAll(() => {
    temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ssl-options-'))
    certificatePath = path.join(temporaryDirectory, 'root.crt')

    fs.writeFileSync(certificatePath, 'fake certificate')
  })

  afterAll(() => {
    fs.rmSync(temporaryDirectory, { force: true, recursive: true })
  })

  it('returns undefined when ssl is disabled', () => {
    expect(createSslOptions({ sslMode: 'disable' })).toEqual(undefined)
    expect(createSslOptions({})).toEqual(undefined)
  })

  it('encrypts without verification for require', () => {
    expect(createSslOptions({ sslMode: 'require' })).toEqual({
      rejectUnauthorized: false
    })
  })

  it('verifies the chain but not the hostname for verify-ca', () => {
    const options = createSslOptions({ sslMode: 'verify-ca' })

    expect(options).toEqual({
      checkServerIdentity: expect.any(Function),
      rejectUnauthorized: true
    })
    expect(options?.checkServerIdentity?.()).toEqual(undefined)
  })

  it('verifies fully with the system trust store by default', () => {
    expect(createSslOptions({ sslMode: 'verify-full' })).toEqual({
      rejectUnauthorized: true
    })

    expect(
      createSslOptions({ sslMode: 'verify-full', sslRootCert: 'system' })
    ).toEqual({ rejectUnauthorized: true })
  })

  it('loads a custom root certificate for verify-full', () => {
    expect(
      createSslOptions({
        sslMode: 'verify-full',
        sslRootCert: certificatePath
      })
    ).toEqual({ ca: 'fake certificate', rejectUnauthorized: true })
  })

  it('loads a custom root certificate for verify-ca', () => {
    expect(
      createSslOptions({ sslMode: 'verify-ca', sslRootCert: certificatePath })
    ).toEqual({
      ca: 'fake certificate',
      checkServerIdentity: expect.any(Function),
      rejectUnauthorized: true
    })
  })

  it('reports a missing certificate file clearly', () => {
    const missingPath = path.join(temporaryDirectory, 'missing.crt')

    expect(() =>
      createSslOptions({ sslMode: 'verify-full', sslRootCert: missingPath })
    ).toThrow(
      `Could not read CA certificate at ${missingPath}: the file does not exist.`
    )
  })

  it('rejects a directory as a certificate path', () => {
    expect(() =>
      createSslOptions({
        sslMode: 'verify-full',
        sslRootCert: temporaryDirectory
      })
    ).toThrow(
      `Could not read CA certificate at ${temporaryDirectory}: the path is not a file.`
    )
  })

  it('rejects an oversized certificate file', () => {
    const oversizedPath = path.join(temporaryDirectory, 'oversized.crt')

    fs.writeFileSync(oversizedPath, Buffer.alloc(1024 * 1024 + 1))

    expect(() =>
      createSslOptions({ sslMode: 'verify-full', sslRootCert: oversizedPath })
    ).toThrow(
      `Could not read CA certificate at ${oversizedPath}: the file is larger than 1 MB.`
    )
  })
})
