import { beforeEach, describe, expect, it } from 'vitest'

import { BootstrapData } from '@/main/bootstrap'
import { WorksheetDto } from '@/glue/worksheets'

import { createStore } from './index'

const testWorksheets: WorksheetDto[] = [
  {
    id: 'ws-1',
    name: 'First',
    content: '',
    createdAt: 1000,
    databaseId: null,
    lastOpenedAt: null
  },
  {
    id: 'ws-2',
    name: 'Second',
    content: '',
    createdAt: 2000,
    databaseId: 'db-1',
    lastOpenedAt: 300
  }
]

describe('createStore', () => {
  beforeEach(() => {
    window.__BOOTSTRAP_DATA__ = {
      apiPort: 7847,
      databases: [],
      worksheets: testWorksheets
    } as BootstrapData
  })

  it('should use lastOpenWorksheetId from bootstrap data when available', () => {
    window.__BOOTSTRAP_DATA__ = {
      apiPort: 7847,
      databases: [],
      lastOpenWorksheetId: 'ws-2',
      worksheets: testWorksheets
    }

    const store = createStore()

    expect(store.getState().editor.openWorksheetId).toEqual('ws-2')
  })

  it('should fall back to first worksheet when lastOpenWorksheetId is undefined', () => {
    window.__BOOTSTRAP_DATA__ = {
      apiPort: 7847,
      databases: [],
      worksheets: testWorksheets
    }

    const store = createStore()

    expect(store.getState().editor.openWorksheetId).toEqual('ws-1')
  })
})
