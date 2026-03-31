export interface WorksheetDto {
  content: string
  createdAt: number
  databaseId: string | null
  id: string
  lastOpenedAt: number | null
  name: string
}
