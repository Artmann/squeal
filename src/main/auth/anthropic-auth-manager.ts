import { randomBytes, createHash } from 'crypto'
import { safeStorage, net } from 'electron'

import { apiPort } from '../../main'
import { store } from '../store'

export interface AnthropicAuthConfig {
  clientId: string
  redirectUri: string
  scopes: string[]
}

export interface AnthropicTokens {
  accessToken: string
  expiresAt: number
  refreshToken: string
  tokenType: 'Bearer'
}

export interface AnthropicUser {
  email: string
  id: string
  subscription: 'free' | 'pro' | 'max'
}

export interface AuthState {
  error: AuthError | null
  isAuthenticated: boolean
  tokens: AnthropicTokens | null
  user: AnthropicUser | null
}

export interface AuthError {
  code: 'AUTH_FAILED' | 'TOKEN_EXPIRED' | 'REFRESH_FAILED' | 'NETWORK_ERROR'
  message: string
  timestamp: number
}

export interface PKCEChallenge {
  codeChallenge: string
  codeVerifier: string
  state: string
}

export class AnthropicAuthManager {
  private static instance: AnthropicAuthManager
  private config: AnthropicAuthConfig
  private currentPKCE: PKCEChallenge | null = null
  private refreshTimer: NodeJS.Timeout | null = null

  private constructor() {
    this.config = {
      clientId: 'Code Monkey',
      redirectUri: `http://localhost:${apiPort}/auth/callback`,
      scopes: ['api.access', 'account.read']
    }
  }

  static getInstance(): AnthropicAuthManager {
    if (!AnthropicAuthManager.instance) {
      AnthropicAuthManager.instance = new AnthropicAuthManager()
    }

    return AnthropicAuthManager.instance
  }

  buildAuthorizationUrl(): string {
    const pkce = this.generatePKCE()

    const params = new URLSearchParams({
      client_id: this.config.clientId,
      code_challenge_method: 'S256',
      code_challenge: pkce.codeChallenge,
      redirect_uri: this.config.redirectUri,
      response_type: 'code',
      scope: this.config.scopes.join(' '),
      state: pkce.state
    })

    return `https://console.anthropic.com/oauth/authorize?${params.toString()}`
  }

  async exchangeCodeForTokens(
    code: string,
    state: string
  ): Promise<AnthropicTokens> {
    if (!this.currentPKCE || this.currentPKCE.state !== state) {
      throw new Error('Invalid state parameter')
    }

    const response = await net.fetch(
      'https://console.anthropic.com/oauth/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: this.config.clientId,
          code,
          redirect_uri: this.config.redirectUri,
          code_verifier: this.currentPKCE.codeVerifier
        })
      }
    )

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${response.statusText}`)
    }

    const data = await response.json()
    const tokens: AnthropicTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + data.expires_in * 1000,
      tokenType: 'Bearer'
    }

    await this.storeTokens(tokens)

    this.scheduleTokenRefresh(tokens)

    return tokens
  }

  generatePKCE(): PKCEChallenge {
    const verifier = this.base64URLEncode(randomBytes(32))
    const challenge = this.base64URLEncode(
      createHash('sha256').update(verifier).digest()
    )
    const state = this.base64URLEncode(randomBytes(16))

    this.currentPKCE = {
      codeChallenge: challenge,
      codeVerifier: verifier,
      state
    }

    return this.currentPKCE
  }

  async logout(): Promise<void> {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
    }

    await store.delete('anthropic_tokens')
  }

  async refreshAccessToken(): Promise<AnthropicTokens> {
    const tokens = await this.getStoredTokens()
    if (!tokens?.refreshToken) {
      throw new Error('No refresh token available')
    }

    const response = await net.fetch(
      'https://console.anthropic.com/oauth/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: this.config.clientId,
          refresh_token: tokens.refreshToken
        })
      }
    )

    if (!response.ok) {
      throw new Error(`Token refresh failed: ${response.statusText}`)
    }

    const data = await response.json()
    const newTokens: AnthropicTokens = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token || tokens.refreshToken,
      expiresAt: Date.now() + data.expires_in * 1000,
      tokenType: 'Bearer'
    }

    await this.storeTokens(newTokens)
    this.scheduleTokenRefresh(newTokens)

    return newTokens
  }

  private base64URLEncode(buffer: Buffer): string {
    return buffer
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '')
  }

  private async getStoredTokens(): Promise<AnthropicTokens | null> {
    const encrypted = await store.get('anthropic_tokens')

    if (!encrypted) return null

    const decrypted = safeStorage.decryptString(
      Buffer.from(encrypted, 'base64')
    )
    return JSON.parse(decrypted)
  }

  private scheduleTokenRefresh(tokens: AnthropicTokens): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
    }

    // Refresh 5 minutes before expiration
    const refreshIn = tokens.expiresAt - Date.now() - 5 * 60 * 1000

    if (refreshIn > 0) {
      this.refreshTimer = setTimeout(() => {
        this.refreshAccessToken().catch(console.error)
      }, refreshIn)
    }
  }

  private async storeTokens(tokens: AnthropicTokens): Promise<void> {
    const encrypted = safeStorage.encryptString(JSON.stringify(tokens))

    await store.set('anthropic_tokens', encrypted.toString('base64'))
  }
}
