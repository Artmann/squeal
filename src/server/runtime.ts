// Assembles the full backend into one layer and hands Electron a
// ManagedRuntime that owns it: building the runtime initializes the app
// database, runs the boot effects, starts the HTTP server, and forks the
// retention fibers; disposing it tears all of that down in reverse.
import { ConfigProvider, Layer, ManagedRuntime, Redacted } from 'effect'

import { boot } from './boot'
import { ApiToken } from './http/api-token'
import { HttpLive } from './http/server'
import { RetentionLive } from './retention'
import { AdapterFactory } from './services/adapter-factory'
import { AppDatabase } from './services/app-database'
import { DatabaseService } from './services/database-service'
import { QueryRunner } from './services/query-runner'
import { SecretStorage } from './services/secret-storage'
import { TraceStore } from './services/trace-store'
import { WorksheetService } from './services/worksheet-service'
import { TracerLive } from './tracing/effect-tracer'

export interface MainRuntimeOptions {
  allowedOrigins: string[]
  publicTraceReads: boolean
  token: string
}

const ServicesLive = Layer.mergeAll(
  AdapterFactory.Default,
  AppDatabase.Default,
  DatabaseService.Default,
  QueryRunner.Default,
  SecretStorage.Default,
  TraceStore.Default,
  WorksheetService.Default
)

// Providing the boot effects as a layer sequences them strictly before the
// server starts listening — the renderer can never poll a stale "running"
// query from the previous process.
const BootLive = Layer.effectDiscard(boot)

export function makeMainRuntime(options: MainRuntimeOptions) {
  const configuration = Layer.setConfigProvider(
    ConfigProvider.fromMap(
      new Map([
        ['ALLOWED_ORIGINS', options.allowedOrigins.join(',')],
        ['PUBLIC_TRACE_READS', String(options.publicTraceReads)]
      ])
    )
  )

  const MainLive = Layer.mergeAll(
    HttpLive.pipe(Layer.provide(BootLive)),
    RetentionLive
  ).pipe(
    Layer.provideMerge(ServicesLive),
    Layer.provide(Layer.succeed(ApiToken, Redacted.make(options.token))),
    Layer.provide(configuration),
    Layer.provideMerge(TracerLive)
  )

  return ManagedRuntime.make(MainLive)
}

export type MainRuntime = ReturnType<typeof makeMainRuntime>
