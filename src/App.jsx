import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './AuthContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Revenue from './pages/Revenue'
import Expenses from './pages/Expenses'
import Staff from './pages/Staff'
import Members from './pages/Members'
import Payroll from './pages/Payroll'
import Investment from './pages/Investment'
import MySchedule from './pages/MySchedule'
import Team from './pages/Team'
import ExpensesInput from './pages/ExpensesInput'
import Cash from './pages/Cash'
import WorkManage from './pages/WorkManage'
import MyPayroll from './pages/MyPayroll'
import Notice from './pages/Notice'
import ConsumptionAnalysis from './pages/ConsumptionAnalysis'
import RevenueInput from './pages/RevenueInput'
import SubstituteBoard from './pages/SubstituteBoard'
import LossClaims from './pages/LossClaims'
import Checklist from './pages/Checklist'
import Prepaid from './pages/Prepaid'
import PhoneUpload from './pages/PhoneUpload'
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

// 역할별 첫 화면 — 권한 없는 화면에 들어오면 여기로 보냄
function homePath({ isOwner, isStore, isInvestor }) {
  return isOwner ? '/' : isStore ? '/revenue-input' : isInvestor ? '/revenue' : '/my-schedule'
}

function PrivateRoute({ children, ownerOnly, legendOnly, storeOk, storeOnly, investorOk }) {
  const auth = useAuth()
  const { user, isOwner, isStore, isInvestor, isPending, isLegend } = auth
  const home = homePath(auth)
  if (!user) return <Navigate to="/login" />
  if (isPending) return <PendingScreen />
  // 투자자 계정: investorOk 표시된 라우트만 접근 가능
  if (isInvestor && !investorOk) return <Navigate to="/revenue" />
  if (ownerOnly && !isOwner && !isInvestor) return <Navigate to={home} />
  if (legendOnly && !isOwner && !isLegend) return <Navigate to={home} />
  if (isStore && !storeOk) return <Navigate to="/revenue-input" />
  // 사장 + 매장계정 전용 화면 (일반 직원은 주소를 직접 쳐도 못 들어감)
  if (storeOnly && !isOwner && !isStore) return <Navigate to={home} />
  return children
}

function AppRoutes() {
  const { user, isOwner, isStore, isInvestor } = useAuth()
  const location = useLocation()

  // 폰 사진 업로드 페이지: 로그인 없이 접근 (포스에서 만든 QR로 진입)
  if (location.pathname.startsWith('/upload/')) return (
    <Routes>
      <Route path="/upload/:sid" element={<PhoneUpload />} />
    </Routes>
  )

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
        {/* 매출: 사장 + 투자자 접근 가능 */}
        <Route path="/revenue" element={<PrivateRoute investorOk><Revenue /></PrivateRoute>} />
        <Route path="/expenses" element={<PrivateRoute ownerOnly><Expenses /></PrivateRoute>} />
        <Route path="/staff" element={<PrivateRoute><Staff /></PrivateRoute>} />
        <Route path="/work-manage" element={<PrivateRoute ownerOnly><WorkManage /></PrivateRoute>} />
        <Route path="/members" element={<PrivateRoute ownerOnly><Members /></PrivateRoute>} />
        <Route path="/payroll" element={<PrivateRoute ownerOnly><Payroll /></PrivateRoute>} />
        {/* 투자관리: 사장 + 투자자 접근 가능 */}
        <Route path="/investment" element={<PrivateRoute investorOk><Investment /></PrivateRoute>} />
        <Route path="/my-payroll" element={<PrivateRoute><MyPayroll /></PrivateRoute>} />
        <Route path="/my-schedule" element={<PrivateRoute><MySchedule /></PrivateRoute>} />
        <Route path="/team" element={<PrivateRoute><Team /></PrivateRoute>} />
        <Route path="/cash" element={<PrivateRoute storeOk><Cash /></PrivateRoute>} />
        <Route path="/expenses-input" element={<PrivateRoute legendOnly><ExpensesInput /></PrivateRoute>} />
        <Route path="/notice" element={<PrivateRoute storeOk><Notice /></PrivateRoute>} />
        <Route path="/consumption" element={<PrivateRoute ownerOnly><ConsumptionAnalysis /></PrivateRoute>} />
        <Route path="/revenue-input" element={<PrivateRoute storeOk storeOnly><RevenueInput /></PrivateRoute>} />
        <Route path="/substitute" element={<PrivateRoute storeOk><SubstituteBoard /></PrivateRoute>} />
        <Route path="/loss-claims" element={<PrivateRoute storeOk><LossClaims /></PrivateRoute>} />
        <Route path="/checklist" element={<PrivateRoute storeOk><Checklist /></PrivateRoute>} />
        <Route path="/prepaid" element={<PrivateRoute storeOk><Prepaid /></PrivateRoute>} />
        <Route path="*" element={<Navigate to={homePath({ isOwner, isStore, isInvestor })} />} />
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
