export const queryKeys = {
  databases: ['databases'] as const,
  health: ['health'] as const,
  queries: ['queries'] as const,
  query: (id: string) => ['query', id] as const,
  schema: (databaseId: string) => ['schema', databaseId] as const,
  traces: (filters: { errorOnly: boolean; search: string }) =>
    ['traces', filters] as const,
  traceSpans: (traceId: string) => ['traces', 'spans', traceId] as const,
  updateStatus: ['updates'] as const,
  worksheets: ['worksheets'] as const
}
