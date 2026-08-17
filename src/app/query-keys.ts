// Every per-database schema key hangs off this prefix, so a refresh can
// invalidate all of them in one call. `schema` derives from it so the two
// cannot drift apart.
const schemasKey = ['schema'] as const

export const queryKeys = {
  databases: ['databases'] as const,
  queries: ['queries'] as const,
  query: (id: string) => ['query', id] as const,
  schema: (databaseId: string) => [...schemasKey, databaseId] as const,
  schemas: schemasKey,
  secretStorage: ['secret-storage'] as const,
  traces: (filters: { errorOnly: boolean; search: string }) =>
    ['traces', filters] as const,
  traceSpans: (traceId: string) => ['traces', 'spans', traceId] as const,
  updateStatus: ['updates'] as const,
  worksheets: ['worksheets'] as const
}
