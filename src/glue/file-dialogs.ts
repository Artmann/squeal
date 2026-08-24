// The catalogue of native file pickers the renderer can ask for. It names one
// of these rather than passing dialog options across the bridge: an options
// object the renderer controlled could ask for directories, hidden files or
// `promptToCreate`, and nothing in the app wants any of those.
//
// Plain data, no `electron` import, so the main process and the renderer can
// both read it.
interface FileDialog {
  filters: Array<{ extensions: string[]; name: string }>
  title: string
}

export const fileDialogs = {
  certificate: {
    // The "All Files" escape hatch is not decoration: corporate CA bundles
    // turn up as `ca-bundle`, as `.txt`, and with no extension at all.
    filters: [
      { extensions: ['pem', 'crt', 'cer', 'cert', 'ca'], name: 'Certificate' },
      { extensions: ['*'], name: 'All Files' }
    ],
    title: 'Select CA Certificate'
  },
  sqliteDatabase: {
    filters: [
      { extensions: ['db', 'sqlite', 'sqlite3'], name: 'SQLite Database' }
    ],
    title: 'Select SQLite Database'
  }
  // Annotated through `satisfies` rather than a type annotation: the keys have
  // to stay literal for `FileDialogKind` below to name them.
} satisfies Record<string, FileDialog>

export type FileDialogKind = keyof typeof fileDialogs
