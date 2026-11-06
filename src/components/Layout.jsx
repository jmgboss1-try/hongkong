import { useNavigate, useLocation } from 'react-router-dom'
import { auth, db } from '../firebase'
import { signOut } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import { useAuth, GradeBadge } from '../AuthContext'
import { useState } from 'react'
import { PhoneFileReceiveModal } from './PhoneFileTransfer'
import NavIcon from './NavIcon'
import OrderAlert from './OrderAlert'
import { NAV_GROUPS, navGroupOf } from '../lib/nav'

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
  const [fileOpen, setFileOpen] = useState(false) // 폰 → 이 컴퓨터로 파일 옮기기
  // 탭 순서 (경로 배열) — 계정별로 users/{uid}.menuOrder 에 저장
  const [savedOrder, setSavedOrder] = useState(null)
  const [editOrder, setEditOrder]   = useState(null) // 편집 중이면 경로 배열, 아니면 null
  // PC 왼쪽 메뉴: 기본은 픽토그램만 (마우스를 올리면 이름), '이름 보기'로 펼쳐 둘 수 있음 (이 기기에만 기억)
  const [wideNav, setWideNav] = useState(() => { try { return localStorage.getItem('nav.wide') === '1' } catch { return false } })
  // 아이콘만 볼 때 이름표: 메뉴가 스크롤돼도 잘리지 않게 화면 기준(fixed)으로 하나만 띄움
  const [tip, setTip] = useState(null) // { label, top, left }
  const showTip = (label) => e => { const r = e.currentTarget.getBoundingClientRect(); setTip({ label, top: r.top + r.height/2, left: r.right + 6 }) }
  const hideTip = () => setTip(null)
  const toggleWide = () => setWideNav(v => { try { localStorage.setItem('nav.wide', v ? '0' : '1') } catch { /* 저장 못 해도 됨 */ } return !v })

  async function handleLogout() {
    await signOut(auth)
    navigate('/login')
  }

  const ownerMenus = [
    { path:'/',              icon:'', label:'대시보드' },
    { path:'/revenue',      icon:'', label:'매출' },
    { path:'/sales-analysis', icon:'', label:'매출분석' },
    { path:'/expenses',     icon:'', label:'지출' },
    { path:'/staff',        icon:'', label:'스케쥴' },
    { path:'/our-store',    icon:'', label:'우리 매장' },
    { path:'/avatar-manage', icon:'', label:'아바타' },
    { path:'/points',       icon:'', label:'포인트' },
    { path:'/menu-manage',  icon:'', label:'메뉴·주문' },
    { path:'/work-manage',  icon:'',  label:'근무관리' },
    { path:'/members',      icon:'', label:'인원관리' },
    { path:'/substitute',   icon:'', label:'대타 구함' },
    { path:'/loss-claims',  icon:'', label:'손실보상' },
    { path:'/checklist',    icon:'', label:'체크리스트' },
    { path:'/prepaid',      icon:'', label:'선결제' },
    { path:'/cash',         icon:'', label:'현금시재' },
    { path:'/payroll',      icon:'', label:'인건비' },
    { path:'/investment',   icon:'', label:'투자관리' },
    { path:'/consumption',  icon:'', label:'소비분석' },
    { path:'/notice',       icon:'', label:'공지·메모' },
  ]

  const staffMenus = [
    { path:'/staff',          icon:'', label:'스케쥴' },
    { path:'/my-schedule',   icon:'', label:'내 기록' },
    { path:'/my-payroll',    icon:'', label:'내 급여' },
    { path:'/points',        icon:'', label:'포인트' },
    { path:'/team',          icon:'', label:'팀원' },
    { path:'/cash',          icon:'', label:'현금시재' },
    { path:'/notice',        icon:'', label:'공지·메모' },
    ...(isLegend ? [{ path:'/expenses-input', icon:'', label:'지출입력' }] : []),
  ]

  const storeMenus = [
  { path:'/revenue-input', icon:'', label:'매출입력' },
  { path:'/menu-manage',   icon:'', label:'메뉴·주문' },
  { path:'/sales-analysis', icon:'', label:'매출분석' },
  { path:'/checklist',     icon:'', label:'체크리스트' },
  { path:'/our-store',     icon:'', label:'우리 매장' },
  { path:'/prepaid',       icon:'', label:'선결제' },
  { path:'/substitute',    icon:'', label:'대타 구함' },
  { path:'/loss-claims',   icon:'', label:'손실보상' },
  { path:'/cash',          icon:'', label:'현금시재' },
  { path:'/notice',        icon:'', label:'공지·메모' },
]

  // 투자자 전용: 매출(조회) + 투자관리(조회)만
  const investorMenus = [
    { path:'/revenue',    icon:'', label:'매출' },
    { path:'/investment', icon:'', label:'투자관리' },
  ]

  const baseMenus = isOwner ? ownerMenus : isStore ? storeMenus : isInvestor ? investorMenus : staffMenus
  const menus = applyOrder(baseMenus, editOrder || savedOrder || userData?.menuOrder)
  const narrowNav = !wideNav && !editOrder
  const NAV_W = narrowNav ? 72 : 208
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

  const menuList = (onPick, narrow) => editOrder ? (
    <div>
      <div style={{padding:'8px 18px', fontSize:10, color:'#6E6A63'}}>▲▼로 순서를 바꾼 뒤 저장하세요</div>
      {menus.map((m,i)=>(
        <div key={m.path} style={{display:'flex', alignItems:'center', gap:8, padding:'7px 10px 7px 18px', fontSize:13, color:'#1D1B18'}}>
          <span style={{flex:1}}>{m.label}</span>
          {[[-1,'▲'],[1,'▼']].map(([dir,ch])=>{
            const disabled = (dir<0 && i===0) || (dir>0 && i===menus.length-1)
            return (
              <button key={dir} onClick={()=>moveMenu(i,dir)} disabled={disabled}
                style={{background:'#F3F1EC', border:'1px solid #DCD7CE', borderRadius:5, color:disabled?'#DCD7CE':'#1D1B18',
                  width:26, height:24, fontSize:10, cursor:disabled?'default':'pointer', padding:0}}>
                {ch}
              </button>
            )
          })}
        </div>
      ))}
      <div style={{display:'flex', gap:6, padding:'10px 14px'}}>
        <button onClick={saveOrder}
          style={{flex:1, background:'#C3261C', color:'#FFFFFF', border:'none', borderRadius:6, padding:'7px', fontSize:11, fontWeight:700, cursor:'pointer', fontFamily:'inherit'}}>
          저장
        </button>
        <button onClick={()=>setEditOrder(baseMenus.map(m=>m.path))}
          style={{background:'#F3F1EC', border:'1px solid #DCD7CE', borderRadius:6, color:'#6E6A63', padding:'7px 8px', fontSize:11, cursor:'pointer', fontFamily:'inherit'}}>
          기본순서
        </button>
        <button onClick={()=>setEditOrder(null)}
          style={{background:'#F3F1EC', border:'1px solid #DCD7CE', borderRadius:6, color:'#6E6A63', padding:'7px 8px', fontSize:11, cursor:'pointer', fontFamily:'inherit'}}>
          취소
        </button>
      </div>
    </div>
  ) : menus.map(m=>{
    const on = location.pathname===m.path
    const g = NAV_GROUPS[navGroupOf(m.path)]
    return (
      <button type="button" key={m.path} onClick={()=>onPick(m.path)} className="nav-item" aria-current={on ? 'page' : undefined}
        aria-label={narrow ? m.label : undefined}
        onMouseEnter={narrow ? showTip(m.label) : undefined} onMouseLeave={narrow ? hideTip : undefined}
        onFocus={narrow ? showTip(m.label) : undefined} onBlur={narrow ? hideTip : undefined}
        style={{
          display:'flex', alignItems:'center', gap:12, width:'100%', border:'none', fontFamily:'inherit', textAlign:'left',
          padding: narrow ? '5px 0' : '5px 14px', justifyContent: narrow ? 'center' : 'flex-start',
          fontSize:14, fontWeight: on ? 700 : 500, color: on ? '#1D1B18' : '#4A4741',
          background: on ? '#FFFFFF' : 'transparent', cursor:'pointer', position:'relative',
          boxShadow: on ? `inset 3px 0 0 ${g.color}` : 'none',
        }}>
        <span style={{display:'grid', placeItems:'center', width:36, height:32, borderRadius:6, color:g.color, flexShrink:0,
          background: on ? `${g.color}26` : `${g.color}0F`}}>
          <NavIcon name={m.path}/>
        </span>
        {!narrow && <span style={{whiteSpace:'nowrap'}}>{m.label}</span>}
      </button>
    )
  })

  const editButton = !editOrder && (
    <button onClick={()=>setEditOrder(menus.map(m=>m.path))}
      style={{width:'100%', background:'transparent', border:'1px dashed #DCD7CE', borderRadius:6, color:'#6E6A63', padding:'7px', fontSize:11, cursor:'pointer', fontFamily:'inherit', marginBottom:8}}>
      탭 순서 바꾸기
    </button>
  )

  return (
    <div style={{display:'flex', minHeight:'100vh', fontFamily:'Noto Sans KR, sans-serif', background:'#FAF9F6', color:'#1D1B18', colorScheme:'light'}}>

      {/* ── PC 사이드바: 픽토그램 레일 (묶음마다 색, 마우스를 올리면 이름) ── */}
      <div style={{
        width:NAV_W, background:'#F3F1EC', borderRight:'1px solid #DCD7CE',
        display:'flex', flexDirection:'column', position:'fixed',
        top:0, left:0, bottom:0, zIndex:10, transition:'width .18s ease',
      }} className="pc-sidebar">
        <div style={{padding: narrowNav ? '16px 0 12px' : '16px 14px 12px', borderBottom:'3px double #1D1B18', display:'flex', alignItems:'center', gap:10, justifyContent: narrowNav ? 'center' : 'flex-start'}}>
          <div aria-hidden="true" style={{width:34, height:34, borderRadius:5, background:'#C3261C', color:'#FFFFFF', display:'grid', placeItems:'center', fontSize:17, fontWeight:900, flexShrink:0}}>홍</div>
          {!narrowNav && <div>
            <div style={{fontSize:15, fontWeight:800, color:'#1D1B18', lineHeight:1.2}}>홍콩반점</div>
            <div style={{fontSize:11, color:'#6E6A63'}}>중앙대점 매장 관리</div>
          </div>}
        </div>
        <div style={{padding: narrowNav ? '8px 0' : '8px 14px', borderBottom:'1px solid #DCD7CE', textAlign: narrowNav ? 'center' : 'left'}}>
          {isOwner ? (
            <div style={{fontSize:11, color:'#C3261C', fontWeight:700}}>사장</div>
          ) : isStore ? (
            <div style={{fontSize:11, color:'#2B5C9E', fontWeight:700}}>{narrowNav ? '매장' : '매장계정'}</div>
          ) : isInvestor ? (
            <div style={{fontSize:11, color:'#2E7D45', fontWeight:700}}>{narrowNav ? '투자' : (userData?.name||'투자자')}</div>
          ) : narrowNav ? (
            <div style={{fontSize:11, fontWeight:700, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{userData?.name}</div>
          ) : (
            <div style={{display:'flex', flexDirection:'column', gap:4}}>
              <div style={{fontSize:12, fontWeight:700}}>{userData?.name}</div>
              <GradeBadge joinDate={userData?.joinDate} size={10}/>
            </div>
          )}
        </div>
        <nav style={{flex:1, padding:'6px 0', overflowY:'auto'}} aria-label="메뉴" onScroll={hideTip}>
          {menuList(path=>{ hideTip(); navigate(path) }, narrowNav)}
        </nav>
        {editOrder ? null : (
          <div style={{padding:'8px 0', borderTop:'1px solid #DCD7CE'}}>
            {[
              ...((isOwner || isStore) ? [['_file', '폰에서 파일 받기', ()=>setFileOpen(true)]] : []),
              ['_order', '탭 순서 바꾸기', ()=>setEditOrder(menus.map(m=>m.path))],
              [narrowNav ? '_expand' : '_collapse', narrowNav ? '이름 보기' : '아이콘만 보기', toggleWide],
              ['_logout', '로그아웃', handleLogout],
            ].map(([icon, label, fn]) => (
              <button key={icon} type="button" onClick={()=>{ hideTip(); fn() }} className="nav-item" aria-label={narrowNav ? label : undefined}
                onMouseEnter={narrowNav ? showTip(label) : undefined} onMouseLeave={narrowNav ? hideTip : undefined}
                onFocus={narrowNav ? showTip(label) : undefined} onBlur={narrowNav ? hideTip : undefined}
                style={{display:'flex', alignItems:'center', gap:12, width:'100%', border:'none', background:'transparent', fontFamily:'inherit',
                  padding: narrowNav ? '6px 0' : '6px 14px', justifyContent: narrowNav ? 'center' : 'flex-start', color:'#6E6A63', fontSize:12, cursor:'pointer', position:'relative'}}>
                <span style={{display:'grid', placeItems:'center', width:34, height:28}}><NavIcon name={icon} size={19}/></span>
                {!narrowNav && <span>{label}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── 모바일 상단 헤더 ── */}
      <div className="mobile-header" style={{
        display:'none', position:'fixed', top:0, left:0, right:0, zIndex:20,
        background:'#FFFFFF', borderBottom:'1px solid #DCD7CE',
        padding:'12px 16px', alignItems:'center', justifyContent:'space-between'
      }}>
        <div style={{fontSize:15, fontWeight:800, color:'#1D1B18'}}>홍콩반점 <span style={{fontWeight:400, color:'#6E6A63', fontSize:13}}>중앙대점</span></div>
        <div style={{display:'flex', alignItems:'center', gap:10}}>
          {!isOwner && !isStore && !isInvestor && <GradeBadge joinDate={userData?.joinDate} size={9}/>}
          {isOwner    && <span style={{fontSize:11, color:'#C3261C', fontWeight:700}}>사장</span>}
          {isStore    && <span style={{fontSize:11, color:'#2B5C9E', fontWeight:700}}>매장</span>}
          {isInvestor && <span style={{fontSize:11, color:'#2E7D45', fontWeight:700}}>투자자</span>}
          <button onClick={()=>setSideOpen(v=>!v)}
            style={{background:'#F3F1EC', border:'1px solid #DCD7CE', borderRadius:6, color:'#1D1B18', padding:'6px 12px', fontSize:13, fontWeight:600, cursor:'pointer', lineHeight:1, fontFamily:'inherit'}}>
              메뉴
            </button>
        </div>
      </div>

      {/* 모바일 드로어 메뉴 */}
      {sideOpen && (
        <div style={{position:'fixed', inset:0, zIndex:30}} onClick={()=>setSideOpen(false)}>
          <div style={{position:'absolute', top:0, right:0, width:220, height:'100%', background:'#FFFFFF', borderLeft:'1px solid #DCD7CE', padding:'20px 0', overflowY:'auto'}}
            onClick={e=>e.stopPropagation()}>
            <div style={{padding:'0 18px 16px', borderBottom:'1px solid #DCD7CE', marginBottom:8}}>
              <div style={{fontSize:13, fontWeight:700,
                color:isOwner?'#C3261C':isStore?'#2B5C9E':isInvestor?'#2E7D45':'#1D1B18'}}>
                {isOwner?'사장':isStore?'매장계정':isInvestor?(userData?.name||'투자자'):userData?.name}
              </div>
              {!isOwner && !isStore && !isInvestor && <div style={{marginTop:4}}><GradeBadge joinDate={userData?.joinDate} size={10}/></div>}
            </div>
            {menuList(path=>{navigate(path);setSideOpen(false)}, false)}
            <div style={{padding:'16px 18px', borderTop:'1px solid #DCD7CE', marginTop:8}}>
              {editButton}
              <button onClick={handleLogout} style={{width:'100%', background:'#F3F1EC', border:'1px solid #DCD7CE', borderRadius:6, color:'#6E6A63', padding:'8px', fontSize:12, cursor:'pointer', fontFamily:'inherit'}}>
                로그아웃
              </button>
            </div>
          </div>
        </div>
      )}

      {tip && narrowNav && (
        <div role="tooltip" className="pc-sidebar" style={{position:'fixed', top:tip.top, left:tip.left, transform:'translateY(-50%)', zIndex:40,
          background:'#1D1B18', color:'#FFFFFF', fontSize:12, fontWeight:600, padding:'5px 9px', borderRadius:4, whiteSpace:'nowrap', pointerEvents:'none'}}>
          {tip.label}
        </div>
      )}

      {(isOwner || isStore) && <OrderAlert/>}

      {fileOpen && <PhoneFileReceiveModal onClose={()=>setFileOpen(false)}/>}

      {/* ── MAIN ── */}
      <div className="main-content" style={{marginLeft:NAV_W, transition:'margin-left .18s ease', flex:1, minWidth:0, padding:'28px 30px', minHeight:'100vh', textAlign:'left'}}>
        {children}
      </div>

      {/* ── 모바일 하단 탭바 ── */}
      <div className="mobile-tabbar" style={{
        display:'none', position:'fixed', bottom:0, left:0, right:0, zIndex:20,
        background:'#FFFFFF', borderTop:'1px solid #DCD7CE',
        padding:'6px 0 8px'
      }}>
        <div style={{display:'flex', justifyContent:'space-around'}}>
          {bottomMenus.map(m=>(
            <div key={m.path} onClick={()=>navigate(m.path)}
              style={{display:'flex', flexDirection:'column', alignItems:'center', padding:'8px 6px 6px', cursor:'pointer',
                color:location.pathname===m.path?'#1D1B18':'#6E6A63', minWidth:50,
                borderTop:`2px solid ${location.pathname===m.path ? '#C3261C' : 'transparent'}`, marginTop:-7}}>
              <span style={{color: NAV_GROUPS[navGroupOf(m.path)].color, opacity: location.pathname===m.path ? 1 : 0.8, marginBottom:2}}><NavIcon name={m.path} size={20}/></span>
              <span style={{fontSize:11, fontWeight:location.pathname===m.path?700:500}}>{m.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 반응형 CSS */}
      <style>{`
        /* 페이지가 자기 바탕색을 쓸 때 (매출입력 디자인 시안) — main-content 여백까지 채움 */
        .page-surface { margin: -28px -30px; padding: 28px 30px; min-height: 100vh; box-sizing: border-box; }
        /* 픽토그램 메뉴: 마우스를 올리거나 키보드로 고르면 이름이 오른쪽에 나옴 */
        .nav-item:hover { background: #ECE8E1 !important; }
        .nav-item[aria-current="page"]:hover { background: #FFFFFF !important; }
        .nav-item:focus-visible { outline: 2px solid #1D1B18; outline-offset: -2px; }
        @media (max-width: 768px) {
          .page-surface { margin: -70px -14px -80px; padding: 70px 14px 80px; }
        }
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
