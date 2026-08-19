import { log } from 'tiny-typescript-logger'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('tiny-typescript-logger', () => ({
  log: { warn: vi.fn() }
}))

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
  getEncryptionState,
  isEncrypted,
  probeEncryption,
  safeStorageSecretStorage,
  setSecretStorageMode
} from './secret-storage'

const realPlatform = process.platform

function warnings(): string[] {
  return vi.mocked(log.warn).mock.calls.map(([message]) => message)
}

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

  // Three module-level variables used to hold this, so nothing reset the
  // "already warned" latches when the mode changed and the one fact the app
  // learned about a broken keychain went into a boolean nobody read.
  describe('encryptionState', () => {
    it('has no decision and nothing to say before the user answers', () => {
      setSecretStorageMode('undecided')

      expect(getEncryptionState()).toEqual({
        mode: 'undecided',
        warnedAboutPlaintext: false
      })
    })

    // Granting is a fresh start: whatever this process learned while it was
    // storing plaintext was learned about the mode being replaced.
    it('trusts the keychain the moment permission is granted', () => {
      setSecretStorageMode('plaintext')
      safeStorageSecretStorage.encrypt('{"password":"x"}')

      setSecretStorageMode('keychain')

      expect(getEncryptionState()).toEqual({
        mode: 'keychain',
        sealing: 'working'
      })
    })

    it('stays working once a secret has actually been sealed', () => {
      safeStorageSecretStorage.encrypt('{"password":"x"}')

      expect(getEncryptionState()).toEqual({
        mode: 'keychain',
        sealing: 'working'
      })
    })

    it('records a keychain that has stopped offering encryption', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)

      expect(safeStorageSecretStorage.encrypt('{"password":"x"}')).toEqual(
        '{"password":"x"}'
      )
      expect(getEncryptionState()).toEqual({
        mode: 'keychain',
        sealing: 'failed'
      })
    })

    // `encryptString` throwing is the likelier shape of a keychain that broke
    // after permission was granted — a locked login keyring answers the
    // availability check and then refuses to seal. It used to escape as a
    // defect, which the caller sees as a 500 on an otherwise fine save.
    it('records a keychain that throws on the way out', () => {
      mockEncryptString.mockImplementation(() => {
        throw new Error('The login keyring is locked.')
      })

      expect(safeStorageSecretStorage.encrypt('{"password":"x"}')).toEqual(
        '{"password":"x"}'
      )
      expect(getEncryptionState()).toEqual({
        mode: 'keychain',
        sealing: 'failed'
      })
    })

    it('clears the failure once the keychain seals again', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)
      safeStorageSecretStorage.encrypt('{"password":"x"}')

      mockIsEncryptionAvailable.mockReturnValue(true)
      safeStorageSecretStorage.encrypt('{"password":"x"}')

      expect(getEncryptionState()).toEqual({
        mode: 'keychain',
        sealing: 'working'
      })
    })

    it('forgets a failure when the mode is applied again', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)
      safeStorageSecretStorage.encrypt('{"password":"x"}')

      setSecretStorageMode('keychain')

      expect(getEncryptionState()).toEqual({
        mode: 'keychain',
        sealing: 'working'
      })
    })

    it('records that plaintext has been stored and warned about', () => {
      setSecretStorageMode('plaintext')
      safeStorageSecretStorage.encrypt('{"password":"x"}')

      expect(getEncryptionState()).toEqual({
        mode: 'plaintext',
        warnedAboutPlaintext: true
      })
    })
  })

  describe('warnings', () => {
    // One line per break, not one per save: a user with ten connections would
    // otherwise get ten identical warnings.
    it('warns once while the keychain stays broken', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)

      safeStorageSecretStorage.encrypt('{"password":"x"}')
      safeStorageSecretStorage.encrypt('{"password":"y"}')

      expect(warnings()).toEqual([
        'OS keychain encryption is unavailable — storing connection secrets as plaintext.'
      ])
    })

    // The whole point of a transition rather than a latch. A keychain that
    // breaks, is fixed, and breaks again is two separate things worth saying;
    // the old permanent latch said the second one to nobody.
    it('warns again after the keychain recovers and breaks a second time', () => {
      mockIsEncryptionAvailable.mockReturnValue(false)
      safeStorageSecretStorage.encrypt('{"password":"x"}')

      mockIsEncryptionAvailable.mockReturnValue(true)
      safeStorageSecretStorage.encrypt('{"password":"y"}')

      mockIsEncryptionAvailable.mockReturnValue(false)
      safeStorageSecretStorage.encrypt('{"password":"z"}')

      expect(warnings()).toEqual([
        'OS keychain encryption is unavailable — storing connection secrets as plaintext.',
        'OS keychain encryption is unavailable — storing connection secrets as plaintext.'
      ])
    })

    // What the keychain said is the only clue to what broke — a locked login
    // keyring and a revoked login item both stop sealing, and the reported
    // error is what tells them apart in a bug report.
    it('repeats what the keychain said when sealing threw', () => {
      mockEncryptString.mockImplementation(() => {
        throw new Error('The login keyring is locked.')
      })

      safeStorageSecretStorage.encrypt('{"password":"x"}')

      expect(warnings()).toEqual([
        'OS keychain encryption is unavailable — storing connection secrets as plaintext. The keychain reported: Error: The login keyring is locked.'
      ])
    })

    // `throw undefined` is legal and reads as "the keychain said nothing",
    // which is a different fact from "the keychain answered that encryption is
    // unavailable" — and the two used to produce the same warning.
    it('says the keychain reported nothing when it threw nothing', () => {
      mockEncryptString.mockImplementation(() => {
        throw undefined
      })

      safeStorageSecretStorage.encrypt('{"password":"x"}')

      expect(warnings()).toEqual([
        'OS keychain encryption is unavailable — storing connection secrets as plaintext. The keychain reported: undefined'
      ])
    })

    it('says nothing while the keychain is sealing', () => {
      safeStorageSecretStorage.encrypt('{"password":"x"}')

      expect(warnings()).toEqual([])
    })

    it.each(['plaintext', 'undecided'] as const)(
      'warns once about storing plaintext in %s mode',
      (mode) => {
        setSecretStorageMode(mode)

        safeStorageSecretStorage.encrypt('{"password":"x"}')
        safeStorageSecretStorage.encrypt('{"password":"y"}')

        expect(warnings()).toEqual([
          'Squeal does not have permission to use the OS keychain — storing connection secrets as plaintext.'
        ])
      }
    )

    // Nothing used to reset the latch, so a session that answered the consent
    // screen twice fell silent after the first answer.
    it('warns about plaintext again after the mode is applied again', () => {
      setSecretStorageMode('plaintext')
      safeStorageSecretStorage.encrypt('{"password":"x"}')

      setSecretStorageMode('plaintext')
      safeStorageSecretStorage.encrypt('{"password":"y"}')

      expect(warnings()).toEqual([
        'Squeal does not have permission to use the OS keychain — storing connection secrets as plaintext.',
        'Squeal does not have permission to use the OS keychain — storing connection secrets as plaintext.'
      ])
    })
  })

  describe('isEncrypted', () => {
    it('detects the encrypted prefix', () => {
      expect(isEncrypted('enc:v1:abc')).toEqual(true)
      expect(isEncrypted('{"password":"x"}')).toEqual(false)
    })
  })
})
