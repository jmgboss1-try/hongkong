import { useEffect, useRef, useState } from 'react'
import { VStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Selector } from '@astryxdesign/core/Selector'
import { TabList, Tab } from '@astryxdesign/core/TabList'
import { HStack } from '@astryxdesign/core/Layout'
import { Button } from '@astryxdesign/core/Button'
import { Table } from '@astryxdesign/core/Table'
import { List, ListItem } from '@astryxdesign/core/List'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { Divider } from '@astryxdesign/core/Divider'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { AstryxPage, Legacy, PageHeader, LedgerCard, Ledger, LedgerRow } from '../astryx/AstryxPage'
import { db } from '../firebase'
import { doc, getDoc, setDoc, collection, getDocs, deleteField } from 'firebase/firestore'
import AttendancePanel from '../components/AttendancePanel'
import { withSubMemos, loadSubs, dayStatus, hm, toDate } from '../lib/attendance'
import { loadPrivateMap } from '../lib/privateInfo'

const pad = n => String(n).padStart(2,'0')

// ── 움직임 ── (움직임 줄이기 설정이면 모두 꺼짐)
//  금액은 굴러가듯 바뀌고, 보기를 바꾸면 내용이 살짝 떠오르며 줄마다 차례로 나타나고, 시간을 저장하면 그 칸이 초록으로 반짝임
function useCountUp(value, ms = 600) {
  const [v, setV] = useState(value)
  const from = useRef(0)
  useEffect(() => {
    const reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const dur = reduce ? 1 : ms
    const start = performance.now(), a = from.current, b = value
    let raf
    const step = t => {
      const k = Math.min(1, (t - start) / dur), e = 1 - Math.pow(1 - k, 3)
      const cur = Math.round(a + (b - a) * e)
      from.current = cur
      setV(cur)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return v
}
function Count({ value, ms }) { return <>{useCountUp(value, ms).toLocaleString()}</> }
const WM_CSS = `@keyframes wmIn { from { opacity:0; transform: translateY(8px) } to { opacity:1; transform:none } }
@keyframes wmRow { from { opacity:0; transform: translateX(-6px) } to { opacity:1; transform:none } }
@keyframes wmGrow { from { transform: scaleX(0) } to { transform: scaleX(1) } }
@keyframes wmSaved { 0% { background:#DDF0E3; border-color:#2E7D45; box-shadow:0 0 0 0 rgba(46,125,69,.45) } 100% { box-shadow:0 0 0 8px rgba(46,125,69,0) } }
@keyframes wmPulse { 0% { box-shadow:0 0 0 0 rgba(46,125,69,.5) } 100% { box-shadow:0 0 0 7px rgba(46,125,69,0) } }
.wm-in { animation: wmIn .3s ease-out both }
.wm-row { animation: wmRow .32s ease-out both }
.wm-grow { transform-origin: left; animation: wmGrow .7s cubic-bezier(.2,.8,.2,1) both }
.wm-saved { animation: wmSaved .9s ease-out }
.wm-live { animation: wmPulse 1.4s ease-out infinite }
.wm-pill { transition: background-color .2s, color .2s, transform .15s }
.wm-pill:active { transform: scale(.96) }
@media (prefers-reduced-motion: reduce) { .wm-in, .wm-row, .wm-grow, .wm-saved, .wm-live { animation: none } .wm-pill { transition: none } }`

// 해당 월의 시급 찾기
function getWageForMonth(emp, month) {
  const history = emp.wageHistory || []
  if(history.length === 0) return emp.wage || 10030
  const applicable = history
    .filter(h => h.month <= month)
    .sort((a,b) => a.month > b.month ? -1 : 1)
  return applicable.length > 0 ? applicable[0].wage : (emp.wage || 10030)
}

// 해당 월에 적용되는 근무스케쥴(소정근로일/평균근무시간) 찾기 — 시급 이력과 동일한 패턴
function getScheduleForMonth(emp, month) {
  const history = emp.scheduleHistory || []
  if(history.length === 0) return { workDays: emp.workDays || [1,2,3,4,5], avgHours: emp.avgHours || 8 }
  const applicable = history
    .filter(h => h.month <= month)
    .sort((a,b) => a.month > b.month ? -1 : 1)
  return applicable.length > 0
    ? { workDays: applicable[0].workDays, avgHours: applicable[0].avgHours }
    : { workDays: emp.workDays || [1,2,3,4,5], avgHours: emp.avgHours || 8 }
}

const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const DAYS_KR = ['일','월','화','수','목','금','토']

function calcWeeklyHoliday(weekHours, wage, workDays, weekAttendance, weekMemos) {
  // 그 주 실제 근무시간이 15시간 미만이면 미지급 (매주 독립 판단)
  if(weekHours < 15) return 0

  // 소정근로일 중 결근일 계산
  const absentDays = workDays.filter(dow => {
    const h = weekAttendance[dow] || 0
    return h === 0
  })

  if(absentDays.length === 0) {
    // 개근 → 주휴 지급
    // 주휴수당 = (그 주 실제근무시간 / 40) × 8 × 시급
    return Math.round((weekHours / 40) * 8 * wage)
  }

  // 결근이 있는 경우 → 대타로 메꿨는지 확인
  const subCount = Object.values(weekMemos).filter(memo =>
    memo && memo.includes('대타')
  ).length

  if(subCount >= absentDays.length) {
    return Math.round((weekHours / 40) * 8 * wage)
  }

  return 0
}

export default function WorkManage() {
  const [curMonth, setCurMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [employees, setEmployees] = useState([])
  const [workHours, setWorkHours] = useState({})   // {uid: {dd: hours}}
  const [workExtra, setWorkExtra] = useState({})   // {uid: {dd: minutes}}
  const [memos, setMemos] = useState({})           // {uid: {dd: memo}}
  const [prevWorkHours, setPrevWorkHours] = useState({})
  const [prevWorkExtra, setPrevWorkExtra] = useState({})
  const [prevMemos, setPrevMemos] = useState({})
  const [subs, setSubs] = useState([])   // 대타 게시판 (확정된 날은 주휴 계산에서 대타로 인정)
  const [att, setAtt] = useState({})     // NFC 출퇴근 attendance/{달}
  const [loading, setLoading] = useState(true)
  const [activeEmp, setActiveEmp] = useState(null)
  const [showTodayOnly, setShowTodayOnly] = useState(false)
  const [severance, setSeverance] = useState({}) // {uid:{amount,tax,net,paidDate}}
  const [nameMap, setNameMap] = useState({}) // uid → name (퇴직자 포함)

  const monthOpts = []
  for(let y=2022;y<=Math.max(2026,new Date().getFullYear());y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  async function load() {
    setLoading(true)
    try {
      // 필요한 문서를 한 번에 같이 불러옴 (하나씩 기다리면 몇 초씩 걸림)
      const [cy,cm] = curMonth.split('-').map(Number)
      const prevMonth = cm===1 ? `${cy-1}-12` : `${cy}-${pad(cm-1)}`
      const data = s => s?.exists() ? s.data() : {}
      const [usersSnap, sevSnap, whSnap, exSnap, memoSnap, prevWhSnap, prevExSnap, prevMemoSnap, subList, attSnap, privMap] = await Promise.all([
        getDocs(collection(db,'users')),
        getDoc(doc(db,'severance',curMonth)),
        getDoc(doc(db,'workhours',curMonth)),
        getDoc(doc(db,'workextra',curMonth)),
        getDoc(doc(db,'workmemos',curMonth)),
        getDoc(doc(db,'workhours',prevMonth)),
        getDoc(doc(db,'workextra',prevMonth)),
        getDoc(doc(db,'workmemos',prevMonth)),
        loadSubs(),
        getDoc(doc(db,'attendance',curMonth)).catch(()=>null),
        loadPrivateMap(),
      ])
      const finalEmps = []
      const nameData = {}
      usersSnap.forEach(d => {
        const u = ({ ...d.data(), ...(privMap[d.id] || {}) })
        nameData[d.id] = u.name
        if(u.status==='approved' && u.role!=='owner' && u.role!=='store' && u.role!=='investor' && u.payType!=='fixed') {
          finalEmps.push({
            uid:d.id,
            name:u.name,
            wage:u.wage||10030,
            wageHistory:u.wageHistory||[],
            workDays:u.workDays||[1,2,3,4,5],
            avgHours:u.avgHours||8,
            scheduleHistory:u.scheduleHistory||[]
          })
        }
      })
      setEmployees(finalEmps)
      setNameMap(nameData)
      setSeverance(data(sevSnap))
      setWorkHours(data(whSnap))
      setWorkExtra(data(exSnap))
      setMemos(data(memoSnap))
      setPrevWorkHours(data(prevWhSnap))
      setPrevWorkExtra(data(prevExSnap))
      setPrevMemos(data(prevMemoSnap))
      setSubs(subList)
      setAtt(data(attSnap))
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [curMonth])

  // 저장한 칸 반짝임 {'uid|dd|h': true}
  const [flash, setFlash] = useState({})
  const markSaved = key => {
    setFlash(f => ({ ...f, [key]: true }))
    setTimeout(() => setFlash(f => { const n = { ...f }; delete n[key]; return n }), 900)
  }
  // 그 칸 하나만 저장 (NFC 퇴근이 같은 달 문서에 시간을 넣어도 서로 덮어쓰지 않게)
  async function saveWorkHours(uid, dd, hours) {
    const h = +hours || 0
    if (h === ((workHours[uid]||{})[dd] || 0)) return
    const newWH = { ...workHours, [uid]: { ...(workHours[uid]||{}), [dd]: h } }
    if(!h) delete newWH[uid][dd]
    await setDoc(doc(db,'workhours',curMonth), { [uid]: { [dd]: h || deleteField() } }, { merge:true })
    setWorkHours(newWH)
    markSaved(`${uid}|${dd}|h`)
  }

  async function saveWorkExtra(uid, dd, mins) {
    const m = +mins || 0
    if (m === ((workExtra[uid]||{})[dd] || 0)) return
    const newEx = { ...workExtra, [uid]: { ...(workExtra[uid]||{}), [dd]: m } }
    if(!m) delete newEx[uid][dd]
    await setDoc(doc(db,'workextra',curMonth), { [uid]: { [dd]: m || deleteField() } }, { merge:true })
    setWorkExtra(newEx)
    markSaved(`${uid}|${dd}|m`)
  }

  async function saveMemo(uid, dd, memo) {
    const newMemos = { ...memos, [uid]: { ...(memos[uid]||{}), [dd]: memo } }
    if(!memo) delete newMemos[uid][dd]
    await setDoc(doc(db,'workmemos',curMonth), newMemos)
    setMemos(newMemos)
  }

  // 주휴 계산용 비고: 저장된 비고 + 대타 게시판에서 확정된 날
  const [pcy, pcm] = curMonth.split('-').map(Number)
  const calcMemos = withSubMemos(memos, subs, curMonth)
  const calcPrevMemos = withSubMemos(prevMemos, subs, pcm===1 ? `${pcy-1}-12` : `${pcy}-${pad(pcm-1)}`)

function getEmpStats(emp) {
    const wh = workHours[emp.uid] || {}
    const ex = workExtra[emp.uid] || {}
    const empMemos = calcMemos[emp.uid] || {}
    const prevWh = prevWorkHours[emp.uid] || {}
    const prevEx = prevWorkExtra[emp.uid] || {}
    const prevEmpMemos = calcPrevMemos[emp.uid] || {}
    const wage = getWageForMonth(emp, curMonth)
    const schedule = getScheduleForMonth(emp, curMonth)
    const workDays = schedule.workDays || [1,2,3,4,5]
    const avgHours = schedule.avgHours || 8
    const days = daysIn(curMonth)
    const [cy,cm] = curMonth.split('-').map(Number)

    // 이전달 마지막 날 계산
    const prevMonthDays = cm===1 ? new Date(cy-1,12,0).getDate() : new Date(cy,cm-1,0).getDate()

    let totalHours = 0
    let totalMins = 0
    let totalWeeklyHoliday = 0
    const rows = []

    for(let d=1; d<=days; d++) {
      const dd = pad(d)
      const dow = new Date(cy,cm-1,d).getDay()
      const h = wh[dd] || 0
      const m = ex[dd] || 0
      totalHours += h
      totalMins += m

      let weeklyHoliday = 0
      if(dow === 0) {
        let weekH = 0
        const weekAttendance = {}
        const weekMemos = {}

        for(let wd=1; wd<=6; wd++) {
          const prevD = d - wd

          if(prevD >= 1) {
            // 이번달 데이터
            const prevDD = pad(prevD)
            const prevDow = new Date(cy,cm-1,prevD).getDay()
            const prevH = (wh[prevDD]||0) + (ex[prevDD]||0)/60
            weekH += prevH
            weekAttendance[prevDow] = (weekAttendance[prevDow]||0) + prevH
            if(empMemos[prevDD]) weekMemos[prevDD] = empMemos[prevDD]
          } else {
            // 이전달 데이터
            const prevMonthD = prevMonthDays + prevD // prevD는 음수이므로 더하기
            if(prevMonthD >= 1) {
              const prevDD = pad(prevMonthD)
              const prevDow = new Date(cy,cm-2,prevMonthD).getDay()
              const prevH = (prevWh[prevDD]||0) + (prevEx[prevDD]||0)/60
              weekH += prevH
              weekAttendance[prevDow] = (weekAttendance[prevDow]||0) + prevH
              if(prevEmpMemos[prevDD]) weekMemos[`prev_${prevDD}`] = prevEmpMemos[prevDD]
            }
          }
        }

        weeklyHoliday = calcWeeklyHoliday(weekH, wage, workDays, weekAttendance, weekMemos)
        totalWeeklyHoliday += weeklyHoliday
      }

      rows.push({ d, dd, dow, h, m, weeklyHoliday })
    }

    const totalH = totalHours + totalMins/60
    const basePay = Math.round(totalH * wage)
    const totalPay = basePay + totalWeeklyHoliday

    return { totalHours, totalMins, totalH, basePay, totalWeeklyHoliday, totalPay, rows }
  }

  const allStats = employees.map(e => ({ emp:e, ...getEmpStats(e) }))
  // 오늘 근무 인원 계산
  const todayDow = new Date().getDay()
  const todayDD  = pad(new Date().getDate())
  const todayEmps = allStats.filter(s => s.emp.workDays.includes(todayDow))

  // 표 안의 숫자 입력칸 (아직 예전 입력칸: 칸을 벗어나면 저장)
  const cellInput = (on, w = 100) => ({ width:w, background:on?'rgba(var(--hk-accent-rgb),0.15)':'#F3F1EC', border:on?'1px solid var(--hk-accent)':'1px solid #DCD7CE',
    borderRadius:6, color:on?'var(--hk-accent)':'#1D1B18', padding:'7px 8px', fontSize:13, fontWeight:on?700:400, textAlign:'center', outline:'none', fontFamily:'inherit', fontVariantNumeric:'tabular-nums' })
  const memoInput = v => ({ width:'100%', minWidth:120, background:'transparent', border:'none', borderBottom:v?'1px solid #DCD7CE':'1px solid transparent', color:v?'#B42318':'#A8A39A', padding:'4px 2px', fontSize:12, outline:'none', fontFamily:'inherit' })

  const grandBase = allStats.reduce((a,s)=>a+s.basePay,0)
  const grandHoliday = allStats.reduce((a,s)=>a+s.totalWeeklyHoliday,0)
  const grandTotal = allStats.reduce((a,s)=>a+s.totalPay,0)

  const viewKey = showTodayOnly ? 'today' : activeEmp ?? 'all'
  const setViewKey = v => { if (v === 'today') { setShowTodayOnly(true); setActiveEmp(null) } else if (v === 'all') { setShowTodayOnly(false); setActiveEmp(null) } else { setShowTodayOnly(false); setActiveEmp(v) } }

  return (
    <AstryxPage>
    <VStack gap={5}>
      <PageHeader title="근무관리" sub={`${mLabel(curMonth)} — 사장 전용`}
        right={<Selector label="달 고르기" isLabelHidden size="sm" value={curMonth} onChange={v => v && setCurMonth(v)} options={monthOpts.map(m => ({ value:m, label:mLabel(m) }))}/>}/>

      {/* NFC 출퇴근: 승인 대기·퇴근 누락·설정 (찍힌 시간은 아래 근무시간에 자동 반영) */}
      <AttendancePanel curMonth={curMonth} nameMap={nameMap} onApplied={load}/>

      {/* 월 합계 */}
      <Grid columns={{ minWidth: 200, max: 3, repeat: 'fit' }} gap={4}>
        {[
          { label:'기본급 합계', val:grandBase },
          { label:'주휴수당 합계', val:grandHoliday },
          { label:'총 인건비', val:grandTotal, filled:true },
        ].map(k => (
          <Card key={k.label} variant={k.filled ? 'red' : 'default'}>
            <VStack gap={1}>
              <Text type="label" color={k.filled ? 'inherit' : 'secondary'}>{k.label}</Text>
              <Text type="display-3" color={k.filled ? 'inherit' : 'primary'} hasTabularNumbers textWrap="nowrap"><Count value={k.val}/><Text type="large" color="inherit"> 원</Text></Text>
            </VStack>
          </Card>
        ))}
      </Grid>

      {/* 보기: 오늘 근무 · 전체 요약 · 직원별 */}
      <TabList value={viewKey} onChange={setViewKey} hasDivider overflow="auto">
        <Tab value="today" label="오늘 근무"/>
        <Tab value="all" label="전체 요약"/>
        {employees.map(e => <Tab key={e.uid} value={e.uid} label={e.name}/>)}
      </TabList>

      {/* 이번달 퇴직금 지급 내역 */}
      {Object.keys(severance).length > 0 && (
        <LedgerCard title={`${mLabel(curMonth)} 퇴직금 지급 내역`}>
          <List hasDividers edge="flush">
            {Object.entries(severance).map(([uid, sv]) => (
              <ListItem key={uid} label={nameMap[uid] || '—'} description={`${sv.paidDate?.slice(0,10) || ''} 지급 · 총액 ${sv.amount.toLocaleString()}원 · 원천징수 −${sv.tax.toLocaleString()}원`}
                endContent={<Text weight="bold" hasTabularNumbers>실지급 {sv.net.toLocaleString()}원</Text>}/>
            ))}
          </List>
        </LedgerCard>
      )}

      <Legacy><style>{WM_CSS}</style></Legacy>
      {loading ? <Text color="secondary">불러오는 중...</Text> : <>
        {/* 오늘 근무: NFC 시간 옆에서 근무시간·추가근무·비고를 바로 고침 (칸을 벗어나면 저장, 저장한 칸은 초록으로 반짝) */}
        {showTodayOnly && (() => {
          const isThisMonth = curMonth===`${new Date().getFullYear()}-${pad(new Date().getMonth()+1)}`
          return (
            <LedgerCard key="today" title={`오늘 (${+todayDD}일) 근무 인원 — ${todayEmps.length}명`}>
              <Text type="supporting" color="secondary">NFC로 찍은 직원은 퇴근을 찍으면 근무시간이 자동으로 채워져요. 비어 있거나 틀린 것만 고치세요 (퇴근 전에 미리 적으면 퇴근 때 NFC 시간으로 바뀌어요).</Text>
              {todayEmps.length === 0 ? <EmptyState title="오늘 근무 예정 인원이 없어요" isCompact/> : (
                <Table data={todayEmps.map(x => x.emp)} idKey="uid" density="compact" columns={[
                  { key:'name', header:'이름', renderCell: emp => {
                    const r = isThisMonth ? att[emp.uid]?.[todayDD] : null
                    return <HStack gap={2} vAlign="center">
                      <StatusDot variant={r?.in && !r.out ? 'success' : 'neutral'} label={r?.in && !r.out ? '근무 중' : r?.out ? '퇴근' : '안 찍음'} isPulsing={!!(r?.in && !r.out)}/>
                      <Text weight="bold">{emp.name}</Text>
                    </HStack>
                  }},
                  { key:'nfc', header:'NFC 출퇴근', renderCell: emp => {
                    const rec = isThisMonth ? att[emp.uid]?.[todayDD] : null
                    if (!rec?.in) return <Text type="supporting" color="secondary">태그 안 함</Text>
                    const st = dayStatus(rec, rec.schedStart ? { start:rec.schedStart, end:rec.schedEnd } : null)
                    return <VStack gap={0}>
                      <Text weight="semibold" hasTabularNumbers>{hm(toDate(rec.in))} ~ {rec.out ? hm(toDate(rec.out)) : '근무 중'}</Text>
                      {(st.late > 0 || st.leftEarly > 0) && <Text type="supporting" color="accent">{st.late > 0 ? `지각 ${st.late}분 ` : ''}{st.leftEarly > 0 ? '조퇴' : ''}</Text>}
                    </VStack>
                  }},
                  { key:'h', header:'근무시간 (h)', renderCell: emp => { const v = (workHours[emp.uid]||{})[todayDD]; return (
                    <Legacy><input key={`h${v||0}`} className={flash[`${emp.uid}|${todayDD}|h`] ? 'wm-saved' : undefined} type="number" defaultValue={v||''} min="0" max="24" step="0.5" placeholder="0" aria-label={`${emp.name} 근무시간`}
                      onBlur={e=>saveWorkHours(emp.uid,todayDD,e.target.value)} onKeyDown={e=>e.key==='Enter'&&e.target.blur()} style={cellInput(v>0)}/></Legacy>) } },
                  { key:'m', header:'추가근무 (분)', renderCell: emp => { const v = (workExtra[emp.uid]||{})[todayDD]; return (
                    <Legacy><input key={`m${v||0}`} className={flash[`${emp.uid}|${todayDD}|m`] ? 'wm-saved' : undefined} type="number" defaultValue={v||''} min="0" max="180" step="5" placeholder="0" aria-label={`${emp.name} 추가근무`}
                      onBlur={e=>saveWorkExtra(emp.uid,todayDD,e.target.value)} onKeyDown={e=>e.key==='Enter'&&e.target.blur()} style={cellInput(v>0)}/></Legacy>) } },
                  { key:'memo', header:'비고', renderCell: emp => { const v = (memos[emp.uid]||{})[todayDD]; return (
                    <Legacy><input type="text" defaultValue={v||''} placeholder="비고..." aria-label={`${emp.name} 비고`} onBlur={e=>saveMemo(emp.uid,todayDD,e.target.value)} onKeyDown={e=>e.key==='Enter'&&e.target.blur()} style={memoInput(v)}/></Legacy>) } },
                ]}/>
              )}
            </LedgerCard>
          )
        })()}

        {/* 전체 요약 */}
        {activeEmp===null && !showTodayOnly && (() => {
          const maxPay = Math.max(1, ...allStats.map(x=>x.totalPay))
          return (
            <LedgerCard key="all" title="직원별 급여 요약" right={<Text type="supporting" color="secondary">이름을 누르면 날짜별로 고쳐요</Text>}>
              <Table data={allStats} idKey={x => x.emp.uid} density="compact" columns={[
                { key:'name', header:'직원', renderCell: x => <Button variant="ghost" size="sm" label={x.emp.name} onClick={()=>setActiveEmp(x.emp.uid)}/> },
                { key:'wage', header:'시급', align:'end', renderCell: x => <Text hasTabularNumbers>{(x.emp.wage||10030).toLocaleString()}</Text> },
                { key:'h', header:'근무시간', align:'end', renderCell: x => <Text hasTabularNumbers>{x.totalHours}h</Text> },
                { key:'m', header:'추가(분)', align:'end', renderCell: x => <Text hasTabularNumbers color={x.totalMins>0 ? 'accent' : 'secondary'}>{x.totalMins>0 ? `${x.totalMins}m` : '—'}</Text> },
                { key:'base', header:'기본급', align:'end', renderCell: x => <Text hasTabularNumbers>{x.basePay.toLocaleString()}</Text> },
                { key:'hol', header:'주휴수당', align:'end', renderCell: x => <Text hasTabularNumbers>{x.totalWeeklyHoliday.toLocaleString()}</Text> },
                { key:'pay', header:'총 지급액', align:'end', width:160, renderCell: x => <VStack gap={1}>
                  <Text weight="bold" hasTabularNumbers justify="end"><Count value={x.totalPay}/></Text>
                  <ProgressBar label={`${x.emp.name} 몫`} isLabelHidden value={x.totalPay} max={maxPay}/>
                </VStack> },
              ]}/>
              <Divider variant="strong"/>
              <Ledger rows={<>
                <LedgerRow label="근무시간 합계" text={`${allStats.reduce((a,x)=>a+x.totalHours,0)}h · 추가 ${allStats.reduce((a,x)=>a+x.totalMins,0)}m`}/>
                <LedgerRow label="기본급" value={grandBase}/>
                <LedgerRow label="주휴수당" value={grandHoliday}/>
              </>} total={<LedgerRow label="합계" value={grandTotal} strong/>}/>
            </LedgerCard>
          )
        })()}

        {/* 개인별 상세: 날짜별 근무시간·추가근무·비고 (일요일 칸에 주휴수당 자동 계산) */}
        {activeEmp!==null && (() => {
          const empData = allStats.find(x=>x.emp.uid===activeEmp)
          if(!empData) return null
          const {emp, totalHours, totalMins, basePay, totalWeeklyHoliday, totalPay, rows} = empData
          const empMemos = memos[emp.uid] || {}
          const now = new Date()
          return (
            <LedgerCard key={`emp-${emp.uid}`} title={`${emp.name} 근무 상세`} right={<Text type="supporting" color="secondary" hasTabularNumbers>시급 {(emp.wage||10030).toLocaleString()}원/h</Text>}>
              <Grid columns={{ minWidth: 150, max: 4, repeat: 'fit' }} gap={3}>
                {[
                  { label:'총 근무시간', val:<>{totalHours}h {totalMins>0 ? `${totalMins}m` : ''}</> },
                  { label:'기본급', val:<><Count value={basePay}/>원</> },
                  { label:'주휴수당', val:<><Count value={totalWeeklyHoliday}/>원</> },
                  { label:'이달 월급', val:<><Count value={totalPay}/>원</>, filled:true },
                ].map(k => (
                  <Card key={k.label} variant={k.filled ? 'red' : 'muted'} padding={3}>
                    <VStack gap={0}>
                      <Text type="supporting" color={k.filled ? 'inherit' : 'secondary'}>{k.label}</Text>
                      <Text type="large" weight="bold" color={k.filled ? 'inherit' : 'primary'} hasTabularNumbers>{k.val}</Text>
                    </VStack>
                  </Card>
                ))}
              </Grid>
              <Table key={activeEmp} data={rows} idKey="dd" density="compact" columns={[
                { key:'d', header:'날짜', renderCell: r => {
                  const isToday = curMonth===`${now.getFullYear()}-${pad(now.getMonth()+1)}` && r.d===now.getDate()
                  return <Text weight={isToday ? 'bold' : 'normal'} color={isToday || r.dow===0 ? 'accent' : 'primary'}>{r.d}일 {DAYS_KR[r.dow]}</Text>
                }},
                { key:'h', header:'근무시간(h)', renderCell: r => r.dow===0 ? <Text type="supporting" color="secondary">주휴일</Text> : (
                  <Legacy><input key={`${activeEmp}_${r.dd}_h`} className={flash[`${emp.uid}|${r.dd}|h`] ? 'wm-saved' : undefined} type="number" defaultValue={r.h||''} min="0" max="24" step="0.5" placeholder="0" aria-label={`${r.d}일 근무시간`}
                    onBlur={e=>saveWorkHours(emp.uid,r.dd,e.target.value)} onKeyDown={e=>e.key==='Enter'&&e.target.blur()} style={cellInput(r.h>0, 80)}/></Legacy>) },
                { key:'m', header:'추가근무(분)', renderCell: r => r.dow===0 ? <Text color="secondary">—</Text> : (
                  <Legacy><input key={`${activeEmp}_${r.dd}_m`} className={flash[`${emp.uid}|${r.dd}|m`] ? 'wm-saved' : undefined} type="number" defaultValue={r.m||''} min="0" max="180" step="5" placeholder="0" aria-label={`${r.d}일 추가근무`}
                    onBlur={e=>saveWorkExtra(emp.uid,r.dd,e.target.value)} onKeyDown={e=>e.key==='Enter'&&e.target.blur()} style={cellInput(r.m>0, 80)}/></Legacy>) },
                { key:'hol', header:'주휴수당', align:'end', renderCell: r => r.dow===0
                  ? <Text weight={r.weeklyHoliday>0 ? 'bold' : 'normal'} color={r.weeklyHoliday>0 ? 'primary' : 'secondary'} hasTabularNumbers>{r.weeklyHoliday>0 ? `${r.weeklyHoliday.toLocaleString()}원` : '미지급'}</Text>
                  : <Text color="secondary">—</Text> },
                { key:'memo', header:'비고', renderCell: r => (
                  <Legacy><input key={`${activeEmp}_${r.dd}_memo`} type="text" defaultValue={empMemos[r.dd]||''} placeholder={r.dow===0 ? '' : '결석사유 등...'} aria-label={`${r.d}일 비고`}
                    onBlur={e=>saveMemo(emp.uid,r.dd,e.target.value)} onKeyDown={e=>e.key==='Enter'&&e.target.blur()} style={memoInput(empMemos[r.dd])}/></Legacy>) },
              ]}/>
              <Divider variant="strong"/>
              <Ledger rows={<>
                <LedgerRow label="이달 근무" text={`${totalHours}h${totalMins>0 ? ` · 추가 ${totalMins}m` : ''}`}/>
                <LedgerRow label="기본급" value={basePay}/>
                <LedgerRow label="주휴수당" value={totalWeeklyHoliday}/>
              </>} total={<LedgerRow label="월급" value={totalPay} strong/>}/>
            </LedgerCard>
          )
        })()}
      </>}
    </VStack>
    </AstryxPage>
  )
}
