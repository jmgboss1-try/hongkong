import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './AuthContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Revenue from './pages/Revenue'
import Expenses from './pages/Expenses'
import Staff from './pages/Staff'
import Payroll from './pages/Payroll'
import MySchedule from './pages/MySchedule'
import Layout from './components/Layout'

function PrivateRoute({ children, ownerOnly, minGrade }) {
  const { user, isOwner, grade } = useAuth()
  if (!user) return <Navigate to="/login" />
  if (ownerOnly && !isOwner) return <Navigate to="/my-schedule" />
  if (minGrade && !isOwner && grade > minGrade) return <Navigate to="/my-schedule" />
  return children
}

function AppRoutes() {
  const { user, isOwner } = useAuth()

  if (!user) return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<Navigate to="/login" />} />
    </Routes>
  )

  return (
    <Layout>
      <Routes>
        <Route path="/" element={
          <PrivateRoute ownerOnly>
            <Dashboard />
          </PrivateRoute>
        } />
        <Route path="/revenue" element={
          <PrivateRoute ownerOnly>
            <Revenue />
          </PrivateRoute>
        } />
        <Route path="/expenses" element={
          <PrivateRoute ownerOnly>
            <Expenses />
          </PrivateRoute>
        } />
        <Route path="/staff" element={
          <PrivateRoute ownerOnly>
            <Staff />
          </PrivateRoute>
        } />
        <Route path="/payroll" element={
          <PrivateRoute ownerOnly>
            <Payroll />
          </PrivateRoute>
        } />
        <Route path="/my-schedule" element={<MySchedule />} />
        <Route path="*" element={<Navigate to={isOwner ? "/" : "/my-schedule"} />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  )
}