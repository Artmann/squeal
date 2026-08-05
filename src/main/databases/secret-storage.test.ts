import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockDecryptString,
  mockEncryptString,
  mockGetSelectedStorageBackend,
  mockIsEncryptionAvailable
} = vi.hoisted(() => ({
  mockDecryptString: vi.fn(),
  mockEncryptString: vi.fn(),
  mockGetSelectedStorageBackend: vi.fn(),
  mockIsEncryptionAvailable: vi.fn()
}))

vi.mock('electron', () => ({
  safeStorage: {
    decryptString: mockDecryptString,
    encryptString: mockEncryptString,
    getSelectedStorageBackend: mockGetSelectedStorageBackend,
    isEncryptionAvailable: mockIsEncryptionAvailable
  }
}))

import {
  isEncrypted,
  probeEncryption,
  safeStorageSecretStorage,
  setSecretStorageMode
} from './secret-storage'

const realPlatform = process.platform

function stubPlatform(platform: string): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform
  })
}

describe('secretStorage', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // The module defaults to 'undecided'; most cases are about the granted
    // behaviour, so they opt in explicitly.
    setSecretStorageMode('keychain')

    mockIsEncryptionAvailable.mockReturnValue(true)
    mockGetSelectedStorageBackend.mockReturnValue('gnome_libsecret')
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

  afterEach(() => {
    stubPlatform(realPlatform)
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

    it.each(['plaintext', 'undecided'] as const)(
      'stores plaintext without touching the keychain in %s mode',
      (mode) => {
        setSecretStorageMode(mode)

        const encrypted = safeStorageSecretStorage.encrypt('{"password":"x"}')

        expect(encrypted).toEqual('{"password":"x"}')
        expect(mockIsEncryptionAvailable).not.toHaveBeenCalled()
        expect(mockEncryptString).not.toHaveBeenCalled()
      }
    )
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

    it.each(['plaintext', 'undecided'] as const)(
      'refuses an encrypted value without touching the keychain in %s mode',
      (mode) => {
        const encrypted = safeStorageSecretStorage.encrypt('{"password":"x"}')

        setSecretStorageMode(mode)
        mockDecryptString.mockClear()

        expect(() => safeStorageSecretStorage.decrypt(encrypted)).toThrow(
          'does not have permission'
        )
        expect(mockDecryptString).not.toHaveBeenCalled()
      }
    )

    it.each(['plaintext', 'undecided'] as const)(
      'still passes plaintext through in %s mode',
      (mode) => {
        setSecretStorageMode(mode)

        expect(safeStorageSecretStorage.decrypt('{"password":"x"}')).toEqual(
          '{"password":"x"}'
        )
      }
    )
  })

  describe('probeEncryption', () => {
    it('reports available after a clean round trip', () => {
      expect(probeEncryption()).toEqual('available')
    })

    it('probes even while no decision has been made', () => {
      setSecretStorageMode('undecided')

      expect(probeEncryption()).toEqual('available')
      expect(mockEncryptString).toHaveBeenCalled()
    })

    it('reports unavailable when the keychain has no key', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)

      expect(probeEncryption()).toEqual('unavailable')
      expect(mockEncryptString).not.toHaveBeenCalled()
    })

    it('reports unavailable when sealing throws', () => {
      mockEncryptString.mockImplementation(() => {
        throw new Error('User denied keychain access.')
      })

      expect(probeEncryption()).toEqual('unavailable')
    })

    it('reports unavailable when the round trip does not match', () => {
      mockDecryptString.mockReturnValue('something else')

      expect(probeEncryption()).toEqual('unavailable')
    })

    it('reports noKeyring for the Linux plaintext backend', () => {
      stubPlatform('linux')
      mockGetSelectedStorageBackend.mockReturnValue('basic_text')

      expect(probeEncryption()).toEqual('noKeyring')
      expect(mockEncryptString).not.toHaveBeenCalled()
    })

    it('does not ask for a storage backend off Linux', () => {
      stubPlatform('darwin')

      expect(probeEncryption()).toEqual('available')
      expect(mockGetSelectedStorageBackend).not.toHaveBeenCalled()
    })
  })

  describe('isEncrypted', () => {
    it('detects the encrypted prefix', () => {
      expect(isEncrypted('enc:v1:abc')).toEqual(true)
      expect(isEncrypted('{"password":"x"}')).toEqual(false)
    })
  })
})
