import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from '@effect/platform'

import {
  DatabaseNotFoundError,
  DifferentServerError,
  SchemaLoadFailedError,
  UnknownDatabaseIdsError
} from '../errors'
import {
  CreateDatabaseRequest,
  CreateDatabaseResponse,
  DatabaseId,
  DeleteDatabaseResponse,
  GetDatabaseSchemaResponse,
  ListDatabasesResponse,
  ReorderDatabasesRequest,
  ReorderDatabasesResponse,
  UpdateDatabaseRequest,
  UpdateDatabaseResponse
} from '../schemas'
import { Authorization } from '../security'

const idParam = HttpApiSchema.param('id', DatabaseId)

export const databasesGroup = HttpApiGroup.make('databases')
  .add(HttpApiEndpoint.get('list', '/').addSuccess(ListDatabasesResponse))
  .add(
    HttpApiEndpoint.post('create', '/')
      .setPayload(CreateDatabaseRequest)
      .addSuccess(CreateDatabaseResponse, { status: 201 })
  )
  .add(
    HttpApiEndpoint.put('reorder', '/order')
      .setPayload(ReorderDatabasesRequest)
      .addSuccess(ReorderDatabasesResponse)
      .addError(UnknownDatabaseIdsError)
  )
  .add(
    HttpApiEndpoint.get('schema')`/${idParam}/schema`
      .addSuccess(GetDatabaseSchemaResponse)
      .addError(DatabaseNotFoundError)
      .addError(SchemaLoadFailedError)
  )
  .add(
    HttpApiEndpoint.del('remove')`/${idParam}`
      .addSuccess(DeleteDatabaseResponse)
      .addError(DatabaseNotFoundError)
  )
  .add(
    HttpApiEndpoint.patch('update')`/${idParam}`
      .setPayload(UpdateDatabaseRequest)
      .addSuccess(UpdateDatabaseResponse)
      .addError(DatabaseNotFoundError)
      .addError(DifferentServerError)
  )
  .middleware(Authorization)
  .prefix('/databases')
