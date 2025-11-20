import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'

import ChartPage from './pages/ChartPage'
import { StartPage } from './pages/StartPage'
import { SidebarProvider } from './components/ui/sidebar'
import { AppSidebar } from './components/AppSidebar'

export function App() {
  return (
    <Router>
      <SidebarProvider>
        <AppSidebar />

        <main>
          <Routes>
            <Route
              path="/"
              element={<StartPage />}
            />
            <Route
              path="/chat"
              element={<ChartPage />}
            />
          </Routes>
        </main>
      </SidebarProvider>
    </Router>
  )
}
