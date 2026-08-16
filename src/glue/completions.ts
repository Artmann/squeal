// Shared between the main process and the renderer. Keep this module free of
// main-process imports — the renderer bundles it.
//
// Every sentence the Settings screen can show about AI suggestions. The server
// picks one and sends it in `CompletionStatusResponse.message`, so the strings
// have a single home and can be asserted on from either side.

// The smallest model worth suggesting: it fits in memory on a laptop and is
// good enough at SQL to be useful.
export const suggestedModel = 'qwen2.5-coder:1.5b'

// Roughly what qwen2.5-coder:1.5b weighs on disk. Approximate on purpose — it
// is in the button so nobody starts a download of an unknown size, not so it
// can be reconciled against the byte count.
export const suggestedModelSize = '~1 GB'

export const completionMessages = {
  disabled: (model: string): string => `Turn suggestions on to use ${model}.`,
  modelMissing: (model: string): string =>
    `The model "${model}" is no longer installed. Pick another model, or run \`ollama pull ${model}\`.`,
  noModels: `Ollama is running but has no models installed. Download ${suggestedModel} to start getting suggestions.`,
  unreachable: (host: string): string =>
    `Squeal could not reach Ollama at ${host}. Install it from ollama.com and make sure it is running, then reopen Settings.`,
  using: (model: string): string =>
    `Using ${model}. Suggestions appear as you type.`
}

// A download is a deliberate user action, so unlike a suggestion its failures
// are worth a sentence. They still travel as data — `state: 'error'` and one of
// these — rather than through an error channel, the way update checks do.
export const downloadMessages = {
  done: (model: string): string =>
    `${model} is installed. Suggestions will start appearing as you type.`,
  failed: (model: string, reason: string): string =>
    `Could not download ${model}. ${reason} Check your internet connection and that Ollama is still running, then try again.`,
  starting: (model: string): string => `Starting the download of ${model}…`
}
