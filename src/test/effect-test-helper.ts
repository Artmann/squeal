// Layer-based test substitutes for the Effect services — no vi.mock. Tests
// compose these under the service layers they exercise and get a fresh
// in-memory app database per layer build.
import { HttpApiClient, HttpClient, HttpClientRequest } from '@effect/platform'
// Subpath import on purpose: the package barrel pulls in cluster modules
// whose optional peers are not installed.
import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer'
import { drizzle } from 'drizzle-orm/libsql'
import { ConfigProvider, Effect, Layer, Redacted } from 'effect'

import { createTables } from '@/database/tables'
import type { SchemaInfo, QueryResult } from '@/databases/adapter'
import { SquealApi } from '@/glue/api/api'
import type { DatabaseConnection } from '@/glue/api/schemas'
import { ApiToken } from '@/server/http/api-token'
import { ApiLive, CorsLive, ServeLive } from '@/server/http/server'
import {
  AppDatabase,
  makeAppDatabaseService
} from '@/server/services/app-database'
import { AdapterFactory } from '@/server/services/adapter-factory'
import { DatabaseService } from '@/server/services/database-service'
import { QueryRunner } from '@/server/services/query-runner'
import { SecretStorage } from '@/server/services/secret-storage'
import { TraceStore } from '@/server/services/trace-store'
import { WorksheetService } from '@/server/services/worksheet-service'

export const testEncryptionPrefix = 'enc:v1:test:'

// Mirrors the real storage's shape (enc:v1:<payload>) without touching the
// OS keychain, so assertions can check that secrets were stored encrypted.
export const TestSecretStorage = Layer.succeed(
  SecretStorage,
  SecretStorage.make({
    decrypt: (value: string) =>
      Effect.succeed(
        value.startsWith(testEncryptionPrefix)
          ? value.slice(testEncryptionPrefix.length)
          : value
      ),
    encrypt: (value: string) =>
      Effect.succeed(`${testEncryptionPrefix}${value}`),
    isEncryptionAvailable: Effect.succeed(true)
  })
)

export function makeTestAppDatabase(): Layer.Layer<AppDatabase> {
  return Layer.effect(
    AppDatabase,
    Effect.promise(async () => {
      const client = drizzle(':memory:')

      await createTables(client)

      return AppDatabase.make(makeAppDatabaseService(client))
    })
  )
}

export interface TestAdapterConfig {
  cancel?: () => Promise<void>
  getSchema?: () => Promise<SchemaInfo>
  getServerVersion?: () => Promise<string>
  runQuery?: (query: string) => Promise<QueryResult>
  testConnection?: () => Promise<void>
}

export interface TestAdapterState {
  // The connection info the last adapter was created with — lets tests
  // assert the password-merge behavior without ever exposing passwords in
  // responses.
  lastConnectionInfo: unknown
  lastType: string | null
}

const defaultTestQueryResult: QueryResult = {
  fields: [{ name: 'value' }],
  rowCount: 1,
  rows: [{ value: 1 }],
  truncated: false
}

const defaultTestSchema: SchemaInfo = {
  databaseName: 'test',
  tables: []
}

export function makeTestAdapterFactory(config: TestAdapterConfig = {}) {
  const state: TestAdapterState = {
    lastConnectionInfo: null,
    lastType: null
  }

  const layer = Layer.succeed(
    AdapterFactory,
    AdapterFactory.make({
      create: (connection: DatabaseConnection) => {
        state.lastConnectionInfo = connection.connectionInfo
        state.lastType = connection.type

        return {
          cancel: config.cancel ?? (() => Promise.resolve()),
          getSchema:
            config.getSchema ?? (() => Promise.resolve(defaultTestSchema)),
          // Left off entirely unless a test asks for it, so the default
          // adapter keeps covering the "cannot report a version" path.
          ...(config.getServerVersion === undefined
            ? {}
            : { getServerVersion: config.getServerVersion }),
          runQuery:
            config.runQuery ?? (() => Promise.resolve(defaultTestQueryResult)),
          testConnection: config.testConnection ?? (() => Promise.resolve())
        }
      }
    })
  )

  return { layer, state }
}

// --- HTTP harness ------------------------------------------------------------
// Serves the real API implementation on an ephemeral in-process server
// (NodeHttpServer.layerTest) and exposes an HttpClient wired to it, so route
// tests exercise auth, decoding, and status mapping end to end.

export const testApiToken = 'test-api-token'

export interface TestApiOptions {
  adapter?: TestAdapterConfig
  // Defaults to the packaged profile: one allowed origin, so the CORS fast-path
  // regression stays covered.
  allowedOrigins?: string[]
  publicTraceReads?: boolean
}

export function makeTestApi(options: TestApiOptions = {}) {
  const adapterFactory = makeTestAdapterFactory(options.adapter)

  const services = Layer.mergeAll(
    QueryRunner.DefaultWithoutDependencies,
    TraceStore.DefaultWithoutDependencies,
    WorksheetService.DefaultWithoutDependencies
  ).pipe(
    Layer.provideMerge(DatabaseService.DefaultWithoutDependencies),
    Layer.provideMerge(adapterFactory.layer),
    Layer.provideMerge(makeTestAppDatabase()),
    Layer.provideMerge(TestSecretStorage)
  )

  const configuration = Layer.setConfigProvider(
    ConfigProvider.fromMap(
      new Map([
        ['ALLOWED_ORIGINS', (options.allowedOrigins ?? ['null']).join(',')],
        ['PUBLIC_TRACE_READS', String(options.publicTraceReads ?? false)]
      ])
    )
  )

  // ServeLive and CorsLive come from the production module so the harness runs
  // the real host guard, body limit, and CORS behaviour.
  const layer = ServeLive.pipe(
    Layer.provide(CorsLive),
    Layer.provide(ApiLive),
    Layer.provideMerge(services),
    Layer.provide(Layer.succeed(ApiToken, Redacted.make(testApiToken))),
    Layer.provide(configuration),
    Layer.provideMerge(NodeHttpServer.layerTest)
  )

  return { adapterState: adapterFactory.state, layer }
}

// A typed client for the served test API, authenticated with the test token.
export const makeAuthorizedClient = HttpApiClient.make(SquealApi, {
  transformClient: HttpClient.mapRequest(
    HttpClientRequest.setHeader('authorization', `Bearer ${testApiToken}`)
  )
})
