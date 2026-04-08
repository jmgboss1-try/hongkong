import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './AuthContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Revenue from './pages/Revenue'
import Expenses from './pages/Expenses'
import Staff from './pages/Staff'
import Members from './pages/Members'
import Payroll from './pages/Payroll'
import MySchedule from './pages/MySchedule'
import Team from './pages/Team'
import ExpensesInput from './pages/ExpensesInput'
import Cash from './pages/Cash'
import Layout from './components/Layout'

function PendingScreen() {
  async function handleLogout() {
    const { auth } = await import('./firebase')
    const { signOut } = await import('firebase/auth')
    await signOut(auth)
  }
  return (
    <div style={{minHeight:'100vh',background:'#0b0d16',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Noto Sans KR, sans-serif'}}>
      <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:16,padding:'40px 36px',width:360,textAlign:'center'}}>
        <div style={{fontSize:40,marginBottom:16}}>⏳</div>
        <div style={{fontSize:16,fontWeight:700,color:'#f9b934',marginBottom:8}}>승인 대기 중</div>
        <div style={{fontSize:12,color:'#5e6585',lineHeight:2,marginBottom:24}}>
          사장님이 아직 계정을 승인하지 않았어요.<br/>승인 후 이용 가능합니다.
        </div>
        <button onClick={handleLogout}
          style={{background:'#191c2b',color:'#5e6585',border:'1px solid #272a3d',borderRadius:8,padding:'10px 24px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
          로그아웃
        </button>
      </div>
    </div>
  )
}

function PrivateRoute({ children, ownerOnly, legendOnly }) {
  const { user, isOwner, isPending, isLegend } = useAuth()
  if (!user) return <Navigate to="/login" />
  if (isPending) return <PendingScreen />
  if (ownerOnly && !isOwner) return <Navigate to="/my-schedule" />
  if (legendOnly && !isOwner && !isLegend) return <Navigate to="/my-schedule" />
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
        <Route path="/" element={<PrivateRoute ownerOnly><Dashboard /></PrivateRoute>} />
        <Route path="/revenue" element={<PrivateRoute ownerOnly><Revenue /></PrivateRoute>} />
        <Route path="/expenses" element={<PrivateRoute ownerOnly><Expenses /></PrivateRoute>} />
        <Route path="/staff" element={<PrivateRoute ownerOnly><Staff /></PrivateRoute>} />
        <Route path="/members" element={<PrivateRoute ownerOnly><Members /></PrivateRoute>} />
        <Route path="/payroll" element={<PrivateRoute ownerOnly><Payroll /></PrivateRoute>} />
        <Route path="/my-schedule" element={<PrivateRoute><MySchedule /></PrivateRoute>} />
        <Route path="/team" element={<PrivateRoute><Team /></PrivateRoute>} />
        <Route path="/cash" element={<PrivateRoute><Cash /></PrivateRoute>} />
        <Route path="/expenses-input" element={<PrivateRoute legendOnly><ExpensesInput /></PrivateRoute>} />
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
