import { describe, expect, it, vi } from 'vitest'

import { onPersistFailure, writeIfReady } from './collection-writes'

function deferredTransaction() {
  let reject: (error: unknown) => void = () => undefined
  let resolve: () => void = () => undefined

  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    reject = rejectPromise
    resolve = resolvePromise
  })

  return { reject, resolve, transaction: { isPersisted: { promise } } }
}

describe('writeIfReady', () => {
  it('writes into a collection that has synced', () => {
    const writeInsert = vi.fn()

    writeIfReady({ status: 'ready', utils: { writeInsert } }, (utils) => {
      utils.writeInsert({ id: 'worksheet-1' })
    })

    expect(writeInsert.mock.calls).toEqual([[{ id: 'worksheet-1' }]])
  })

  it.each(['idle', 'loading', 'error', 'cleaned-up'] as const)(
    'skips the write while the collection is %s',
    (status) => {
      const writeInsert = vi.fn()

      writeIfReady({ status, utils: { writeInsert } }, (utils) => {
        utils.writeInsert({ id: 'worksheet-1' })
      })

      expect(writeInsert.mock.calls).toEqual([])
    }
  )
})

describe('onPersistFailure', () => {
  it('hands a failed persist to the handler', async () => {
    const onError = vi.fn()
    const { reject, transaction } = deferredTransaction()

    onPersistFailure(transaction, onError)
    reject(new Error('Network down'))

    await vi.waitFor(() => {
      expect(onError.mock.calls).toEqual([[new Error('Network down')]])
    })
  })

  it('does not call the handler when the persist succeeds', async () => {
    const onError = vi.fn()
    const { resolve, transaction } = deferredTransaction()

    onPersistFailure(transaction, onError)
    resolve()

    await transaction.isPersisted.promise

    expect(onError.mock.calls).toEqual([])
  })

  it('swallows a failure when no handler is given', async () => {
    const unhandled = vi.fn()
    const { reject, transaction } = deferredTransaction()

    process.on('unhandledRejection', unhandled)

    try {
      onPersistFailure(transaction)
      reject(new Error('Network down'))

      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(unhandled.mock.calls).toEqual([])
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
