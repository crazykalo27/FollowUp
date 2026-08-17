import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import { OrientationProvider } from './lib/orientationContext'
import { AppShell, RequireAuth } from './components/AppShell'
import { ProfileSetupGate } from './components/ProfileSetupGate'
import { WelcomeSetupPage } from './pages/WelcomeSetupPage'
import { LandingPage } from './pages/LandingPage'
import { OverviewPage } from './pages/OverviewPage'
import { OnboardingPage } from './pages/OnboardingPage'
import { FiltersPage } from './pages/FiltersPage'
import { ContactsPage } from './pages/ContactsPage'
import { DraftsPage } from './pages/DraftsPage'
import { SettingsPage } from './pages/SettingsPage'
import { RefinePage } from './pages/RefinePage'
import { AdminPage } from './pages/AdminPage'
import './index.css'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/app/welcome" element={<WelcomeSetupPage />} />
            <Route element={<ProfileSetupGate />}>
              <Route
                path="/app"
                element={
                  <OrientationProvider>
                    <AppShell />
                  </OrientationProvider>
                }
              >
                <Route index element={<Navigate to="search" replace />} />
                <Route path="search" element={<OverviewPage />} />
                <Route path="onboarding" element={<OnboardingPage />} />
                <Route path="filters" element={<FiltersPage />} />
                <Route path="refine" element={<RefinePage />} />
                <Route path="contacts" element={<ContactsPage />} />
                <Route path="drafts" element={<DraftsPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="admin" element={<AdminPage />} />
              </Route>
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
