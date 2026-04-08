import { useNavigate, useLocation } from 'react-router-dom'
import { auth } from '../firebase'
import { signOut } from 'firebase/auth'
import { useAuth, GradeBadge } from '../AuthContext'

export default function Layout({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { isOwner, isLegend, userData } = useAuth()

  async function handleLogout() {
    await signOut(auth)
    navigate('/login')
  }

  const ownerMenus = [
    { path:'/',          icon:'📊', label:'대시보드' },
    { path:'/revenue',   icon:'💰', label:'매출관리' },
    { path:'/expenses',  icon:'📋', label:'지출관리' },
    { path:'/staff',     icon:'👥', label:'인원·스케쥴' },
    { path:'/members',   icon:'📁', label:'인원관리' },
    { path:'/payroll',   icon:'📄', label:'인건비 보고서' },
  ]

  const staffMenus = [
    { path:'/my-schedule', icon:'📅', label:'내 스케쥴' },
    { path:'/team',        icon:'👥', label:'팀원 소개' },
  ]

  // 1등급(대선배)는 지출입력 가능
  if (isLegend && !isOwner) {
    staffMenus.push({ path:'/expenses-input', icon:'📋', label:'지출입력' })
  }

  const menus = isOwner ? ownerMenus : staffMenus

  return (
    <div style={{display:'flex', minHeight:'100vh', fontFamily:'Noto Sans KR, sans-serif', background:'#0b0d16', color:'#dde1f2'}}>
      {/* SIDEBAR */}
      <div style={{
        width:214, background:'#12141f', borderRight:'1px solid #272a3d',
        display:'flex', flexDirection:'column', position:'fixed',
        top:0, left:0, bottom:0, zIndex:10
      }}>
        <div style={{padding:'22px 18px 16px', borderBottom:'1px solid #272a3d'}}>
          <div style={{fontSize:14, fontWeight:700, color:'#f9b934'}}>🍜 홍콩반점 중앙대점</div>
          <div style={{fontSize:10, color:'#5e6585', marginTop:3, letterSpacing:.5}}>STORE MANAGEMENT</div>
        </div>

        <div style={{padding:'10px 14px', borderBottom:'1px solid #272a3d'}}>
          {isOwner ? (
            <div style={{fontSize:11, color:'#f9b934', fontWeight:700}}>👑 사장</div>
          ) : (
            <div style={{display:'flex', flexDirection:'column', gap:4}}>
              <div style={{fontSize:12, fontWeight:700, color:'#dde1f2'}}>{userData?.name}</div>
              <GradeBadge joinDate={userData?.joinDate} size={10}/>
            </div>
          )}
        </div>

        <nav style={{flex:1, padding:'4px 0'}}>
          {menus.map(m => (
            <div key={m.path} onClick={() => navigate(m.path)}
              style={{
                display:'flex', alignItems:'center', gap:10,
                padding:'11px 18px', fontSize:13, fontWeight:500,
                color: location.pathname === m.path ? '#f9b934' : '#5e6585',
                borderLeft: location.pathname === m.path ? '3px solid #f9b934' : '3px solid transparent',
                background: location.pathname === m.path ? 'rgba(249,185,52,0.12)' : 'transparent',
                cursor:'pointer', transition:'.15s'
              }}>
              <span>{m.icon}</span>{m.label}
            </div>
          ))}
        </nav>

        <div style={{padding:'14px 16px', borderTop:'1px solid #272a3d'}}>
          <button onClick={handleLogout} style={{
            width:'100%', background:'#191c2b', border:'1px solid #272a3d',
            borderRadius:6, color:'#5e6585', padding:'7px', fontSize:11,
            cursor:'pointer', fontFamily:'inherit'
          }}>
            🚪 로그아웃
          </button>
        </div>
      </div>

      {/* MAIN */}
      <div style={{marginLeft:214, flex:1, padding:'28px 30px', minHeight:'100vh'}}>
        {children}
      </div>
    </div>
  )
}
