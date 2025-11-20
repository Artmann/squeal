import { ApiError } from './errors'
import { ProviderDto } from './glue/providers'

export async function fetchProviders(): Promise<ProviderDto[]> {
  const response = await fetch('http://localhost:7847/providers', {
    headers: {
      'Content-Type': 'application/json'
    },
    method: 'GET'
  })
  const data = await response.json()

  if (data.error) {
    throw new ApiError(
      data.error.message,
      response.status.toString(),
      data.error.details
    )
  }

  return data.providers
}

export async function upsertProvider(
  id: string,
  type: string,
  token = ''
): Promise<ProviderDto> {
  const response = await fetch(`http://localhost:7847/providers/${id}`, {
    body: JSON.stringify({
      id,
      token,
      type
    }),
    headers: {
      'Content-Type': 'application/json'
    },
    method: 'PUT'
  })

  const data = await response.json()

  if (data.error) {
    throw new ApiError(
      data.error.message,
      response.status.toString(),
      data.error.details
    )
  }

  return data.provider
}
