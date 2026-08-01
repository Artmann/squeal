// Helpers for renderer tests that stub fetch. The API client decodes real
// Responses, so tests hand it the genuine article instead of duck-typed
// stand-ins, and read requests back through one place because the HTTP
// client passes a URL plus an init whose body is encoded bytes.
import { vi } from 'vitest'

export function jsonResponse(
  data: unknown,
  options: { status?: number } = {}
): Response {
  return new Response(JSON.stringify(data), {
    headers: { 'content-type': 'application/json' },
    status: options.status ?? 200
  })
}

export interface CapturedFetch {
  body: unknown
  headers: Record<string, string>
  method: string
  url: string
}

function decodeBody(body: unknown): unknown {
  if (typeof body === 'string') {
    return JSON.parse(body)
  }

  // ArrayBuffer.isView rather than instanceof: jsdom hands back a typed
  // array from another realm, where instanceof is false.
  if (ArrayBuffer.isView(body)) {
    return JSON.parse(new TextDecoder().decode(body as Uint8Array))
  }

  return undefined
}

function readHeaders(source: HeadersInit | undefined): Record<string, string> {
  const headers: Record<string, string> = {}

  if (source !== undefined) {
    new Headers(source).forEach((value, key) => {
      headers[key.toLowerCase()] = value
    })
  }

  return headers
}

export async function capturedFetch(callIndex = 0): Promise<CapturedFetch> {
  const [input, init] = vi.mocked(fetch).mock.calls[callIndex] as [
    Request | URL | string,
    RequestInit | undefined
  ]

  if (input instanceof Request) {
    const headers = readHeaders(input.headers)
    const text = await input.clone().text()

    return {
      body: text === '' ? decodeBody(init?.body) : JSON.parse(text),
      headers,
      method: input.method,
      url: input.url
    }
  }

  return {
    body: decodeBody(init?.body),
    headers: readHeaders(init?.headers),
    method: init?.method ?? 'GET',
    url: String(input)
  }
}
