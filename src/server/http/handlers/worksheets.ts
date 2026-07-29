import { HttpApiBuilder } from '@effect/platform'
import { Effect } from 'effect'

import { SquealApi } from '@/glue/api/api'
import { WorksheetService } from '@/server/services/worksheet-service'
import { orDieInternal } from '../internal-errors'

export const WorksheetsLive = HttpApiBuilder.group(
  SquealApi,
  'worksheets',
  (handlers) =>
    handlers
      .handle('list', () =>
        Effect.gen(function* () {
          const service = yield* WorksheetService

          let worksheets = yield* service.list()

          // The app always has a worksheet to open.
          if (worksheets.length === 0) {
            const defaultWorksheet = yield* service.create({
              name: 'My First Worksheet'
            })

            worksheets = [defaultWorksheet]
          }

          return { worksheets }
        }).pipe(orDieInternal)
      )
      .handle('create', ({ payload }) =>
        Effect.gen(function* () {
          const service = yield* WorksheetService

          const worksheet = yield* service.create(payload)

          return { worksheet }
        }).pipe(orDieInternal)
      )
      .handle('reorder', ({ payload }) =>
        Effect.gen(function* () {
          const service = yield* WorksheetService

          const worksheets = yield* service.reorder(payload.worksheetIds)

          return { worksheets }
        }).pipe(orDieInternal)
      )
      .handle('update', ({ path, payload }) =>
        Effect.gen(function* () {
          const service = yield* WorksheetService

          const worksheet = yield* service.update(path.id, payload)

          return { worksheet }
        }).pipe(orDieInternal)
      )
)
