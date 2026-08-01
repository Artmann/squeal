import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from '@effect/platform'

import {
  GetTraceResponse,
  GetTracesResponse,
  IngestSpansRequest,
  IngestSpansResponse,
  ListTracesUrlParams,
  TraceId
} from '../schemas'
import { Authorization, TraceReadAuthorization } from '../security'

const traceIdParam = HttpApiSchema.param('traceId', TraceId)

// Auth is applied per endpoint here: reads are public in development (agents
// curl them without the token), while span ingest always requires the bearer
// token.
export const tracesGroup = HttpApiGroup.make('traces')
  .add(
    HttpApiEndpoint.get('list', '/')
      .setUrlParams(ListTracesUrlParams)
      .addSuccess(GetTracesResponse)
      .middleware(TraceReadAuthorization)
  )
  .add(
    HttpApiEndpoint.get('get')`/${traceIdParam}`
      .addSuccess(GetTraceResponse)
      .middleware(TraceReadAuthorization)
  )
  .add(
    HttpApiEndpoint.post('ingest', '/spans')
      .setPayload(IngestSpansRequest)
      .addSuccess(IngestSpansResponse)
      .middleware(Authorization)
  )
  .prefix('/traces')
