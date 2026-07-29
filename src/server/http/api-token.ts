import { Context, Redacted } from 'effect'

// The per-session bearer token, minted at boot in the Electron main process
// and handed to the renderer over IPC — never printed or persisted.
export class ApiToken extends Context.Tag('ApiToken')<
  ApiToken,
  Redacted.Redacted<string>
>() {}
