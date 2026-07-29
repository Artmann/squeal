import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from '@effect/platform'

import { NoDatabaseAvailableError, QueryNotFoundError } from '../errors'
import {
  CancelQueryResponse,
  CreateQueryRequest,
  CreateQueryResponse,
  GetQueriesResponse,
  GetQueryResponse,
  QueryId
} from '../schemas'
import { Authorization } from '../security'

const idParam = HttpApiSchema.param('id', QueryId)

// Query execution is async: create returns the row immediately with a null
// finishedAt, and the renderer polls `get` until it is set.
export const queriesGroup = HttpApiGroup.make('queries')
  .add(HttpApiEndpoint.get('list', '/').addSuccess(GetQueriesResponse))
  .add(
    HttpApiEndpoint.get('get')`/${idParam}`
      .addSuccess(GetQueryResponse)
      .addError(QueryNotFoundError)
  )
  .add(
    HttpApiEndpoint.post('create', '/')
      .setPayload(CreateQueryRequest)
      .addSuccess(CreateQueryResponse)
      .addError(NoDatabaseAvailableError)
  )
  .add(
    // Canceling an unknown or already finished query is a deliberate no-op.
    HttpApiEndpoint.post('cancel')`/${idParam}/cancel`.addSuccess(
      CancelQueryResponse
    )
  )
  .middleware(Authorization)
  .prefix('/queries')
