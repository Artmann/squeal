// Shared between the main process and the renderer. Keep this module free of
// main-process imports — the renderer bundles it.
//
// The platform's name for its keychain is resolved in the main process from
// `process.platform` and travels in the response, so the renderer never guesses
// it from the deprecated `navigator.platform`.
export function safeStorageName(platform: string): string {
  if (platform === 'darwin') {
    return 'the macOS Keychain'
  }

  if (platform === 'linux') {
    return 'your Linux keyring'
  }

  if (platform === 'win32') {
    return 'Windows Data Protection'
  }

  return 'your system keychain'
}

export const secretStorageMessages = {
  keychainUnavailable: (storageName: string): string =>
    `Squeal could not get access to ${storageName}. If your system asked for permission, choose Allow and try again — or skip and save your passwords unencrypted.`,
  noKeyring:
    'This system has no keyring for Squeal to store an encryption key in. Install and unlock GNOME Keyring or KWallet and try again — or skip and save your passwords unencrypted.'
}
