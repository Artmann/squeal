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
  cannotRunUnreadableConnection: (databaseName: string): string =>
    `Squeal can't read the saved details for "${databaseName}". Open the connection and re-enter them.`,
  keychainUnavailable: (storageName: string): string =>
    `Squeal could not get access to ${storageName}. If your system asked for permission, choose Allow and try again — or skip and save your passwords unencrypted.`,
  noKeyring:
    'This system has no keyring for Squeal to store an encryption key in. Install and unlock GNOME Keyring or KWallet and try again — or skip and save your passwords unencrypted.',
  // Permission was granted and then the keychain refused to seal anything, so
  // the mode says `keychain` while the passwords on disk are still plaintext.
  // Nothing else in the response can tell the two apart, which is why this is
  // said rather than inferred.
  sealingFailed: (count: number, storageName: string): string =>
    `Squeal has permission to use ${storageName}, but it refused to encrypt, so ${count} saved ${count === 1 ? 'connection is' : 'connections are'} still stored unencrypted. Once ${storageName} is working again, open each connection and save it to encrypt it.`,

  // The sidebar marks such a row with a warning icon and a short inline action;
  // this is the icon's accessible name and tooltip, so it is the one place that
  // explains the state in full. A sentence per row would bury a list of them.
  unreadableConnection:
    "Squeal can't read this connection's saved details. Re-enter them to repair it."
}
