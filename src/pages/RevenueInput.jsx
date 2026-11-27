import { useEffect, useRef, useState } from 'react'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Button } from '@astryxdesign/core/Button'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Selector } from '@astryxdesign/core/Selector'
import { Banner } from '@astryxdesign/core/Banner'
import { Divider } from '@astryxdesign/core/Divider'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Table } from '@astryxdesign/core/Table'
import { TabList, Tab } from '@astryxdesign/core/TabList'
import { Stepper, Step } from '@astryxdesign/core/Stepper'
import { AstryxPage, Legacy, PageHeader } from '../astryx/AstryxPage'
import CountUp from '../components/CountUp'
import { db, auth } from '../firebase'
import { compressImage } from '../components/PhotoAttach'
import { PhoneReceiveDialog } from '../astryx/PhotoField'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useAuth } from '../AuthContext'
import { chLabels, isNewChannels, ETC_HINT, HALL_HINT, CHANGE_NOTICE_UNTIL } from '../lib/revenueChannels'

const pad = n => String(n).padStart(2,'0')
const DAYS_KR = ['일','월','화','수','목','금','토']

const DELIVERY_PLATFORMS = [
  { key:'baemin',  label:'배달의민족', color:'#2E7D45', emoji:'' },
  { key:'coupang', label:'쿠팡이츠',   color:'#B42318', emoji:'' },
  { key:'yogiyo',  label:'요기요',     color:'var(--hk-accent)', emoji:'' },
  { key:'ddangyeo',label:'땡겨요',     color:'#2B5C9E', emoji:'' },
]

// 화면 색 — 주문전표·장부 디자인 (종이 흰색 바탕, 먹색 글씨, 강조는 짬뽕 빨강 하나, 영수증 같은 점선 줄)
const T = { bg:'#FAF9F6', ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', strong:'#1D1B18',
  accent:'var(--hk-accent)', onAccent:'#FFFFFF', accentSoft:'#F7E6E3', warn:'#8A5300', ok:'#2E6A3A', field:'#FFFFFF', fieldLine:'#CBC5BA', leader:true }
const won = n => (n || 0).toLocaleString('ko-KR')


// early = 얼리 영업 9:00~10:30 (10시 30분에 포스에 찍힌 금액). 오전·마감은 9시부터 쌓인 금액이라 얼리를 포함
const PREFIX = { early:'early', morning:'morning', middle:'middle', close:'' }
const fieldKey = (session, base) => {
  const p = PREFIX[session]
  if(!p) return base // close는 접두어 없음
  return p + base.charAt(0).toUpperCase() + base.slice(1)
}

// 저장 완료 도장 (가운데에 찍혔다가 사라짐, 움직임 줄이기 설정이면 움직이지 않음)
const RI_CSS = `@keyframes riFade { 0% { opacity:0 } 12% { opacity:1 } 82% { opacity:1 } 100% { opacity:0 } }
@keyframes riStamp { 0% { opacity:0; transform: scale(1.8) rotate(-8deg) } 55% { opacity:1; transform: scale(.94) rotate(-3deg) } 75% { transform: scale(1.03) rotate(-3deg) } 100% { opacity:1; transform: scale(1) rotate(-3deg) } }
@keyframes riDraw { to { stroke-dashoffset: 0 } }
.ri-stamp-wrap { animation: riFade 1.9s ease both }
.ri-stamp { animation: riStamp .5s cubic-bezier(.2,.9,.3,1.2) both }
.ri-check { stroke-dasharray: 60; stroke-dashoffset: 60; animation: riDraw .4s .25s ease-out forwards }
@media (prefers-reduced-motion: reduce) { .ri-stamp, .ri-stamp-wrap { animation: none } .ri-check { animation: none; stroke-dashoffset: 0 } }`

export default function RevenueInput() {
  const { userData } = useAuth()
  const now = new Date()
  const today = `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  const todayDD = pad(now.getDate())
  const todayLabel = `${now.getMonth()+1}월 ${now.getDate()}일 (${DAYS_KR[now.getDay()]})`
  // 11월 9일부터: 키오스크 → 홀(매출 프로그램 합계), 포스 → 기타(현금·이체·페이·전화배달)
  const CH = chLabels(`${today}-${todayDD}`), newCh = isNewChannels(`${today}-${todayDD}`)

  // 얼리는 못 적은 날을 나중에 채울 수 있게 이번 달 지난 날짜도 고를 수 있음 (다른 탭은 오늘만)
  const [earlyDay, setEarlyDay] = useState(() => pad(new Date().getDate()))
  const [activeSession, setActiveSession] = useState(() => new Date().getHours() < 11 ? 'early' : 'morning') // 'early' | 'morning' | 'middle' | 'close'
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [stamp, setStamp] = useState(null)   // 저장 완료 도장 {id, label, amount}
  const fileRef = useRef(null)               // 이 기기에서 사진 고르기 (숨긴 파일 칸)

  const [kiosk, setKiosk] = useState('')
  const [pos, setPos]     = useState('')
  const [baemin,   setBaemin]   = useState('')
  const [coupang,  setCoupang]  = useState('')
  const [yogiyo,   setYogiyo]   = useState('')
  const [ddangyeo, setDdangyeo] = useState('')
  // 마감 때만: 배달앱별 주문 건수 (매출분석에서 객단가·할인 효과 계산에 씀)
  const [orders, setOrders] = useState({ baemin:'', coupang:'', yogiyo:'', ddangyeo:'' })

  const delTotal = (+baemin||0)+(+coupang||0)+(+yogiyo||0)+(+ddangyeo||0)

  // 포스기에서 하루 종일 켜두므로 1분마다 날짜를 다시 확인 — 날짜가 바뀌면 그날 문서를 새로 불러옴
  const [, setTick] = useState(0)
  const [scan, setScan] = useState(null) // 사진 인식: { busy } | { result, photo } | { error }
  const [phoneOpen, setPhoneOpen] = useState(false) // 폰에서 출력물 사진 받기 (QR)
  useEffect(()=>{
    const id = setInterval(()=>setTick(t=>t+1), 60000)
    return ()=>clearInterval(id)
  },[])

  useEffect(()=>{
    async function load() {
      setLoading(true)
      try {
        const snap = await getDoc(doc(db,'revenue',today))
        setData(snap.exists() ? snap.data() : {})
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  },[today, todayDD])

  function resetInputs() {
    setKiosk(''); setPos('')
    setBaemin(''); setCoupang(''); setYogiyo(''); setDdangyeo('')
    setOrders({ baemin:'', coupang:'', yogiyo:'', ddangyeo:'' })
  }

  useEffect(()=>{
    setScan(null)
    const rec = data[activeSession === 'early' ? earlyDay : todayDD]
    if(!rec) { resetInputs(); return }
    if(activeSession === 'middle') {
      // 미들타임은 "누적값" 기준으로 입력/표시 (저장은 순수값으로 되어있으므로 오전값을 더해 복원)
      setKiosk(rec.middleKiosk!=null ? (rec.middleKiosk + (rec.morningKiosk||0)) : '')
      setPos(rec.middlePos!=null ? (rec.middlePos + (rec.morningPos||0)) : '')
      setBaemin(rec.middleBaemin!=null ? (rec.middleBaemin + (rec.morningBaemin||0)) : '')
      setCoupang(rec.middleCoupang!=null ? (rec.middleCoupang + (rec.morningCoupang||0)) : '')
      setYogiyo(rec.middleYogiyo!=null ? (rec.middleYogiyo + (rec.morningYogiyo||0)) : '')
      setDdangyeo(rec.middleDdangyeo!=null ? (rec.middleDdangyeo + (rec.morningDdangyeo||0)) : '')
    } else {
      setKiosk(rec[fieldKey(activeSession,'kiosk')] || '')
      setPos(rec[fieldKey(activeSession,'pos')] || '')
      setBaemin(rec[fieldKey(activeSession,'baemin')] || '')
      setCoupang(rec[fieldKey(activeSession,'coupang')] || '')
      setYogiyo(rec[fieldKey(activeSession,'yogiyo')] || '')
      setDdangyeo(rec[fieldKey(activeSession,'ddangyeo')] || '')
    }
    const o = k => rec[`${k}Orders`] != null ? String(rec[`${k}Orders`]) : ''
    setOrders({ baemin:o('baemin'), coupang:o('coupang'), yogiyo:o('yogiyo'), ddangyeo:o('ddangyeo') })
  },[activeSession, data, earlyDay, todayDD])

  // 마감 출력물 사진(JPEG data URL) → 서버(/api/read-receipt)에서 Claude로 읽어 칸을 채움. 저장은 확인 후 직접
  async function readPhoto(photo) {
    if (!photo) return
    setScan({ busy:true })
    try {
      const token = await auth.currentUser?.getIdToken()
      const r = await fetch('/api/read-receipt', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token||''}` },
        body: JSON.stringify({ image: photo }),
      })
      const result = await r.json().catch(()=>({}))
      if (!r.ok) throw new Error(result.error || `사진 인식 실패 (${r.status})`)
      const v = n => n == null ? '' : String(n)
      setKiosk(v(result.kiosk)); setPos(v(result.pos))
      setBaemin(v(result.baemin)); setCoupang(v(result.coupang)); setYogiyo(v(result.yogiyo)); setDdangyeo(v(result.ddangyeo))
      setOrders({ baemin:v(result.baeminOrders), coupang:v(result.coupangOrders), yogiyo:v(result.yogiyoOrders), ddangyeo:v(result.ddangyeoOrders) })
      setScan({ result, photo })
    } catch(e) {
      console.error(e)
      setScan({ error: e.message || '사진을 읽지 못했어요' })
    }
  }

  async function save() {
    setSaving(true)
    try {
      // 저장 직전 최신 데이터를 다시 읽음 — 켜둔 사이 사장님이 다른 기기에서 고친 내용을 덮어쓰지 않도록
      const snap = await getDoc(doc(db,'revenue',today))
      const latest = snap.exists() ? snap.data() : {}
      const targetDD = activeSession === 'early' && earlyDay <= todayDD ? earlyDay : todayDD
      const existing = latest[targetDD] || {}

      let kioskVal, posVal, baeminVal, coupangVal, yogiyoVal, ddangyeoVal

      if (activeSession === 'middle') {
        // 미들타임: 입력값(누적)에서 오전값을 빼서 순수 미들타임 매출로 저장
        kioskVal    = Math.max(0, (+kiosk||0)    - (existing.morningKiosk||0))
        posVal      = Math.max(0, (+pos||0)      - (existing.morningPos||0))
        baeminVal   = Math.max(0, (+baemin||0)   - (existing.morningBaemin||0))
        coupangVal  = Math.max(0, (+coupang||0)  - (existing.morningCoupang||0))
        yogiyoVal   = Math.max(0, (+yogiyo||0)   - (existing.morningYogiyo||0))
        ddangyeoVal = Math.max(0, (+ddangyeo||0) - (existing.morningDdangyeo||0))
      } else {
        kioskVal=+kiosk||0; posVal=+pos||0
        baeminVal=+baemin||0; coupangVal=+coupang||0; yogiyoVal=+yogiyo||0; ddangyeoVal=+ddangyeo||0
      }
      const delSum = baeminVal+coupangVal+yogiyoVal+ddangyeoVal

      const newRow = {
        ...existing,
        [fieldKey(activeSession,'kiosk')]:    kioskVal,
        [fieldKey(activeSession,'del')]:      delSum,
        [fieldKey(activeSession,'baemin')]:   baeminVal,
        [fieldKey(activeSession,'coupang')]:  coupangVal,
        [fieldKey(activeSession,'yogiyo')]:   yogiyoVal,
        [fieldKey(activeSession,'ddangyeo')]: ddangyeoVal,
        [fieldKey(activeSession,'pos')]:      posVal,
        // 마감: 앱별 주문 건수 (비워두면 기록 안 함)
        ...(activeSession==='close' ? Object.fromEntries(Object.entries(orders)
          .filter(([,v])=>v!=='' && v!=null).map(([k,v])=>[`${k}Orders`, Math.max(0, Math.round(+v)||0)])) : {}),
        [`${activeSession}By`]: userData?.name || '매장전용',
        [`${activeSession}At`]: new Date().toISOString(),
      }
      // 오늘 날짜 칸만 저장 (다른 날짜는 건드리지 않음)
      await setDoc(doc(db,'revenue',today), { [targetDD]: newRow }, { merge:true })
      setData({ ...latest, [targetDD]: newRow })
      const label = (targetDD !== todayDD ? `${+targetDD}일 ` : '') + sessionInfo[activeSession].label
      const id = Date.now()
      setStamp({ id, label, amount: kioskVal + delSum + posVal })
      setTimeout(() => setStamp(s => s?.id === id ? null : s), 1900)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  const rec = data[todayDD] || {}

  const sum = (session) =>
    (rec[fieldKey(session,'kiosk')]||0) + (rec[fieldKey(session,'del')]||0) + (rec[fieldKey(session,'pos')]||0)

  const hasEarly   = sum('early') > 0
  const earlySum   = sum('early')
  // 오전은 9시부터 쌓인 금액으로 저장 → 얼리가 있으면 보여 줄 때만 얼리를 뺀 10:30 이후 금액으로
  const netM = base => (rec[fieldKey('morning', base)]||0) - (hasEarly ? (rec[fieldKey('early', base)]||0) : 0)
  const hasMorning = sum('morning') > 0
  const hasMiddle  = sum('middle') > 0
  const hasClose   = sum('close') > 0
  const morningSum = sum('morning')
  const middleSum  = sum('middle')
  const closeSum   = sum('close')

  // 오후 = 마감 - 오전 - 미들
  const hasAfternoon   = hasClose && (hasMorning || hasMiddle)
  const afternoonKiosk = (rec.kiosk||0) - (rec.morningKiosk||0) - (rec.middleKiosk||0)
  const afternoonDel   = (rec.del||0)   - (rec.morningDel||0)   - (rec.middleDel||0)
  const afternoonPos   = (rec.pos||0)   - (rec.morningPos||0)   - (rec.middlePos||0)
  const afternoonSum   = afternoonKiosk + afternoonDel + afternoonPos
  const isNegative     = afternoonKiosk < 0 || afternoonDel < 0 || afternoonPos < 0

  const sessionInfo = {
    early:   { label:'얼리',     hint:'9:00~10:30 · 10시 30분에 포스에 찍힌 금액 그대로 입력해요 (오전·마감은 지금처럼 하루 누적 금액으로 적어요)' },
    morning: { label:'오전',     hint:'오전 영업이 끝나면 입력' },
    middle:  { label:'미들타임', hint:'14:30~16:30, 포스에 찍힌 누적 금액 그대로 입력' },
    close:   { label:'마감',     hint:'하루 전체 합계를 입력해요. 오후 매출은 자동으로 계산돼요' },
  }
  const si = sessionInfo[activeSession]
  const subtotal = (+kiosk||0) + delTotal + (+pos||0)
  const morningTotal = (rec.morningKiosk||0)+(rec.morningDel||0)+(rec.morningPos||0)
  const summary = [
    { key:'early',   label:'얼리',  val:earlySum,   filled:hasEarly,   by:rec.earlyBy },
    { key:'morning', label: hasEarly ? '오전 10:30~' : '오전', val: hasEarly ? morningSum - earlySum : morningSum, filled:hasMorning, by:rec.morningBy },
    { key:'middle',  label:'미들',  val:middleSum,  filled:hasMiddle,  by:rec.middleBy },
    { key:'close',   label:'마감 (하루 합계)', val:closeSum, filled:hasClose, by:rec.closeBy },
  ]

  const sessionKeys = Object.keys(sessionInfo)
  const doneOf = k => (k==='early'&&hasEarly)||(k==='morning'&&hasMorning)||(k==='middle'&&hasMiddle)||(k==='close'&&hasClose)
  const digits = v => v.replace(/[^0-9]/g, '')
  // 금액 칸: 쉼표 찍어 보여주고 숫자만 받음 (값은 숫자 문자열 그대로)
  const money = (label, val, set, extra = {}) => (
    <TextInput label={label} value={val === '' || val == null ? '' : won(+val)} onChange={v=>set(digits(v))}
      inputMode="numeric" placeholder="0" size="lg" {...extra}/>
  )
  // 배달앱별 금액 (오전은 얼리를 뺀 10:30 이후 금액)
  const appParts = session => DELIVERY_PLATFORMS
    .map(p => ({ ...p, v: session === 'morning' ? netM(p.key) : (rec[fieldKey(session, p.key)] || 0) }))
    .filter(p => p.v > 0)
  const delCell = (v, session) => (
    <VStack gap={0} hAlign="end">
      <Text hasTabularNumbers>{won(v)}</Text>
      {session && appParts(session).map(p => <Text key={p.key} type="supporting" color="secondary" hasTabularNumbers>{p.label} {won(p.v)}</Text>)}
    </VStack>
  )
  const historyRows = [
    hasEarly && { id:'early', name:'얼리', note:'9~10:30', k:rec.earlyKiosk, d:delCell(rec.earlyDel, 'early'), p:rec.earlyPos, t:earlySum, by:rec.earlyBy },
    hasMorning && { id:'morning', name:'오전', note: hasEarly ? '10:30~' : '', k:netM('kiosk'), d:delCell(netM('del'), 'morning'), p:netM('pos'), t: hasEarly ? morningSum - earlySum : morningSum, by:rec.morningBy },
    hasMiddle && { id:'middle', name:'미들', note:'', k:rec.middleKiosk, d:delCell(rec.middleDel, 'middle'), p:rec.middlePos, t:middleSum, by:rec.middleBy },
    hasAfternoon && { id:'afternoon', name:'오후', note:'자동 계산', k:afternoonKiosk, d:delCell(afternoonDel), p:afternoonPos, t:afternoonSum, by: isNegative ? '마감이 오전보다 작아요' : '', bad:isNegative },
    hasClose && { id:'close', name:'하루 합계', note:'', k:rec.kiosk, d:delCell(rec.del, 'close'), p:rec.pos, t:closeSum, by:rec.closeBy, strong:true },
  ].filter(Boolean)
  const money2 = v => <Text hasTabularNumbers>{won(v)}</Text>

  return (
    <AstryxPage>
      <VStack gap={5} maxWidth={640}>
        <PageHeader title="매출 입력" right={<Text color="secondary">{todayLabel}</Text>}/>
        {/* 매출 칸이 바뀐 첫 일주일 안내 (11월 9일 ~ 15일) */}
        {newCh && `${today}-${todayDD}` <= CHANGE_NOTICE_UNTIL && (
          <Banner status="warning" title="매출 칸이 바뀌었어요" description="홀에는 매출 프로그램 합계만, 현금·이체·페이·전화배달은 기타에 적어 주세요."/>
        )}

        {/* 오늘 진행: 얼리 → 오전 → 미들 → 마감 (누르면 그 탭으로) */}
        <Stepper activeStep={sessionKeys.indexOf(activeSession)} onStepClick={i => setActiveSession(sessionKeys[i])} label="오늘 매출 입력 진행" density="compact">
          {summary.map((k, i) => (
            <Step key={k.key} step={i} label={k.key === 'close' ? '마감' : k.label} status={k.filled ? 'success' : undefined}
              description={k.filled ? `${won(k.val)}원${k.by ? ` · ${k.by}` : ''}` : '미입력'}/>
          ))}
        </Stepper>

        <TabList value={activeSession} onChange={setActiveSession} layout="fill" hasDivider size="lg">
          {sessionKeys.map(key => (
            <Tab key={key} value={key} label={sessionInfo[key].label} endContent={doneOf(key) ? <StatusDot variant="success" label="입력됨"/> : undefined}/>
          ))}
        </TabList>

        {loading ? <Text color="secondary">불러오는 중...</Text> : (
          <Card key={activeSession}>
            <VStack gap={4}>
              <Text color="secondary">
                {si.hint}
                {activeSession==='morning' && hasEarly && ` · 얼리(${won(earlySum)}원)는 오전 매출에서 자동으로 빠져서 보여요`}
                {activeSession==='middle' && ` · 오전 매출(${hasMorning ? `${won(morningTotal)}원` : '미입력'})을 빼서 미들타임 매출만 저장해요`}
              </Text>

              {activeSession==='early' && (
                <HStack gap={3} vAlign="end" wrap="wrap">
                  <Selector label="얼리 매출 날짜" value={earlyDay} onChange={v => v && setEarlyDay(v)}
                    options={Array.from({ length: +todayDD }, (_, i) => pad(+todayDD - i)).map(dd => {
                      const r = data[dd] || {}
                      const done = (r.earlyKiosk||0)+(r.earlyDel||0)+(r.earlyPos||0) > 0
                      const dow = DAYS_KR[new Date(+today.slice(0,4), +today.slice(5)-1, +dd).getDay()]
                      return { value: dd, label: `${dd === todayDD ? '오늘' : `${+dd}일`} (${dow})${done ? ' · 입력됨' : ''}` }
                    })}/>
                  {earlyDay !== todayDD && <Text color="accent">{+earlyDay}일 얼리 매출을 적고 있어요</Text>}
                </HStack>
              )}

              {activeSession==='close' && (
                <VStack gap={2}>
                  <HStack gap={2} vAlign="center" wrap="wrap">
                    <Button label={scan?.busy ? '사진 읽는 중... (10~30초)' : '폰으로 마감 출력물 찍어서 채우기'} isLoading={!!scan?.busy} onClick={()=>setPhoneOpen(true)}/>
                    {!scan?.busy && <Button variant="ghost" label="이 기기에서 사진 고르기" onClick={()=>fileRef.current?.click()}/>}
                  </HStack>
                  {scan?.error && <Banner status="error" title={scan.error}/>}
                  {scan?.result && (()=>{
                    const r = scan.result
                    const warns = []
                    if (r.total != null && r.total !== subtotal) warns.push(`출력물 합계 ${won(r.total)}원과 아래 합계 ${won(subtotal)}원이 달라요`)
                    if (r.delivery != null && r.delivery !== delTotal) warns.push(`출력물 배달 합계 ${won(r.delivery)}원과 배달 칸 합계 ${won(delTotal)}원이 달라요`)
                    if (r.date && r.date !== `${today}-${todayDD}`) warns.push(`출력물 날짜가 ${r.date}예요. 오늘 출력물이 맞는지 확인하세요`)
                    if (r.notes) warns.push(r.notes)
                    return <Banner status={warns.length ? 'warning' : 'success'} title="출력물에서 읽은 숫자로 채웠어요. 확인하고 저장하세요" description={warns.join(' · ') || undefined}/>
                  })()}
                </VStack>
              )}

              {money(newCh ? `홀 (${HALL_HINT})` : '키오스크', kiosk, setKiosk)}

              <VStack gap={2}>
                <HStack hAlign="between" vAlign="center">
                  <Heading level={5}>배달</Heading>
                  {delTotal > 0 && <Text color="secondary" hasTabularNumbers>{won(delTotal)}원</Text>}
                </HStack>
                {[
                  [baemin,   setBaemin,   '배달의민족', 'baemin'],
                  [coupang,  setCoupang,  '쿠팡이츠',   'coupang'],
                  [yogiyo,   setYogiyo,   '요기요',     'yogiyo'],
                  [ddangyeo, setDdangyeo, '땡겨요',     'ddangyeo'],
                ].map(([val, set, label, key]) => (
                  <VStack key={key} gap={1}>
                    <HStack gap={2} vAlign="end">
                      <VStack gap={0} width="100%">{money(label, val, set)}</VStack>
                      {activeSession==='close' && (
                        <TextInput label="주문 건수" value={orders[key]} onChange={v=>setOrders(o=>({ ...o, [key]: digits(v) }))}
                          inputMode="numeric" placeholder="0" size="lg" width={96}/>
                      )}
                    </HStack>
                    {activeSession==='close' && +orders[key] > 0 && +val > 0 && (
                      <Text type="supporting" color="secondary" hasTabularNumbers justify="end">객단가 {won(Math.round(+val / +orders[key]))}원</Text>
                    )}
                  </VStack>
                ))}
              </VStack>

              {money(newCh ? '기타' : '포스 (현장)', pos, setPos, newCh ? { description: `기타: ${ETC_HINT}` } : {})}

              <Divider variant="strong"/>
              <HStack hAlign="between" vAlign="center">
                <Text type="large" weight="bold">{activeSession==='middle' ? '입력한 누적 금액' : '합계'}</Text>
                <Text type="display-2" hasTabularNumbers textWrap="nowrap"><CountUp value={subtotal} ms={320}/><Text type="large" color="inherit"> 원</Text></Text>
              </HStack>
              {activeSession==='middle' && (
                <HStack hAlign="between" vAlign="center">
                  <Text color="secondary">저장될 미들타임 매출 (오전 제외)</Text>
                  <Text type="large" weight="bold" hasTabularNumbers>{won(Math.max(0, subtotal - morningTotal))}원</Text>
                </HStack>
              )}
              <Button variant="primary" size="lg" width="100%" label={saving ? '저장 중...' : `${si.label} 매출 저장`} isLoading={saving} onClick={save}/>
            </VStack>
          </Card>
        )}

        {/* 오늘 입력 내역 */}
        {historyRows.length > 0 && (
          <Card>
            <VStack gap={3}>
              <Heading level={4}>오늘 입력 내역</Heading>
              <Table data={historyRows} idKey="id" density="compact" columns={[
                { key:'name', header:'구분', renderCell: r => <VStack gap={0}><Text weight={r.strong ? 'bold' : 'semibold'} color={r.bad ? 'accent' : 'primary'}>{r.name}</Text>{r.note && <Text type="supporting" color="secondary">{r.note}</Text>}</VStack> },
                { key:'k', header:CH.kiosk, align:'end', renderCell: r => money2(r.k) },
                { key:'d', header:'배달', align:'end', renderCell: r => r.d },
                { key:'p', header:CH.pos, align:'end', renderCell: r => money2(r.p) },
                { key:'t', header:'합계', align:'end', renderCell: r => <Text weight="bold" hasTabularNumbers color={r.bad ? 'accent' : 'primary'}>{won(r.t)}</Text> },
                { key:'by', header:'입력', renderCell: r => <Text type="supporting" color={r.bad ? 'accent' : 'secondary'}>{r.by || '–'}</Text> },
              ]}/>
            </VStack>
          </Card>
        )}
      </VStack>

      {phoneOpen && (
        <PhoneReceiveDialog hiRes title="마감 출력물 사진 받기"
          hint="폰 카메라로 QR을 찍고 마감 출력물을 찍어 보내세요. 받으면 바로 숫자를 읽어 칸을 채워요."
          onAdd={fresh=>{ setPhoneOpen(false); readPhoto(fresh[fresh.length-1]); return '' }}
          onClose={()=>setPhoneOpen(false)}/>
      )}
      {/* 숨긴 파일 고르기 (이 기기에서 사진 고르기 버튼이 누름) */}
      <Legacy>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{display:'none'}}
          onChange={async e=>{ const f = e.target.files?.[0]; e.target.value=''; if (f) readPhoto(await compressImage(f, 1600, 450)) }}/>
        <style>{RI_CSS}</style>
      </Legacy>
      {/* 저장 완료 도장: 화면 전체를 덮는 자리와 튀어나오는 움직임(RI_CSS)만 바깥 div, 안은 Astryx 카드 */}
      {stamp && (
        <div key={stamp.id} className="ri-stamp-wrap" onClick={()=>setStamp(null)} role="status"
          style={{position:'fixed', inset:0, zIndex:1000, display:'grid', placeItems:'center', background:'rgba(250,249,246,.55)', cursor:'pointer'}}>
          <div className="ri-stamp">
            <Card padding={6}>
              <VStack gap={2} hAlign="center">
                <svg width="56" height="56" viewBox="0 0 56 56" aria-hidden="true">
                  <circle cx="28" cy="28" r="26" fill="var(--color-accent)"/>
                  <path className="ri-check" d="M16 29 l8 8 l16 -17" fill="none" stroke="var(--color-on-accent)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                <Text weight="bold" color="accent">{stamp.label} 매출 저장 완료</Text>
                <Text type="display-3" weight="bold" hasTabularNumbers><CountUp value={stamp.amount} ms={700}/>원</Text>
              </VStack>
            </Card>
          </div>
        </div>
      )}
    </AstryxPage>
  )
}
