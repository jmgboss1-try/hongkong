import { useNavigate, useLocation } from 'react-router-dom'
import { auth, db } from '../firebase'
import { signOut } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import { useAuth } from '../AuthContext'
import { useEffect, useRef, useState } from 'react'
import { migratePrivacy } from '../lib/privateInfo'
import { PhoneFileReceiveModal } from './PhoneFileTransfer'
import NavIcon from './NavIcon'
import ThemeDots from './ThemeDots'
import OrderAlert from './OrderAlert'
import { NAV_GROUPS, navGroupOf } from '../lib/nav'
import { useMode, setMode } from '../lib/dashTheme'
import { SideNav, SideNavItem, SideNavHeading, SideNavSection } from '@astryxdesign/core/SideNav'
import { MobileNav } from '@astryxdesign/core/MobileNav'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Button } from '@astryxdesign/core/Button'
import { Badge } from '@astryxdesign/core/Badge'
import { Card } from '@astryxdesign/core/Card'
import { Avatar } from '@astryxdesign/core/Avatar'
import { AstryxPage, Legacy } from '../astryx/AstryxPage'
import AGradeBadge from '../astryx/GradeBadge'

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
  // 예전 자료의 주민번호·시급 등을 개인 문서로, 급여를 사람별 복사본으로 한 번 옮김 (사장님 계정에서만)
  useEffect(() => { if (isOwner) migratePrivacy() }, [isOwner])
  useEffect(() => {
    const bar = tabbarRef.current, el = bar?.querySelector('[data-active="1"]')
    if (bar && el) bar.scrollLeft = el.offsetLeft - (bar.clientWidth - el.offsetWidth) / 2   // 페이지는 안 움직이고 탭줄만
  }, [location.pathname])
  const [sideOpen, setSideOpen] = useState(false)
  const [fileOpen, setFileOpen] = useState(false) // 폰 → 이 컴퓨터로 파일 옮기기
  // 탭 순서 (경로 배열) — 계정별로 users/{uid}.menuOrder 에 저장
  const [savedOrder, setSavedOrder] = useState(null)
  const [editOrder, setEditOrder]   = useState(null) // 편집 중이면 경로 배열, 아니면 null
  // PC 왼쪽 메뉴: 기본은 픽토그램만 (마우스를 올리면 이름), '이름 보기'로 펼쳐 둘 수 있음 (이 기기에만 기억)
  const [wideNav, setWideNav] = useState(() => { try { return localStorage.getItem('nav.wide') === '1' } catch { return false } })
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
  // 모바일 하단 탭: 모든 메뉴를 옆으로 밀어서 볼 수 있게 (지금 화면 탭은 가운데로)
  const bottomMenus = menus
  const tabbarRef = useRef(null)
  // 밝기: Astryx 화면은 테마가 알아서 바꾸고, Layout 바탕(테마 상자 밖)만 여기서 맞춤 (hongkongTheme 의 body/muted/border 값과 같음)
  const mode = useMode()
  const PAL = mode === 'dark' ? { body:'#15130F', nav:'#2A2722', rule:'#3A362F', ink:'#F3F1EC' } : { body:'#FAF9F6', nav:'#F3F1EC', rule:'#DCD7CE', ink:'#1D1B18' }
  // PC 메뉴 폭은 Astryx SideNav 가 정함 (접힘·펼침) → 재서 본문을 그만큼 띄움
  const navRef = useRef(null)
  const [navW, setNavW] = useState(56)
  useEffect(() => {
    const el = navRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setNavW(el.offsetWidth || 0))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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

  // 메뉴 아이콘: 묶음 색(돈 파랑·사람 보라·매장 주황)은 데이터 색이라 인라인
  // 묶음 색: 다크에서는 어두운 바탕에서 보이게 한 단계 밝게 (대시보드 먹색은 밝은 글자색)
  const DARK_GROUP = { home:PAL.ink, money:'#7FA6E0', people:'#A98FDB', store:'#E3A35B' }
  const groupColor = path => mode === 'dark' ? DARK_GROUP[navGroupOf(path)] : navGroupOf(path) === 'home' ? PAL.ink : NAV_GROUPS[navGroupOf(path)].color
  const iconOf = path => <span style={{display:'inline-flex', color:groupColor(path)}}><NavIcon name={path}/></span>
  const roleLabel = isOwner ? '사장' : isStore ? '매장계정' : isInvestor ? (userData?.name||'투자자') : (userData?.name||'')
  const roleBadge = isOwner ? <Badge variant="red" label="사장"/> : isStore ? <Badge variant="blue" label="매장"/> : isInvestor ? <Badge variant="green" label="투자자"/>
    : <AGradeBadge joinDate={userData?.joinDate}/>

  // 탭 순서 바꾸기 (펼친 메뉴 안에서)
  const orderEditor = (
    <VStack gap={2} padding={2}>
      <Text type="supporting" color="secondary">▲▼로 순서를 바꾼 뒤 저장하세요</Text>
      {menus.map((m,i)=>(
        <HStack key={m.path} gap={1} vAlign="center" hAlign="between">
          <HStack gap={2} vAlign="center">{iconOf(m.path)}<Text>{m.label}</Text></HStack>
          <HStack gap={0}>
            <Button size="sm" variant="ghost" label="▲" aria-label={`${m.label} 위로`} isDisabled={i===0} onClick={()=>moveMenu(i,-1)}/>
            <Button size="sm" variant="ghost" label="▼" aria-label={`${m.label} 아래로`} isDisabled={i===menus.length-1} onClick={()=>moveMenu(i,1)}/>
          </HStack>
        </HStack>
      ))}
      <HStack gap={1} wrap="wrap">
        <Button size="sm" variant="primary" label="저장" onClick={saveOrder}/>
        <Button size="sm" label="기본순서" onClick={()=>setEditOrder(baseMenus.map(m=>m.path))}/>
        <Button size="sm" variant="ghost" label="취소" onClick={()=>setEditOrder(null)}/>
      </HStack>
    </VStack>
  )
  const menuItems = onPick => (
    <SideNavSection title="메뉴" isHeaderHidden>
      {menus.map(m => <SideNavItem key={m.path} label={m.label} icon={iconOf(m.path)} isSelected={location.pathname===m.path} onClick={()=>onPick(m.path)}/>)}
    </SideNavSection>
  )
  const extraItems = onDone => (
    <SideNavSection title="설정" isHeaderHidden>
      {(isOwner || isStore) && <SideNavItem label="폰에서 파일 받기" icon={<NavIcon name="_file"/>} onClick={()=>{ onDone?.(); setFileOpen(true) }}/>}
      <SideNavItem label={mode === 'dark' ? '밝은 화면으로' : '어두운 화면으로'} icon={<NavIcon name="_mode"/>} onClick={()=>setMode(mode === 'dark' ? 'light' : 'dark')}/>
      <SideNavItem label="탭 순서 바꾸기" icon={<NavIcon name="_order"/>} onClick={()=>{ if (!wideNav) toggleWide(); setEditOrder(menus.map(m=>m.path)) }}/>
      <SideNavItem label="로그아웃" icon={<NavIcon name="_logout"/>} onClick={handleLogout}/>
    </SideNavSection>
  )

  return (
    <div style={{display:'flex', minHeight:'100vh', fontFamily:'Noto Sans KR, sans-serif', background:PAL.body, color:PAL.ink, colorScheme:mode}}>

      {/* ── PC 왼쪽 메뉴 (Astryx SideNav): 접으면 아이콘만, 마우스를 올리면 이름 ── */}
      <div ref={navRef} className="pc-sidebar" style={{position:'fixed', top:0, left:0, bottom:0, zIndex:10,
        background:PAL.nav, borderRight:`1px solid ${PAL.rule}`}}>
        <AstryxPage>
          <SideNav
            collapsible={{ isCollapsed:narrowNav, onCollapsedChange:c=>{ if (c === wideNav) toggleWide() }, buttonLabel: narrowNav ? '이름 보기' : '아이콘만 보기' }}
            header={<SideNavHeading heading="홍콩반점" subheading={`중앙대점 · ${roleLabel}`} icon={<Avatar name="홍" size="sm"/>}
              headerEndContent={!isOwner && !isStore && !isInvestor ? <AGradeBadge joinDate={userData?.joinDate}/> : null}/>}
            footer={editOrder ? null : <VStack gap={1}>
              {!narrowNav && <Legacy><ThemeDots size={16} label style={{padding:'2px 8px 6px'}}/></Legacy>}
              {extraItems()}
            </VStack>}>
            {editOrder ? orderEditor : menuItems(path=>navigate(path))}
          </SideNav>
        </AstryxPage>
      </div>

      {/* ── 모바일 상단 헤더 ── */}
      <div className="mobile-header" style={{display:'none', position:'fixed', top:0, left:0, right:0, zIndex:20}}>
        <AstryxPage>
          <Card padding={2}>
            <HStack hAlign="between" vAlign="center" gap={2}>
              <HStack gap={1} vAlign="baseline"><Text weight="bold">홍콩반점</Text><Text type="supporting" color="secondary">중앙대점</Text></HStack>
              <HStack gap={2} vAlign="center">
                {roleBadge}
                <Button size="sm" label="메뉴" onClick={()=>setSideOpen(true)}/>
              </HStack>
            </HStack>
          </Card>
        </AstryxPage>
      </div>

      {/* 모바일 메뉴 서랍 */}
      {sideOpen && (
        <AstryxPage>
          <MobileNav isOpen onOpenChange={o=>{ if (!o) setSideOpen(false) }} side="end" width={260} label="메뉴"
            header={<VStack gap={1}><Text weight="bold">{roleLabel}</Text>{!isOwner && !isStore && !isInvestor && <AGradeBadge joinDate={userData?.joinDate}/>}</VStack>}>
            {editOrder ? orderEditor : menuItems(path=>{ navigate(path); setSideOpen(false) })}
            {!editOrder && <>
              <Legacy><ThemeDots size={22} label style={{padding:'8px 12px'}}/></Legacy>
              {extraItems(()=>setSideOpen(false))}
            </>}
          </MobileNav>
        </AstryxPage>
      )}

      {(isOwner || isStore) && <OrderAlert/>}

      {fileOpen && <PhoneFileReceiveModal onClose={()=>setFileOpen(false)}/>}

      {/* ── MAIN ── */}
      <div className="main-content" style={{marginLeft:navW, flex:1, minWidth:0, padding:'28px 30px', minHeight:'100vh', textAlign:'left'}}>
        {/* 탭을 옮길 때마다 새로 붙어서 화면이 떠오르며 나타남 (appView.css .hk-page) */}
        <div key={location.pathname} className="hk-page">{children}</div>
      </div>

      {/* ── 모바일 하단 탭바: 모든 메뉴를 옆으로 밀어 봄 (지금 탭은 가운데로). 미는 줄·탭 폭·위쪽 강조선만 인라인, 색은 Astryx 토큰 ── */}
      <div className="mobile-tabbar" style={{display:'none', position:'fixed', bottom:0, left:0, right:0, zIndex:20}}>
        <AstryxPage>
          <div style={{background:'var(--color-background-card)', borderTop:'1px solid var(--color-border)', padding:'0 0 8px'}}>
            <div ref={tabbarRef} className="tabbar-scroll" style={{display:'flex', overflowX:'auto', overscrollBehaviorX:'contain', WebkitOverflowScrolling:'touch', scrollbarWidth:'none'}}>
              {bottomMenus.map(m => {
                const on = location.pathname===m.path
                return (
                  <button type="button" key={m.path} onClick={()=>navigate(m.path)} data-active={on ? '1' : '0'} aria-current={on ? 'page' : undefined}
                    style={{flex:'0 0 auto', width: bottomMenus.length <= 5 ? `${100 / bottomMenus.length}%` : '18%', padding:'8px 4px 6px',
                      background:'transparent', border:'none', cursor:'pointer', whiteSpace:'nowrap',
                      borderTop:`2px solid ${on ? 'var(--color-accent)' : 'transparent'}`}}>
                    <VStack gap={0.5} hAlign="center">
                      <span style={{display:'inline-flex', color:groupColor(m.path), opacity: on ? 1 : 0.8}}><NavIcon name={m.path} size={20}/></span>
                      <Text type="supporting" weight={on ? 'bold' : 'normal'} color={on ? 'primary' : 'secondary'}>{m.label}</Text>
                    </VStack>
                  </button>
                )
              })}
            </div>
          </div>
        </AstryxPage>
      </div>

      {/* 반응형 CSS */}
      <style>{`
        /* 페이지가 자기 바탕색을 쓸 때 (매출입력 디자인 시안) — main-content 여백까지 채움 */
        .page-surface { margin: -28px -30px; padding: 28px 30px; min-height: 100vh; box-sizing: border-box; }
        .tabbar-scroll::-webkit-scrollbar { display: none; }
        @media (max-width: 768px) {
          .page-surface { margin: -70px -14px -80px; padding: 70px 14px 80px; }
        }
        @media (max-width: 768px) {
          .pc-sidebar { display: none !important; }
          .mobile-header { display: block !important; }
          .mobile-header > * { width: 100%; }
          .mobile-tabbar { display: block !important; }
          .mobile-tabbar > * { width: 100%; }
          .main-content {
            margin-left: 0 !important;
            padding: 70px 14px 80px !important;
          }
        }
      `}</style>
    </div>
  )
}
