import { useEffect, useState } from 'react'
import { VStack } from '@astryxdesign/core/Layout'
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { List, ListItem } from '@astryxdesign/core/List'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Badge } from '@astryxdesign/core/Badge'
import { Table } from '@astryxdesign/core/Table'
import { ClickableCard } from '@astryxdesign/core/ClickableCard'
import { AstryxPage, Legacy, PageHeader, LedgerCard } from '../astryx/AstryxPage'
import { db } from '../firebase'
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore'
import { useAuth } from '../AuthContext'
import { toDate, hm, dayStatus, breakForShift, recBreak, planFor, reapplyDay } from '../lib/attendance'
import { deleteField } from 'firebase/firestore'
import TimePick from '../components/TimePick'
import { saveUser } from '../lib/privateInfo'

const pad = n => String(n).padStart(2,'0')
const DAYS_KR = ['일','월','화','수','목','금','토']
const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', soft:'#ECE8E1', accent:'var(--hk-accent)', red:'#B42318', green:'#2E7D45', blue:'#2B5C9E', amber:'#B45309', purple:'#6B4FA0' }
const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
const ymOfDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}`
const toMin = s => { const [h,m] = String(s).split(':').map(Number); return h*60 + (m||0) }
const mondayOf = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay()+6)%7)); return x }

// 퇴근 예정이 없는 근무(출근만 정함)는 화면 계산용으로 매장 마감(22:00)까지로 봄
const STORE_CLOSE = 22*60
const endMinOf = s => { const a = toMin(s.start); if (!s.end) return Math.max(STORE_CLOSE, a + 60); const b = toMin(s.end); return b <= a ? 1440 : b }

function PendingCard({ u, onApprove, onReject }) {
  const [selGrade, setSelGrade] = useState('3')
  const [joinDate, setJoinDate] = useState(u.createdAt?.slice(0,10)||'')
  const [wage, setWage] = useState(10030)
  return (
    <div style={{background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:6,padding:'16px'}}>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:700}}>{u.name}</div>
        <div style={{fontSize:11,color:'#6E6A63',marginTop:2}}>{u.email}</div>
        <div style={{fontSize:10,color:'#6E6A63',marginTop:2}}>가입 신청일: {u.createdAt?.slice(0,10)}</div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10,marginBottom:12}}>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          <label style={{fontSize:10,color:'#6E6A63',fontWeight:600}}>등급</label>
          <select value={selGrade} onChange={e=>setSelGrade(e.target.value)}
            style={{background:'#FAF9F6',border:'1px solid #DCD7CE',borderRadius:6,color:'#1D1B18',padding:'7px 10px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
            <option value="1">대선배 (1년↑)</option>
            <option value="2">고오급인력 (6개월~1년)</option>
            <option value="3">병아리 (6개월↓)</option>
          </select>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          <label style={{fontSize:10,color:'#6E6A63',fontWeight:600}}>입사일</label>
          <input type="date" value={joinDate} onChange={e=>setJoinDate(e.target.value)}
            style={{background:'#FAF9F6',border:'1px solid #DCD7CE',borderRadius:6,color:'#1D1B18',padding:'7px 10px',fontSize:12,fontFamily:'inherit',outline:'none'}}/>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          <label style={{fontSize:10,color:'#6E6A63',fontWeight:600}}>시급 (원)</label>
          <input type="number" value={wage} onChange={e=>setWage(+e.target.value)}
            style={{background:'#FAF9F6',border:'1px solid #DCD7CE',borderRadius:6,color:'#1D1B18',padding:'7px 10px',fontSize:12,fontFamily:'inherit',outline:'none'}}/>
        </div>
      </div>
      <div style={{display:'flex',gap:8}}>
        <button onClick={()=>onApprove(u,selGrade,joinDate,wage)}
          style={{background:'#2E7D45',color:'#FFFFFF',border:'none',borderRadius:6,padding:'8px 18px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
          승인
        </button>
        <button onClick={()=>onReject(u.uid)}
          style={{background:'transparent',border:'1px solid #E8C4BF',color:'#B42318',borderRadius:6,padding:'8px 18px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
          거절
        </button>
      </div>
    </div>
  )
}

// 스케쥴: 지금 매장 현황 + 이번 주 근무표 + 시간대별 인원
// 근무표는 인원관리의 요일별 예정 시각(shiftTimes)에 대타 게시판(확정된 대타)과 임시휴무를 반영하고,
// 지난 날에는 NFC 출퇴근 기록(지각·결근)을 겹쳐 보여줌. 매장 일정 메모는 events/{달}[dd]
// ── 움직임 ── (움직임 줄이기 설정이면 모두 꺼짐)
//  지금 매장: 사람마다 오늘 하루 막대(예정은 옅게, 실제 근무는 진하게)가 자라고 '지금' 선이 그어짐, 상태 점이 깜박임
//  근무표: 주를 넘기면 그 방향에서 표가 미끄러져 들어옴. 시간대별 인원: 칸이 요일 순서대로 톡톡 채워짐
const ST_CSS = `@keyframes stGrow { from { transform: scaleX(0) } to { transform: scaleX(1) } }
@keyframes stFromR { from { opacity:0; transform: translateX(28px) } to { opacity:1; transform:none } }
@keyframes stFromL { from { opacity:0; transform: translateX(-28px) } to { opacity:1; transform:none } }
@keyframes stPop { 0% { opacity:0; transform: scale(.55) } 70% { opacity:1; transform: scale(1.06) } 100% { opacity:1; transform: scale(1) } }
@keyframes stPulse { 0% { box-shadow: 0 0 0 0 var(--st-c) } 100% { box-shadow: 0 0 0 7px transparent } }
@keyframes stNow { 0%, 100% { opacity: 1 } 50% { opacity: .45 } }
@keyframes stIn { from { opacity:0; transform: translateY(6px) } to { opacity:1; transform:none } }
.st-grow { transform-origin: left; animation: stGrow .7s cubic-bezier(.2,.8,.2,1) both }
.st-from-r { animation: stFromR .35s cubic-bezier(.2,.8,.2,1) both }
.st-from-l { animation: stFromL .35s cubic-bezier(.2,.8,.2,1) both }
.st-pop { animation: stPop .34s ease-out both }
.st-pulse { animation: stPulse 1.5s ease-out infinite }
.st-now { animation: stNow 2s ease-in-out infinite }
.st-in { animation: stIn .25s ease-out both }
@media (prefers-reduced-motion: reduce) { .st-grow, .st-from-r, .st-from-l, .st-pop, .st-pulse, .st-now, .st-in { animation: none } }`

export default function Staff() {
  const { isOwner } = useAuth()
  const [weekOffset, setWeekOffset] = useState(0)
  const goWeek = w => setWeekOffset(w)
  const [staff, setStaff] = useState([])
  const [pending, setPending] = useState([])
  const [att, setAtt] = useState({})         // { 'YYYY-MM': attendance 문서 }
  const [events, setEvents] = useState({})   // { 'YYYY-MM': events 문서 }
  const [subs, setSubs] = useState([])
  const [holidays, setHolidays] = useState([])
  const [cfg, setCfg] = useState(null)       // attendance/_config (매장 브레이크)
  const [loading, setLoading] = useState(true)
  const [editDay, setEditDay] = useState(null) // 매장 일정 고치는 날짜 'YYYY-MM-DD'
  const [plans, setPlans] = useState({})       // { 'YYYY-MM': schedule 문서 } 근무표에서 직접 바꾼 날·일찍 마감
  const [cellEdit, setCellEdit] = useState(null)   // { uid, ds, start, end }
  const [closeEdit, setCloseEdit] = useState(null) // { ds, time }
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [now, setNow] = useState(() => new Date())

  const monday = mondayOf(now); monday.setDate(monday.getDate() + weekOffset*7)
  const week = Array.from({length:7}, (_,i) => { const d = new Date(monday); d.setDate(d.getDate()+i); return d })
  const prevWeek = week.map(d => { const x = new Date(d); x.setDate(x.getDate()-7); return x })
  const months = [...new Set([ymOfDate(new Date()), ...week.map(ymOfDate), ...prevWeek.map(ymOfDate)])]
  const monthsKey = months.join(',')

  // 1분마다 '지금' 다시 계산 (늦은 사람 표시)
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t) }, [])

  useEffect(() => {
    let off = false
    async function load() {
      try {
        const opt = p => p.then(x => x.exists() ? x.data() : null).catch(() => null)
        const [usersSnap, subDoc, holDoc, cfgDoc, ...monthDocs] = await Promise.all([
          getDocs(collection(db,'users')),
          opt(getDoc(doc(db,'substitutes','requests'))),
          opt(getDoc(doc(db,'checklist','holidays'))),
          opt(getDoc(doc(db,'attendance','_config'))),
          ...monthsKey.split(',').flatMap(ym => [opt(getDoc(doc(db,'attendance',ym))), opt(getDoc(doc(db,'events',ym))), opt(getDoc(doc(db,'schedule',ym)))]),
        ])
        if (off) return
        const list = []
        usersSnap.forEach(d => { const u = d.data(); if (u.status==='approved' && !['owner','store','investor'].includes(u.role)) list.push({ uid:d.id, ...u }) })
        setStaff(list.sort((a,b)=>(a.joinDate||'').localeCompare(b.joinDate||'')))
        setSubs(subDoc?.list || []); setHolidays(holDoc?.list || []); setCfg(cfgDoc)
        const a = {}, e = {}, pl = {}
        monthsKey.split(',').forEach((ym,i) => { a[ym] = monthDocs[i*3] || {}; e[ym] = monthDocs[i*3+1] || {}; pl[ym] = monthDocs[i*3+2] || {} })
        setAtt(a); setEvents(e); setPlans(pl)
        if (isOwner) {
          const pSnap = await getDocs(query(collection(db,'users'), where('status','==','pending')))
          const pl = []; pSnap.forEach(d => pl.push({ uid:d.id, ...d.data() }))
          if (!off) setPending(pl)
        }
      } catch(err) { console.error(err) }
      if (!off) setLoading(false)
    }
    load()
    return () => { off = true }
  }, [monthsKey, isOwner, reloadKey])

  async function approveUser(u, grade, joinDate, wage) {
    await saveUser(u.uid, { ...u, status:'approved', grade:+grade, wage:+wage||10030, joinDate:joinDate||'' })
    setPending(p => p.filter(x=>x.uid!==u.uid))
    setStaff(s => [...s, { ...u, status:'approved', joinDate }])
  }
  async function rejectUser(uid) {
    await setDoc(doc(db,'users',uid), {status:'rejected'}, {merge:true})
    setPending(p => p.filter(x=>x.uid!==uid))
  }
  async function saveEvent(ds, text) {
    const ym = ds.slice(0,7), dd = ds.slice(8,10)
    const cur = { ...(events[ym]||{}) }
    if (text) cur[dd] = text; else delete cur[dd]
    await setDoc(doc(db,'events',ym), cur)
    setEvents(e => ({ ...e, [ym]: cur })); setEditDay(null)
  }

  // ── 하루 한 사람의 근무 (예정 + 대타 + 기록) ──
  const nameOf = uid => staff.find(u=>u.uid===uid)?.name || '—'
  const holidayOf = ds => holidays.find(h => h.startDate <= ds && ds <= h.endDate) || null
  const closedOf = d => d.getDay() === 0 || !!holidayOf(dateStr(d))
  function cellOf(u, d) {
    const ds = dateStr(d), ym = ds.slice(0,7), dd = ds.slice(8,10)
    const rec = att[ym]?.[u.uid]?.[dd] || null
    const override = plans[ym]?.shifts?.[u.uid]?.[dd] || null   // 근무표에서 직접 넣은 칸
    const planned = rec?.schedStart ? { start:rec.schedStart, end:rec.schedEnd } : (rec?.in ? null : planFor(u, d, plans[ym], u.uid))
    const gaveAway = subs.find(r => r.requesterUid===u.uid && r.date===ds && r.confirmedUid)
    const seeking = subs.find(r => r.requesterUid===u.uid && r.date===ds && !r.confirmedUid)
    const covering = subs.filter(r => r.confirmedUid===u.uid && r.date===ds)
      .map(r => {
        // 일찍 마감한 날이면 대타 근무도 마감 시각까지만
        const close = plans[ym]?.closeAt?.[dd], end = `${r.endH}:${r.endM}`
        return { start:`${r.startH}:${r.startM}`, end: close && toMin(close) > toMin(`${r.startH}:${r.startM}`) && toMin(close) < toMin(end) ? close : end, for:r.requesterUid }
      })
    const closed = closedOf(d)
    const shifts = []   // 실제로 이 사람이 매장에 있을 예정인 시간 (인원 계산용)
    // 브레이크: 지난 날은 기록에 붙은 것, 앞으로는 매장 브레이크(풀타임만)
    const brk = rec?.in ? recBreak(rec) : (planned ? breakForShift(cfg, d, planned) : null)
    if (planned && !gaveAway && !closed) shifts.push({ ...planned, brk })
    covering.forEach(c => shifts.push(c))
    const past = ds < dateStr(now)
    const today = ds === dateStr(now)
    const st = rec?.in ? dayStatus(rec, planned) : null
    const late = !rec?.in && planned && !gaveAway && !closed && !rec?.excused &&
      (past || (today && now.getHours()*60+now.getMinutes() > toMin(planned.start)))
    return { ds, rec, planned, override, brk, gaveAway, seeking, covering, closed, shifts, past, today, st, missing: late }
  }

  // ── 근무표 고치기 (사장) ──
  // 칸 하나: {start,end} 직접 시간 / {off:true} 휴무 / null 기본 패턴으로 되돌리기. 오늘까지의 날이면 찍힌 기록도 새 근무표로 다시 계산
  async function writePlan(entries) { // entries: [{ d, uid, val }]  uid 없으면 마감 시각
    setBusy(true)
    try {
      const next = { ...plans }
      for (const { d, uid, val } of entries) {
        const ym = ymOfDate(d), dd = pad(d.getDate())
        const field = uid ? { shifts: { [uid]: { [dd]: val ?? deleteField() } } } : { closeAt: { [dd]: val ?? deleteField() } }
        await setDoc(doc(db,'schedule',ym), field, { merge:true })
        const cur = { ...(next[ym]||{}) }
        if (uid) { const sh = { ...(cur.shifts||{}) }, mine = { ...(sh[uid]||{}) }; if (val) mine[dd] = val; else delete mine[dd]; sh[uid] = mine; cur.shifts = sh }
        else { const c = { ...(cur.closeAt||{}) }; if (val) c[dd] = val; else delete c[dd]; cur.closeAt = c }
        next[ym] = cur
      }
      setPlans(next)
      const todayStr = dateStr(new Date())
      const touched = [...new Set(entries.map(e => dateStr(e.d)))].filter(ds => ds <= todayStr)
      for (const ds of touched) {
        const d = new Date(+ds.slice(0,4), +ds.slice(5,7)-1, +ds.slice(8,10))
        await reapplyDay(d, { users: staff, plan: next[ds.slice(0,7)], cfg })
      }
      if (touched.length) setReloadKey(k => k+1)
    } catch(e) { console.error(e); alert('저장하지 못했어요. 다시 시도해 주세요.') }
    setBusy(false)
  }
  async function saveCell(val) {
    const { uid, ds } = cellEdit
    if (val && !val.off && !val.start) return alert('출근 시각을 넣어 주세요')
    if (val && !val.off && !val.end) val = { start: val.start }
    await writePlan([{ d: new Date(+ds.slice(0,4), +ds.slice(5,7)-1, +ds.slice(8,10)), uid, val }])
    setCellEdit(null)
  }
  async function saveClose(val) {
    const { ds } = closeEdit
    await writePlan([{ d: new Date(+ds.slice(0,4), +ds.slice(5,7)-1, +ds.slice(8,10)), val }])
    setCloseEdit(null)
  }
  // 지난주 근무표에서 직접 넣은 칸(시간·휴무)을 이번 주 같은 요일로 복사
  async function copyLastWeek() {
    const entries = []
    days.forEach((d, i) => {
      const p = prevWeek[i], src = plans[ymOfDate(p)]?.shifts || {}
      for (const u of staff) { const v = src[u.uid]?.[pad(p.getDate())]; if (v) entries.push({ d, uid:u.uid, val:v }) }
    })
    if (!entries.length) return alert('지난주에 직접 넣은 칸이 없어요. (기본 패턴만 쓰는 직원은 매주 자동으로 채워져요)')
    if (!window.confirm(`지난주에 직접 넣은 ${entries.length}칸을 이번 주 같은 요일에 넣을까요? 이번 주에 이미 넣은 같은 칸은 바뀌어요.`)) return
    await writePlan(entries)
  }

  // ── 지금 매장 ──
  const todayD = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const nowMin = now.getHours()*60 + now.getMinutes()
  const todayRows = staff.map(u => ({ u, c: cellOf(u, todayD) }))
    .filter(({c}) => c.shifts.length || c.rec?.in)
    .map(({u,c}) => {
      const s = c.shifts[0], inD = toDate(c.rec?.in), outD = toDate(c.rec?.out)
      let state, color
      if (outD) { state = `퇴근 ${hm(outD)}`; color = T.sub }
      else if (inD) { state = `근무 중 · ${hm(inD)} 출근${c.st?.late ? ` (지각 ${c.st.late}분)` : ''}`; color = c.st?.late ? T.red : T.green }
      else if (s && s.end && nowMin >= endMinOf(s)) { state = '안 왔어요 (결근)'; color = T.red }
      else if (s && nowMin > toMin(s.start)) { state = `아직 안 옴 · ${nowMin - toMin(s.start)}분 지남`; color = T.red }
      else if (s) { state = `${s.start} 출근 예정`; color = T.sub }
      else { state = '—'; color = T.sub }
      return { u, c, s, state, color, order: s ? toMin(s.start) : 9999 }
    }).sort((a,b) => a.order - b.order)
  const inNow = todayRows.filter(r => r.c.rec?.in && !r.c.rec?.out).length
  const plannedNow = todayRows.filter(r => r.s && toMin(r.s.start) <= nowMin && nowMin < endMinOf(r.s)).length

  // ── 이번 주 근무표 ──
  const showSun = staff.some(u => week[6] && cellOf(u, week[6]).shifts.length)
  const days = showSun ? week : week.slice(0,6)
  // 사장은 모든 직원 (유동 근무자 칸을 채우려면), 직원은 이번 주에 근무가 있는 사람만
  const rows = isOwner ? staff : staff.filter(u => days.some(d => { const c = cellOf(u, d); return c.planned || c.shifts.length || c.rec?.in }))
  // 시간대별 인원: 예정(대타 반영) 기준, 한 시간 칸에 걸쳐 있으면 1명
  let hFrom = 24, hTo = 0
  const shiftsByDay = days.map(d => rows.flatMap(u => cellOf(u, d).shifts))
  shiftsByDay.flat().forEach(s => { hFrom = Math.min(hFrom, Math.floor(toMin(s.start)/60)); hTo = Math.max(hTo, Math.ceil(endMinOf(s)/60)) })
  const hours = hTo > hFrom ? Array.from({length:hTo-hFrom}, (_,i)=>hFrom+i) : []
  // 그 시간 칸에 근무하는 분이 있으면 1명 (브레이크로 그 시간 전체를 쉬면 빼고)
  const ov = (a0,a1,b0,b1) => Math.max(0, Math.min(a1,b1) - Math.max(a0,b0))
  const countAt = (list, h) => list.filter(s => {
    const a = toMin(s.start), b = endMinOf(s), h0 = h*60, h1 = h0+60
    const work = ov(a, b, h0, h1), rest = s.brk ? ov(Math.max(a, toMin(s.brk.start)), Math.min(b, toMin(s.brk.end)), h0, h1) : 0
    return work - rest > 0
  }).length
  const maxCount = Math.max(1, ...hours.flatMap(h => shiftsByDay.map(l => countAt(l, h))))

  const weekLabel = `${monday.getMonth()+1}월 ${monday.getDate()}일 ~ ${days[days.length-1].getMonth()+1}월 ${days[days.length-1].getDate()}일`
  const sectionTitle = (text, right) => (
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:10, flexWrap:'wrap', borderBottom:`2px solid ${T.ink}`, paddingBottom:6, marginBottom:6}}>
      <h2 style={{fontSize:16, fontWeight:800, margin:0, fontFamily:'inherit', color:T.ink}}>{text}</h2>
      {right && <div style={{fontSize:12, color:T.sub}}>{right}</div>}
    </div>
  )
  const linkBtn = color => ({ background:'none', border:'none', borderBottom:`1px solid ${color}`, color, padding:0, fontSize:11, cursor:'pointer', fontFamily:'inherit' })

  return (
    <AstryxPage>
    <VStack gap={4} maxWidth={1100}>
      <PageHeader title="스케쥴" right={<>
        <Button size="sm" label="이전 주" onClick={()=>goWeek(weekOffset-1)}/>
        <Button size="sm" label="이번 주" variant={weekOffset===0 ? 'primary' : 'secondary'} onClick={()=>goWeek(0)}/>
        <Button size="sm" label="다음 주" onClick={()=>goWeek(weekOffset+1)}/>
      </>}/>

      <Legacy>
      <style>{ST_CSS}</style>
      {/* 사장: 가입 승인 대기 */}
      {isOwner && pending.length>0 && (
        <section style={{marginBottom:28}}>
          {sectionTitle(`가입 승인 대기 ${pending.length}명`)}
          <div style={{display:'flex', flexDirection:'column', gap:12, paddingTop:6}}>
            {pending.map(u=><PendingCard key={u.uid} u={u} onApprove={approveUser} onReject={rejectUser}/>)}
          </div>
        </section>
      )}

      </Legacy>

      {loading ? <Text color="secondary">불러오는 중...</Text> : <>
        {/* 지금 매장: 사람마다 상태 점 + 오늘 하루 막대 (점선 = 예정, 진한 막대 = 실제 근무, 빨간 선 = 지금) */}
        <LedgerCard title={`지금 매장 · ${hm(now)}`} right={<Text type="supporting" color="secondary">{closedOf(todayD) ? (holidayOf(dateStr(todayD))?.reason || '오늘은 휴무일') : `지금 근무 예정 ${plannedNow}명 · 출근해 있는 사람 ${inNow}명`}</Text>}>
          {todayRows.length === 0 ? <Text color="secondary">오늘 근무 예정인 사람이 없어요</Text> :
            (() => {
              // 오늘 하루 막대의 눈금: 가장 이른 출근 ~ 가장 늦은 퇴근(예정) 시각
              const minOf = d => d.getHours()*60 + d.getMinutes()
              let a0 = 24*60, a1 = 0
              todayRows.forEach(({s, c}) => {
                if (s) { a0 = Math.min(a0, toMin(s.start)); a1 = Math.max(a1, endMinOf(s)) }
                const i = toDate(c.rec?.in), o = toDate(c.rec?.out)
                if (i && !isNaN(i)) a0 = Math.min(a0, minOf(i))
                if (o && !isNaN(o)) a1 = Math.max(a1, minOf(o))
              })
              a0 = Math.floor(a0/60)*60; a1 = Math.max(a0 + 60, Math.ceil(a1/60)*60)
              const pct = m => `${Math.min(100, Math.max(0, (m - a0) / (a1 - a0) * 100))}%`
              const wid = (m0, m1) => `${Math.max(0.8, Math.min(100, (Math.min(m1, a1) - Math.max(m0, a0)) / (a1 - a0) * 100))}%`
              const showNow = !closedOf(todayD) && nowMin >= a0 && nowMin <= a1
              return <>
                <List hasDividers edge="flush">
                  {todayRows.map(({u, s, state, c}, i) => {
                    const inD = toDate(c.rec?.in), outD = toDate(c.rec?.out)
                    const working = inD && !outD, late = !inD && s && nowMin > toMin(s.start)
                    const bad = late || c.st?.late
                    return (
                      <ListItem key={u.uid} align="start"
                        startContent={<StatusDot variant={outD ? 'neutral' : working ? 'success' : late ? 'error' : 'neutral'} label={outD ? '퇴근' : working ? '근무 중' : late ? '아직 안 옴' : '출근 예정'} isPulsing={!!(working || late)}/>}
                        label={<HStack gap={2} vAlign="center" wrap="wrap"><Text weight="bold">{u.name}</Text><Text type="supporting" color="secondary" hasTabularNumbers>{s ? `${s.start}~${s.end||''}` : '예정 없음'}{c.covering.length ? ` (${nameOf(c.covering[0].for)} 대타)` : ''}</Text></HStack>}
                        endContent={<Text weight="bold" color={bad ? 'accent' : 'secondary'} hasTabularNumbers>{state}</Text>}
                        description={
                          <Legacy>
                            <div aria-hidden="true" style={{position:'relative', height:8, borderRadius:4, background:'#F3F1EC', marginTop:6}}>
                              {s && <span className="st-grow" style={{position:'absolute', top:0, bottom:0, left:pct(toMin(s.start)), width:wid(toMin(s.start), endMinOf(s)), borderRadius:4,
                                background:'rgba(var(--hk-accent-rgb),.16)', border:'1px dashed rgba(var(--hk-accent-rgb),.45)', boxSizing:'border-box', animationDelay:`${i*50}ms`}}/>}
                              {inD && <span className="st-grow" style={{position:'absolute', top:1, bottom:1, left:pct(minOf(inD)), width:wid(minOf(inD), outD ? minOf(outD) : nowMin), borderRadius:3,
                                background: outD ? T.faint : T.green, animationDelay:`${120 + i*50}ms`}}/>}
                              {showNow && <span className="st-now" style={{position:'absolute', top:-3, bottom:-3, left:pct(nowMin), width:2, marginLeft:-1, borderRadius:1, background:T.accent}}/>}
                            </div>
                          </Legacy>}/>
                    )
                  })}
                </List>
                <HStack hAlign="between">
                  <Text type="supporting" color="secondary" hasTabularNumbers>{a0/60}시</Text>
                  {showNow && <Text type="supporting" color="accent">지금 {hm(now)} · 점선 = 예정, 진한 막대 = 실제 근무</Text>}
                  <Text type="supporting" color="secondary" hasTabularNumbers>{a1/60}시</Text>
                </HStack>
              </>
            })()}
        </LedgerCard>

        {/* 이번 주 근무표 (Astryx 표): 사장님은 칸을 눌러 그날 시간·휴무를 바꿈. 고치는 칸·일정·마감 입력은 아직 예전 입력칸 */}
        <LedgerCard title={`${weekOffset===0 ? '이번 주' : weekOffset===1 ? '다음 주' : weekOffset===-1 ? '지난주' : ''} 근무표 · ${weekLabel}`}
          right={isOwner ? <>
            <Text type="supporting" color="secondary">칸을 눌러 그날 시간·휴무를 바꿔요 (파란 글씨 = 직접 넣은 칸)</Text>
            <Button size="sm" label="지난주와 같게" isDisabled={busy} onClick={copyLastWeek}/>
          </> : <Text type="supporting" color="secondary">대타·임시휴무 반영, 지난 날은 실제 출퇴근</Text>}>
          {rows.length === 0 ? <Text color="secondary">인원관리에서 직원별 요일 출퇴근 예정 시각을 넣으면 근무표가 만들어져요</Text> : (() => {
            const showClose = isOwner || days.some(d => plans[ymOfDate(d)]?.closeAt?.[pad(d.getDate())])
            const data = [{ id:'_event', kind:'event' }, ...(showClose ? [{ id:'_close', kind:'close' }] : []), ...rows.map(u => ({ id:u.uid, kind:'user', u })), { id:'_count', kind:'count' }]
            const cellOfDay = (row, d, i) => {
              const ds = dateStr(d)
              if (row.kind === 'event') {
                const ev = events[ds.slice(0,7)]?.[ds.slice(8,10)], hol = holidayOf(ds)
                return <VStack gap={1}>
                  {hol && <Text type="supporting" weight="bold" color="secondary">{hol.reason || '임시휴무'}</Text>}
                  {!hol && d.getDay()===0 && <Text type="supporting" color="secondary">휴무</Text>}
                  {editDay === ds
                    ? <Legacy><input autoFocus defaultValue={ev||''} placeholder="일정" onBlur={e=>saveEvent(ds, e.target.value.trim())} onKeyDown={e=>e.key==='Enter' && e.target.blur()}
                        style={{width:'100%', boxSizing:'border-box', fontSize:12, padding:'3px 5px', border:'1px solid #CBC5BA', borderRadius:4, fontFamily:'inherit'}}/></Legacy>
                    : ev ? (isOwner ? <Button size="sm" variant="ghost" label={ev} onClick={()=>setEditDay(ds)}/> : <Text type="supporting" weight="bold" color="accent">{ev}</Text>)
                    : isOwner && <Button size="sm" variant="ghost" label="+ 일정" onClick={()=>setEditDay(ds)}/>}
                </VStack>
              }
              if (row.kind === 'close') {
                const close = plans[ds.slice(0,7)]?.closeAt?.[ds.slice(8,10)]
                if (closeEdit?.ds === ds) return (
                  <Legacy>
                    <TimePick value={closeEdit.time} onChange={v=>setCloseEdit(c=>({...c,time:v}))} label="마감 시각"/>
                    <div style={{display:'flex', gap:6, justifyContent:'center', marginTop:4}}>
                      <button type="button" disabled={busy || !closeEdit.time} onClick={()=>saveClose(closeEdit.time)} style={linkBtn(T.accent)}>저장</button>
                      {close && <button type="button" disabled={busy} onClick={()=>saveClose(null)} style={linkBtn(T.red)}>지우기</button>}
                      <button type="button" onClick={()=>setCloseEdit(null)} style={linkBtn(T.sub)}>취소</button>
                    </div>
                  </Legacy>
                )
                return close ? (isOwner ? <Button size="sm" variant="ghost" label={`${close} 마감`} onClick={()=>setCloseEdit({ ds, time:close })}/> : <Text type="supporting" weight="bold" color="accent">{close} 마감</Text>)
                  : isOwner && !closedOf(d) ? <Button size="sm" variant="ghost" label="+ 마감" onClick={()=>setCloseEdit({ ds, time:'20:00' })}/> : null
              }
              if (row.kind === 'count') { const l = shiftsByDay[i]; return <Text weight="bold" hasTabularNumbers>{l.length ? `${l.length}명` : ''}</Text> }
              const u = row.u, c = cellOf(u, d)
              const inD = toDate(c.rec?.in), outD = toDate(c.rec?.out)
              if (cellEdit?.uid === u.uid && cellEdit?.ds === c.ds) return (
                <Legacy>
                  <div style={{display:'flex', flexDirection:'column', gap:3}}>
                    <span style={{fontSize:11, color:T.sub, textAlign:'left'}}>출근</span>
                    <TimePick value={cellEdit.start} onChange={v=>setCellEdit(x=>({...x,start:v}))} label="출근 예정"/>
                    <span style={{fontSize:11, color:T.sub, textAlign:'left'}}>퇴근 (선택)</span>
                    <TimePick value={cellEdit.end} onChange={v=>setCellEdit(x=>({...x,end:v}))} label="퇴근 예정"/>
                  </div>
                  <div style={{display:'flex', gap:6, justifyContent:'center', flexWrap:'wrap', marginTop:4}}>
                    <button type="button" disabled={busy} onClick={()=>{ if(!cellEdit.start) return alert('출근 시각을 골라주세요'); saveCell({ start:cellEdit.start, end:cellEdit.end || null }) }} style={linkBtn(T.accent)}>저장</button>
                    <button type="button" disabled={busy} onClick={()=>saveCell({ off:true })} style={linkBtn(T.sub)}>휴무</button>
                    {c.override && <button type="button" disabled={busy} onClick={()=>saveCell(null)} style={linkBtn(T.blue)}>기본으로</button>}
                    <button type="button" onClick={()=>setCellEdit(null)} style={linkBtn(T.sub)}>취소</button>
                  </div>
                </Legacy>
              )
              if (c.closed) return <Text type="supporting" color="secondary">—</Text>
              const body = (
                <VStack gap={0}>
                  {c.override?.off && !c.rec?.in && <Text type="supporting" color="secondary">휴무</Text>}
                  {c.planned && <Text weight="semibold" hasTabularNumbers hasStrikethrough={!!c.gaveAway} color={c.gaveAway ? 'secondary' : c.override && !c.rec?.in ? 'accent' : 'primary'}>{c.planned.start}~{c.planned.end||''}{c.planned.cut ? ' (마감)' : ''}</Text>}
                  {c.brk && c.planned && !c.gaveAway && <Text type="supporting" color="secondary" hasTabularNumbers>휴게 {c.brk.start}~{c.brk.end}</Text>}
                  {c.gaveAway && <Text type="supporting" color="secondary">대타 {nameOf(c.gaveAway.confirmedUid)}</Text>}
                  {c.seeking && !c.gaveAway && <Badge variant="warning" label="대타 구하는 중"/>}
                  {c.covering.map((v,k) => <Text key={k} type="supporting" weight="semibold" hasTabularNumbers>{v.start}~{v.end} {nameOf(v.for)} 대신</Text>)}
                  {inD && <Text type="supporting" hasTabularNumbers color={c.st?.late || c.st?.leftEarly ? 'accent' : 'secondary'}>{hm(inD)}~{outD ? hm(outD) : ''}{c.st?.late ? ` 지각${c.st.late}분` : ''}{c.st?.leftEarly ? ' 조퇴' : ''}</Text>}
                  {c.missing && <Text type="supporting" weight="bold" color="accent">{c.past ? '결근' : '아직 안 옴'}</Text>}
                  {!c.planned && !c.override?.off && !c.covering.length && !inD && <Text color="secondary">{isOwner ? '+' : '·'}</Text>}
                </VStack>
              )
              return isOwner
                ? <ClickableCard label={`${u.name} ${d.getMonth()+1}/${d.getDate()} 시간 바꾸기`} variant="transparent" padding={1}
                    onClick={()=>setCellEdit({ uid:u.uid, ds:c.ds, start:c.planned?.start || '', end:c.planned?.end || '' })}>{body}</ClickableCard>
                : body
            }
            return (
              <VStack key={`w${weekOffset}`} gap={0} isScrollable>
                <Table data={data} idKey="id" density="compact" dividers="grid" verticalAlign="top" columns={[
                  { key:'name', header:'이름', width:84, renderCell: r => <Text weight="bold" color={r.kind === 'user' ? 'primary' : 'secondary'}>{r.kind === 'event' ? '매장 일정' : r.kind === 'close' ? '일찍 마감' : r.kind === 'count' ? '근무 인원' : r.u.name}</Text> },
                  ...days.map((d, i) => {
                    const isToday = dateStr(d) === dateStr(now)
                    return { key:dateStr(d), header:`${DAYS_KR[d.getDay()]} ${d.getMonth()+1}/${d.getDate()}${isToday ? ' 오늘' : ''}`, width:110, renderCell: r => cellOfDay(r, d, i) }
                  }),
                ]}/>
              </VStack>
            )
          })()}
        </LedgerCard>

        {/* 시간대별 인원 (예정 기준, 대타 반영. 진할수록 사람이 많음) */}
        {hours.length > 0 && (
          <LedgerCard title="시간대별 인원" right={<Text type="supporting" color="secondary">예정 기준 (대타 반영). 진할수록 사람이 많아요</Text>}>
            <Table key={`h${weekOffset}`} data={hours.map(h => ({ h }))} idKey="h" density="compact" columns={[
              { key:'h', header:'시간', width:64, renderCell: r => <Text color="secondary" hasTabularNumbers>{r.h}시</Text> },
              ...days.map((d, i) => ({ key:dateStr(d), header:`${DAYS_KR[d.getDay()]} ${d.getMonth()+1}/${d.getDate()}`, align:'center', renderCell: r => {
                const n = countAt(shiftsByDay[i], r.h)
                return n > 0 && <Legacy><div className="st-pop" style={{animationDelay:`${i*70 + (r.h - hours[0])*25}ms`, borderRadius:6, padding:'3px 0', fontWeight:700, textAlign:'center',
                  color: n/maxCount > 0.6 ? '#FFFFFF' : T.ink, background:`rgba(var(--hk-accent-rgb),${0.12 + 0.68*n/maxCount})`}}>{n}</div></Legacy>
              } })),
            ]}/>
          </LedgerCard>
        )}
      </>}
    </VStack>
    </AstryxPage>
  )
}
