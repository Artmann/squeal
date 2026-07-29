// Electron safeStorage as a service. The Live implementation touches the OS
// keychain, so it is only ever built in the main process — tests provide a
// transparent substitute layer and never build Default.
import { Effect } from 'effect'

import {
  isEncryptionAvailable,
  safeStorageSecretStorage
} from '@/main/databases/secret-storage'
import { SecretDecryptError } from '../errors'

export class SecretStorage extends Effect.Service<SecretStorage>()(
  'SecretStorage',
  {
    accessors: true,
    sync: () => ({
      decrypt: (value: string) =>
        Effect.try({
          catch: () =>
            new SecretDecryptError({
              message:
                'A stored connection secret could not be decrypted. Edit the connection and re-enter its password.'
            }),
          try: () => safeStorageSecretStorage.decrypt(value)
        }),
      encrypt: (value: string) =>
        Effect.sync(() => safeStorageSecretStorage.encrypt(value)),
      isEncryptionAvailable: Effect.sync(() => isEncryptionAvailable())
    })
  }
) {}
