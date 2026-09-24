import { Navigate, Route, Routes } from 'react-router-dom'
import Shell from './components/Shell'
import { useMe } from './lib/hooks'
import Admin from './pages/Admin'
import Alts from './pages/Alts'
import Landing from './pages/Landing'
import Ores from './pages/Ores'
import Overview from './pages/Overview'
import Refining from './pages/Refining'
import Settings from './pages/Settings'
import Systems from './pages/Systems'

export default function App() {
  const { data: user, isLoading } = useMe()

  if (isLoading) return <div className="landing" aria-busy="true" />
  if (!user) return <Landing />

  return (
    <Routes>
      <Route element={<Shell user={user} />}>
        <Route index element={<Overview user={user} />} />
        <Route path="alts" element={<Alts user={user} />} />
        <Route path="ores" element={<Ores />} />
        <Route path="systems" element={<Systems />} />
        <Route path="refining" element={<Refining user={user} />} />
        <Route path="settings" element={<Settings user={user} />} />
        {user.is_admin && <Route path="admin" element={<Admin user={user} />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
