interface CharacterRange {
  end: number
  start: number
}

interface LineRange {
  endLine: number
  startLine: number
}

// Converts a statement's character range to the document positions of the
// first character of every line it covers — the anchors gutter markers need.
export function findGutterMarkerPositions(
  content: string,
  statement: CharacterRange
): number[] {
  const range = findStatementLineRange(content, statement)

  if (!range) {
    return []
  }

  const lines = content.split('\n')
  const positions: number[] = []
  let characterPosition = 0

  for (let i = 0; i < lines.length; i++) {
    if (i >= range.startLine && i <= range.endLine) {
      positions.push(characterPosition)
    }

    characterPosition += lines[i].length + 1
  }

  return positions
}

export function findStatementLineRange(
  content: string,
  statement: CharacterRange
): LineRange | null {
  const lines = content.split('\n')

  let lineStart = 0
  let startLine = -1
  let endLine = -1

  for (let i = 0; i < lines.length; i++) {
    const lineEnd = lineStart + lines[i].length

    if (startLine === -1 && statement.start <= lineEnd) {
      startLine = i
    }

    if (statement.end <= lineEnd + 1) {
      endLine = i
      break
    }

    lineStart = lineEnd + 1
  }

  if (startLine === -1) {
    return null
  }

  if (endLine === -1) {
    endLine = lines.length - 1
  }

  return { endLine, startLine }
}
