import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'

import { AppSidebar } from './components/AppSidebar'
import { SidebarProvider } from './components/ui/sidebar'
import { Toaster } from './components/ui/sonner'
import ChartPage from './pages/ChartPage'
import { ProvidersPage } from './pages/ProvidersPage'
import { StartPage } from './pages/StartPage'
import { ProviderPage } from './pages/ProviderPage'

export function App() {
  return (
    <Router>
      <SidebarProvider>
        <AppSidebar />

        <main className="w-full">
          <Routes>
            <Route
              path="/"
              element={<StartPage />}
            />
            <Route
              path="/chat"
              element={<ChartPage />}
            />
            <Route
              path="/chat"
              element={<ChartPage />}
            />
            <Route
              path="/providers"
              element={<ProvidersPage />}
            />
            <Route
              path="/providers/:id"
              element={<ProviderPage />}
            />
          </Routes>
        </main>

        <Toaster />
      </SidebarProvider>
    </Router>
  )
}
