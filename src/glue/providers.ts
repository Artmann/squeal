export const providerTypes = ['anthropic', 'openai', 'google'] as const
export type ProviderType = (typeof providerTypes)[number]

export interface ProviderDto {
  id: string
  token: string
  type: ProviderType
}
