// Electron safeStorage as a service. The Live implementation can reach the OS
// keychain, but only once the user has granted permission (`mode === 'keychain'`)
// or when `probe` is called because they asked for it — so building this layer at
// boot raises no prompt. Tests provide a transparent substitute layer and never
// build Default.
import { Effect } from 'effect'

import type { SecretStorageMode } from '@/glue/api/schemas'
import {
  probeEncryption,
  safeStorageSecretStorage,
  setSecretStorageMode
} from '@/main/databases/secret-storage'
import { SecretDecryptError } from '../errors'

export class SecretStorage extends Effect.Service<SecretStorage>()(
  'SecretStorage',
  {
    accessors: true,
    sync: () => ({
      decrypt: (value: string) =>
        Effect.try({
          catch: (cause) =>
            new SecretDecryptError({
              cause: String(cause),
              message:
                'A stored connection secret could not be decrypted. Edit the connection and re-enter its password.'
            }),
          try: () => safeStorageSecretStorage.decrypt(value)
        }),
      encrypt: (value: string) =>
        Effect.sync(() => safeStorageSecretStorage.encrypt(value)),
      probe: Effect.sync(() => probeEncryption()),
      setMode: (next: SecretStorageMode) =>
        Effect.sync(() => setSecretStorageMode(next))
    })
  }
) {}
