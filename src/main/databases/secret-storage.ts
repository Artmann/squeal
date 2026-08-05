import { safeStorage } from 'electron'
import { log } from 'tiny-typescript-logger'

import type { SecretStorageMode } from '@/glue/api/schemas'

export interface SecretStorage {
  decrypt(value: string): string
  encrypt(value: string): string
}

export type KeychainProbeResult = 'available' | 'noKeyring' | 'unavailable'

const encryptedPrefix = 'enc:v1:'

// This module is the only place in the app allowed to reach `safeStorage`, and
// the mode is its permission to do so: outside `keychain`, nothing here touches
// the keychain, so no OS prompt can appear before the user has agreed to one.
//
// The gate lives here rather than in the Effect service on purpose. The plain
// `safeStorageSecretStorage` object below is reached from Effect code and from
// plain promise code alike, and `isEncryptionAvailable()` is called inside
// `encrypt`, below the service boundary — a gate above it could not cover
// either.
let mode: SecretStorageMode = 'undecided'

let warnedAboutMissingPermission = false
let warnedAboutUnavailableEncryption = false

export function getSecretStorageMode(): SecretStorageMode {
  return mode
}

export function setSecretStorageMode(next: SecretStorageMode): void {
  mode = next
}

export function isEncrypted(value: string): boolean {
  return value.startsWith(encryptedPrefix)
}

// The one deliberate keychain touch in the app, and the only code here that
// ignores the mode: it runs when the user asks for encryption, which is exactly
// when the OS prompt should appear.
//
// A full round trip rather than an availability check, because
// isEncryptionAvailable() can answer for a key that then fails to seal, and
// finding that out at save time would mean a password silently stored as
// plaintext.
export function probeEncryption(): KeychainProbeResult {
  try {
    // `basic_text` is Chromium obfuscating values with a hardcoded key instead
    // of encrypting them, and it still reports encryption as available. Calling
    // that a success would tell the user their passwords are protected when
    // they are not. The call itself is Linux-only.
    if (
      process.platform === 'linux' &&
      safeStorage.getSelectedStorageBackend() === 'basic_text'
    ) {
      return 'noKeyring'
    }

    if (!safeStorage.isEncryptionAvailable()) {
      return 'unavailable'
    }

    const probeValue = 'squeal-keychain-probe'
    const sealed = safeStorage.encryptString(probeValue)

    if (safeStorage.decryptString(sealed) !== probeValue) {
      return 'unavailable'
    }

    return 'available'
  } catch (error) {
    log.warn(`The OS keychain could not be reached: ${String(error)}`)

    return 'unavailable'
  }
}

// Encrypts values with the OS keychain via Electron's safeStorage. Values are
// stored as `enc:v1:<base64>`; anything without that prefix is treated as
// plaintext and passed through, so rows written before the user granted
// permission keep working until they are re-encrypted.
export const safeStorageSecretStorage: SecretStorage = {
  decrypt(value: string): string {
    if (!isEncrypted(value)) {
      return value
    }

    if (mode !== 'keychain') {
      // Only reachable with a database file copied from another machine, whose
      // rows are sealed with a key this one does not hold — so prompting would
      // buy nothing and would break the promise that the keychain stays
      // untouched without permission. The caller reports the row as unreadable
      // and offers to repair it.
      throw new Error(
        'Squeal does not have permission to use the OS keychain, so this secret cannot be read.'
      )
    }

    const encrypted = Buffer.from(value.slice(encryptedPrefix.length), 'base64')

    return safeStorage.decryptString(encrypted)
  },

  encrypt(value: string): string {
    if (mode !== 'keychain') {
      if (!warnedAboutMissingPermission) {
        warnedAboutMissingPermission = true

        log.warn(
          'Squeal does not have permission to use the OS keychain — storing connection secrets as plaintext.'
        )
      }

      return value
    }

    if (!safeStorage.isEncryptionAvailable()) {
      if (!warnedAboutUnavailableEncryption) {
        warnedAboutUnavailableEncryption = true

        log.warn(
          'OS keychain encryption is unavailable — storing connection secrets as plaintext.'
        )
      }

      return value
    }

    return `${encryptedPrefix}${safeStorage.encryptString(value).toString('base64')}`
  }
}
