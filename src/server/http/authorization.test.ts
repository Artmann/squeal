import { describe, expect, it } from 'vitest'

import { presentsToken } from './authorization'

const token = 'test-api-token'

describe('presentsToken', () => {
  it.each([
    ['the canonical scheme', `Bearer ${token}`],
    ['a lowercase scheme', `bearer ${token}`],
    ['an uppercase scheme', `BEARER ${token}`],
    // RFC 7235 §2.1 separates the scheme from the credential with 1*SP, so more
    // than one space is well-formed. The platform's blind seven-character slice
    // read the second space as part of the credential and rejected it.
    ['a doubled space', `Bearer  ${token}`],
    ['a tab separator', `bearer\t${token}`]
  ])('accepts the session token behind %s', (_description, header) => {
    expect(presentsToken(header, token)).toEqual(true)
  })

  it.each([
    ['no header at all', undefined],
    ['an empty header', ''],
    // Seven characters, so the platform's slice dropped exactly the scheme and
    // authenticated this on every route except the trace reads.
    ['a Digest scheme', `Digest ${token}`],
    ['a Basic scheme', `Basic ${token}`],
    ['the bare token with no scheme', token],
    ['the scheme with no separator', `Bearer${token}`],
    ['the right scheme and the wrong token', 'Bearer wrong-token'],
    ['the scheme alone', 'Bearer ']
  ])('rejects %s', (_description, header) => {
    expect(presentsToken(header, token)).toEqual(false)
  })

  // The session token is 32 random bytes hex-encoded and can never be empty, so
  // this is defence in depth rather than a reachable bypass. It is pinned
  // because the predicate used to answer '' for an absent header and for a
  // malformed one alike, which made both compare equal to an empty token -- and
  // because a well-formed header with nothing behind the scheme yields a real
  // '' that no amount of care about the undefined cases would have caught.
  it.each([
    ['no header', undefined],
    ['a malformed scheme', 'Digest '],
    ['the scheme with an empty credential', 'Bearer ']
  ])(
    'rejects %s even when the token itself is empty',
    (_description, header) => {
      expect(presentsToken(header, '')).toEqual(false)
    }
  )
})
