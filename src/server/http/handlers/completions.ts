import { HttpApiBuilder } from '@effect/platform'
import { Effect } from 'effect'

import { SquealApi } from '@/glue/api/api'
import { Completions } from '@/server/services/completions'
import { orDieInternal } from '../internal-errors'

export const CompletionsLive = HttpApiBuilder.group(
  SquealApi,
  'completions',
  (handlers) =>
    handlers
      .handle('status', () =>
        Effect.gen(function* () {
          const completions = yield* Completions

          return yield* completions.status()
        }).pipe(orDieInternal)
      )
      .handle('create', ({ payload }) =>
        Effect.gen(function* () {
          const completions = yield* Completions

          return yield* completions.complete(payload)
        }).pipe(orDieInternal)
      )
      .handle('startDownload', () =>
        Effect.gen(function* () {
          const completions = yield* Completions

          return yield* completions.startDownload()
        }).pipe(orDieInternal)
      )
      .handle('downloadStatus', () =>
        Effect.gen(function* () {
          const completions = yield* Completions

          return yield* completions.downloadStatus()
        }).pipe(orDieInternal)
      )
      .handle('cancelDownload', () =>
        Effect.gen(function* () {
          const completions = yield* Completions

          return yield* completions.cancelDownload()
        }).pipe(orDieInternal)
      )
)
