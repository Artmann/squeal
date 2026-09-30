import { beforeEach, describe, expect, it } from 'vitest'

import { createStore } from './index'
import { sidebarCollapsedStorageKey } from './sidebar-storage'
import { uiActions } from './ui-slice'

describe('createStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  describe('the collapsed sidebar', () => {
    it('starts expanded when nothing is stored', () => {
      const store = createStore()

      expect(store.getState().ui.sidebarCollapsed).toEqual(false)
    })

    it('starts collapsed when the last session collapsed it', () => {
      localStorage.setItem(sidebarCollapsedStorageKey, 'true')

      const store = createStore()

      expect(store.getState().ui.sidebarCollapsed).toEqual(true)
    })

    it('saves each toggle so it survives a restart', () => {
      const store = createStore()

      store.dispatch(uiActions.toggleSidebar())

      expect(localStorage.getItem(sidebarCollapsedStorageKey)).toEqual('true')

      store.dispatch(uiActions.toggleSidebar())

      expect(localStorage.getItem(sidebarCollapsedStorageKey)).toEqual('false')
    })

    it('does not write the preference on unrelated dispatches', () => {
      const store = createStore()

      store.dispatch(uiActions.openSettings())

      expect(localStorage.getItem(sidebarCollapsedStorageKey)).toEqual(null)
    })
  })
})
