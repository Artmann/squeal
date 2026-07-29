import { createHash, timingSafeEqual } from 'node:crypto'

// Hashing both sides first makes timingSafeEqual usable for tokens of
// unequal length without leaking the length through an early return.
export function isAuthorized(presented: string, token: string): boolean {
  const presentedDigest = createHash('sha256').update(presented).digest()
  const tokenDigest = createHash('sha256').update(token).digest()

  return timingSafeEqual(presentedDigest, tokenDigest)
}
