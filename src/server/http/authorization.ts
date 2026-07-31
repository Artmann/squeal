import { createHash, timingSafeEqual } from 'node:crypto'

const bearerScheme = /^bearer[ \t]+/i

// RFC 7235 §2.1 makes the scheme token case-insensitive, and the platform's own
// bearer decoder ignores its case too. Being stricter here is what made
// lowercase `bearer` work on every route except the trace reads.
export function bearerCredential(header: string | undefined): string {
  if (header === undefined) {
    return ''
  }

  const match = bearerScheme.exec(header)

  if (match === null) {
    return ''
  }

  return header.slice(match[0].length)
}

// Hashing both sides first makes timingSafeEqual usable for tokens of
// unequal length without leaking the length through an early return.
export function isAuthorized(presented: string, token: string): boolean {
  const presentedDigest = createHash('sha256').update(presented).digest()
  const tokenDigest = createHash('sha256').update(token).digest()

  return timingSafeEqual(presentedDigest, tokenDigest)
}
