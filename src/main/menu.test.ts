import type { MenuItemConstructorOptions } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockBuildFromTemplate, mockSetApplicationMenu } = vi.hoisted(() => ({
  mockBuildFromTemplate: vi.fn((template: unknown) => ({ template })),
  mockSetApplicationMenu: vi.fn()
}))

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: mockBuildFromTemplate,
    setApplicationMenu: mockSetApplicationMenu
  }
}))

import { applyApplicationMenu, buildTemplate } from './menu'

const originalPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', {
    configurable: true,
    value: platform
  })
}

// Every role anywhere in the template, submenus included, so a role cannot hide
// one level down from an assertion made at the top.
function rolesIn(template: MenuItemConstructorOptions[]): string[] {
  return template.flatMap((item) => [
    ...(item.role ? [item.role] : []),
    ...(Array.isArray(item.submenu)
      ? rolesIn(item.submenu as MenuItemConstructorOptions[])
      : [])
  ])
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  setPlatform(originalPlatform)
})

describe('buildTemplate', () => {
  // The whole reason this module exists. Electron's default menu binds these
  // two to Mod-R and Mod-Shift-R, and a menu accelerator beats anything the
  // renderer registers -- so the Databases refresh shortcut reloaded the
  // window. Nothing about a frameless window suggests a menu is doing it.
  it('binds neither Reload nor Force Reload', () => {
    setPlatform('darwin')

    const roles = rolesIn(buildTemplate())

    expect(roles).not.toContain('reload')
    expect(roles).not.toContain('forceReload')
  })

  // The other half of the trap: dropping the menu entirely also frees Mod-R,
  // and takes copy and paste with it on macOS.
  it('keeps the Edit menu, which is what supplies copy and paste on macOS', () => {
    setPlatform('darwin')

    expect(rolesIn(buildTemplate())).toContain('editMenu')
  })

  it('keeps the app menu on macOS, where Quit and Hide live in it', () => {
    setPlatform('darwin')

    expect(buildTemplate()[0]).toEqual({ role: 'appMenu' })
  })

  it('leaves the app menu out where there is no app menu', () => {
    setPlatform('win32')

    expect(rolesIn(buildTemplate())).not.toContain('appMenu')
    expect(buildTemplate()[0]).toEqual({ role: 'editMenu' })
  })

  it('still offers the dev tools and the zoom and fullscreen roles', () => {
    setPlatform('darwin')

    const roles = rolesIn(buildTemplate())

    expect(roles).toContain('toggleDevTools')
    expect(roles).toContain('resetZoom')
    expect(roles).toContain('zoomIn')
    expect(roles).toContain('zoomOut')
    expect(roles).toContain('togglefullscreen')
    expect(roles).toContain('windowMenu')
  })
})

describe('applyApplicationMenu', () => {
  it('installs the built template as the application menu', () => {
    setPlatform('darwin')

    applyApplicationMenu()

    expect(mockBuildFromTemplate).toHaveBeenCalledWith(buildTemplate())
    expect(mockSetApplicationMenu).toHaveBeenCalledWith({
      template: buildTemplate()
    })
  })
})
