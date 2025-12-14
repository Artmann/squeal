import type {
  ColumnInfo,
  ForeignKeyInfo,
  SchemaInfo,
  TableInfo
} from './adapter'

export const postgresColumnsQuery = `
SELECT
  c.table_schema,
  c.table_name,
  c.column_name,
  c.ordinal_position,
  c.data_type,
  c.is_nullable,
  c.column_default,
  CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END as is_primary_key
FROM information_schema.columns c
LEFT JOIN (
  SELECT
    kcu.table_schema,
    kcu.table_name,
    kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
  WHERE tc.constraint_type = 'PRIMARY KEY'
) pk ON c.table_schema = pk.table_schema
  AND c.table_name = pk.table_name
  AND c.column_name = pk.column_name
WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY c.table_schema, c.table_name, c.ordinal_position
`

export const postgresForeignKeysQuery = `
SELECT
  tc.table_schema,
  tc.table_name,
  kcu.column_name,
  tc.constraint_name,
  ccu.table_schema AS referenced_table_schema,
  ccu.table_name AS referenced_table_name,
  ccu.column_name AS referenced_column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
`

export const mysqlColumnsQuery = `
SELECT
  c.TABLE_SCHEMA as table_schema,
  c.TABLE_NAME as table_name,
  c.COLUMN_NAME as column_name,
  c.ORDINAL_POSITION as ordinal_position,
  c.DATA_TYPE as data_type,
  c.IS_NULLABLE as is_nullable,
  c.COLUMN_DEFAULT as column_default,
  CASE WHEN c.COLUMN_KEY = 'PRI' THEN true ELSE false END as is_primary_key
FROM information_schema.COLUMNS c
WHERE c.TABLE_SCHEMA = DATABASE()
ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION
`

export const mysqlForeignKeysQuery = `
SELECT
  kcu.TABLE_SCHEMA as table_schema,
  kcu.TABLE_NAME as table_name,
  kcu.COLUMN_NAME as column_name,
  kcu.CONSTRAINT_NAME as constraint_name,
  kcu.REFERENCED_TABLE_SCHEMA as referenced_table_schema,
  kcu.REFERENCED_TABLE_NAME as referenced_table_name,
  kcu.REFERENCED_COLUMN_NAME as referenced_column_name
FROM information_schema.KEY_COLUMN_USAGE kcu
WHERE kcu.TABLE_SCHEMA = DATABASE()
  AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
`

export interface ColumnRow {
  column_default: string | null
  column_name: string
  data_type: string
  is_nullable: string
  is_primary_key: boolean | number
  ordinal_position: number
  table_name: string
  table_schema: string
}

export interface ForeignKeyRow {
  column_name: string
  constraint_name: string
  referenced_column_name: string
  referenced_table_name: string
  referenced_table_schema: string
  table_name: string
  table_schema: string
}

export function transformToSchemaInfo(
  databaseName: string,
  columnRows: ColumnRow[],
  foreignKeyRows: ForeignKeyRow[]
): SchemaInfo {
  const tableMap = new Map<string, TableInfo>()

  for (const row of columnRows) {
    const tableKey = `${row.table_schema}.${row.table_name}`

    let table = tableMap.get(tableKey)

    if (!table) {
      table = {
        columns: [],
        foreignKeys: [],
        tableName: row.table_name,
        tableSchema: row.table_schema
      }
      tableMap.set(tableKey, table)
    }

    const column: ColumnInfo = {
      columnName: row.column_name,
      dataType: row.data_type,
      defaultValue: row.column_default,
      isNullable: row.is_nullable === 'YES',
      isPrimaryKey: Boolean(row.is_primary_key),
      ordinalPosition: row.ordinal_position
    }

    table.columns.push(column)
  }

  for (const row of foreignKeyRows) {
    const tableKey = `${row.table_schema}.${row.table_name}`
    const table = tableMap.get(tableKey)

    if (table) {
      const foreignKey: ForeignKeyInfo = {
        columnName: row.column_name,
        constraintName: row.constraint_name,
        referencedColumnName: row.referenced_column_name,
        referencedTableName: row.referenced_table_name,
        referencedTableSchema: row.referenced_table_schema
      }

      table.foreignKeys.push(foreignKey)
    }
  }

  const tables = Array.from(tableMap.values()).sort((a, b) => {
    const schemaCompare = a.tableSchema.localeCompare(b.tableSchema)

    if (schemaCompare !== 0) {
      return schemaCompare
    }

    return a.tableName.localeCompare(b.tableName)
  })

  return {
    databaseName,
    tables
  }
}
