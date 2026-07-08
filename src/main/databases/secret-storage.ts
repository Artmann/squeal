import { safeStorage } from 'electron'
import { log } from 'tiny-typescript-logger'

export interface SecretStorage {
  decrypt(value: string): string
  encrypt(value: string): string
}

const encryptedPrefix = 'enc:v1:'

let warnedAboutUnavailableEncryption = false

export function isEncrypted(value: string): boolean {
  return value.startsWith(encryptedPrefix)
}

// Encrypts values with the OS keychain via Electron's safeStorage. Values are
// stored as `enc:v1:<base64>`; anything without that prefix is treated as
// legacy plaintext and passed through so existing rows keep working until the
// boot-time migration re-encrypts them.
export const safeStorageSecretStorage: SecretStorage = {
  decrypt(value: string): string {
    if (!isEncrypted(value)) {
      return value
    }

    const encrypted = Buffer.from(value.slice(encryptedPrefix.length), 'base64')

    return safeStorage.decryptString(encrypted)
  },

  encrypt(value: string): string {
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
