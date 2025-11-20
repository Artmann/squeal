import type { Context } from 'hono'
import { log } from 'tiny-typescript-logger'

import { ApiError } from '../../errors'

export function errorHandler(error: Error, context: Context) {
  log.error(`Error: ${error.message}`, error)

  // Handle JSON parsing errors
  if (error instanceof SyntaxError && error.message.includes('JSON')) {
    return context.json(
      {
        error: {
          message: 'Invalid JSON in request body.'
        }
      },
      400
    )
  }

  if (error instanceof ApiError) {
    const response: any = {
      error: {
        message: error.message
      }
    }

    if (error.details) {
      response.error.details = error.details
    }

    return context.json(response, error.statusCode as any)
  }

  return context.json(
    {
      error: {
        message: 'Something went wrong. Please try again.'
      }
    },
    500
  )
}
