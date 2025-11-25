import { ReactElement } from 'react'

export function App(): ReactElement {
  return (
    <main className="w-full flex">
      <div>
        <header className="flex pt-3">
          <div>Databases</div>
          <div>Worksheets</div>
        </header>
      </div>

      <div className="flex-1">
        <header className="w-full py-3"></header>

        <div>
          <div>Editor</div>
          <div>Results</div>
        </div>
      </div>
    </main>
  )
}
