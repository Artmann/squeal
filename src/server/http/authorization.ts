import { createHash, timingSafeEqual } from 'node:crypto'

// RFC 7235 §2.1: the scheme token is case-insensitive, and 1*SP separates it
// from the credential — so more than one space is well-formed. HTAB is not in
// 1*SP; it is accepted anyway because `Bearer\t<token>` already authenticated
// on every route (the scheme plus a tab is exactly the seven characters the
// platform's decoder slices off), and narrowing that now would be a
// regression rather than a fix.
const bearerScheme = /^bearer[ \t]+/i

// The single definition of "does this request present the session token", used
// by both authorization middlewares.
//
// It exists because they used to answer it two different ways and disagreed on
// real headers in both directions. The platform's own bearer decoder is
// `(headers.authorization ?? '').slice('Bearer '.length)` — it never inspects
// the scheme — so `Digest <token>` authenticated while `Bearer  <token>` did
// not, and the trace-read path, which parsed the header, did the reverse. That
// seam had already shipped one divergence: the lowercase `bearer` that worked
// everywhere except trace reads.
export function presentsToken(
  header: string | undefined,
  token: string
): boolean {
  const credential = bearerCredential(header)

  // An empty credential is rejected outright rather than compared. Absent and
  // malformed headers answer undefined, but `Bearer ` on its own is
  // well-formed and yields '', which would authenticate against an empty
  // token. The session token is 32 random bytes hex-encoded and can never be
  // empty, so this is defence in depth rather than a live bypass — but it only
  // is defence in depth if it covers the well-formed case too.
  if (credential === undefined || credential === '') {
    return false
  }

  return isAuthorized(credential, token)
}

function bearerCredential(header: string | undefined): string | undefined {
  if (header === undefined) {
    return undefined
  }

  const match = bearerScheme.exec(header)

  if (match === null) {
    return undefined
  }

  return header.slice(match[0].length)
}

// Hashing both sides first makes timingSafeEqual usable for tokens of
// unequal length without leaking the length through an early return.
function isAuthorized(presented: string, token: string): boolean {
  const presentedDigest = createHash('sha256').update(presented).digest()
  const tokenDigest = createHash('sha256').update(token).digest()

  return timingSafeEqual(presentedDigest, tokenDigest)
}
