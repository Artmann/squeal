// Caches the promise for a value that should only ever be created once per
// renderer session. A rejected promise is deliberately not kept: caching one
// would wedge every later caller until the window reloads, so the next call
// gets a fresh attempt instead.
export function memoizePromise<A>(create: () => Promise<A>): () => Promise<A> {
  let pending: Promise<A> | undefined

  return () => {
    pending ??= create().catch((error: unknown) => {
      pending = undefined

      throw error
    })

    return pending
  }
}
