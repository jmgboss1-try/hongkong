import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Grid } from '@astryxdesign/core/Grid'
import { Divider } from '@astryxdesign/core/Divider'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Card } from '@astryxdesign/core/Card'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Selector } from '@astryxdesign/core/Selector'
import { TabList, Tab } from '@astryxdesign/core/TabList'
import { List, ListItem } from '@astryxdesign/core/List'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { TextInput } from '@astryxdesign/core/TextInput'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { AstryxPage, Legacy, PageHeader, LedgerCard } from '../astryx/AstryxPage'
import TimeSelect from '../astryx/TimeSelect'
import { db } from '../firebase'
import { doc, getDoc, setDoc, collection, query, orderBy, limit, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore'
import { MODES, DEFAULT_ITEMS, DEFAULT_SETTINGS, DAYS, won, catsOf, openState } from '../lib/menuData'
import { toDate, hm } from '../lib/attendance'
import { EVENTS, PRESETS, loadSound, saveSound, unlockAudio, audioReady, playEvent, setOrdersVisible, askNotify } from '../lib/orderSounds'

// 사장님·매장 계정: QR 주문 받기 + 메뉴(가격·옵션·품절) 고치기
// 주문은 orders 를 실시간으로 보고(onSnapshot) 새 주문이 오면 소리를 냄 — 포스에 이 화면을 띄워 두면 됨
const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', soft:'#ECE8E1', chip:'#F3F1EC', red:'var(--hk-accent)', green:'#2E7D45', blue:'#2B5C9E', amber:'#B45309' }
const STATUS = { new:['새 주문', T.red], accepted:['접수함', T.blue], done:['완료', T.green], canceled:['취소', T.faint] }


// 메뉴 문서는 화면을 열 때 미리 받아 두고(탭을 누를 때 기다리지 않게), 저장하면 같이 고쳐 둠
let menuCache = null   // { items, settings, fromDefault }
let menuReq = null
function fetchMenu() {
  menuCache = null
  menuReq = getDoc(doc(db,'menu','public')).then(s => {
    const d = s.exists() ? s.data() : null
    menuCache = { items: d?.items?.length ? d.items : DEFAULT_ITEMS, settings: { ...DEFAULT_SETTINGS, ...(d?.settings||{}) }, fromDefault: !d?.items?.length }
    return menuCache
  }).catch(e => { console.error(e); return menuCache || { items: DEFAULT_ITEMS, settings: DEFAULT_SETTINGS, fromDefault: true } })
  return menuReq
}

export default function MenuManage() {
  const [tab, setTab] = useState('orders')
  const [menuOpened, setMenuOpened] = useState(false)
  useEffect(() => { fetchMenu() }, [])
  const pick = k => { setTab(k); if (k !== 'orders') setMenuOpened(true) }
  // 위쪽 'QR 새 주문' 띠를 누르면 (이미 이 화면이어도) QR 주문 탭으로
  useEffect(() => {
    const f = () => setTab('orders')
    window.addEventListener('showorders', f)
    return () => window.removeEventListener('showorders', f)
  }, [])
  return (
    <AstryxPage>
    <VStack gap={4}>
      <PageHeader title="메뉴 · 주문"/>
      <TabList value={tab} onChange={k=>k && pick(k)}>
        <Tab value="orders" label="QR 주문"/>
        <Tab value="menu" label="메뉴 고치기"/>
        <Tab value="settings" label="배달 설정"/>
      </TabList>
      {tab === 'orders' && <Orders/>}
      {/* 한 번 연 메뉴 화면은 주문 탭에 갔다 와도 그대로 (다시 불러오지 않고, 저장 안 한 고침도 남음). 끌어서 순서 바꾸기가 있어 아직 예전 모양 */}
      {menuOpened && <div hidden={tab === 'orders'}><MenuEditor tab={tab === 'orders' ? 'menu' : tab}/></div>}
    </VStack>
    </AstryxPage>
  )
}

// ── QR 주문 받기 ──
function Orders() {
  const [orders, setOrders] = useState(null)
  const [err, setErr] = useState('')
  const [sound, setSound] = useState(audioReady)     // 이 기기에서 소리 켰는지 (다른 화면에서 이미 눌렀으면 켜져 있음)
  const [snd, setSnd] = useState(loadSound)          // 소리 설정 (기기마다)
  const [showSnd, setShowSnd] = useState(false)
  const [showOld, setShowOld] = useState(false)
  const sndRef = useRef(snd)
  useEffect(() => { sndRef.current = snd; saveSound(snd) }, [snd])

  useEffect(() => {
    const q = query(collection(db,'orders'), orderBy('createdAt','desc'), limit(80))
    return onSnapshot(q, s => {
      const list = s.docs.map(d => ({ id:d.id, ...d.data() }))
      // 새 주문·경고 소리는 앱 전체에서 OrderAlert 가 냄 (이 화면이 아닌 탭·메뉴에 있어도 빠지지 않게)
      setOrders(list)
    }, e => { console.error(e); setErr(e.code === 'permission-denied' ? '주문을 읽을 권한이 없어요. Firestore 규칙에 orders 를 추가해 주세요.' : '주문을 불러오지 못했어요.') })
  }, [])


  // 이 목록이 보이는 동안은 위쪽 알림 띠를 안 띄움
  useEffect(() => { setOrdersVisible(true); return () => setOrdersVisible(false) }, [])

  function enableSound() {
    try {
      if (!unlockAudio()) throw new Error('no audio')
      askNotify()
      setSound(true); setTimeout(() => playEvent(sndRef.current, 'new'), 50)
    } catch { alert('이 기기에서는 소리를 낼 수 없어요') }
  }
  async function setStatus(o, status, eta) {
    if (status === 'canceled' && !window.confirm(`주문 ${o.code}을(를) 취소할까요? 손님께는 전화로 알려 주세요.`)) return
    try {
      await updateDoc(doc(db,'orders',o.id), { status, [`${status}At`]: serverTimestamp(), ...(eta ? { eta } : {}) })
      playEvent(sndRef.current, status === 'accepted' ? 'accept' : status === 'done' ? 'done' : status === 'canceled' ? 'cancel' : 'none')
    } catch(e) { console.error(e); alert('바꾸지 못했어요. 다시 시도해 주세요.') }
  }

  if (err) return <Banner status="error" title={err}/>
  if (!orders) return <Text color="secondary">주문을 불러오고 있어요...</Text>
  const active = orders.filter(o => o.status === 'new' || o.status === 'accepted')
  const old = orders.filter(o => o.status === 'done' || o.status === 'canceled')

  return (
    <VStack gap={3}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        {!sound ? <Button variant="primary" label="주문 소리 켜기" onClick={enableSound}/> : <Badge variant="success" label="소리 켜짐"/>}
        <Button label={showSnd ? '소리 설정 닫기' : '소리 설정'} onClick={()=>setShowSnd(v=>!v)}/>
        <Text type="supporting" color="secondary">이 화면을 포스에 띄워 두면 손님이 QR로 주문할 때 바로 떠요. 접수하고 배달은 기사님을 불러 주세요.</Text>
      </HStack>
      {showSnd && <SoundSettings snd={snd} setSnd={setSnd} ready={sound} onUnlock={enableSound}/>}
      {!active.length && <EmptyState title="지금 들어온 주문이 없어요" isCompact/>}
      {active.map(o => <OrderCard key={o.id} o={o} onStatus={setStatus}/>)}
      {old.length > 0 && <>
        <HStack><Button variant="ghost" label={showOld ? '지난 주문 접기' : `지난 주문 ${old.length}건 보기`} onClick={()=>setShowOld(v=>!v)}/></HStack>
        {showOld && old.map(o => <OrderCard key={o.id} o={o} onStatus={setStatus}/>)}
      </>}
    </VStack>
  )
}

// 소리 설정: 음량, 상황마다 소리 고르기(들어보기), 경고 간격, 내 소리 파일
function SoundSettings({ snd, setSnd, ready, onUnlock }) {
  const set = p => setSnd(s => ({ ...s, ...p }))
  const test = ev => { if (!ready) onUnlock(); setTimeout(() => playEvent(snd, ev), 80) }
  function pickFile(ev, file) {
    if (!file) return
    if (file.size > 400 * 1024) return alert('소리 파일은 400KB 이하로 골라 주세요 (짧은 mp3·wav)')
    const r = new FileReader()
    r.onload = () => setSnd(s => ({ ...s, files:{ ...s.files, [ev]: r.result }, sounds:{ ...s.sounds, [ev]:'custom' } }))
    r.readAsDataURL(file)
  }
  return (
    <LedgerCard title="소리 설정">
      <HStack gap={3} vAlign="center" wrap="wrap">
        <Text weight="bold">음량</Text>
        <Legacy><input type="range" min="0" max="1" step="0.05" value={snd.volume} onChange={e=>set({ volume:+e.target.value })} aria-label="음량" style={{width:200}}/></Legacy>
        <Text hasTabularNumbers>{Math.round(snd.volume*100)}%</Text>
        <Text type="supporting" color="secondary">그래도 작으면 포스 컴퓨터(스피커) 음량도 올려 주세요</Text>
      </HStack>
      <List hasDividers edge="flush">
        {EVENTS.map(ev => (
          <ListItem key={ev.id} label={ev.label}
            endContent={<HStack gap={2} vAlign="center" wrap="wrap">
              <Selector label={`${ev.label} 소리`} isLabelHidden size="sm" value={snd.sounds[ev.id]} onChange={v=>v && set({ sounds:{ ...snd.sounds, [ev.id]: v } })}
                options={Object.entries(PRESETS).filter(([k]) => k !== 'custom' || snd.files?.[ev.id]).map(([k,p]) => ({ value:k, label:p.label }))}/>
              <Button size="sm" label="들어보기" onClick={()=>test(ev.id)}/>
              <Legacy>
                <label style={{cursor:'pointer', fontSize:12}}>
                  내 소리 파일 고르기
                  <input type="file" accept="audio/*" style={{display:'none'}} onChange={e=>{ pickFile(ev.id, e.target.files?.[0]); e.target.value='' }}/>
                </label>
              </Legacy>
            </HStack>}/>
        ))}
      </List>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Text>접수 안 한 주문이</Text>
        <Selector label="경고까지 시간" isLabelHidden size="sm" value={String(snd.remindMin)} onChange={v=>v && set({ remindMin:+v })} options={[1,2,3,5,10].map(m => ({ value:String(m), label:`${m}분` }))}/>
        <Text>넘게 남아 있으면</Text>
        <Selector label="경고 간격" isLabelHidden size="sm" value={String(snd.remindEvery)} onChange={v=>v && set({ remindEvery:+v })} options={[15,30,60,120].map(x => ({ value:String(x), label: x < 60 ? `${x}초` : `${x/60}분` }))}/>
        <Text>마다 경고 소리</Text>
      </HStack>
      <Text type="supporting" color="secondary">소리 설정은 이 기기에만 저장돼요 (포스와 사장님 폰을 따로 정할 수 있어요). 화면을 새로 열면 '주문 소리 켜기'를 한 번 눌러 주세요.</Text>
    </LedgerCard>
  )
}

function OrderCard({ o, onStatus }) {
  const at = toDate(o.createdAt)
  const [label] = STATUS[o.status] || STATUS.new
  const badge = { new:'error', accepted:'info', done:'success', canceled:'neutral' }[o.status] || 'error'
  const phone = String(o.phone||'')
  const phoneFmt = phone.length === 11 ? `${phone.slice(0,3)}-${phone.slice(3,7)}-${phone.slice(7)}` : phone
  return (
    <Card variant={o.status === 'new' ? 'muted' : 'default'} padding={4}>
      <VStack gap={3}>
        <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Text type="large" weight="bold" color="accent" hasTabularNumbers>{o.code}</Text>
            <Text weight="bold">{MODES[o.mode]}</Text>
            <Badge variant={badge} label={label}/>
            <Text type="supporting" color="secondary" hasTabularNumbers>{at ? `${at.getMonth()+1}/${at.getDate()} ${hm(at)}` : ''}</Text>
            {o.eta && o.status !== 'new' && <Badge variant="info" label={`손님께 ${o.eta}분 안내함`}/>}
            {o.mode === 'pickup' && o.pickupIn && <Badge variant="warning" label={`${o.pickupIn}분 뒤 방문${at ? ` (${hm(new Date(at.getTime() + o.pickupIn*60000))})` : ''}`}/>}
          </HStack>
          <HStack gap={2} vAlign="center">
            <Text type="large" weight="bold" hasTabularNumbers>{won(o.total)}</Text>
            <Text type="supporting" color="secondary">{o.pay === 'cash' ? '현금' : '카드'} · 만나서 결제</Text>
          </HStack>
        </HStack>
        <List hasDividers edge="flush">
          {(o.items||[]).map((l,i) => (
            <ListItem key={i} label={<Text weight="bold">{l.name}</Text>} description={l.options?.length ? l.options.map(x=>x.name).join(', ') : undefined}
              endContent={<HStack gap={3}><Text hasTabularNumbers>× {l.qty}</Text><Text hasTabularNumbers>{won(l.total)}</Text></HStack>}/>
          ))}
          {o.deliveryFee > 0 && <ListItem label={<Text color="secondary">배달비</Text>} endContent={<Text hasTabularNumbers>{won(o.deliveryFee)}</Text>}/>}
        </List>
        <VStack gap={1}>
          <HStack gap={2} vAlign="center"><Text color="secondary">연락처</Text><Button size="sm" variant="ghost" label={phoneFmt} onClick={()=>{ window.location.href = `tel:${phone}` }}/></HStack>
          {o.address && <Text><Text color="secondary">주소 </Text><Text weight="bold">{o.address}</Text></Text>}
          {o.request && <Text><Text color="secondary">요청 </Text>{o.request}</Text>}
        </VStack>
        <HStack gap={2} vAlign="center" wrap="wrap">
          {o.status === 'new' && <>
            <Text type="supporting" color="secondary">접수 ({o.mode === 'delivery' ? '도착' : '준비'}까지)</Text>
            {(o.mode === 'delivery' ? [30,40,50,60] : [10,15,20,30]).map(m => <Button key={m} variant="primary" label={`${m}분`} onClick={()=>onStatus(o,'accepted',m)}/>)}
          </>}
          {(o.status === 'new' || o.status === 'accepted') && <Button label={o.mode === 'delivery' ? '배달 보냄 (완료)' : '전달함 (완료)'} onClick={()=>onStatus(o,'done')}/>}
          {(o.status === 'new' || o.status === 'accepted') && <Button variant="destructive" label="취소" onClick={()=>onStatus(o,'canceled')}/>}
          {(o.status === 'done' || o.status === 'canceled') && <Button size="sm" label="다시 진행 중으로" onClick={()=>onStatus(o,'accepted')}/>}
        </HStack>
      </VStack>
    </Card>
  )
}

// ── 메뉴 고치기 / 배달 설정 ──
// ── 끌어서 순서 바꾸기 (마우스·손가락 모두, 아이폰 아이콘 옮기듯) ──
// 손잡이를 누르면 그 줄이 떠올라 손가락을 따라오고, 나머지 줄은 빈자리를 만들며 부드럽게 비켜남.
// 끄는 동안 drag.over/after 로 미리 바뀐 순서를 그리고(부모가 미리보기 계산), 놓으면 onDrop(옮길 것, 놓은 곳, 뒤에 놓는지)
// 줄: [data-drag-group][data-drag-key], 분류 제목: [data-drag-group][data-drag-head] (위·아래 반쪽으로 앞 분류 끝/이 분류 처음)
const dragEls = g => [...document.querySelectorAll(`[data-drag-group="${g}"]`)]
const dragKeyOf = el => el.dataset.dragKey ?? ('head:' + el.dataset.dragHead)
const dragFind = (g, k) => dragEls(g).find(el => el.dataset.dragKey === k)
// 지금 화면에 보이는 위치(움직이는 중이면 그 위치) 기록 → 다음 그림에서 거기서부터 미끄러지게
function dragSnap(g, skip) {
  const rects = new Map()
  for (const el of dragEls(g)) { const k = dragKeyOf(el); if (k !== skip) { const r = el.getBoundingClientRect(); rects.set(k, { x:r.left, y:r.top }) } }
  return { group:g, rects }
}
// 끄는 줄을 손가락 위치로 (원래 자리 기준 이동량을 transform 으로)
function dragPlace(d) {
  const el = d && dragFind(d.group, d.key)
  if (!el) return
  const [ox, oy] = el._dragT || [0, 0]
  const r = el.getBoundingClientRect()
  const natX = r.left - ox + window.scrollX, natY = r.top - oy + window.scrollY
  const tx = d.nx0 + (d.cx + window.scrollX - d.px0) - natX
  const ty = d.ny0 + (d.cy + window.scrollY - d.py0) - natY
  el._dragT = [tx, ty]
  el.style.transform = `translate(${tx}px, ${ty}px)`
  el.style.transition = 'none'
}
function useDragSort() {
  const [drag, setDrag] = useState(null)   // { key, group, over, after }
  const cur = useRef(null)                 // 끄는 중 정보 (손가락 위치 등)
  const snap = useRef(null)
  const active = drag ? `${drag.group}|${drag.key}` : ''

  // 그린 뒤: 자리가 바뀐 줄은 예전 자리에서 새 자리로 미끄러지게, 끄는 줄은 손가락 위치에
  useLayoutEffect(() => {
    const d = cur.current
    const sn = snap.current
    if (sn) {
      snap.current = null
      for (const el of dragEls(sn.group)) {
        const k = dragKeyOf(el)
        if (d && k === d.key) continue
        const p = sn.rects.get(k)
        if (!p) continue
        el.getAnimations?.().forEach(a => a.cancel())
        const r = el.getBoundingClientRect()
        const dx = p.x - r.left, dy = p.y - r.top
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5)
          el.animate?.([{ transform:`translate(${dx}px, ${dy}px)` }, { transform:'none' }], { duration:220, easing:'cubic-bezier(.2,.8,.2,1)' })
      }
    }
    dragPlace(d)
  })

  useEffect(() => {
    if (!active) return
    const target = e => {
      const d = cur.current
      const hit = document.elementsFromPoint(e.clientX, e.clientY)
        .map(x => x.closest?.(`[data-drag-group="${d.group}"]`)).find(x => x && dragKeyOf(x) !== d.key)
      if (!hit) return
      const r = hit.getBoundingClientRect()
      let after = d.horizontal ? e.clientX > r.left + r.width/2 : e.clientY > r.top + r.height/2
      let over = hit.dataset.dragKey
      if (over == null) {   // 분류 제목 위: 아래쪽 반이면 이 분류 맨 앞, 위쪽 반이면 앞 분류 맨 끝
        const list = dragEls(d.group).filter(x => dragKeyOf(x) !== d.key)
        const i = list.indexOf(hit)
        const nb = after ? list[i+1] : list[i-1]
        if (!nb || nb.dataset.dragKey == null) return
        over = nb.dataset.dragKey; after = !after
      }
      if (over === d.over && after === d.after) return
      d.over = over; d.after = after
      snap.current = dragSnap(d.group, d.key)
      setDrag(x => x && { ...x, over, after })
    }
    const move = e => {
      const d = cur.current
      if (!d) return
      d.cx = e.clientX; d.cy = e.clientY
      if (!d.horizontal) { if (e.clientY < 70) window.scrollBy(0, -12); else if (e.clientY > window.innerHeight - 70) window.scrollBy(0, 12) }
      dragPlace(d)
      target(e)
    }
    const end = drop => () => {
      const d = cur.current
      if (!d) return
      // 지금 떠 있는 위치에서 제자리로 내려앉게
      snap.current = dragSnap(d.group, null)
      const el = dragFind(d.group, d.key)
      if (el) { el.style.transform = ''; el.style.transition = ''; el._dragT = null }
      cur.current = null
      setDrag(null)
      if (drop && d.over && d.over !== d.key) d.onDrop(d.key, d.over, d.after)
    }
    const up = end(true), cancel = end(false)
    const scroll = () => dragPlace(cur.current)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('scroll', scroll, { passive:true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('scroll', scroll)
    }
  }, [active])

  const handle = (key, group, onDrop, horizontal) => ({
    onPointerDown: e => {
      if (e.button > 0 || cur.current) return
      e.preventDefault()
      const el = dragFind(group, key)
      if (!el) return
      el.getAnimations?.().forEach(a => a.cancel())
      const r = el.getBoundingClientRect()
      cur.current = { key, group, onDrop, horizontal, over:null, after:false,
        px0: e.clientX + window.scrollX, py0: e.clientY + window.scrollY, nx0: r.left + window.scrollX, ny0: r.top + window.scrollY, cx: e.clientX, cy: e.clientY }
      setDrag({ key, group, over:null, after:false })
    },
    style: { cursor: drag?.key === key ? 'grabbing' : 'grab', touchAction:'none', userSelect:'none', WebkitUserSelect:'none' },
    'aria-label': '끌어서 순서 바꾸기', role:'button', tabIndex:-1,
  })
  // 끄는 줄: 살짝 투명하게 떠오른 모습
  const mark = (key, group) => (drag && drag.group === group && drag.key === key)
    ? { position:'relative', zIndex:30, opacity:0.88, background:'#FFFFFF', boxShadow:'0 12px 28px rgba(29,27,24,0.22)', borderRadius:4, pointerEvents:'none' }
    : {}
  return { drag, handle, mark }
}
// 끌어 놓기 결과 (미리보기와 실제 놓기에 같이 씀)
function moveItemTo(items, fromId, toId, after) {
  const from = items.find(i => i.id === fromId), to = items.find(i => i.id === toId)
  if (!from || !to || fromId === toId) return items
  const rest = items.filter(i => i.id !== fromId)
  const at = rest.findIndex(i => i.id === toId) + (after ? 1 : 0)
  return [...rest.slice(0, at), { ...from, cat: to.cat }, ...rest.slice(at)]
}
function moveKeyTo(arr, from, to, after) {
  if (from === to || !arr.includes(to)) return arr
  const rest = arr.filter(c => c !== from)
  const at = rest.indexOf(to) + (after ? 1 : 0)
  return [...rest.slice(0, at), from, ...rest.slice(at)]
}
const Grip = () => (
  <svg width="14" height="18" viewBox="0 0 14 18" aria-hidden="true" style={{display:'block'}}>
    {[3,9,15].flatMap(y => [4,10].map(x => <circle key={x+'-'+y} cx={x} cy={y} r="1.6" fill="currentColor" opacity="0.45"/>))}
  </svg>
)
// 가격 바로 고치기 (칸을 눌러 숫자를 바꾸고 엔터 또는 다른 곳 누르면 반영). 가격이 바뀌면 key 로 다시 그림
function PriceInput({ value, onChange, label }) {
  const [v, setV] = useState((value||0).toLocaleString('ko-KR'))
  const commit = () => { const n = +String(v).replace(/[^0-9]/g,'') || 0; if (n !== (value||0)) onChange(n); else setV((value||0).toLocaleString('ko-KR')) }
  return (
    <div onBlur={commit}>
      <HStack gap={1} vAlign="center">
        <TextInput label={label} isLabelHidden size="sm" width={100} inputMode="numeric" value={v} onEnter={commit}
          onChange={t=>{ const n = +String(t||'').replace(/[^0-9]/g,''); setV(n ? n.toLocaleString('ko-KR') : '') }}/>
        <Text color="secondary">원</Text>
      </HStack>
    </div>
  )
}

function MenuEditor({ tab }) {
  const [items, setItems] = useState(() => menuCache?.items ?? null)
  const [settings, setSettings] = useState(() => menuCache?.settings ?? DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(true)
  const [fromDefault, setFromDefault] = useState(() => !!menuCache?.fromDefault)
  const [mode, setMode] = useState('pickup')
  const [edit, setEdit] = useState(null)   // 고치는 메뉴 (사본)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [picking, setPicking] = useState(null)   // 메뉴 묶기: 고른 메뉴 id 들
  const [both, setBoth] = useState(true)          // 포장·배달 둘 다 묶기
  const dnd = useDragSort()

  // 미리 받아 둔 메뉴가 있으면 바로 보여 주고, 받는 중이면 그걸 기다림
  const fromCache = useRef(!!menuCache)
  useEffect(() => {
    if (fromCache.current) return
    let live = true
    ;(menuReq || fetchMenu()).then(c => { if (live) { setItems(c.items); setSettings(c.settings); setFromDefault(c.fromDefault) } })
    return () => { live = false }
  }, [])

  async function save(nextItems = items, nextSettings = settings) {
    setBusy(true); setMsg('')
    try {
      await setDoc(doc(db,'menu','public'), { items: nextItems, settings: nextSettings, updatedAt: new Date().toISOString() })
      menuCache = { items: nextItems, settings: nextSettings, fromDefault: false }
      setSaved(true); setFromDefault(false); setMsg('저장했어요. 손님 메뉴 화면에 바로 나와요')
    } catch(e) { console.error(e); setMsg(e.code === 'permission-denied' ? '저장할 권한이 없어요. Firestore 규칙에 menu 를 추가해 주세요.' : '저장하지 못했어요. 다시 시도해 주세요.') }
    setBusy(false)
  }
  const change = next => { setItems(next); setSaved(false) }
  const patch = (id, p) => change(items.map(i => i.id === id ? { ...i, ...p } : i))
  function remove(i) {
    if (!window.confirm(`${MODES[i.mode]} 메뉴 '${i.name}'을(를) 지울까요? (저장해야 반영돼요)`)) return
    change(items.filter(x => x.id !== i.id))
  }
  function saveEdit() {
    const e = edit
    if (!e.name.trim()) return alert('메뉴 이름을 넣어 주세요')
    const clean = { ...e, name:e.name.trim(), price: +String(e.price).replace(/[^0-9]/g,'') || 0,
      options: (e.options||[]).filter(g => g.name.trim() && g.choices.some(c=>c.name.trim()))
        .map(g => ({ ...g, name:g.name.trim(), choices: g.choices.filter(c=>c.name.trim()).map(c=>({ name:c.name.trim(), price:+String(c.price).replace(/[^0-9-]/g,'')||0 })) })) }
    change(items.some(i => i.id === e.id) ? items.map(i => i.id === e.id ? clean : i) : [...items, clean])
    setEdit(null)
  }
  function copyToOther(i) {
    const other = i.mode === 'pickup' ? 'delivery' : 'pickup'
    if (items.some(x => x.mode === other && x.name === i.name)) return alert(`${MODES[other]} 메뉴에 '${i.name}'이(가) 이미 있어요`)
    change([...items, { ...i, id:`${other[0]}${Date.now().toString(36)}`, mode:other }])
    setMsg(`${MODES[other]} 메뉴에 복사했어요. 가격을 확인하고 저장해 주세요`)
  }  // 고른 메뉴들을 한 메뉴로 (같은 이름의 메뉴가 다른 쪽(포장/배달)에도 있으면 같이)
  function doGroup() {
    const sel = items.filter(i => picking.includes(i.id))
    if (sel.length < 2) return alert('묶을 메뉴를 두 개 이상 골라 주세요')
    const def = [...sel].map(i => i.name).filter(n => !/곱빼기\s*$/.test(n)).sort((a,b) => a.length - b.length)[0] || sel[0].name
    const name = window.prompt('묶은 메뉴 이름 (손님 화면에 이 이름 하나만 보여요)', def)?.trim()
    if (!name) return
    const stamp = Date.now().toString(36)
    let next = items
    const apply = (group, m) => {
      if (group.length < 2) return 0
      const at = next.indexOf(group[0])
      const made = groupItems(group, name, `${m[0]}${stamp}g`)
      next = next.filter(i => !group.includes(i))
      next = [...next.slice(0, at), made, ...next.slice(at)]
      return group.length
    }
    apply(sel, mode)
    const other = mode === 'pickup' ? 'delivery' : 'pickup'
    const names = new Set(sel.map(i => i.name))
    const otherN = both ? apply(next.filter(i => i.mode === other && names.has(i.name)), other) : 0
    change(next); setPicking(null)
    setMsg(`${sel.length}개를 '${name}' 하나로 묶었어요${otherN ? ` (${MODES[other]}도 ${otherN}개)` : ''}. 확인하고 저장해 주세요`)
  }
  function doUngroup(i) {
    if (!window.confirm(`'${i.name}'을(를) 종류별 메뉴로 다시 나눌까요? (저장해야 반영돼요)`)) return
    const stamp = Date.now().toString(36)
    const parts = ungroupItem(i, n => `${i.mode[0]}${stamp}u${n}`)
    const at = items.findIndex(x => x.id === i.id)
    change([...items.slice(0, at), ...parts, ...items.slice(at + 1)])
    setMsg(`'${i.name}'을(를) ${parts.length}개 메뉴로 나눴어요. 저장해 주세요`)
  }


  if (!items) return <Text color="secondary">메뉴를 불러오고 있어요...</Text>

  const saveBar = (
    <Card variant="muted" padding={3}>
      <HStack gap={3} vAlign="center" wrap="wrap">
        <Button variant="primary" label={busy ? '저장 중...' : '저장'} isDisabled={busy || (saved && !fromDefault)} onClick={()=>save()}/>
        {!saved && <Badge variant="warning" label="고친 내용이 아직 저장 안 됐어요"/>}
        {fromDefault && saved && <Text type="supporting" color="secondary">포스 사진으로 만든 기본 메뉴예요. 한 번 저장하면 손님 화면에 이 메뉴가 쓰여요</Text>}
        {msg && <Text type="supporting" color={msg.includes('못') || msg.includes('권한') ? 'accent' : 'secondary'}>{msg}</Text>}
        <Button size="sm" variant="ghost" label="손님 화면 보기" onClick={()=>window.open('/menu', '_blank', 'noopener')}/>
      </HStack>
    </Card>
  )

  if (tab === 'settings') {
    const set = (k, v) => { setSettings(s => ({ ...s, [k]: v })); setSaved(false) }
    const money = (k, label) => (
      <ListItem label={label} endContent={<TextInput label={label} isLabelHidden inputMode="numeric" width={140} value={(settings[k]||0).toLocaleString('ko-KR')} onChange={v=>set(k, +v.replace(/[^0-9]/g,'')||0)}/>}/>
    )
    return (
      <VStack gap={3}>
        {saveBar}
        <LedgerCard title="배달 설정">
          <CheckboxInput label="QR 주문 받기" description="끄면 손님 화면에 메뉴만 보이고 전화 주문 안내가 나와요" value={settings.open !== false} onChange={v=>set('open', v)}/>
          <Hours settings={settings} set={set}/>
          <List hasDividers edge="flush">
            {money('minDelivery','배달 최소 주문 금액 (원)')}
            {money('freeDelivery','무료배달 기준 금액 (원)')}
            {money('deliveryFee','배달비 (기준 미만일 때, 원)')}
            <ListItem label="매장 전화번호" endContent={<TextInput label="매장 전화번호" isLabelHidden type="tel" width={170} value={settings.phone || ''} onChange={v=>set('phone', v)}/>}/>
          </List>
          <TextInput label="손님 화면 맨 위 안내" isOptional placeholder="예: 오늘은 탕수육 재료 소진으로 주문이 안 돼요" value={settings.notice||''} onChange={v=>set('notice', v)}/>
        </LedgerCard>
      </VStack>
    )
  }

  // 끄는 동안에는 놓으면 될 순서를 미리 보여 줌
  const dg = dnd.drag
  const shownItems = dg?.group === 'item' && dg.over ? moveItemTo(items, dg.key, dg.over, dg.after) : items
  const list = shownItems.filter(i => i.mode === mode)
  const allCats = catsOf(settings, items)
  const cats = dg?.group === 'cat' && dg.over ? moveKeyTo(allCats, dg.key, dg.over, dg.after) : allCats
  // 분류 고치기: 순서는 settings.cats, 이름을 바꾸면 그 분류 메뉴들도 같이 바뀜
  const setCats = next => { setSettings(s => ({ ...s, cats: next })); setSaved(false) }
  function addCat() {
    const n = window.prompt('새 분류 이름 (예: 세트, 계절 메뉴)')?.trim()
    if (!n) return
    if (allCats.includes(n)) return alert('이미 있는 분류예요')
    setCats([...allCats, n])
  }
  function renameCat(c) {
    const n = window.prompt(`'${c}' 분류의 새 이름`, c)?.trim()
    if (!n || n === c) return
    if (allCats.includes(n)) return alert('이미 있는 분류예요. 합치려면 메뉴의 분류를 하나씩 바꿔 주세요')
    setCats(allCats.map(x => x === c ? n : x))
    change(items.map(i => i.cat === c ? { ...i, cat:n } : i))
  }
  function removeCat(c) {
    const used = items.filter(i => i.cat === c).length
    if (used) return alert(`'${c}' 분류에 메뉴가 ${used}개 있어요. 메뉴를 다른 분류로 옮기거나 지운 뒤에 분류를 지워 주세요`)
    if (!window.confirm(`'${c}' 분류를 지울까요?`)) return
    setCats(allCats.filter(x => x !== c))
  }
  // 메뉴 끌어 놓기: 놓은 메뉴 앞(뒤)으로, 다른 분류에 놓으면 그 분류로 옮김
  const dropItem = (fromId, toId, after) => {
    const from = items.find(i => i.id === fromId), to = items.find(i => i.id === toId)
    if (!from || !to) return
    change(moveItemTo(items, fromId, toId, after))
    if (from.cat !== to.cat) setMsg(`'${from.name}'을(를) ${to.cat}(으)로 옮겼어요. 저장해 주세요`)
  }
  const dropCat = (from, to, after) => setCats(moveKeyTo(allCats, from, to, after))
  const moveCat = (c, d) => { const a = [...allCats], i = a.indexOf(c), j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; setCats(a) }
  return (
    <VStack gap={3}>
      {saveBar}
      {/* 분류: 칩을 끌어서 순서 바꾸기 (끄는 칩은 data-drag-* 가 붙은 맨 바깥 div, 떠오르는 모양만 인라인) */}
      <Card variant="muted" padding={3}>
        <VStack gap={2}>
          <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Text weight="bold">분류</Text>
              <Text type="supporting" color="secondary">손님 화면에 이 순서로 나와요 (포장·배달 같이 씀). 이름 바꾸기·순서·삭제 후 '저장'</Text>
            </HStack>
            <Button size="sm" label="+ 분류 추가" onClick={addCat}/>
          </HStack>
          <HStack gap={2} wrap="wrap">
            {cats.map((c, i) => (
              <div key={c} data-drag-group="cat" data-drag-key={c} style={dnd.mark(c,'cat')}>
                <Card padding={1}>
                  <HStack gap={1} vAlign="center">
                    <span {...dnd.handle(c, 'cat', dropCat, true)}><Grip/></span>
                    <Text weight="bold">{c}</Text>
                    <Text type="supporting" color="secondary" hasTabularNumbers>{items.filter(x=>x.cat===c).length}</Text>
                    <Button size="sm" variant="ghost" label="◀" aria-label={`${c} 앞으로`} isDisabled={i===0} onClick={()=>moveCat(c,-1)}/>
                    <Button size="sm" variant="ghost" label="▶" aria-label={`${c} 뒤로`} isDisabled={i===allCats.length-1} onClick={()=>moveCat(c,1)}/>
                    <Button size="sm" variant="ghost" label="이름" onClick={()=>renameCat(c)}/>
                    <Button size="sm" variant="ghost" label="삭제" onClick={()=>removeCat(c)}/>
                  </HStack>
                </Card>
              </div>
            ))}
          </HStack>
        </VStack>
      </Card>
      <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
        <SegmentedControl label="포장·배달" value={mode} onChange={k=>{ if (!k) return; setMode(k); setEdit(null) }}>
          {Object.entries(MODES).map(([k,l]) => <SegmentedControlItem key={k} value={k} label={`${l} 메뉴 (${items.filter(i=>i.mode===k).length})`}/>)}
        </SegmentedControl>
        <HStack gap={2}>
          <Button label={picking ? '묶기 그만' : '메뉴 묶기'} onClick={()=>{ setPicking(p => p ? null : []); setEdit(null) }}/>
          <Button variant="primary" label={`+ ${MODES[mode]} 메뉴 추가`} onClick={()=>setEdit({ id:`${mode[0]}${Date.now().toString(36)}`, mode, cat:allCats[0]||'기타', name:'', price:0, best:false, soldOut:false, hidden:false, desc:'', options:[] })}/>
        </HStack>
      </HStack>
      <Text type="supporting" color="secondary">왼쪽 점(⠿)을 끌어 순서를 바꾸고, 다른 분류에 놓으면 분류가 바뀌어요. 가격은 눌러서 바로 고쳐요</Text>
      {picking && (
        <Card variant="muted" padding={3}>
          <VStack gap={2}>
            <Text><Text weight="bold">한 메뉴로 묶을 것들을 고르세요.</Text> 예: 짬뽕 · 고추짬뽕 · 고기짬뽕과 각 곱빼기. 손님은 메뉴를 고른 뒤 종류를 꼭 고르고, 곱빼기는 원하면 골라요 (곱빼기 값이 모두 같을 때).</Text>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <CheckboxInput label={`${mode === 'pickup' ? '배달' : '포장'} 메뉴도 같은 이름끼리 같이`} value={both} onChange={v=>setBoth(v)}/>
              <Button variant="primary" label={`${picking.length}개 한 메뉴로 묶기`} isDisabled={picking.length < 2} onClick={doGroup}/>
              <Button label="취소" onClick={()=>setPicking(null)}/>
            </HStack>
          </VStack>
        </Card>
      )}
      {/* 메뉴 줄: 끌어서 순서 바꾸기. 끄는 줄은 data-drag-* 가 붙은 맨 바깥 div (떠오르는 모양만 인라인) */}
      {cats.filter(c => list.some(i=>i.cat===c)).map(c => (
        <VStack key={c} gap={0}>
          <div data-drag-group="item" data-drag-head={c}>
            <VStack gap={1}><Heading level={5}>{c}</Heading><Divider variant="strong"/></VStack>
          </div>
          {list.filter(i=>i.cat===c).map(i => (
            <div key={i.id} data-drag-group="item" data-drag-key={i.id} style={dnd.mark(i.id,'item')}>
              <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap" padding={1}>
                <HStack gap={2} vAlign="center">
                {picking
                  ? <CheckboxInput label={`${i.name} 고르기`} isLabelHidden value={picking.includes(i.id)} onChange={v=>setPicking(p => v ? [...p, i.id] : p.filter(x => x !== i.id))}/>
                  : <span {...dnd.handle(i.id, 'item', dropItem)}><Grip/></span>}
                <VStack gap={0} minWidth={160}>
                  <HStack gap={1} vAlign="center" wrap="wrap">
                    <Text weight="bold" color={i.hidden ? 'secondary' : 'primary'}>{i.name}</Text>
                    {i.best && <Badge variant="red" label="추천"/>}
                    {i.hidden && <Badge label="숨김"/>}
                    {i.soldOut && <Badge variant="error" label="품절"/>}
                  </HStack>
                  {isGrouped(i)
                    ? <Text type="supporting" color="secondary">종류 {i.options[0].choices.map(c => `${c.name}${+c.price ? ` +${(+c.price).toLocaleString('ko-KR')}` : ''}`).join(' · ')}{i.options.length > 1 ? ` / ${i.options.slice(1).map(g=>g.name).join(', ')}` : ''}</Text>
                    : i.options?.length > 0 && <Text type="supporting" color="secondary">옵션 {i.options.map(g=>g.name).join(', ')}</Text>}
                </VStack>
                </HStack>
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <PriceInput key={`${i.id}|${i.price}`} value={i.price} label={`${i.name} 가격`} onChange={n=>patch(i.id,{ price:n })}/>
                  <CheckboxInput label="품절" value={!!i.soldOut} onChange={v=>patch(i.id,{ soldOut:v })}/>
                  <Button size="sm" label="수정" onClick={()=>setEdit(JSON.parse(JSON.stringify(i)))}/>
                  {isGrouped(i) && <Button size="sm" label="풀기" onClick={()=>doUngroup(i)}/>}
                  <Button size="sm" variant="ghost" label={i.mode==='pickup' ? '배달에 복사' : '포장에 복사'} onClick={()=>copyToOther(i)}/>
                  <Button size="sm" variant="ghost" label="삭제" onClick={()=>remove(i)}/>
                </HStack>
              </HStack>
              <Divider/>
            </div>
          ))}
        </VStack>
      ))}
      {edit && <ItemForm edit={edit} setEdit={setEdit} onSave={saveEdit} cats={allCats} isNew={!items.some(i=>i.id===edit.id)}/>}
    </VStack>
  )
}

// 메뉴 하나 고치기: 이름·가격·분류·설명·추천·숨김 + 옵션 묶음
// 영업시간·브레이크: 켜면 그 시간에만 손님 주문을 받음 (요일마다)
function Hours({ settings, set }) {
  const st = openState(settings)
  const day = (w, p) => set('hours', { ...settings.hours, [w]: { ...(settings.hours?.[w]||{}), ...p } })
  return (
    <VStack gap={2}>
      <CheckboxInput label="영업시간에만 주문 받기" description="쉬는 날·영업 전·브레이크·마감 뒤에는 손님 화면에 안내가 나오고 주문 버튼이 막혀요" value={!!settings.hoursOn} onChange={v=>set('hoursOn', v)}/>
      <HStack gap={2} vAlign="center"><Text type="supporting" color="secondary">지금:</Text><Badge variant={st.ok ? 'success' : 'error'} label={st.ok ? '주문 받는 중' : st.text}/></HStack>
      {settings.hoursOn && <>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Text>마감</Text>
          <Selector label="주문 마감" isLabelHidden size="sm" value={String(settings.lastOrder ?? 30)} onChange={v=>v != null && set('lastOrder', +v)} options={[0,10,20,30,40,60].map(m => ({ value:String(m), label:`${m}분 전` }))}/>
          <Text>까지 주문 받기</Text>
        </HStack>
        <List hasDividers edge="flush">
          {[1,2,3,4,5,6,0].map(w => {
            const d = { ...(DEFAULT_SETTINGS.hours[w]||{}), ...(settings.hours?.[w]||{}) }
            return (
              <ListItem key={w} align="start"
                label={<HStack gap={3} vAlign="center"><Text weight="bold" color={w===0 ? 'accent' : 'primary'}>{DAYS[w]}</Text><CheckboxInput label="쉼" value={!!d.closed} onChange={v=>day(w,{ closed:v })}/></HStack>}
                description={!d.closed && <VStack gap={1}>
                  <HStack gap={2} vAlign="center" wrap="wrap"><Text type="supporting" color="secondary">영업</Text>
                    <TimeSelect value={d.open} onChange={v=>day(w,{ open:v })} label={`${DAYS[w]} 영업 시작`}/><Text>~</Text>
                    <TimeSelect value={d.close} onChange={v=>day(w,{ close:v })} label={`${DAYS[w]} 영업 끝`}/></HStack>
                  <HStack gap={2} vAlign="center" wrap="wrap"><Text type="supporting" color="secondary">브레이크</Text>
                    <TimeSelect value={d.bStart} onChange={v=>day(w,{ bStart:v })} label={`${DAYS[w]} 브레이크 시작`} clearable/><Text>~</Text>
                    <TimeSelect value={d.bEnd} onChange={v=>day(w,{ bEnd:v })} label={`${DAYS[w]} 브레이크 끝`} clearable/></HStack>
                </VStack>}/>
            )
          })}
        </List>
        <Text type="supporting" color="secondary">브레이크가 없는 날은 비워 두세요. 갑자기 쉬는 날은 위의 'QR 주문 받기'를 끄면 돼요.</Text>
      </>}
    </VStack>
  )
}

// ── 메뉴 묶기 / 풀기 ──
// 같은 계열 메뉴(짬뽕·고추짬뽕·고기짬뽕 + 각 곱빼기)를 한 메뉴로: '종류'(꼭 고름) + '곱빼기'(고르면 추가) 옵션
const KIND = '종류', BIG = '곱빼기'
const bigBase = n => n.replace(/\s*곱빼기\s*$/, '').trim()
function groupItems(sel, name, id) {
  const bigs = sel.filter(i => /곱빼기\s*$/.test(i.name) && sel.some(b => b !== i && b.name === bigBase(i.name)))
  let kinds = sel.filter(i => !bigs.includes(i))
  const diffs = bigs.map(b => b.price - kinds.find(k => k.name === bigBase(b.name)).price)
  // 모든 종류에 곱빼기가 있고 추가 금액이 같을 때만 '곱빼기' 옵션으로, 아니면 곱빼기도 종류 중 하나로
  const bigOpt = bigs.length && bigs.length === kinds.length && diffs.every(d => d === diffs[0]) ? diffs[0] : null
  if (bigOpt == null) kinds = sel
  kinds = [...kinds].sort((a, b) => a.price - b.price)
  const base = kinds[0]
  const options = [{ id:'g0', name:KIND, required:true, multi:false,
    choices: kinds.map(k => ({ name: k.name === name ? `기본 ${k.name}` : k.name, price: k.price - base.price })) }]
  if (bigOpt != null) options.push({ id:'g1', name:BIG, required:false, multi:true, choices:[{ name:BIG, price:bigOpt }] })
  for (const g of base.options || []) if (!options.some(o => o.name === g.name)) options.push({ ...g, id:`g${options.length}` })
  return { ...base, id, name, price: base.price, best: sel.some(i => i.best), soldOut:false, hidden:false, options }
}
const isGrouped = i => i.options?.[0]?.name === KIND && i.options[0].required
function ungroupItem(i, newId) {
  const [kind, ...rest] = i.options
  const big = rest.find(g => g.name === BIG && g.choices.length === 1)
  const others = rest.filter(g => g !== big)
  const out = []
  kind.choices.forEach((c, n) => {
    const nm = c.name.replace(/^기본\s+/, '')
    const one = { ...i, id: newId(n * 2), name: nm, price: i.price + (+c.price || 0), best: false, options: others }
    out.push(one)
    if (big) out.push({ ...one, id: newId(n * 2 + 1), name: `${nm}${BIG}`, price: one.price + (+big.choices[0].price || 0) })
  })
  return out
}


function ItemForm({ edit, setEdit, onSave, cats, isNew }) {
  const set = (k, v) => setEdit(e => ({ ...e, [k]: v }))
  const setGroup = (gi, p) => setEdit(e => ({ ...e, options: e.options.map((g,i) => i===gi ? { ...g, ...p } : g) }))
  const close = o => { if (!o) setEdit(null) }
  const templates = [
    ['+ 종류 고르기 (꼭 고름)', { name:KIND, required:true, multi:false, choices:[{ name:'', price:'' },{ name:'', price:'' }] }, true],
    ['+ 곱빼기', { name:BIG, required:false, multi:true, choices:[{ name:BIG, price:'1500' }] }],
    ['+ 토핑 (여러 개)', { name:'토핑 추가', required:false, multi:true, choices:[{ name:'', price:'' }] }],
    ['+ 다른 옵션', { name:'', required:false, multi:false, choices:[{ name:'', price:'' }] }],
  ].filter(([, g]) => !g.name || !(edit.options||[]).some(x => x.name === g.name))
  const addGroup = (g, first) => setEdit(e => { const n = 1 + Math.max(-1, ...(e.options||[]).map(x => +String(x.id).replace(/[^0-9]/g,'') || 0)); const ng = { ...g, id:`g${n}` }; return { ...e, options: first ? [ng, ...(e.options||[])] : [...(e.options||[]), ng] } })
  return (
    <Dialog isOpen onOpenChange={close} width={600} maxHeight="90dvh" purpose="form">
      <DialogHeader title={isNew ? `새 ${MODES[edit.mode] || ''} 메뉴` : `${edit.name || '메뉴'} 고치기`} onOpenChange={close}/>
      <VStack gap={4} padding={4}>
        <Grid columns={{ minWidth: 160, max: 3, repeat: 'fit' }} gap={3}>
          <TextInput label="메뉴 이름" value={edit.name} onChange={v=>set('name', v)}/>
          <TextInput label="가격 (원)" inputMode="numeric" value={(+edit.price||0).toLocaleString('ko-KR')} onChange={v=>set('price', +String(v||'').replace(/[^0-9]/g,'')||0)}/>
          <Selector label="분류" value={edit.cat} onChange={v=>set('cat', v)}
            options={(cats.includes(edit.cat) ? cats : [...cats, edit.cat]).map(c => ({ value:c, label:c }))}/>
        </Grid>
        <TextInput label="설명" isOptional placeholder="예: 불맛 가득한 매콤한 짬뽕" value={edit.desc||''} onChange={v=>set('desc', v)}/>
        <HStack gap={4} wrap="wrap">
          <CheckboxInput label="추천" value={!!edit.best} onChange={v=>set('best', v)}/>
          <CheckboxInput label="손님 화면에서 숨김" value={!!edit.hidden} onChange={v=>set('hidden', v)}/>
        </HStack>

        <VStack gap={2}>
          <HStack gap={2} vAlign="center" wrap="wrap"><Text weight="bold">옵션</Text><Text type="supporting" color="secondary">위에서부터 손님에게 차례로 보여요</Text></HStack>
          {(edit.options||[]).map((g, gi) => (
            <Card key={g.id} variant="muted" padding={3}>
              <VStack gap={2}>
                <HStack gap={3} vAlign="end" wrap="wrap">
                  <TextInput label="옵션 이름" placeholder="예: 맵기" value={g.name} onChange={v=>setGroup(gi,{ name:v })}/>
                  <CheckboxInput label="꼭 고르기" value={!!g.required} onChange={v=>setGroup(gi,{ required:v })}/>
                  <CheckboxInput label="여러 개 고르기" value={!!g.multi} onChange={v=>setGroup(gi,{ multi:v })}/>
                  <Button size="sm" variant="ghost" label="옵션 삭제" onClick={()=>setEdit(e => ({ ...e, options: e.options.filter((_,i)=>i!==gi) }))}/>
                </HStack>
                {g.choices.map((c, ci) => (
                  <HStack key={ci} gap={2} vAlign="center" wrap="wrap">
                    <TextInput label="고를 것" isLabelHidden placeholder="고를 것 (예: 보통맵게)" value={c.name}
                      onChange={v=>setGroup(gi,{ choices: g.choices.map((x,i)=>i===ci ? { ...x, name:v } : x) })}/>
                    <Text color="secondary">+</Text>
                    <TextInput label="추가 금액" isLabelHidden width={90} inputMode="numeric" placeholder="0" value={String(c.price ?? '')}
                      onChange={v=>setGroup(gi,{ choices: g.choices.map((x,i)=>i===ci ? { ...x, price:String(v||'').replace(/[^0-9]/g,'') } : x) })}/>
                    <Text color="secondary">원</Text>
                    <Button size="sm" variant="ghost" label="삭제" onClick={()=>setGroup(gi,{ choices: g.choices.filter((_,i)=>i!==ci) })}/>
                  </HStack>
                ))}
                <HStack><Button size="sm" variant="ghost" label="+ 고를 것 추가" onClick={()=>setGroup(gi,{ choices:[...g.choices, { name:'', price:'' }] })}/></HStack>
              </VStack>
            </Card>
          ))}
          <HStack gap={2} wrap="wrap">
            {templates.map(([t, g, first]) => <Button key={t} size="sm" label={t} onClick={()=>addGroup(g, first)}/>)}
          </HStack>
          <Text type="supporting" color="secondary">종류 고르기: 메뉴 가격은 가장 싼 종류 값으로, 나머지 종류는 차이만 '+금액'에 적어요 (예: 짬뽕 9,000 · 고기짬뽕 +2,000)</Text>
        </VStack>

        <HStack gap={2} vAlign="center" wrap="wrap">
          <Button variant="primary" label="확인" onClick={onSave}/>
          <Button label="취소" onClick={()=>setEdit(null)}/>
          <Text type="supporting" color="secondary">확인 뒤 위의 '저장'을 눌러야 손님 화면에 반영돼요</Text>
        </HStack>
      </VStack>
    </Dialog>
  )
}
