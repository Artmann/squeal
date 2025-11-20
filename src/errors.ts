import { ZodError } from 'zod'

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

export class ValidationError extends ApiError {
  constructor(zodError: ZodError) {
    const details: Record<string, string> = {}

    for (const issue of zodError.issues) {
      const field = issue.path.join('.')
      let message = issue.message

      // Clean up the message format
      if (!message.endsWith('.')) {
        message = message + '.'
      }

      details[field] = message
    }

    super(400, 'Validation error', details)
    this.name = 'ValidationError'
  }
}
