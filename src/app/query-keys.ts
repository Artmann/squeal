export const queryKeys = {
  databases: ['databases'] as const,
  queries: ['queries'] as const,
  query: (id: string) => ['query', id] as const,
  schema: (databaseId: string) => ['schema', databaseId] as const,
  worksheets: ['worksheets'] as const
}
