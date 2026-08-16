// Shared between the main process and the renderer. Keep this module free of
// main-process imports — the renderer bundles it.
//
// Every sentence the Settings screen can show about AI suggestions. The server
// picks one and sends it in `CompletionStatusResponse.message`, so the strings
// have a single home and can be asserted on from either side.

// The smallest model worth suggesting: it fits in memory on a laptop and is
// good enough at SQL to be useful.
export const suggestedModel = 'qwen2.5-coder:1.5b'

export const completionMessages = {
  disabled: (model: string): string => `Turn suggestions on to use ${model}.`,
  modelMissing: (model: string): string =>
    `The model "${model}" is no longer installed. Pick another model, or run \`ollama pull ${model}\`.`,
  noModels: `Ollama is running but has no models installed. Run \`ollama pull ${suggestedModel}\` in a terminal, then reopen Settings.`,
  unreachable: (host: string): string =>
    `Squeal could not reach Ollama at ${host}. Install it from ollama.com and make sure it is running, then reopen Settings.`,
  using: (model: string): string =>
    `Using ${model}. Suggestions appear as you type.`
}
