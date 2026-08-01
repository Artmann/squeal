// The renderer's transport-level error. Failures declared in the API
// contract arrive as their own tagged classes (`src/glue/api/errors.ts`);
// this covers what the contract does not describe — decode failures and
// network faults.
export class ApiError extends Error {
  statusCode: number
  details?: Record<string, string>

  constructor(
    statusCode: number,
    message: string,
    details?: Record<string, string>
  ) {
    super(message)
    this.statusCode = statusCode
    this.details = details
    this.name = 'ApiError'
  }
}
