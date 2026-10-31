import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './AuthContext'
import Login from './pages/Login'
import Layout from './components/Layout'

// 화면별로 필요할 때만 코드를 내려받음 (한 파일로 묶으면 첫 화면이 1MB 넘게 기다려야 함)
// 포스처럼 하루 종일 켜 둔 화면은 그사이 새 버전이 올라가면 예전 화면 파일이 없어져 못 불러옴 → 한 번 새로고침해서 새 버전으로
const lazyPage = load => lazy(() => load().catch(err => {
  let last = 0
  try { last = +sessionStorage.getItem('pageReloadAt') || 0 } catch { /* 없어도 됨 */ }
  if (Date.now() - last > 30000) {
    try { sessionStorage.setItem('pageReloadAt', String(Date.now())) } catch { /* 없어도 됨 */ }
    window.location.reload()
    return new Promise(() => {})
  }
  throw err
}))
const Clock = lazyPage(() => import('./pages/Clock'))
const Dashboard = lazyPage(() => import('./pages/Dashboard'))
const Revenue = lazyPage(() => import('./pages/Revenue'))
const Expenses = lazyPage(() => import('./pages/Expenses'))
const Staff = lazyPage(() => import('./pages/Staff'))
const Members = lazyPage(() => import('./pages/Members'))
const Payroll = lazyPage(() => import('./pages/Payroll'))
const Investment = lazyPage(() => import('./pages/Investment'))
const MySchedule = lazyPage(() => import('./pages/MySchedule'))
const Team = lazyPage(() => import('./pages/Team'))
const ExpensesInput = lazyPage(() => import('./pages/ExpensesInput'))
const Cash = lazyPage(() => import('./pages/Cash'))
const WorkManage = lazyPage(() => import('./pages/WorkManage'))
const MyPayroll = lazyPage(() => import('./pages/MyPayroll'))
const Notice = lazyPage(() => import('./pages/Notice'))
const ConsumptionAnalysis = lazyPage(() => import('./pages/ConsumptionAnalysis'))
const RevenueInput = lazyPage(() => import('./pages/RevenueInput'))
const SubstituteBoard = lazyPage(() => import('./pages/SubstituteBoard'))
const LossClaims = lazyPage(() => import('./pages/LossClaims'))
const Checklist = lazyPage(() => import('./pages/Checklist'))
const Prepaid = lazyPage(() => import('./pages/Prepaid'))
const SalesAnalysis = lazyPage(() => import('./pages/SalesAnalysis'))
const OurStore = lazyPage(() => import('./pages/OurStore'))
const PhoneUpload = lazyPage(() => import('./pages/PhoneUpload'))

// 화면 코드를 내려받는 동안 (보통 한순간)
function PageLoading() {
  return <div style={{padding:'40px 0', color:'#6E6A63', fontSize:14}}>불러오는 중...</div>
}

function PendingScreen() {
  async function handleLogout() {
    const { auth } = await import('./firebase')
    const { signOut } = await import('firebase/auth')
    await signOut(auth)
  }
  return (
    <div style={{minHeight:'100vh',background:'#FAF9F6',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Noto Sans KR, sans-serif'}}>
      <div style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,padding:'40px 36px',width:360,textAlign:'center'}}>
        <div style={{fontSize:40,marginBottom:16}}></div>
        <div style={{fontSize:16,fontWeight:700,color:'#C3261C',marginBottom:8}}>승인 대기 중</div>
        <div style={{fontSize:12,color:'#6E6A63',lineHeight:2,marginBottom:24}}>
          사장님이 아직 계정을 승인하지 않았어요.<br/>승인 후 이용 가능합니다.
        </div>
        <button onClick={handleLogout}
          style={{background:'#F3F1EC',color:'#6E6A63',border:'1px solid #DCD7CE',borderRadius:4,padding:'10px 24px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
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
    <Suspense fallback={<PageLoading/>}>
      <Routes>
        <Route path="/upload/:sid" element={<PhoneUpload />} />
      </Routes>
    </Suspense>
  )

  // NFC 출퇴근 페이지: 메뉴 없이 폰 화면 하나로. 로그인 안 돼 있으면 이 주소에서 바로 로그인
  if (location.pathname === '/clock') return user ? <Suspense fallback={<PageLoading/>}><Clock /></Suspense> : <Login />

  if (!user) return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="*" element={<Navigate to="/login" />} />
    </Routes>
  )

  return (
    <Layout>
      <Suspense fallback={<PageLoading/>}>
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
        <Route path="/sales-analysis" element={<PrivateRoute storeOk storeOnly><SalesAnalysis /></PrivateRoute>} />
        {/* 우리 매장: 사장 + 매장계정 (포스에 띄워 두는 화면) */}
        <Route path="/our-store" element={<PrivateRoute storeOk storeOnly><OurStore /></PrivateRoute>} />
        <Route path="*" element={<Navigate to={homePath({ isOwner, isStore, isInvestor })} />} />
      </Routes>
      </Suspense>
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
