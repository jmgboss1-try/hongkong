import { useNavigate, useLocation } from 'react-router-dom'
import { auth } from '../firebase'
import { signOut } from 'firebase/auth'
import { useAuth, GradeBadge } from '../AuthContext'
import { useState } from 'react'

export default function Layout({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { isOwner, isLegend, userData } = useAuth()
  const [sideOpen, setSideOpen] = useState(false)

  async function handleLogout() {
    await signOut(auth)
    navigate('/login')
  }

  const ownerMenus = [
    { path:'/',                icon:'📊', label:'대시보드' },
    { path:'/revenue',        icon:'💰', label:'매출' },
    { path:'/expenses',       icon:'📋', label:'지출' },
    { path:'/staff',          icon:'👥', label:'스케쥴' },
    { path:'/members',        icon:'📁', label:'인원관리' },
    { path:'/cash',           icon:'💵', label:'현금시재' },
    { path:'/payroll',        icon:'📄', label:'인건비' },
  ]

  const staffMenus = [
    { path:'/my-schedule',    icon:'📅', label:'스케쥴' },
    { path:'/team',           icon:'👥', label:'팀원' },
    { path:'/cash',           icon:'💵', label:'현금시재' },
    ...(isLegend ? [{ path:'/expenses-input', icon:'📋', label:'지출입력' }] : []),
  ]

  const menus = isOwner ? ownerMenus : staffMenus
  // 모바일 하단 탭은 최대 5개
  const bottomMenus = menus.slice(0, 5)
  const extraMenus = menus.slice(5)

  return (
    <div style={{display:'flex', minHeight:'100vh', fontFamily:'Noto Sans KR, sans-serif', background:'#0b0d16', color:'#dde1f2'}}>

      {/* ── PC 사이드바 ── */}
      <div style={{
        width:214, background:'#12141f', borderRight:'1px solid #272a3d',
        display:'flex', flexDirection:'column', position:'fixed',
        top:0, left:0, bottom:0, zIndex:10,
        // 모바일에서 숨김
        '@media(max-width:768px)': {display:'none'}
      }} className="pc-sidebar">
        <div style={{padding:'22px 18px 16px', borderBottom:'1px solid #272a3d'}}>
          <div style={{fontSize:14, fontWeight:700, color:'#f9b934'}}>🍜 홍콩반점 중앙대점</div>
          <div style={{fontSize:10, color:'#5e6585', marginTop:3, letterSpacing:.5}}>STORE MANAGEMENT</div>
        </div>
        <div style={{padding:'10px 14px', borderBottom:'1px solid #272a3d'}}>
          {isOwner ? (
            <div style={{fontSize:11, color:'#f9b934', fontWeight:700}}>👑 사장</div>
          ) : (
            <div style={{display:'flex', flexDirection:'column', gap:4}}>
              <div style={{fontSize:12, fontWeight:700}}>{userData?.name}</div>
              <GradeBadge joinDate={userData?.joinDate} size={10}/>
            </div>
          )}
        </div>
        <nav style={{flex:1, padding:'4px 0', overflowY:'auto'}}>
          {menus.map(m=>(
            <div key={m.path} onClick={()=>navigate(m.path)}
              style={{
                display:'flex', alignItems:'center', gap:10,
                padding:'11px 18px', fontSize:13, fontWeight:500,
                color: location.pathname===m.path ? '#f9b934' : '#5e6585',
                borderLeft: location.pathname===m.path ? '3px solid #f9b934' : '3px solid transparent',
                background: location.pathname===m.path ? 'rgba(249,185,52,0.12)' : 'transparent',
                cursor:'pointer', transition:'.15s'
              }}>
              <span>{m.icon}</span>{m.label}
            </div>
          ))}
        </nav>
        <div style={{padding:'14px 16px', borderTop:'1px solid #272a3d'}}>
          <button onClick={handleLogout} style={{width:'100%', background:'#191c2b', border:'1px solid #272a3d', borderRadius:6, color:'#5e6585', padding:'7px', fontSize:11, cursor:'pointer', fontFamily:'inherit'}}>
            🚪 로그아웃
          </button>
        </div>
      </div>

      {/* ── 모바일 상단 헤더 ── */}
      <div className="mobile-header" style={{
        display:'none', position:'fixed', top:0, left:0, right:0, zIndex:20,
        background:'#12141f', borderBottom:'1px solid #272a3d',
        padding:'12px 16px', alignItems:'center', justifyContent:'space-between'
      }}>
        <div style={{fontSize:13, fontWeight:700, color:'#f9b934'}}>🍜 홍콩반점</div>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          {!isOwner && <GradeBadge joinDate={userData?.joinDate} size={9}/>}
          {isOwner && <span style={{fontSize:11, color:'#f9b934', fontWeight:700}}>👑 사장</span>}
          <button onClick={()=>setSideOpen(v=>!v)}
            style={{background:'#191c2b', border:'1px solid #272a3d', borderRadius:6, color:'#dde1f2', padding:'5px 10px', fontSize:16, cursor:'pointer', lineHeight:1}}>
            ☰
          </button>
        </div>
      </div>

      {/* 모바일 드로어 메뉴 */}
      {sideOpen && (
        <div style={{position:'fixed', inset:0, zIndex:30}} onClick={()=>setSideOpen(false)}>
          <div style={{position:'absolute', top:0, right:0, width:220, height:'100%', background:'#12141f', borderLeft:'1px solid #272a3d', padding:'20px 0'}}
            onClick={e=>e.stopPropagation()}>
            <div style={{padding:'0 18px 16px', borderBottom:'1px solid #272a3d', marginBottom:8}}>
              <div style={{fontSize:13, fontWeight:700, color:isOwner?'#f9b934':'#dde1f2'}}>{isOwner?'👑 사장':userData?.name}</div>
              {!isOwner && <div style={{marginTop:4}}><GradeBadge joinDate={userData?.joinDate} size={10}/></div>}
            </div>
            {menus.map(m=>(
              <div key={m.path} onClick={()=>{navigate(m.path);setSideOpen(false)}}
                style={{display:'flex', alignItems:'center', gap:10, padding:'12px 18px', fontSize:13, fontWeight:500,
                  color:location.pathname===m.path?'#f9b934':'#5e6585',
                  background:location.pathname===m.path?'rgba(249,185,52,0.12)':'transparent',
                  cursor:'pointer'}}>
                <span>{m.icon}</span>{m.label}
              </div>
            ))}
            <div style={{padding:'16px 18px', borderTop:'1px solid #272a3d', marginTop:8}}>
              <button onClick={handleLogout} style={{width:'100%', background:'#191c2b', border:'1px solid #272a3d', borderRadius:6, color:'#5e6585', padding:'8px', fontSize:12, cursor:'pointer', fontFamily:'inherit'}}>
                🚪 로그아웃
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN ── */}
      <div className="main-content" style={{marginLeft:214, flex:1, padding:'28px 30px', minHeight:'100vh'}}>
        {children}
      </div>

      {/* ── 모바일 하단 탭바 ── */}
      <div className="mobile-tabbar" style={{
        display:'none', position:'fixed', bottom:0, left:0, right:0, zIndex:20,
        background:'#12141f', borderTop:'1px solid #272a3d',
        padding:'6px 0 8px'
      }}>
        <div style={{display:'flex', justifyContent:'space-around'}}>
          {bottomMenus.map(m=>(
            <div key={m.path} onClick={()=>navigate(m.path)}
              style={{display:'flex', flexDirection:'column', alignItems:'center', gap:2, padding:'4px 8px', cursor:'pointer',
                color:location.pathname===m.path?'#f9b934':'#5e6585', minWidth:50}}>
              <span style={{fontSize:20}}>{m.icon}</span>
              <span style={{fontSize:9, fontWeight:600}}>{m.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 반응형 CSS */}
      <style>{`
        @media (max-width: 768px) {
          .pc-sidebar { display: none !important; }
          .mobile-header { display: flex !important; }
          .mobile-tabbar { display: block !important; }
          .main-content {
            margin-left: 0 !important;
            padding: 70px 14px 80px !important;
          }
        }
      `}</style>
    </div>
  )
}
