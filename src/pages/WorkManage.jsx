import { useEffect, useRef, useState } from 'react'
import { VStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Selector } from '@astryxdesign/core/Selector'
import { TabList, Tab } from '@astryxdesign/core/TabList'
import { AstryxPage, Legacy, PageHeader } from '../astryx/AstryxPage'
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

  const todayContent = (
    <div style={{background:'#FFFFFF',border:'1px solid #2E7D45',borderRadius:6,overflow:'hidden',marginBottom:18}}>
      <div style={{padding:'14px 18px',borderBottom:'1px solid #DCD7CE',fontSize:13,fontWeight:600,color:'#2E7D45'}}>
        오늘 ({+todayDD}일) 근무 인원 — {todayEmps.length}명
        <div style={{fontSize:11,fontWeight:400,color:'#6E6A63',marginTop:3}}>
          NFC로 찍은 직원은 퇴근을 찍으면 근무시간이 자동으로 채워져요. 비어 있거나 틀린 것만 고치세요 (퇴근 전에 미리 적으면 퇴근 때 NFC 시간으로 바뀌어요).
        </div>
      </div>
      {todayEmps.length === 0 ? (
        <div style={{padding:24,textAlign:'center',color:'#6E6A63',fontSize:12}}>오늘 근무 예정 인원이 없습니다</div>
      ) : (
        <div>
          <div style={{display:'flex',alignItems:'center',gap:14,padding:'8px 18px',
            background:'#F3F1EC',fontSize:10,fontWeight:600,color:'#6E6A63'}}>
            <div style={{minWidth:80}}>이름</div>
            <div style={{minWidth:170}}>NFC 출퇴근</div>
            <div style={{minWidth:120}}>근무시간 (h)</div>
            <div style={{minWidth:120}}>추가근무 (분)</div>
            <div style={{flex:1}}>비고</div>
          </div>
          {todayEmps.map(({emp}, i)=>{
            const wh = workHours[emp.uid]||{}
            const ex = workExtra[emp.uid]||{}
            const empMemos = memos[emp.uid]||{}
            const missing = []
            const hasMissing = missing.length > 0
            const hasToday = (wh[todayDD]||0) > 0
            return (
              <div key={emp.uid} className="wm-row" style={{animationDelay:`${i*50}ms`,display:'flex',alignItems:'center',gap:14,padding:'10px 18px',
                borderBottom:'1px solid #ECE8E1',
                background:hasToday?'rgba(var(--hk-accent-rgb),0.04)':'transparent'}}>
                <div style={{minWidth:80,fontSize:13,fontWeight:700,display:'flex',alignItems:'center',gap:7,
                  color:hasMissing?'#B42318':hasToday?'var(--hk-accent)':'#1D1B18'}}>
                  {(() => {
                    // 지금 상태 점: 근무 중 = 초록 깜박임, 퇴근 = 회색 체크, 안 찍음 = 빈 동그라미
                    const r = curMonth===`${new Date().getFullYear()}-${pad(new Date().getMonth()+1)}` ? att[emp.uid]?.[todayDD] : null
                    if (r?.in && !r.out) return <span className="wm-live" title="근무 중" style={{width:10,height:10,borderRadius:5,background:'#2E7D45',flexShrink:0}}/>
                    if (r?.out) return <span title="퇴근" style={{width:14,height:14,borderRadius:7,background:'#A8A39A',color:'#FFFFFF',fontSize:9,display:'grid',placeItems:'center',flexShrink:0}}>✓</span>
                    return <span title="안 찍음" style={{width:10,height:10,borderRadius:5,border:'1.5px solid #CBC5BA',boxSizing:'border-box',flexShrink:0}}/>
                  })()}
                  {emp.name}
                  {hasMissing && <span style={{fontSize:9,marginLeft:4}}>⚠{missing.length}</span>}
                </div>
                {(() => {
                  // 오늘 NFC 기록: 출근·퇴근 시각, 지각·조퇴
                  const rec = curMonth===`${new Date().getFullYear()}-${pad(new Date().getMonth()+1)}` ? att[emp.uid]?.[todayDD] : null
                  if (!rec?.in) return <div style={{minWidth:170,fontSize:12,color:'#A8A39A'}}>태그 안 함</div>
                  const st = dayStatus(rec, rec.schedStart ? { start:rec.schedStart, end:rec.schedEnd } : null)
                  return (
                    <div style={{minWidth:170,fontSize:12,fontVariantNumeric:'tabular-nums',lineHeight:1.5}}>
                      <span style={{fontWeight:700}}>{hm(toDate(rec.in))} ~ {rec.out ? hm(toDate(rec.out)) : ''}</span>
                      {!rec.out && <span style={{color:'#2B5C9E',marginLeft:4}}>근무 중</span>}
                      {st.late > 0 && <span style={{color:'#B42318',fontWeight:700,marginLeft:6}}>지각 {st.late}분</span>}
                      {st.leftEarly > 0 && <span style={{color:'#B42318',fontWeight:700,marginLeft:6}}>조퇴</span>}
                    </div>
                  )
                })()}
                <input key={`h${wh[todayDD]||0}`} className={flash[`${emp.uid}|${todayDD}|h`] ? 'wm-saved' : undefined} type="number" defaultValue={wh[todayDD]||''} min="0" max="24" step="0.5" placeholder="0"
                  onBlur={e=>saveWorkHours(emp.uid,todayDD,e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                  style={{width:100,background:wh[todayDD]>0?'rgba(var(--hk-accent-rgb),0.15)':'#F3F1EC',
                    border:wh[todayDD]>0?'1px solid var(--hk-accent)':'1px solid #DCD7CE',
                    borderRadius:6,color:wh[todayDD]>0?'var(--hk-accent)':'#1D1B18',
                    padding:'7px 8px',fontSize:13,fontWeight:wh[todayDD]>0?700:400,
                    textAlign:'center',outline:'none',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}/>
                <input key={`m${ex[todayDD]||0}`} className={flash[`${emp.uid}|${todayDD}|m`] ? 'wm-saved' : undefined} type="number" defaultValue={ex[todayDD]||''} min="0" max="180" step="5" placeholder="0"
                  onBlur={e=>saveWorkExtra(emp.uid,todayDD,e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                  style={{width:100,background:ex[todayDD]>0?'rgba(var(--hk-accent-rgb),0.15)':'#F3F1EC',
                    border:ex[todayDD]>0?'1px solid var(--hk-accent)':'1px solid #DCD7CE',
                    borderRadius:6,color:ex[todayDD]>0?'var(--hk-accent)':'#1D1B18',
                    padding:'7px 8px',fontSize:13,fontWeight:ex[todayDD]>0?700:400,
                    textAlign:'center',outline:'none',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}/>
                <input type="text" defaultValue={empMemos[todayDD]||''} placeholder="비고..."
                  onBlur={e=>saveMemo(emp.uid,todayDD,e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                  style={{flex:1,background:'transparent',border:'none',
                    borderBottom:empMemos[todayDD]?'1px solid #DCD7CE':'1px solid transparent',
                    color:empMemos[todayDD]?'#B42318':'#A8A39A',
                    padding:'4px 2px',fontSize:11,outline:'none',fontFamily:'inherit'}}/>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

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
      <Legacy><AttendancePanel curMonth={curMonth} nameMap={nameMap} onApplied={load}/></Legacy>

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

      <Legacy>
      {/* 이번달 퇴직금 지급 내역 */}
      {Object.keys(severance).length > 0 && (
        <div style={{background:'#FFFFFF',border:'1px solid rgba(180,83,9,0.3)',borderRadius:6,
          overflow:'hidden',marginBottom:18}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #DCD7CE',fontSize:13,fontWeight:600,color:'#B45309'}}>
            {mLabel(curMonth)} 퇴직금 지급 내역
          </div>
          <div style={{padding:'8px 0'}}>
            {Object.entries(severance).map(([uid,s])=>(
              <div key={uid} style={{display:'flex',alignItems:'center',gap:14,padding:'10px 18px',
                borderBottom:'1px solid #ECE8E1',flexWrap:'wrap'}}>
                <div style={{minWidth:80,fontSize:13,fontWeight:700,color:'#1D1B18'}}>
                  {nameMap[uid]||'—'}
                </div>
                <div style={{fontSize:11,color:'#6E6A63'}}>
                  {s.paidDate?.slice(0,10)} 지급
                </div>
                <div style={{flex:1}}/>
                <div style={{fontSize:11,color:'#6E6A63'}}>
                  총액 {s.amount.toLocaleString()}원
                </div>
                <div style={{fontSize:11,color:'#B42318'}}>
                  원천징수 -{s.tax.toLocaleString()}원
                </div>
                <div style={{fontSize:13,fontWeight:700,color:'#2E7D45',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>
                  실지급 {s.net.toLocaleString()}원
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? <div style={{textAlign:'center',color:'#6E6A63',padding:60}}>로딩 중...</div> : (
        <>
          <style>{WM_CSS}</style>
          {showTodayOnly && <div key="today" className="wm-in">{todayContent}</div>}

          {/* 전체 요약 */}
          {activeEmp===null && !showTodayOnly && (
            <div key="all" className="wm-in" style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,overflow:'hidden',marginBottom:18}}>
              <div style={{padding:'14px 18px',borderBottom:'1px solid #DCD7CE',fontSize:13,fontWeight:600}}>직원별 급여 요약</div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead>
                    <tr style={{background:'#F3F1EC'}}>
                      {['직원','시급','근무시간','추가(분)','기본급','주휴수당','총 지급액'].map(h=>(
                        <th key={h} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:'#6E6A63',
                          textAlign:h==='직원'?'left':'right',whiteSpace:'nowrap'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allStats.map(({emp,totalHours,totalMins,basePay,totalWeeklyHoliday,totalPay}, i)=>(
                      <tr key={emp.uid} className="wm-row" onClick={()=>setActiveEmp(emp.uid)} style={{cursor:'pointer',animationDelay:`${i*45}ms`}}>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #DCD7CE',color:'#1D1B18',fontWeight:600}}>{emp.name}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #DCD7CE',textAlign:'right',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',color:'#1D1B18'}}>{(emp.wage||10030).toLocaleString()}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #DCD7CE',textAlign:'right',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',color:'#1D1B18'}}>{totalHours}h</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #DCD7CE',textAlign:'right',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',color:totalMins>0?'var(--hk-accent)':'#6E6A63'}}>{totalMins>0?`${totalMins}m`:'—'}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #DCD7CE',textAlign:'right',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',color:'#1D1B18'}}>{basePay.toLocaleString()}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #DCD7CE',textAlign:'right',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',color:'#2B5C9E'}}>{totalWeeklyHoliday.toLocaleString()}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #DCD7CE',textAlign:'right',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',color:'#2E7D45',fontWeight:700,minWidth:110}}>
                          <Count value={totalPay}/>
                          {/* 총 인건비 중 이 사람 몫 막대 */}
                          <div style={{height:4,borderRadius:2,background:'#ECE8E1',marginTop:5,overflow:'hidden'}}>
                            <div className="wm-grow" style={{height:'100%',borderRadius:2,background:'#2E7D45',width:`${grandTotal ? Math.round(totalPay / Math.max(1, ...allStats.map(x=>x.totalPay)) * 100) : 0}%`,animationDelay:`${150 + i*45}ms`}}/>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{background:'#ECE8E1'}}>
                      <td style={{padding:'10px 14px',fontWeight:700,color:'var(--hk-accent)'}}>합 계</td>
                      <td></td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'var(--hk-accent)',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{allStats.reduce((a,s)=>a+s.totalHours,0)}h</td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'var(--hk-accent)',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{allStats.reduce((a,s)=>a+s.totalMins,0)}m</td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'var(--hk-accent)',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{grandBase.toLocaleString()}</td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'var(--hk-accent)',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{grandHoliday.toLocaleString()}</td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'var(--hk-accent)',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{grandTotal.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* 개인별 상세 */}
{activeEmp!==null && (()=>{
  const empData = allStats.find(s=>s.emp.uid===activeEmp)
  if(!empData) return null
            if(!empData) return null
            const {emp, totalHours, totalMins, totalH, basePay, totalWeeklyHoliday, totalPay, rows} = empData
            const empMemos = memos[emp.uid] || {}

            return (
              <div key={`emp-${emp.uid}`} className="wm-in" style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,overflow:'hidden'}}>
                <div style={{padding:'14px 18px',borderBottom:'1px solid #DCD7CE',fontSize:13,fontWeight:600,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span>{emp.name} 근무 상세</span>
                  <span style={{fontSize:11,color:'#6E6A63'}}>시급 {(emp.wage||10030).toLocaleString()}원/h</span>
                </div>

                {/* 급여 요약 */}
                <div style={{padding:'14px 18px',borderBottom:'1px solid #DCD7CE',display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
                  {[
                    {label:'총 근무시간', val:`${totalHours}h ${totalMins>0?totalMins+'m':''}`, color:'var(--hk-accent)'},
                    {label:'기본급', val:<><Count value={basePay}/>원</>, color:'#1D1B18'},
                    {label:'주휴수당', val:<><Count value={totalWeeklyHoliday}/>원</>, color:'#2B5C9E'},
                    {label:'이달 월급', val:<><Count value={totalPay}/>원</>, color:'#2E7D45'},
                  ].map(k=>(
                    <div key={k.label} style={{background:'#F3F1EC',borderRadius:4,padding:'10px 12px'}}>
                      <div style={{fontSize:10,color:'#6E6A63',marginBottom:3}}>{k.label}</div>
                      <div style={{fontSize:13,fontWeight:700,color:k.color,fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{k.val}</div>
                    </div>
                  ))}
                </div>

                {/* 테이블 */}
                <div style={{padding:'12px 18px',borderBottom:'1px solid #DCD7CE',fontSize:12,fontWeight:600,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span>일별 근무시간 입력</span>
                  <span style={{fontSize:10,color:'#6E6A63'}}>일요일에 주휴수당 자동계산</span>
                </div>
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                    <thead>
                      <tr style={{background:'#F3F1EC'}}>
                        <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#6E6A63',textAlign:'left',width:45}}>날짜</th>
                        <th style={{padding:'8px 6px',fontSize:10,fontWeight:600,color:'#6E6A63',textAlign:'left',width:28}}>요일</th>
                        <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#6E6A63',textAlign:'center',width:110}}>근무시간(h)</th>
                        <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'var(--hk-accent)',textAlign:'center',width:110}}>추가근무(분)</th>
                        <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#2B5C9E',textAlign:'center',width:110}}>주휴수당</th>
                        <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#6E6A63',textAlign:'left'}}>비고</th>
                      </tr>
                    </thead>
<tbody key={activeEmp}>
  {rows.map(({d,dd,dow,h,m,weeklyHoliday}, i)=>{
                        const isWeekend = dow===0||dow===6
                        const isSun = dow===0
                        const now = new Date()
                        const isToday = curMonth===`${now.getFullYear()}-${pad(now.getMonth()+1)}` && d===now.getDate()

                        return (
                          <tr key={dd} className="wm-row" style={{
                            animationDelay:`${Math.min(i*14, 420)}ms`,
                            background: isSun&&weeklyHoliday>0?'rgba(43,92,158,0.05)':h>0||m>0?'rgba(var(--hk-accent-rgb),0.04)':'transparent',
                            borderLeft: isSun&&weeklyHoliday>0?'3px solid #2B5C9E':h>0||m>0?'3px solid var(--hk-accent)':'3px solid transparent'
                          }}>
                            <td style={{padding:'6px 10px',borderBottom:'1px solid #ECE8E1',
                              color:isToday?'var(--hk-accent)':dow===0?'#B42318':dow===6?'#2B5C9E':'#1D1B18',
                              fontWeight:isToday?700:500,fontSize:12}}>
                              {d}일
                            </td>
                            <td style={{padding:'6px 6px',borderBottom:'1px solid #ECE8E1',
                              color:dow===0?'#B42318':dow===6?'#2B5C9E':'#6E6A63',fontSize:11,fontWeight:600}}>
                              {DAYS_KR[dow]}
                            </td>
                            {/* 근무시간 */}
                            <td style={{padding:'4px 10px',borderBottom:'1px solid #ECE8E1',textAlign:'center'}}>
                              {!isSun ? (
<input key={`${activeEmp}_${dd}_h`} className={flash[`${emp.uid}|${dd}|h`] ? 'wm-saved' : undefined} type="number" defaultValue={h||''} min="0" max="24" step="0.5" placeholder="0"
  onBlur={e=>saveWorkHours(emp.uid,dd,e.target.value)}
  onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                                  style={{
                                    width:80, background:h>0?'rgba(var(--hk-accent-rgb),0.15)':'#F3F1EC',
                                    border:h>0?'1px solid var(--hk-accent)':'1px solid #DCD7CE',
                                    borderRadius:6, color:h>0?'var(--hk-accent)':'#1D1B18',
                                    padding:'6px 8px', fontSize:13, fontWeight:h>0?700:400,
                                    textAlign:'center', outline:'none', fontFamily:'inherit',fontVariantNumeric:'tabular-nums'
                                  }}/>
                              ) : (
                                <span style={{fontSize:11,color:'#6E6A63'}}>주휴일</span>
                              )}
                            </td>
                            {/* 추가근무(분) */}
                            <td style={{padding:'4px 10px',borderBottom:'1px solid #ECE8E1',textAlign:'center'}}>
                              {!isSun ? (
<input key={`${activeEmp}_${dd}_m`} className={flash[`${emp.uid}|${dd}|m`] ? 'wm-saved' : undefined} type="number" defaultValue={m||''} min="0" max="180" step="5" placeholder="0"
  onBlur={e=>saveWorkExtra(emp.uid,dd,e.target.value)}
  onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                                  style={{
                                    width:80, background:m>0?'rgba(var(--hk-accent-rgb),0.15)':'#F3F1EC',
                                    border:m>0?'1px solid var(--hk-accent)':'1px solid #DCD7CE',
                                    borderRadius:6, color:m>0?'var(--hk-accent)':'#1D1B18',
                                    padding:'6px 8px', fontSize:13, fontWeight:m>0?700:400,
                                    textAlign:'center', outline:'none', fontFamily:'inherit',fontVariantNumeric:'tabular-nums'
                                  }}/>
                              ) : <span style={{color:'#DCD7CE'}}>—</span>}
                            </td>
                            {/* 주휴수당 */}
                            <td style={{padding:'6px 10px',borderBottom:'1px solid #ECE8E1',textAlign:'center',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>
{isSun && weeklyHoliday>0 ? (
  <span style={{color:'#2B5C9E',fontWeight:700,fontSize:12}}>{weeklyHoliday.toLocaleString()}원</span>
) : isSun ? (
  <span style={{color:'#A8A39A',fontSize:11}}>미지급</span>
) : (
  <span style={{color:'#DCD7CE'}}>—</span>
)}
                            </td>
                            {/* 비고 */}
                            <td style={{padding:'4px 10px',borderBottom:'1px solid #ECE8E1'}}>
<input key={`${activeEmp}_${dd}_memo`} type="text" defaultValue={empMemos[dd]||''}
  placeholder={isSun?'':'결석사유 등...'}
  onBlur={e=>saveMemo(emp.uid,dd,e.target.value)}
  onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                                style={{
                                  width:'100%', background:'transparent', border:'none',
                                  borderBottom:empMemos[dd]?'1px solid #DCD7CE':'1px solid transparent',
                                  color:empMemos[dd]?'#B42318':'#A8A39A',
                                  padding:'4px 2px', fontSize:11, outline:'none', fontFamily:'inherit'
                                }}/>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{background:'#ECE8E1'}}>
                        <td colSpan={2} style={{padding:'12px 10px',fontWeight:700,color:'var(--hk-accent)',fontSize:12}}>이달 합계</td>
                        <td style={{padding:'12px 10px',textAlign:'center',fontWeight:700,color:'var(--hk-accent)',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{totalHours}h</td>
                        <td style={{padding:'12px 10px',textAlign:'center',fontWeight:700,color:'var(--hk-accent)',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{totalMins>0?`${totalMins}m`:'—'}</td>
                        <td style={{padding:'12px 10px',textAlign:'center',fontWeight:700,color:'#2B5C9E',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{totalWeeklyHoliday.toLocaleString()}원</td>
                        <td style={{padding:'12px 10px'}}>
                          <span style={{color:'#2E7D45',fontWeight:700,fontFamily:'inherit',fontVariantNumeric:'tabular-nums',fontSize:14}}>
                            월급 {totalPay.toLocaleString()}원
                          </span>
                          <span style={{color:'#6E6A63',fontSize:10,marginLeft:8}}>
                            (기본급 {basePay.toLocaleString()} + 주휴 {totalWeeklyHoliday.toLocaleString()})
                          </span>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )
          })()}
        </>
      )}
      </Legacy>
    </VStack>
    </AstryxPage>
  )
}
