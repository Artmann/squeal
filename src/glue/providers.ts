export const providerTypes = ['anthropic', 'google', 'openai'] as const
export type ProviderType = (typeof providerTypes)[number]

export const providerNames: Record<ProviderType, string> = {
  anthropic: 'Anthropic',
  google: 'Google',
  openai: 'OpenAI'
} as const

export interface ProviderDto {
  id: string
  token: string
  type: ProviderType
}
