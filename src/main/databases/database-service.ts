import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'

import { database } from '@/database'
import { databasesTable, worksheetsTable } from '@/database/schema'
import { ApiError } from '@/errors'
import type {
  ConnectionInfo,
  DatabaseType,
  PublicConnectionInfo,
  UpdateConnectionInfo
} from '@/databases/schemas'
import { DatabaseDto } from '@/glue/databases'
import { WorksheetDto } from '@/glue/worksheets'
import { safeStorageSecretStorage, type SecretStorage } from './secret-storage'

export interface CreateDatabaseResult {
  database: DatabaseDto
  updatedWorksheet?: WorksheetDto
}

export interface DatabaseWithSecrets {
  connectionInfo: ConnectionInfo
  id: string
  name: string
  type: DatabaseType
}

export class DatabaseService {
  private readonly secretStorage: SecretStorage

  constructor(secretStorage: SecretStorage = safeStorageSecretStorage) {
    this.secretStorage = secretStorage
  }

  async createDatabase(
    name: string,
    connectionInfo: ConnectionInfo,
    type: DatabaseType
  ): Promise<CreateDatabaseResult> {
    const [record] = await database
      .insert(databasesTable)
      .values({
        connectionInfo: this.secretStorage.encrypt(
          JSON.stringify(connectionInfo)
        ),
        name,
        type
      })
      .returning()

    const databaseDto = this.transformDatabase(record)

    // If this is the first database and there's a worksheet without a database, connect it.
    const existingDatabases = await database
      .select()
      .from(databasesTable)
      .where(isNull(databasesTable.deletedAt))

    let updatedWorksheet: WorksheetDto | undefined

    if (existingDatabases.length === 1) {
      const worksheetsWithoutDatabase = await database
        .select()
        .from(worksheetsTable)
        .where(
          and(
            isNull(worksheetsTable.deletedAt),
            isNull(worksheetsTable.databaseId)
          )
        )

      if (worksheetsWithoutDatabase.length === 1) {
        const [updated] = await database
          .update(worksheetsTable)
          .set({ databaseId: databaseDto.id })
          .where(eq(worksheetsTable.id, worksheetsWithoutDatabase[0].id))
          .returning()

        updatedWorksheet = {
          content: updated.content,
          createdAt: updated.createdAt,
          databaseId: updated.databaseId ?? null,
          id: updated.id,
          lastOpenedAt: updated.lastOpenedAt ?? null,
          name: updated.name,
          sortOrder: updated.sortOrder ?? null
        }
      }
    }

    return { database: databaseDto, updatedWorksheet }
  }

  async getDatabase(id: string): Promise<DatabaseDto | null> {
    const record = await this.findActiveRecord(id)

    if (!record) {
      return null
    }

    return this.transformDatabase(record)
  }

  // Returns the decrypted connection info, password included. Main-process
  // use only (adapter construction) — never send this to the renderer.
  async getDatabaseWithSecrets(
    id: string
  ): Promise<DatabaseWithSecrets | null> {
    const record = await this.findActiveRecord(id)

    if (!record) {
      return null
    }

    return {
      connectionInfo: this.parseConnectionInfo(record.connectionInfo),
      id: record.id,
      name: record.name,
      type: record.type as DatabaseType
    }
  }

  async listDatabases(): Promise<DatabaseDto[]> {
    const records = await database
      .select()
      .from(databasesTable)
      .where(isNull(databasesTable.deletedAt))
      .orderBy(
        sql`${databasesTable.sortOrder} is null`,
        asc(databasesTable.sortOrder),
        asc(databasesTable.createdAt)
      )

    return records.map((record) => this.transformDatabase(record))
  }

  // Only writes sortOrder — reordering must never touch connectionInfo, which
  // updateDatabase would re-encrypt.
  async reorderDatabases(databaseIds: string[]): Promise<DatabaseDto[]> {
    const records = await database
      .select({ id: databasesTable.id })
      .from(databasesTable)
      .where(
        and(
          inArray(databasesTable.id, databaseIds),
          isNull(databasesTable.deletedAt)
        )
      )

    if (records.length !== databaseIds.length) {
      throw new ApiError(400, 'One or more database ids are unknown.')
    }

    for (const [index, id] of databaseIds.entries()) {
      await database
        .update(databasesTable)
        .set({ sortOrder: index })
        .where(eq(databasesTable.id, id))
    }

    return this.listDatabases()
  }

  async updateDatabase(
    id: string,
    name: string,
    connectionInfo: UpdateConnectionInfo,
    type: DatabaseType
  ): Promise<DatabaseDto> {
    const resolvedConnectionInfo = await this.resolveConnectionInfo(
      id,
      connectionInfo,
      type
    )

    const [record] = await database
      .update(databasesTable)
      .set({
        connectionInfo: this.secretStorage.encrypt(
          JSON.stringify(resolvedConnectionInfo)
        ),
        name,
        type
      })
      .where(eq(databasesTable.id, id))
      .returning()

    return this.transformDatabase(record)
  }

  private async findActiveRecord(id: string) {
    const [record] = await database
      .select()
      .from(databasesTable)
      .where(and(eq(databasesTable.id, id), isNull(databasesTable.deletedAt)))
      .limit(1)

    return record ?? null
  }

  private parseConnectionInfo(value: string): ConnectionInfo {
    return JSON.parse(this.secretStorage.decrypt(value)) as ConnectionInfo
  }

  // An update without a password means "keep the stored one" — the renderer
  // never sees passwords, so edits can't send them back.
  private async resolveConnectionInfo(
    id: string,
    connectionInfo: UpdateConnectionInfo,
    type: DatabaseType
  ): Promise<ConnectionInfo> {
    if (!('username' in connectionInfo) || connectionInfo.password) {
      return connectionInfo as ConnectionInfo
    }

    const existing = await this.getDatabaseWithSecrets(id)
    const storedPassword =
      existing &&
      existing.type === type &&
      'password' in existing.connectionInfo
        ? existing.connectionInfo.password
        : ''

    return { ...connectionInfo, password: storedPassword }
  }

  private transformDatabase(
    record: typeof databasesTable.$inferSelect
  ): DatabaseDto {
    return {
      connectionInfo: toPublicConnectionInfo(
        this.parseConnectionInfo(record.connectionInfo)
      ),
      createdAt: record.createdAt,
      id: record.id,
      name: record.name,
      sortOrder: record.sortOrder ?? null,
      type: record.type as DatabaseType
    }
  }
}

function toPublicConnectionInfo(
  connectionInfo: ConnectionInfo
): PublicConnectionInfo {
  if (!('password' in connectionInfo)) {
    return connectionInfo
  }

  const publicInfo: Partial<typeof connectionInfo> = { ...connectionInfo }

  delete publicInfo.password

  return publicInfo as PublicConnectionInfo
}
