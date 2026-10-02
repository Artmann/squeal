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

// Read from `pg_constraint` rather than `information_schema`, because only the
// catalog keeps the two column lists side by side: `conkey[i]` references
// `confkey[i]`. `constraint_column_usage` has no position at all, so joining it
// by constraint name paired every column of a composite key with every column
// it references, and — since constraint names are only unique per table —
// with the columns of any same-named constraint in another schema too.
//
// One row per column pair, ordered by its position in the key, so a consumer
// can rebuild a composite key from consecutive rows.
export const postgresForeignKeysQuery = `
SELECT
  referencing_namespace.nspname AS table_schema,
  referencing_table.relname AS table_name,
  referencing_column.attname AS column_name,
  foreign_key.conname AS constraint_name,
  referenced_namespace.nspname AS referenced_table_schema,
  referenced_table.relname AS referenced_table_name,
  referenced_column.attname AS referenced_column_name
FROM pg_constraint foreign_key
CROSS JOIN LATERAL unnest(foreign_key.conkey, foreign_key.confkey)
  WITH ORDINALITY AS pair(column_number, referenced_column_number, position)
JOIN pg_class referencing_table
  ON referencing_table.oid = foreign_key.conrelid
JOIN pg_namespace referencing_namespace
  ON referencing_namespace.oid = referencing_table.relnamespace
JOIN pg_attribute referencing_column
  ON referencing_column.attrelid = foreign_key.conrelid
  AND referencing_column.attnum = pair.column_number
JOIN pg_class referenced_table
  ON referenced_table.oid = foreign_key.confrelid
JOIN pg_namespace referenced_namespace
  ON referenced_namespace.oid = referenced_table.relnamespace
JOIN pg_attribute referenced_column
  ON referenced_column.attrelid = foreign_key.confrelid
  AND referenced_column.attnum = pair.referenced_column_number
WHERE foreign_key.contype = 'f'
  AND referencing_namespace.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY
  referencing_namespace.nspname,
  referencing_table.relname,
  foreign_key.conname,
  pair.position
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

// `KEY_COLUMN_USAGE` carries the referenced column on the same row as the
// referencing one, so composite keys already pair up correctly here. The order
// is what lets a consumer rebuild one from consecutive rows.
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
ORDER BY
  kcu.TABLE_SCHEMA,
  kcu.TABLE_NAME,
  kcu.CONSTRAINT_NAME,
  kcu.ORDINAL_POSITION
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

  // Sort by table name first so the explorer shows one flat alphabetical list.
  // A database can spread tables across several schemas, and the explorer does
  // not surface the schema, so grouping by schema would look out of order.
  // Schema is only the tiebreaker for identically named tables.
  const tables = Array.from(tableMap.values()).sort((a, b) => {
    const nameCompare = a.tableName.localeCompare(b.tableName)

    if (nameCompare !== 0) {
      return nameCompare
    }

    return a.tableSchema.localeCompare(b.tableSchema)
  })

  return {
    databaseName,
    tables
  }
}
