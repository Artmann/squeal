import type {
  CompletionResult,
  CompletionSource
} from '@codemirror/autocomplete'
import { sql, type SQLDialect, type SQLNamespace } from '@codemirror/lang-sql'
import type { Extension } from '@codemirror/state'
import { toast } from 'sonner'

import { listLocalCompletions } from './sql-completion-locals'
import { toCodeMirrorDialect } from './sql-dialect'
import { findJoinContext, listJoinCompletions } from './sql-join-completions'
import { buildSqlNamespace, findDefaultSchemaName } from './sql-namespace'
import {
  findSchemaNotice,
  type WorksheetSchemaStatus
} from '../worksheet-schema-status'
import type { DatabaseType, SchemaInfoDto } from '@/glue/api/schemas'

export interface SqlLanguageOptions {
  databaseType: DatabaseType | undefined

  /**
   * Read at completion time rather than passed by value, so a schema that
   * changes from `loading` to `error` never has to reconfigure the editor —
   * only the sentence shown to the user changes, and nothing about the
   * language does.
   */
  getSchemaStatus: () => WorksheetSchemaStatus

  schema: SchemaInfoDto | undefined
}

// The word being completed. `matchBefore` returning an empty range means the
// cursor is not inside a word, which is only worth completing when the user
// asked for it outright.
const wordBefore = /[\w$]*/
const wordSpan = /^[\w$]*$/

// An empty result and no result are not the same thing to CodeMirror: an empty
// one still claims the range and stops the tooltip closing, so a source with
// nothing to say returns null.
function toCompletionResult(
  from: number,
  options: CompletionResult['options']
): CompletionResult | null {
  if (options.length === 0) {
    return null
  }

  return { from, options, validFor: wordSpan }
}

// A completion source is the one place that knows the user asked rather than
// typed: `context.explicit` is true however the request was triggered, so this
// covers every key bound to completion rather than one of them — which matters
// because the key that triggers it differs by platform, and on macOS the
// obvious ones are spoken for by Spotlight and the input-source switcher.
//
// It contributes no completions — it exists for the sentence. Returning null is
// what keeps it out of the list while still letting the schema and keyword
// sources answer normally.
function createNoticeSource(
  getSchemaStatus: () => WorksheetSchemaStatus
): CompletionSource {
  return (context) => {
    if (!context.explicit) {
      return null
    }

    const notice = findSchemaNotice(getSchemaStatus())

    if (!notice) {
      return null
    }

    // A fixed id so holding the shortcut down stacks one toast rather than a
    // column of identical ones.
    toast.info(notice.title, {
      description: notice.description,
      id: 'sql-schema-unavailable'
    })

    return null
  }
}

// Depends on nothing but the document, so it is built once rather than per
// reconfigure.
const localSource: CompletionSource = (context) => {
  const word = context.matchBefore(wordBefore)

  if (!word || (word.from === word.to && !context.explicit)) {
    return null
  }

  // After a dot the user is naming a column of something, and a CTE or
  // subquery alias is never that.
  if (context.state.sliceDoc(word.from - 1, word.from) === '.') {
    return null
  }

  return toCompletionResult(
    word.from,
    listLocalCompletions(context.state.doc.toString(), context.pos)
  )
}

function createJoinSource(
  dialect: SQLDialect,
  schema: SchemaInfoDto
): CompletionSource {
  return (context) => {
    const word = context.matchBefore(wordBefore)

    if (!word || (word.from === word.to && !context.explicit)) {
      return null
    }

    const joinContext = findJoinContext(context.state.doc.toString(), word.from)

    if (!joinContext) {
      return null
    }

    return toCompletionResult(
      word.from,
      listJoinCompletions(joinContext, schema, dialect)
    )
  }
}

// A malformed payload costs the editor its suggestions; it must not cost the
// user their editor. Everything below the language itself is decoration, so a
// throw here degrades to keyword-only completion rather than failing the
// reconfigure and leaving the worksheet without a parser.
function buildNamespace(
  schema: SchemaInfoDto | undefined,
  dialect: SQLDialect
): SQLNamespace | undefined {
  if (!schema) {
    return undefined
  }

  try {
    return buildSqlNamespace(schema, dialect)
  } catch (error) {
    console.error('Could not build SQL completions from the schema.', error)

    return undefined
  }
}

/**
 * The whole SQL language for one worksheet: dialect, schema, and the three
 * completion sources lang-sql does not supply.
 *
 * Built as a unit and held in a `Compartment` the editor hook reconfigures,
 * which is what keeps the schema out of the `extensions` array. That array's
 * identity is load-bearing — see the comment at the top of
 * `use-worksheet-editor` for what a reconfigure of the whole editor costs.
 */
export function createSqlLanguage(options: SqlLanguageOptions): Extension {
  const { databaseType, getSchemaStatus, schema } = options

  const dialect = toCodeMirrorDialect(databaseType)
  const namespace = buildNamespace(schema, dialect)

  const sources: CompletionSource[] = [
    createNoticeSource(getSchemaStatus),
    localSource
  ]

  if (schema && namespace) {
    sources.push(createJoinSource(dialect, schema))
  }

  return [
    sql({
      defaultSchema: schema
        ? findDefaultSchemaName(schema, databaseType)
        : undefined,
      dialect,
      schema: namespace,
      upperCaseKeywords: true
    }),
    ...sources.map((source) =>
      dialect.language.data.of({ autocomplete: source })
    )
  ]
}
