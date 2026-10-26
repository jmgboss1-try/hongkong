import { useNavigate, useLocation } from 'react-router-dom'
import { auth, db } from '../firebase'
import { signOut } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import { useAuth, GradeBadge } from '../AuthContext'
import { useState } from 'react'

// 저장된 순서대로 메뉴 정렬 — 저장 후 새로 생긴 메뉴는 기본 순서대로 뒤에 붙음
function applyOrder(menus, order) {
  if(!Array.isArray(order) || order.length===0) return menus
  const rank = p => { const i = order.indexOf(p); return i<0 ? order.length : i }
  return menus.map((m,i)=>({m,i})).sort((a,b)=>rank(a.m.path)-rank(b.m.path) || a.i-b.i).map(x=>x.m)
}

export default function Layout({ children }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, isOwner, isStore, isInvestor, isLegend, userData } = useAuth()
  const [sideOpen, setSideOpen] = useState(false)
  // 탭 순서 (경로 배열) — 계정별로 users/{uid}.menuOrder 에 저장
  const [savedOrder, setSavedOrder] = useState(null)
  const [editOrder, setEditOrder]   = useState(null) // 편집 중이면 경로 배열, 아니면 null

  async function handleLogout() {
    await signOut(auth)
    navigate('/login')
  }

  const ownerMenus = [
    { path:'/',              icon:'📊', label:'대시보드' },
    { path:'/revenue',      icon:'💰', label:'매출' },
    { path:'/sales-analysis', icon:'🎯', label:'매출분석' },
    { path:'/expenses',     icon:'📋', label:'지출' },
    { path:'/staff',        icon:'📅', label:'스케쥴' },
    { path:'/work-manage',  icon:'⏱',  label:'근무관리' },
    { path:'/members',      icon:'📁', label:'인원관리' },
    { path:'/substitute',   icon:'🔄', label:'대타 구함' },
    { path:'/loss-claims',  icon:'📋', label:'손실보상' },
    { path:'/checklist',    icon:'✅', label:'체크리스트' },
    { path:'/prepaid',      icon:'💳', label:'선결제' },
    { path:'/cash',         icon:'💵', label:'현금시재' },
    { path:'/payroll',      icon:'📄', label:'인건비' },
    { path:'/investment',   icon:'📈', label:'투자관리' },
    { path:'/consumption',  icon:'📊', label:'소비분석' },
    { path:'/notice',       icon:'📋', label:'공지·메모' },
  ]

  const staffMenus = [
    { path:'/staff',          icon:'📅', label:'스케쥴' },
    { path:'/my-schedule',   icon:'🕐', label:'내 기록' },
    { path:'/my-payroll',    icon:'💸', label:'내 급여' },
    { path:'/team',          icon:'👥', label:'팀원' },
    { path:'/cash',          icon:'💵', label:'현금시재' },
    { path:'/notice',        icon:'📋', label:'공지·메모' },
    ...(isLegend ? [{ path:'/expenses-input', icon:'📋', label:'지출입력' }] : []),
  ]

  const storeMenus = [
  { path:'/revenue-input', icon:'💰', label:'매출입력' },
  { path:'/sales-analysis', icon:'🎯', label:'매출분석' },
  { path:'/checklist',     icon:'✅', label:'체크리스트' },
  { path:'/prepaid',       icon:'💳', label:'선결제' },
  { path:'/substitute',    icon:'🔄', label:'대타 구함' },
  { path:'/loss-claims',   icon:'📋', label:'손실보상' },
  { path:'/cash',          icon:'💵', label:'현금시재' },
  { path:'/notice',        icon:'📋', label:'공지·메모' },
]

  // 투자자 전용: 매출(조회) + 투자관리(조회)만
  const investorMenus = [
    { path:'/revenue',    icon:'💰', label:'매출' },
    { path:'/investment', icon:'📈', label:'투자관리' },
  ]

  const baseMenus = isOwner ? ownerMenus : isStore ? storeMenus : isInvestor ? investorMenus : staffMenus
  const menus = applyOrder(baseMenus, editOrder || savedOrder || userData?.menuOrder)
  const bottomMenus = menus.slice(0, 5)

  function moveMenu(idx, dir) {
    const paths = menus.map(m=>m.path)
    const to = idx + dir
    if(to < 0 || to >= paths.length) return
    ;[paths[idx], paths[to]] = [paths[to], paths[idx]]
    setEditOrder(paths)
  }
  async function saveOrder() {
    const order = menus.map(m=>m.path)
    try {
      await setDoc(doc(db,'users',user.uid), { menuOrder: order }, { merge:true })
      setSavedOrder(order)
      setEditOrder(null)
    } catch(e) { console.error(e); alert('순서 저장에 실패했어요. 다시 시도해 주세요.') }
  }

  const menuList = (onPick) => editOrder ? (
    <div>
      <div style={{padding:'8px 18px', fontSize:10, color:'#5e6585'}}>▲▼로 순서를 바꾼 뒤 저장하세요</div>
      {menus.map((m,i)=>(
        <div key={m.path} style={{display:'flex', alignItems:'center', gap:8, padding:'7px 10px 7px 18px', fontSize:13, color:'#dde1f2'}}>
          <span>{m.icon}</span><span style={{flex:1}}>{m.label}</span>
          {[[-1,'▲'],[1,'▼']].map(([dir,ch])=>{
            const disabled = (dir<0 && i===0) || (dir>0 && i===menus.length-1)
            return (
              <button key={dir} onClick={()=>moveMenu(i,dir)} disabled={disabled}
                style={{background:'#191c2b', border:'1px solid #272a3d', borderRadius:5, color:disabled?'#272a3d':'#dde1f2',
                  width:26, height:24, fontSize:10, cursor:disabled?'default':'pointer', padding:0}}>
                {ch}
              </button>
            )
          })}
        </div>
      ))}
      <div style={{display:'flex', gap:6, padding:'10px 14px'}}>
        <button onClick={saveOrder}
          style={{flex:1, background:'#f9b934', color:'#000', border:'none', borderRadius:6, padding:'7px', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit'}}>
          저장
        </button>
        <button onClick={()=>setEditOrder(baseMenus.map(m=>m.path))}
          style={{background:'#191c2b', border:'1px solid #272a3d', borderRadius:6, color:'#5e6585', padding:'7px 8px', fontSize:11, cursor:'pointer', fontFamily:'inherit'}}>
          기본순서
        </button>
        <button onClick={()=>setEditOrder(null)}
          style={{background:'#191c2b', border:'1px solid #272a3d', borderRadius:6, color:'#5e6585', padding:'7px 8px', fontSize:11, cursor:'pointer', fontFamily:'inherit'}}>
          취소
        </button>
      </div>
    </div>
  ) : menus.map(m=>(
    <div key={m.path} onClick={()=>onPick(m.path)}
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
  ))

  const editButton = !editOrder && (
    <button onClick={()=>setEditOrder(menus.map(m=>m.path))}
      style={{width:'100%', background:'transparent', border:'1px dashed #272a3d', borderRadius:6, color:'#5e6585', padding:'7px', fontSize:11, cursor:'pointer', fontFamily:'inherit', marginBottom:8}}>
      ↕️ 탭 순서 편집
    </button>
  )

  return (
    <div style={{display:'flex', minHeight:'100vh', fontFamily:'Noto Sans KR, sans-serif', background:'#0b0d16', color:'#dde1f2'}}>

      {/* ── PC 사이드바 ── */}
      <div style={{
        width:214, background:'#12141f', borderRight:'1px solid #272a3d',
        display:'flex', flexDirection:'column', position:'fixed',
        top:0, left:0, bottom:0, zIndex:10,
      }} className="pc-sidebar">
        <div style={{padding:'22px 18px 16px', borderBottom:'1px solid #272a3d'}}>
          <div style={{fontSize:14, fontWeight:700, color:'#f9b934'}}>🍜 홍콩반점 중앙대점</div>
          <div style={{fontSize:10, color:'#5e6585', marginTop:3, letterSpacing:.5}}>STORE MANAGEMENT</div>
        </div>
        <div style={{padding:'10px 14px', borderBottom:'1px solid #272a3d'}}>
          {isOwner ? (
            <div style={{fontSize:11, color:'#f9b934', fontWeight:700}}>👑 사장</div>
          ) : isStore ? (
            <div style={{fontSize:11, color:'#93c5fd', fontWeight:700}}>🏪 매장계정</div>
          ) : isInvestor ? (
            <div style={{fontSize:11, color:'#34d399', fontWeight:700}}>🤝 {userData?.name||'투자자'}</div>
          ) : (
            <div style={{display:'flex', flexDirection:'column', gap:4}}>
              <div style={{fontSize:12, fontWeight:700}}>{userData?.name}</div>
              <GradeBadge joinDate={userData?.joinDate} size={10}/>
            </div>
          )}
        </div>
        <nav style={{flex:1, padding:'4px 0', overflowY:'auto'}}>
          {menuList(path=>navigate(path))}
        </nav>
        <div style={{padding:'14px 16px', borderTop:'1px solid #272a3d'}}>
          {editButton}
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
          {!isOwner && !isStore && !isInvestor && <GradeBadge joinDate={userData?.joinDate} size={9}/>}
          {isOwner    && <span style={{fontSize:11, color:'#f9b934', fontWeight:700}}>👑 사장</span>}
          {isStore    && <span style={{fontSize:11, color:'#93c5fd', fontWeight:700}}>🏪 매장</span>}
          {isInvestor && <span style={{fontSize:11, color:'#34d399', fontWeight:700}}>🤝 투자자</span>}
          <button onClick={()=>setSideOpen(v=>!v)}
            style={{background:'#191c2b', border:'1px solid #272a3d', borderRadius:6, color:'#dde1f2', padding:'5px 10px', fontSize:16, cursor:'pointer', lineHeight:1}}>
            ☰
          </button>
        </div>
      </div>

      {/* 모바일 드로어 메뉴 */}
      {sideOpen && (
        <div style={{position:'fixed', inset:0, zIndex:30}} onClick={()=>setSideOpen(false)}>
          <div style={{position:'absolute', top:0, right:0, width:220, height:'100%', background:'#12141f', borderLeft:'1px solid #272a3d', padding:'20px 0', overflowY:'auto'}}
            onClick={e=>e.stopPropagation()}>
            <div style={{padding:'0 18px 16px', borderBottom:'1px solid #272a3d', marginBottom:8}}>
              <div style={{fontSize:13, fontWeight:700,
                color:isOwner?'#f9b934':isStore?'#93c5fd':isInvestor?'#34d399':'#dde1f2'}}>
                {isOwner?'👑 사장':isStore?'🏪 매장계정':isInvestor?`🤝 ${userData?.name||'투자자'}`:userData?.name}
              </div>
              {!isOwner && !isStore && !isInvestor && <div style={{marginTop:4}}><GradeBadge joinDate={userData?.joinDate} size={10}/></div>}
            </div>
            {menuList(path=>{navigate(path);setSideOpen(false)})}
            <div style={{padding:'16px 18px', borderTop:'1px solid #272a3d', marginTop:8}}>
              {editButton}
              <button onClick={handleLogout} style={{width:'100%', background:'#191c2b', border:'1px solid #272a3d', borderRadius:6, color:'#5e6585', padding:'8px', fontSize:12, cursor:'pointer', fontFamily:'inherit'}}>
                🚪 로그아웃
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── MAIN ── */}
      <div className="main-content" style={{marginLeft:214, flex:1, minWidth:0, padding:'28px 30px', minHeight:'100vh'}}>
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
