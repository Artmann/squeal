import { safeStorage } from 'electron'
import { log } from 'tiny-typescript-logger'

import type { SecretStorageMode } from '@/glue/api/schemas'

export interface SecretStorage {
  decrypt(value: string): string
  encrypt(value: string): string
}

// Everything this process knows about its own encryption, in one value.
//
// `sealing` is representable only under `keychain` because that is the only
// mode that tries to seal anything, and `warnedAboutPlaintext` only under the
// two modes that never do — so there is no combination here that cannot
// happen, and no latch that outlives the mode it was about.
//
// It is deliberately process-local and never persisted: a `'failed'` written to
// disk would outlive the restart that fixed the keychain.
export type EncryptionState =
  | { readonly mode: 'keychain'; readonly sealing: 'failed' | 'working' }
  | {
      readonly mode: 'plaintext' | 'undecided'
      readonly warnedAboutPlaintext: boolean
    }

export type KeychainProbeResult = 'available' | 'noKeyring' | 'unavailable'

const encryptedPrefix = 'enc:v1:'

const missingPermissionWarning =
  'Squeal does not have permission to use the OS keychain — storing connection secrets as plaintext.'

const unavailableEncryptionWarning =
  'OS keychain encryption is unavailable — storing connection secrets as plaintext.'

// This module is the only place in the app allowed to reach `safeStorage`, and
// the mode is its permission to do so: outside `keychain`, nothing here touches
// the keychain, so no OS prompt can appear before the user has agreed to one.
//
// The gate lives here rather than in the Effect service on purpose. The plain
// `safeStorageSecretStorage` object below is reached from Effect code and from
// plain promise code alike, and `isEncryptionAvailable()` is called inside
// `encrypt`, below the service boundary — a gate above it could not cover
// either.
let state: EncryptionState = { mode: 'undecided', warnedAboutPlaintext: false }

export function getEncryptionState(): EncryptionState {
  return state
}

export function setSecretStorageMode(next: SecretStorageMode): void {
  // Applying a mode is the reset. Whatever this process had learned — that the
  // keychain was refusing to seal, that the plaintext warning had been given —
  // was learned about the mode being replaced.
  //
  // `working` is the optimistic default rather than a third "not tried yet"
  // value, and it is safe to be optimistic because nothing reports it: only
  // `failed` is ever shown, and only a seal attempt can set it. Two of the
  // three ways into keychain mode are evidence — a `probeEncryption()` that
  // sealed a value, a database that already holds sealed rows — but the third
  // is the mode read back from settings at boot, which has probed nothing.
  state =
    next === 'keychain'
      ? { mode: 'keychain', sealing: 'working' }
      : { mode: next, warnedAboutPlaintext: false }
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

// Warns on the transition into failure rather than latching, so a keychain that
// breaks, is repaired, and breaks again says so both times. A latch said the
// second one to nobody, and nothing reset it when the mode changed.
// `reason` is already a string rather than the caught value, so "the keychain
// answered that encryption is unavailable" and "the keychain threw `undefined`"
// stay two different sentences.
function recordSealingFailure(
  value: string,
  reason: string | undefined
): string {
  if (state.mode === 'keychain' && state.sealing !== 'failed') {
    state = { mode: 'keychain', sealing: 'failed' }

    log.warn(
      reason === undefined
        ? unavailableEncryptionWarning
        : `${unavailableEncryptionWarning} The keychain reported: ${reason}`
    )
  }

  return value
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

    if (state.mode !== 'keychain') {
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
    if (state.mode !== 'keychain') {
      if (!state.warnedAboutPlaintext) {
        state = { mode: state.mode, warnedAboutPlaintext: true }

        log.warn(missingPermissionWarning)
      }

      return value
    }

    // Sealing has to survive the keychain going wrong under it, not just
    // answering `false`: a locked login keyring passes the availability check
    // and then throws. Letting that escape turns an otherwise fine save into a
    // 500, and the password never reaches the database at all.
    try {
      if (!safeStorage.isEncryptionAvailable()) {
        return recordSealingFailure(value, undefined)
      }

      const sealed = safeStorage.encryptString(value).toString('base64')

      state = { mode: 'keychain', sealing: 'working' }

      return `${encryptedPrefix}${sealed}`
    } catch (error) {
      return recordSealingFailure(value, String(error))
    }
  }
}
