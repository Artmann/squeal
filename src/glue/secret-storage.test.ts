import { describe, expect, it } from 'vitest'

import { safeStorageName, secretStorageMessages } from './secret-storage'

describe('safeStorageName', () => {
  it.each([
    ['darwin', 'the macOS Keychain'],
    ['linux', 'your Linux keyring'],
    ['win32', 'Windows Data Protection']
  ])('names the keychain on %s', (platform, expected) => {
    expect(safeStorageName(platform)).toEqual(expected)
  })

  it('falls back to a neutral name on an unknown platform', () => {
    expect(safeStorageName('freebsd')).toEqual('your system keychain')
    expect(safeStorageName('')).toEqual('your system keychain')
  })
})

describe('secretStorageMessages', () => {
  it('names the platform keychain and both ways forward', () => {
    expect(
      secretStorageMessages.keychainUnavailable('the macOS Keychain')
    ).toEqual(
      'Squeal could not get access to the macOS Keychain. If your system asked for permission, choose Allow and try again — or skip and save your passwords unencrypted.'
    )
  })

  it('tells a Linux user which keyrings work', () => {
    expect(secretStorageMessages.noKeyring).toEqual(
      'This system has no keyring for Squeal to store an encryption key in. Install and unlock GNOME Keyring or KWallet and try again — or skip and save your passwords unencrypted.'
    )
  })
})
