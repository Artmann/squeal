import type { DatabaseAdapter, QueryResult, SchemaInfo } from '@/databases/adapter'

export interface MockAdapterConfig {
  getSchema?: () => Promise<SchemaInfo>
  runQuery?: (query: string) => Promise<QueryResult>
  testConnection?: () => Promise<void>
}

/**
 * A configurable mock database adapter for testing.
 * By default, returns empty results. Configure specific behaviors via the config object.
 */
export class MockAdapter implements DatabaseAdapter {
  private config: MockAdapterConfig

  constructor(config: MockAdapterConfig = {}) {
    this.config = config
  }

  async getSchema(): Promise<SchemaInfo> {
    if (this.config.getSchema) {
      return this.config.getSchema()
    }

    return {
      databaseName: 'test_database',
      tables: []
    }
  }

  async runQuery(query: string): Promise<QueryResult> {
    if (this.config.runQuery) {
      return this.config.runQuery(query)
    }

    return {
      fields: [],
      rowCount: 0,
      rows: []
    }
  }

  async testConnection(): Promise<void> {
    if (this.config.testConnection) {
      return this.config.testConnection()
    }

    // Default: connection succeeds.
  }
}

/**
 * Creates a mock adapter that returns the specified query result.
 */
export function createMockAdapterWithResult(result: QueryResult): MockAdapter {
  return new MockAdapter({
    runQuery: async () => result
  })
}

/**
 * Creates a mock adapter that throws an error on query execution.
 */
export function createMockAdapterWithError(errorMessage: string): MockAdapter {
  return new MockAdapter({
    runQuery: async () => {
      throw new Error(errorMessage)
    }
  })
}

/**
 * Creates a mock adapter that fails to connect.
 */
export function createMockAdapterWithConnectionError(
  errorMessage: string
): MockAdapter {
  return new MockAdapter({
    testConnection: async () => {
      throw new Error(errorMessage)
    }
  })
}
