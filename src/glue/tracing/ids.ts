// Shared between the main process and the renderer. Keep this module free of
// main-process imports — the renderer bundles it.

// W3C trace ids are raw hex, deliberately not UUIDs like the query ids.
export function generateSpanId(): string {
  return randomHex(8)
}

export function generateTraceId(): string {
  return randomHex(16)
}

function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount)

  globalThis.crypto.getRandomValues(bytes)

  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    ''
  )
}
