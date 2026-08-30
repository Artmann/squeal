// Layer-based test substitutes for the Effect services — no vi.mock. Tests
// compose these under the service layers they exercise and get a fresh
// in-memory app database per layer build.
import { HttpApiClient, HttpClient, HttpClientRequest } from '@effect/platform'
// Subpath import on purpose: the package barrel pulls in cluster modules
// whose optional peers are not installed.
import * as NodeHttpServer from '@effect/platform-node/NodeHttpServer'
import { Effect, Layer, Redacted } from 'effect'

import type { SchemaInfo, QueryResult } from '@/databases/adapter'
import { SquealApi } from '@/glue/api/api'
import { UpdateNotReadyError } from '@/glue/api/errors'
import type { DatabaseConnection, SecretStorageMode } from '@/glue/api/schemas'
import type {
  EncryptionState,
  KeychainProbeResult
} from '@/main/databases/secret-storage'
import { updateMessages } from '@/main/updates/updater'
import { ServerConfig } from '@/server/config'
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
import { SecretStorageSettings } from '@/server/services/secret-storage-settings'
import { TraceStore } from '@/server/services/trace-store'
import { Updater } from '@/server/services/updater'
import { WorksheetService } from '@/server/services/worksheet-service'
import type { UpdateStatus } from '@/main/updates/updater'

import { createInMemoryDatabase } from './in-memory-database'

export const testEncryptionPrefix = 'enc:v1:test:'

// Mirrors the real storage's shape (enc:v1:<payload>) without touching the OS
// keychain, so assertions can check that secrets were stored encrypted.
//
// encrypt and decrypt deliberately ignore the mode: whether the gate holds is a
// property of the real module and is covered by
// src/main/databases/secret-storage.test.ts. What matters here is that the
// encryption state round-trips through setMode, and that it lives in this
// closure rather than in the real module's process-global.
//
// `sealing` is what a caller sets to get a keychain that answers every save
// with the plaintext it was handed — the shape of one that broke after
// permission was granted, and the only way to reach the code that copes.
//
// It deliberately survives `setMode`, where the real module resets sealing to
// `working` on every mode change: a test says "this keychain is broken" once
// and means it for the whole request, including the `setMode('keychain')` that
// granting does on the way in.
interface TestSecretStorageOptions {
  probeResult?: KeychainProbeResult
  sealing?: 'failed' | 'working'
}

function makeTestSecretStorage(options: TestSecretStorageOptions = {}) {
  const { probeResult = 'available', sealing = 'working' } = options

  const stateForMode = (mode: SecretStorageMode): EncryptionState =>
    mode === 'keychain'
      ? { mode, sealing }
      : { mode, warnedAboutPlaintext: false }

  let state: EncryptionState = stateForMode('keychain')

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
        Effect.succeed(
          state.mode === 'keychain' && state.sealing === 'working'
            ? `${testEncryptionPrefix}${value}`
            : value
        ),
      probe: Effect.sync(() => probeResult),
      setMode: (next: SecretStorageMode) =>
        Effect.sync(() => {
          state = stateForMode(next)
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

export function makeTestAppDatabase(): Layer.Layer<AppDatabase> {
  return Layer.effect(
    AppDatabase,
    Effect.promise(async () =>
      AppDatabase.make(makeAppDatabaseService(await createInMemoryDatabase()))
    )
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

        // Wrapped because the real factory loads its driver on demand and so
        // answers with an Effect. `succeed`, not `promise`: the stub has
        // nothing to wait for, and keeping it synchronous means a test still
        // observes the adapter in the same step it asks for one.
        return Effect.succeed({
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
        })
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
  allowedOrigins?: ReadonlyArray<string>
  publicTraceReads?: boolean
  // What the keychain answers when the user asks for encryption.
  secretStorageProbe?: KeychainProbeResult
  // 'failed' gives a keychain that grants permission and then refuses to
  // seal anything, which is how one that broke afterwards behaves.
  secretStorageSealing?: 'failed' | 'working'
  updateStatus?: UpdateStatus
}

export function makeTestApi(options: TestApiOptions = {}) {
  const adapterFactory = makeTestAdapterFactory(options.adapter)
  const secretStorage = makeTestSecretStorage({
    probeResult: options.secretStorageProbe,
    sealing: options.secretStorageSealing
  })
  const updater = makeTestUpdater(options.updateStatus)

  const services = Layer.mergeAll(
    QueryRunner.DefaultWithoutDependencies,
    SecretStorageSettings.DefaultWithoutDependencies,
    TraceStore.DefaultWithoutDependencies,
    WorksheetService.DefaultWithoutDependencies
  ).pipe(
    Layer.provideMerge(DatabaseService.DefaultWithoutDependencies),
    Layer.provideMerge(adapterFactory.layer),
    Layer.provideMerge(makeTestAppDatabase()),
    Layer.provideMerge(secretStorage.layer),
    Layer.provideMerge(updater.layer)
  )

  const configuration = Layer.succeed(ServerConfig, {
    allowedOrigins: options.allowedOrigins ?? ['null'],
    publicTraceReads: options.publicTraceReads ?? false
  })

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
    updaterState: updater.state
  }
}

// A typed client for the served test API, authenticated with the test token.
export const makeAuthorizedClient = HttpApiClient.make(SquealApi, {
  transformClient: HttpClient.mapRequest(
    HttpClientRequest.setHeader('authorization', `Bearer ${testApiToken}`)
  )
})
