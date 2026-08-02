import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from '@effect/platform'

import { UnknownWorksheetIdsError, WorksheetNotFoundError } from '../errors'
import {
  CreateWorksheetRequest,
  CreateWorksheetResponse,
  DeleteWorksheetResponse,
  ListWorksheetsResponse,
  ReorderWorksheetsRequest,
  ReorderWorksheetsResponse,
  UpdateWorksheetRequest,
  UpdateWorksheetResponse,
  WorksheetId
} from '../schemas'
import { Authorization } from '../security'

const idParam = HttpApiSchema.param('id', WorksheetId)

export const worksheetsGroup = HttpApiGroup.make('worksheets')
  .add(
    // Listing with an empty table creates and returns a default worksheet so
    // the app always has one to open.
    HttpApiEndpoint.get('list', '/').addSuccess(ListWorksheetsResponse)
  )
  .add(
    HttpApiEndpoint.post('create', '/')
      .setPayload(CreateWorksheetRequest)
      .addSuccess(CreateWorksheetResponse, { status: 201 })
  )
  .add(
    HttpApiEndpoint.put('reorder', '/order')
      .setPayload(ReorderWorksheetsRequest)
      .addSuccess(ReorderWorksheetsResponse)
      .addError(UnknownWorksheetIdsError)
  )
  .add(
    // Soft delete, like databases: the row keeps its queries so history
    // survives, and every read already filters on deletedAt.
    HttpApiEndpoint.del('remove')`/${idParam}`
      .addSuccess(DeleteWorksheetResponse)
      .addError(WorksheetNotFoundError)
  )
  .add(
    HttpApiEndpoint.patch('update')`/${idParam}`
      .setPayload(UpdateWorksheetRequest)
      .addSuccess(UpdateWorksheetResponse)
      .addError(WorksheetNotFoundError)
  )
  .middleware(Authorization)
  .prefix('/worksheets')
