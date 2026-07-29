// Shared between the main process and the renderer. Keep this module free of
// main-process imports — the renderer bundles it.
import { HttpApiMiddleware, HttpApiSecurity } from '@effect/platform'

import { UnauthorizedError } from './errors'

// Bearer-token auth for every route except /health. The Live implementation
// (main process) compares sha256 digests with timingSafeEqual.
export class Authorization extends HttpApiMiddleware.Tag<Authorization>()(
  'Authorization',
  {
    failure: UnauthorizedError,
    security: {
      bearer: HttpApiSecurity.bearer
    }
  }
) {}

// The two trace read endpoints are public in development so local agents can
// curl them without the token — the server binds loopback only. In packaged
// builds the Live implementation falls back to the same bearer check, so the
// carve-out is structural instead of path-string matching.
export class TraceReadAuthorization extends HttpApiMiddleware.Tag<TraceReadAuthorization>()(
  'TraceReadAuthorization',
  {
    failure: UnauthorizedError
  }
) {}
