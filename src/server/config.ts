import { Context } from 'effect'

// The two deployment knobs the main process decides at boot: which origins the
// renderer may call from, and whether trace reads are open to tooling that
// sends no Origin. Both are read straight off this tag, so a layer that forgets
// to supply them fails to compile rather than falling back to a default nobody
// chose -- and the values arrive as themselves, not as strings to be parsed.
//
// A separate module because `runtime.ts`, the only producer in the app, imports
// `http/server.ts`, one of the two consumers.
//
// Deliberately not the home of the session token, which has its own tag: this
// pair is plain deployment configuration, and keeping the secret out of the
// record is what stops the CORS layer from being able to read it.
interface ServerConfiguration {
  readonly allowedOrigins: ReadonlyArray<string>
  readonly publicTraceReads: boolean
}

export class ServerConfig extends Context.Tag('ServerConfig')<
  ServerConfig,
  ServerConfiguration
>() {}
