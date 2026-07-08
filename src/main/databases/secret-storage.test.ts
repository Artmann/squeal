import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockDecryptString, mockEncryptString, mockIsEncryptionAvailable } =
  vi.hoisted(() => ({
    mockDecryptString: vi.fn(),
    mockEncryptString: vi.fn(),
    mockIsEncryptionAvailable: vi.fn()
  }))

vi.mock('electron', () => ({
  safeStorage: {
    decryptString: mockDecryptString,
    encryptString: mockEncryptString,
    isEncryptionAvailable: mockIsEncryptionAvailable
  }
}))

import { isEncrypted, safeStorageSecretStorage } from './secret-storage'

describe('secretStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mockIsEncryptionAvailable.mockReturnValue(true)
    mockEncryptString.mockImplementation((value: string) =>
      Buffer.from(`sealed(${value})`)
    )
    mockDecryptString.mockImplementation((value: Buffer) => {
      const match = /^sealed\((.*)\)$/.exec(value.toString())

      if (!match) {
        throw new Error('Not encrypted with this key.')
      }

      return match[1]
    })
  })

  describe('encrypt', () => {
    it('prefixes encrypted values with enc:v1:', () => {
      const encrypted = safeStorageSecretStorage.encrypt('{"password":"x"}')

      expect(encrypted).toEqual(
        `enc:v1:${Buffer.from('sealed({"password":"x"})').toString('base64')}`
      )
    })

    it('falls back to plaintext when encryption is unavailable', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)

      const encrypted = safeStorageSecretStorage.encrypt('{"password":"x"}')

      expect(encrypted).toEqual('{"password":"x"}')
      expect(mockEncryptString).not.toHaveBeenCalled()
    })
  })

  describe('decrypt', () => {
    it('round-trips an encrypted value', () => {
      const encrypted = safeStorageSecretStorage.encrypt('{"password":"x"}')

      expect(safeStorageSecretStorage.decrypt(encrypted)).toEqual(
        '{"password":"x"}'
      )
    })

    it('passes legacy plaintext values through unchanged', () => {
      expect(safeStorageSecretStorage.decrypt('{"password":"x"}')).toEqual(
        '{"password":"x"}'
      )
      expect(mockDecryptString).not.toHaveBeenCalled()
    })
  })

  describe('isEncrypted', () => {
    it('detects the encrypted prefix', () => {
      expect(isEncrypted('enc:v1:abc')).toEqual(true)
      expect(isEncrypted('{"password":"x"}')).toEqual(false)
    })
  })
})
