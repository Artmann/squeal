// Layer-based test substitutes for the Effect services — no vi.mock. Tests
// compose these under the service layers they exercise and get a fresh
// in-memory app database per layer build.
import { HttpApiClient, HttpClient, HttpClientRequest } from '@effect/platform'
// Subpath import on purpose: the package barrel pulls in cluster modules
// whose optional peers are not installed.
import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer'
import { drizzle } from 'drizzle-orm/libsql'
import { ConfigProvider, Deferred, Effect, Layer, Redacted } from 'effect'

import { createTables } from '@/database/tables'
import type { SchemaInfo, QueryResult } from '@/databases/adapter'
import { SquealApi } from '@/glue/api/api'
import { UpdateNotReadyError } from '@/glue/api/errors'
import type { DatabaseConnection, SecretStorageMode } from '@/glue/api/schemas'
import type { KeychainProbeResult } from '@/main/databases/secret-storage'
import { updateMessages } from '@/main/updates/updater'
import { ApiToken } from '@/server/http/api-token'
import { ApiLive, CorsLive, ServeLive } from '@/server/http/server'
import {
  AppDatabase,
  makeAppDatabaseService
} from '@/server/services/app-database'
import { AdapterFactory } from '@/server/services/adapter-factory'
import { AppSettings } from '@/server/services/app-settings'
import { Completions } from '@/server/services/completions'
import { DatabaseService } from '@/server/services/database-service'
import { Ollama } from '@/server/services/ollama'
import type {
  OllamaGenerateOptions,
  OllamaPullOptions
} from '@/server/services/ollama'
import type { PullProgress } from '@/main/ai/ollama-client'
import { OllamaError } from '@/server/errors'
import { QueryRunner } from '@/server/services/query-runner'
import { SecretStorage } from '@/server/services/secret-storage'
import { SecretStorageSettings } from '@/server/services/secret-storage-settings'
import { TraceStore } from '@/server/services/trace-store'
import { Updater } from '@/server/services/updater'
import { WorksheetService } from '@/server/services/worksheet-service'
import type { UpdateStatus } from '@/main/updates/updater'

export const testEncryptionPrefix = 'enc:v1:test:'

// Mirrors the real storage's shape (enc:v1:<payload>) without touching the OS
// keychain, so assertions can check that secrets were stored encrypted.
//
// encrypt and decrypt deliberately ignore the mode: whether the gate holds is a
// property of the real module and is covered by
// src/main/databases/secret-storage.test.ts. What matters here is that the mode
// round-trips through setMode, and that it lives in this closure rather than in
// the real module's process-global.
function makeTestSecretStorage(probeResult: KeychainProbeResult = 'available') {
  let mode: SecretStorageMode = 'keychain'

  const layer = Layer.succeed(
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
      mode: Effect.sync(() => mode),
      probe: Effect.sync(() => probeResult),
      setMode: (next: SecretStorageMode) =>
        Effect.sync(() => {
          mode = next
        })
    })
  )

  return { layer }
}

// The default substitute, kept as a layer so the suites that only need
// transparent encryption can provide it directly.
export const TestSecretStorage = makeTestSecretStorage().layer

export const idleUpdateStatus: UpdateStatus = {
  currentVersion: '1.2.0',
  lastCheckedAt: null,
  message: null,
  releaseNotesUrl: null,
  state: 'idle',
  version: null
}

export interface TestUpdaterState {
  checks: number
  installs: number
}

// The real service attaches listeners to Electron's autoUpdater, so tests never
// build Default. `status` is fixed per layer: route tests care about how a
// given status is served, not about driving transitions — that is
// src/main/updates/updater.test.ts's job.
function makeTestUpdater(status: UpdateStatus = idleUpdateStatus) {
  const state: TestUpdaterState = { checks: 0, installs: 0 }

  const layer = Layer.succeed(
    Updater,
    Updater.make({
      check: Effect.sync(() => {
        state.checks++
      }),
      install: () =>
        Effect.gen(function* () {
          if (status.state !== 'ready') {
            return yield* new UpdateNotReadyError({
              message: updateMessages.notReady
            })
          }

          state.installs++

          return status
        }),
      status: Effect.succeed(status)
    })
  )

  return { layer, state }
}

export interface TestOllamaConfig {
  // Undefined means Ollama is not answering at all — the case every test of
  // the "silently absent" behaviour needs.
  models?: string[]
  // Each entry is reported before the pull resolves, so a test can drive the
  // percentage the same way a real download would.
  pullProgress?: PullProgress[]
  // When set, the pull fails with this message instead of succeeding.
  pullFailure?: string
  // Held open until released, so a test can observe the state mid-download.
  pullLatch?: Deferred.Deferred<void>
  response?: string
}

export interface TestOllamaState {
  generateCalls: number
  lastModel: string | null
  lastPrompt: string | null
  listCalls: number
  pullCalls: number
  pullsInterrupted: number
}

export const testOllamaHost = 'http://127.0.0.1:11434'

// The real service talks to a local HTTP server, so tests substitute it rather
// than building Default. `src/main/ai/ollama-client.test.ts` covers the wire
// format; what matters here is which model was asked and with what prompt.
export function makeTestOllama(config: TestOllamaConfig = {}) {
  const state: TestOllamaState = {
    generateCalls: 0,
    lastModel: null,
    lastPrompt: null,
    listCalls: 0,
    pullCalls: 0,
    pullsInterrupted: 0
  }

  const unreachable = new OllamaError({
    message: 'fetch failed'
  })

  const layer = Layer.succeed(
    Ollama,
    Ollama.make({
      generate: ({ model, prompt }: OllamaGenerateOptions) =>
        Effect.suspend(() => {
          state.generateCalls++
          state.lastModel = model
          state.lastPrompt = prompt

          if (config.models === undefined) {
            return Effect.fail(unreachable)
          }

          return Effect.succeed(config.response ?? '')
        }),
      host: testOllamaHost,
      listModels: Effect.suspend(() => {
        state.listCalls++

        if (config.models === undefined) {
          return Effect.fail(unreachable)
        }

        return Effect.succeed(config.models)
      }),
      pullModel: ({ model, onProgress }: OllamaPullOptions) =>
        Effect.gen(function* () {
          state.pullCalls++
          state.lastModel = model

          for (const progress of config.pullProgress ?? []) {
            onProgress(progress)
          }

          if (config.pullLatch !== undefined) {
            yield* Deferred.await(config.pullLatch)
          }

          if (config.pullFailure !== undefined) {
            return yield* Effect.fail(
              new OllamaError({ message: config.pullFailure })
            )
          }
        }).pipe(
          Effect.onInterrupt(() =>
            Effect.sync(() => {
              state.pullsInterrupted++
            })
          )
        )
    })
  )

  return { layer, state }
}

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
  // Defaults to an Ollama that is not running, which is the state most
  // machines — and most test runs — are in.
  ollama?: TestOllamaConfig
  publicTraceReads?: boolean
  // What the keychain answers when the user asks for encryption.
  secretStorageProbe?: KeychainProbeResult
  updateStatus?: UpdateStatus
}

export function makeTestApi(options: TestApiOptions = {}) {
  const adapterFactory = makeTestAdapterFactory(options.adapter)
  const ollama = makeTestOllama(options.ollama)
  const secretStorage = makeTestSecretStorage(options.secretStorageProbe)
  const updater = makeTestUpdater(options.updateStatus)

  const services = Layer.mergeAll(
    Completions.DefaultWithoutDependencies,
    QueryRunner.DefaultWithoutDependencies,
    SecretStorageSettings.DefaultWithoutDependencies,
    TraceStore.DefaultWithoutDependencies,
    WorksheetService.DefaultWithoutDependencies
  ).pipe(
    Layer.provideMerge(AppSettings.DefaultWithoutDependencies),
    Layer.provideMerge(DatabaseService.DefaultWithoutDependencies),
    Layer.provideMerge(adapterFactory.layer),
    Layer.provideMerge(ollama.layer),
    Layer.provideMerge(makeTestAppDatabase()),
    Layer.provideMerge(secretStorage.layer),
    Layer.provideMerge(updater.layer)
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

  return {
    adapterState: adapterFactory.state,
    layer,
    ollamaState: ollama.state,
    updaterState: updater.state
  }
}

// A typed client for the served test API, authenticated with the test token.
export const makeAuthorizedClient = HttpApiClient.make(SquealApi, {
  transformClient: HttpClient.mapRequest(
    HttpClientRequest.setHeader('authorization', `Bearer ${testApiToken}`)
  )
})
