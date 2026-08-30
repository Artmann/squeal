import { Menu, type MenuItemConstructorOptions } from 'electron'

// Electron installs a default application menu when nothing sets one, and its
// View submenu binds Reload to Mod-R and Force Reload to Mod-Shift-R. Menu
// accelerators win over anything the renderer registers, so an app shortcut on
// either key reloads the window instead of running its handler -- and nothing
// about this window suggests a menu exists at all: it is frameless with
// `titleBarStyle: 'hidden'`, and on macOS the menu bar is off-window entirely.
//
// `Menu.setApplicationMenu(null)` is not the fix. On macOS the standard Edit
// menu is what supplies Mod-C, Mod-V, Mod-X, Mod-A and Mod-Z to the renderer,
// so removing the menu breaks copy and paste app-wide. What is wanted is the
// default menu minus two items, which means writing the template out.
//
// So: `reload` and `forceReload` are deliberately absent below. Do not add them
// back without moving the renderer's refresh shortcut off Mod-R first -- the
// window reloading in place of a refresh is exactly the bug this file exists to
// prevent, and it is silent.
export function applyApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate(buildTemplate()))
}

// Exported for the test: the guard worth having is on the template, since the
// regression is a role reappearing in it.
export function buildTemplate(): MenuItemConstructorOptions[] {
  // The app menu carries Quit, Hide and About, and only macOS has one. On
  // Windows and Linux those live elsewhere and a template entry for them would
  // render as a stray "squeal" menu.
  const appMenu: MenuItemConstructorOptions[] =
    process.platform === 'darwin' ? [{ role: 'appMenu' }] : []

  return [
    ...appMenu,
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
}
