// Turns whatever a local model actually returned into something safe to insert
// at the cursor.
//
// Small instruction-tuned models are unreliable in a handful of predictable
// ways — they wrap answers in markdown fences, they restate the text they were
// asked to continue, and they pad with blank lines. None of that is a failure
// worth surfacing, so it is cleaned up here rather than shown to the user.

// A model that restates the prompt usually restates the tail of it. Comparing
// the whole prefix would miss that, and comparing too little would strip real
// output that happens to repeat a word the user just typed.
const maxEchoLength = 200

// Matches an opening fence with an optional language tag, for an answer whose
// fence was never closed.
const openingFencePattern = /^\s*```[a-zA-Z]*\s*\n?/

// A chattier model ignores "no code fences" and answers with prose around a
// fenced block. Taking the first block is what turns that answer into something
// insertable instead of a paragraph of English in the editor.
const fencedBlockPattern = /```[a-zA-Z]*[ \t]*\n?([\s\S]*?)```/

export function normalizeCompletion(
  raw: string,
  prefix: string
): string | null {
  const unfenced = stripFences(raw)
  const unechoed = stripEchoedPrefix(unfenced, prefix)

  // Leading blank lines would push the suggestion away from the cursor, but
  // leading spaces on the first line can be meaningful, so only newlines go.
  const trimmed = unechoed.replace(/^\n+/, '').trimEnd()

  if (trimmed.trim().length === 0) {
    return null
  }

  return trimmed
}

function stripFences(value: string): string {
  const block = value.match(fencedBlockPattern)

  if (block !== null) {
    return block[1] ?? ''
  }

  if (!openingFencePattern.test(value)) {
    return value
  }

  return value.replace(openingFencePattern, '')
}

// The user's text is what the model was told to continue. When the answer
// starts by repeating it, inserting the answer verbatim would duplicate what is
// already on screen.
function stripEchoedPrefix(value: string, prefix: string): string {
  const tail = prefix.slice(-maxEchoLength)

  for (let length = tail.length; length > 0; length--) {
    const candidate = tail.slice(tail.length - length)

    if (value.startsWith(candidate)) {
      return value.slice(candidate.length)
    }
  }

  return value
}
