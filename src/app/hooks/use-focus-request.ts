import { RefObject, useCallback, useEffect, useRef, useState } from 'react'

export interface FocusRequest<T extends HTMLElement> {
  ref: RefObject<T | null>
  request: () => void
}

/**
 * Focus and select an element that may not exist yet, on demand.
 *
 * A counter rather than a boolean, for two reasons. The element is often
 * mounted by the same state update that asks for the focus, so the effect has
 * to run after that render rather than during the handler. And asking twice
 * while it is already focused still has to do something -- for the find bar
 * that is what makes a second ⌘F select what is in the box, so the paste after
 * it replaces the old value instead of appending to it.
 */
export function useFocusRequest<
  T extends HTMLElement & { select?: () => void }
>(): FocusRequest<T> {
  const ref = useRef<T>(null)
  const [requestCount, setRequestCount] = useState(0)

  useEffect(() => {
    if (requestCount === 0) {
      return
    }

    ref.current?.focus()
    ref.current?.select?.()
  }, [requestCount])

  const request = useCallback(() => {
    setRequestCount((count) => count + 1)
  }, [])

  return { ref, request }
}
