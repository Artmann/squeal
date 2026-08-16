import { Deferred, Effect, Layer } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SchemaInfo } from '@/databases/adapter'
import {
  completionMessages,
  downloadMessages,
  suggestedModel
} from '@/glue/completions'
import {
  makeTestAdapterFactory,
  makeTestAppDatabase,
  makeTestOllama,
  testOllamaHost,
  TestSecretStorage,
  type TestAdapterConfig,
  type TestOllamaConfig
} from '@/test/effect-test-helper'
import { AppDatabase } from './app-database'
import { AppSettings } from './app-settings'
import { Completions, selectModel } from './completions'
import { DatabaseService } from './database-service'

interface HarnessOptions {
  adapter?: TestAdapterConfig
  ollama?: TestOllamaConfig
}

function makeHarness(options: HarnessOptions = {}) {
  const adapterFactory = makeTestAdapterFactory(options.adapter)
  const ollama = makeTestOllama(options.ollama)

  const layer = Completions.DefaultWithoutDependencies.pipe(
    Layer.provideMerge(AppSettings.DefaultWithoutDependencies),
    Layer.provideMerge(DatabaseService.DefaultWithoutDependencies),
    Layer.provideMerge(adapterFactory.layer),
    Layer.provideMerge(ollama.layer),
    Layer.provideMerge(makeTestAppDatabase()),
    Layer.provideMerge(TestSecretStorage)
  )

  const run = <A, E>(
    effect: Effect.Effect<
      A,
      E,
      AppDatabase | AppSettings | Completions | DatabaseService
    >
  ): Promise<A> => Effect.runPromise(Effect.provide(effect, layer))

  return { ollamaState: ollama.state, run }
}

// The connection is never opened — the test adapter answers from config — but
// the row has to exist for the schema lookup to reach it.
function seedDatabase() {
  return Effect.gen(function* () {
    const databases = yield* DatabaseService

    const { database } = yield* databases.create('Pagila', {
      connectionInfo: {
        database: 'pagila',
        host: '127.0.0.1',
        password: 'secret',
        port: 5432,
        username: 'postgres'
      },
      type: 'postgres'
    })

    return database.id
  })
}

const filmSchema: SchemaInfo = {
  databaseName: 'pagila',
  tables: [
    {
      columns: [
        {
          columnName: 'film_id',
          dataType: 'integer',
          defaultValue: null,
          isNullable: false,
          isPrimaryKey: true,
          ordinalPosition: 1
        },
        {
          columnName: 'title',
          dataType: 'text',
          defaultValue: null,
          isNullable: false,
          isPrimaryKey: false,
          ordinalPosition: 2
        }
      ],
      foreignKeys: [],
      tableName: 'film',
      tableSchema: 'public'
    }
  ]
}

afterEach(() => {
  vi.useRealTimers()
})

describe('selectModel', () => {
  it('uses the stored model when it is still installed', () => {
    expect(selectModel(['llama3.2:3b', 'codegemma:2b'], 'llama3.2:3b')).toEqual(
      {
        selectedModel: 'llama3.2:3b',
        storedModelMissing: false
      }
    )
  })

  it('prefers coding models in order when nothing is stored', () => {
    expect(
      selectModel(['llama3.2:3b', 'codellama:7b', 'qwen2.5-coder:1.5b'], null)
    ).toEqual({
      selectedModel: 'qwen2.5-coder:1.5b',
      storedModelMissing: false
    })
  })

  it('matches a preferred model by its tag', () => {
    expect(selectModel(['deepseek-coder:6.7b-instruct'], null)).toEqual({
      selectedModel: 'deepseek-coder:6.7b-instruct',
      storedModelMissing: false
    })
  })

  it('falls back to whatever is installed when none are coding models', () => {
    expect(selectModel(['llama3.2:3b', 'mistral:7b'], null)).toEqual({
      selectedModel: 'llama3.2:3b',
      storedModelMissing: false
    })
  })

  it('reports a stored model that is gone and falls back', () => {
    expect(selectModel(['codegemma:2b'], 'qwen2.5-coder:1.5b')).toEqual({
      selectedModel: 'codegemma:2b',
      storedModelMissing: true
    })
  })

  it('answers with no model when nothing is installed', () => {
    expect(selectModel([], 'qwen2.5-coder:1.5b')).toEqual({
      selectedModel: null,
      storedModelMissing: true
    })
  })
})

describe('Completions.status', () => {
  it('says how to install Ollama when it is not answering', async () => {
    const { run } = makeHarness()

    expect(await run(Completions.status())).toEqual({
      available: false,
      enabled: true,
      message: completionMessages.unreachable(testOllamaHost),
      models: [],
      reachable: false,
      selectedModel: null
    })
  })

  it('says how to pull a model when Ollama has none', async () => {
    const { run } = makeHarness({ ollama: { models: [] } })

    expect(await run(Completions.status())).toEqual({
      available: false,
      enabled: true,
      message: completionMessages.noModels,
      models: [],
      reachable: true,
      selectedModel: null
    })
  })

  it('reports the model it will use', async () => {
    const { run } = makeHarness({
      ollama: { models: ['llama3.2:3b', 'qwen2.5-coder:1.5b'] }
    })

    expect(await run(Completions.status())).toEqual({
      available: true,
      enabled: true,
      message: completionMessages.using('qwen2.5-coder:1.5b'),
      models: ['llama3.2:3b', 'qwen2.5-coder:1.5b'],
      reachable: true,
      selectedModel: 'qwen2.5-coder:1.5b'
    })
  })

  it('says when the chosen model is no longer installed', async () => {
    const { run } = makeHarness({ ollama: { models: ['codegemma:2b'] } })

    const status = await run(
      Effect.gen(function* () {
        yield* AppSettings.update({ aiCompletionModel: 'qwen2.5-coder:1.5b' })

        return yield* Completions.status()
      })
    )

    expect(status).toEqual({
      available: true,
      enabled: true,
      message: completionMessages.modelMissing('codegemma:2b'),
      models: ['codegemma:2b'],
      reachable: true,
      selectedModel: 'codegemma:2b'
    })
  })

  it('still reports the model when suggestions are turned off', async () => {
    const { run } = makeHarness({ ollama: { models: ['codegemma:2b'] } })

    const status = await run(
      Effect.gen(function* () {
        yield* AppSettings.update({ aiCompletionsEnabled: false })

        return yield* Completions.status()
      })
    )

    expect(status).toEqual({
      available: true,
      enabled: false,
      message: completionMessages.disabled('codegemma:2b'),
      models: ['codegemma:2b'],
      reachable: true,
      selectedModel: 'codegemma:2b'
    })
  })

  it('asks Ollama again on every read, so a just-started server shows up', async () => {
    const { ollamaState, run } = makeHarness({ ollama: { models: [] } })

    await run(
      Effect.gen(function* () {
        yield* Completions.status()
        yield* Completions.status()
      })
    )

    expect(ollamaState.listCalls).toEqual(2)
  })
})

describe('Completions.complete', () => {
  it('returns the model answer, cleaned up', async () => {
    const { ollamaState, run } = makeHarness({
      ollama: {
        models: ['qwen2.5-coder:1.5b'],
        response: '```sql\nselect title\nfrom film\n```'
      }
    })

    const result = await run(
      Completions.complete({ prefix: 'select ', suffix: '' })
    )

    // The fence is gone and so is the echoed 'select ', which is already on
    // screen at the cursor.
    expect(result).toEqual({ completion: 'title\nfrom film' })
    expect(ollamaState.lastModel).toEqual('qwen2.5-coder:1.5b')
  })

  it('puts the schema of the attached database in the prompt', async () => {
    const { ollamaState, run } = makeHarness({
      adapter: { getSchema: () => Promise.resolve(filmSchema) },
      ollama: { models: ['codegemma:2b'], response: 'title from film' }
    })

    await run(
      Effect.gen(function* () {
        const databaseId = yield* seedDatabase()

        return yield* Completions.complete({
          databaseId,
          prefix: 'select ',
          suffix: ''
        })
      })
    )

    expect(ollamaState.lastPrompt).toContain(
      'public.film(film_id integer PK, title text)'
    )
    expect(ollamaState.lastPrompt).toContain('PostgreSQL autocomplete engine')
  })

  it('loads a schema once and reuses it for later suggestions', async () => {
    let schemaLoads = 0

    const { run } = makeHarness({
      adapter: {
        getSchema: () => {
          schemaLoads++

          return Promise.resolve(filmSchema)
        }
      },
      ollama: { models: ['codegemma:2b'], response: 'title' }
    })

    await run(
      Effect.gen(function* () {
        const databaseId = yield* seedDatabase()

        yield* Completions.complete({
          databaseId,
          prefix: 'select ',
          suffix: ''
        })
        yield* Completions.complete({
          databaseId,
          prefix: 'select t',
          suffix: ''
        })
      })
    )

    expect(schemaLoads).toEqual(1)
  })

  it('still suggests when the schema cannot be loaded', async () => {
    const { run } = makeHarness({
      adapter: {
        getSchema: () => Promise.reject(new Error('too many connections'))
      },
      ollama: { models: ['codegemma:2b'], response: 'title' }
    })

    const result = await run(
      Effect.gen(function* () {
        const databaseId = yield* seedDatabase()

        return yield* Completions.complete({
          databaseId,
          prefix: 'select ',
          suffix: ''
        })
      })
    )

    expect(result).toEqual({ completion: 'title' })
  })

  it('suggests nothing when suggestions are turned off', async () => {
    const { ollamaState, run } = makeHarness({
      ollama: { models: ['codegemma:2b'], response: 'title' }
    })

    const result = await run(
      Effect.gen(function* () {
        yield* AppSettings.update({ aiCompletionsEnabled: false })

        return yield* Completions.complete({ prefix: 'select ', suffix: '' })
      })
    )

    expect(result).toEqual({ completion: null })
    expect(ollamaState.generateCalls).toEqual(0)
  })

  it('suggests nothing when Ollama is not running', async () => {
    const { ollamaState, run } = makeHarness()

    const result = await run(
      Completions.complete({ prefix: 'select ', suffix: '' })
    )

    expect(result).toEqual({ completion: null })
    expect(ollamaState.generateCalls).toEqual(0)
  })

  it('suggests nothing when the model fails, and does not fail the request', async () => {
    const { run } = makeHarness({
      ollama: { models: ['codegemma:2b'], response: '   ' }
    })

    expect(
      await run(Completions.complete({ prefix: 'select ', suffix: '' }))
    ).toEqual({ completion: null })
  })

  it('suggests nothing for an empty statement', async () => {
    const { ollamaState, run } = makeHarness({
      ollama: { models: ['codegemma:2b'], response: 'select 1' }
    })

    const result = await run(
      Completions.complete({ prefix: '   \n', suffix: '' })
    )

    expect(result).toEqual({ completion: null })
    expect(ollamaState.generateCalls).toEqual(0)
  })

  it('checks whether Ollama is there once, not on every keystroke pause', async () => {
    const { ollamaState, run } = makeHarness({
      ollama: { models: ['codegemma:2b'], response: 'title' }
    })

    await run(
      Effect.gen(function* () {
        yield* Completions.complete({ prefix: 'select ', suffix: '' })
        yield* Completions.complete({ prefix: 'select t', suffix: '' })
        yield* Completions.complete({ prefix: 'select ti', suffix: '' })
      })
    )

    expect(ollamaState.listCalls).toEqual(1)
  })

  it('checks again once the cached answer has expired', async () => {
    // Only Date is faked: Effect's scheduler still needs real timers.
    vi.useFakeTimers({ toFake: ['Date'] })

    const { ollamaState, run } = makeHarness({
      ollama: { models: ['codegemma:2b'], response: 'title' }
    })

    // Both calls share one layer build, because the cache belongs to the
    // service instance.
    await run(
      Effect.gen(function* () {
        yield* Completions.complete({ prefix: 'select ', suffix: '' })

        yield* Effect.sync(() => vi.advanceTimersByTime(6 * 60 * 1000))

        yield* Completions.complete({ prefix: 'select ', suffix: '' })
      })
    )

    expect(ollamaState.listCalls).toEqual(2)
  })
})

describe('Completions download', () => {
  it('reports nothing until a download is asked for', async () => {
    const { run } = makeHarness({ ollama: { models: [] } })

    expect(await run(Completions.downloadStatus())).toEqual({
      message: '',
      model: null,
      percent: 0,
      state: 'idle'
    })
  })

  it('turns the byte counts Ollama reports into a percentage', async () => {
    const latch = Effect.runSync(Deferred.make<void>())

    const { run } = makeHarness({
      ollama: {
        models: [],
        pullLatch: latch,
        pullProgress: [
          { completed: 0, status: 'pulling manifest', total: 0 },
          { completed: 250, status: 'pulling 4c1b0e1e', total: 1000 }
        ]
      }
    })

    const status = await run(
      Effect.gen(function* () {
        yield* Completions.startDownload()

        // The pull runs in a forked fiber, so the progress it reports lands
        // after this one yields.
        yield* Effect.sleep('20 millis')

        return yield* Completions.downloadStatus()
      })
    )

    expect(status).toEqual({
      message: 'pulling 4c1b0e1e',
      model: suggestedModel,
      percent: 25,
      state: 'downloading'
    })
  })

  it('says the model is installed once the pull finishes', async () => {
    const { ollamaState, run } = makeHarness({ ollama: { models: [] } })

    const status = await run(
      Effect.gen(function* () {
        yield* Completions.startDownload()

        yield* Effect.sleep('20 millis')

        return yield* Completions.downloadStatus()
      })
    )

    expect(status).toEqual({
      message: downloadMessages.done(suggestedModel),
      model: suggestedModel,
      percent: 100,
      state: 'done'
    })

    expect(ollamaState.lastModel).toEqual(suggestedModel)
  })

  it('rereads the model list after a download, so the new model appears', async () => {
    const { ollamaState, run } = makeHarness({ ollama: { models: [] } })

    await run(
      Effect.gen(function* () {
        // Warms the availability cache, which a download is then expected to
        // drop.
        yield* Completions.complete({ prefix: 'select ', suffix: '' })

        yield* Completions.startDownload()

        yield* Effect.sleep('20 millis')

        yield* Completions.complete({ prefix: 'select ', suffix: '' })
      })
    )

    expect(ollamaState.listCalls).toEqual(2)
  })

  it('explains a download that failed and leaves it startable again', async () => {
    const { run } = makeHarness({
      ollama: { models: [], pullFailure: 'no space left on device' }
    })

    const status = await run(
      Effect.gen(function* () {
        yield* Completions.startDownload()

        yield* Effect.sleep('20 millis')

        return yield* Completions.downloadStatus()
      })
    )

    expect(status).toEqual({
      message: downloadMessages.failed(
        suggestedModel,
        'no space left on device'
      ),
      model: suggestedModel,
      percent: 0,
      state: 'error'
    })
  })

  it('does not start a second pull of the same model', async () => {
    const latch = Effect.runSync(Deferred.make<void>())

    const { ollamaState, run } = makeHarness({
      ollama: { models: [], pullLatch: latch }
    })

    const second = await run(
      Effect.gen(function* () {
        yield* Completions.startDownload()

        yield* Effect.sleep('20 millis')

        return yield* Completions.startDownload()
      })
    )

    expect(second.state).toEqual('downloading')
    expect(ollamaState.pullCalls).toEqual(1)
  })

  it('interrupts the pull when the user cancels', async () => {
    const latch = Effect.runSync(Deferred.make<void>())

    const { ollamaState, run } = makeHarness({
      ollama: { models: [], pullLatch: latch }
    })

    const status = await run(
      Effect.gen(function* () {
        yield* Completions.startDownload()

        yield* Effect.sleep('20 millis')

        return yield* Completions.cancelDownload()
      })
    )

    expect(status).toEqual({
      message: '',
      model: null,
      percent: 0,
      state: 'idle'
    })

    expect(ollamaState.pullsInterrupted).toEqual(1)
  })

  it('cancels nothing when no download is running', async () => {
    const { ollamaState, run } = makeHarness({ ollama: { models: [] } })

    expect(await run(Completions.cancelDownload())).toEqual({
      message: '',
      model: null,
      percent: 0,
      state: 'idle'
    })

    expect(ollamaState.pullCalls).toEqual(0)
  })
})
