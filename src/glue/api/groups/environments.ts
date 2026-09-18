import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from '@effect/platform'

import { EnvironmentNotFoundError } from '../errors'
import {
  CreateEnvironmentRequest,
  CreateEnvironmentResponse,
  DeleteEnvironmentResponse,
  EnvironmentId,
  ListEnvironmentsResponse,
  UpdateEnvironmentRequest,
  UpdateEnvironmentResponse
} from '../schemas'
import { Authorization } from '../security'

const idParam = HttpApiSchema.param('id', EnvironmentId)

export const environmentsGroup = HttpApiGroup.make('environments')
  .add(
    // Never empty in practice: the three shipped environments are seeded at
    // boot, and deleting one is a soft delete that the list filters out.
    HttpApiEndpoint.get('list', '/').addSuccess(ListEnvironmentsResponse)
  )
  .add(
    HttpApiEndpoint.post('create', '/')
      .setPayload(CreateEnvironmentRequest)
      .addSuccess(CreateEnvironmentResponse, { status: 201 })
  )
  .add(
    // Soft delete, so that re-seeding at the next boot does not bring a
    // deleted default back.
    HttpApiEndpoint.del('remove')`/${idParam}`
      .addSuccess(DeleteEnvironmentResponse)
      .addError(EnvironmentNotFoundError)
  )
  .add(
    HttpApiEndpoint.patch('update')`/${idParam}`
      .setPayload(UpdateEnvironmentRequest)
      .addSuccess(UpdateEnvironmentResponse)
      .addError(EnvironmentNotFoundError)
  )
  .middleware(Authorization)
  .prefix('/environments')
