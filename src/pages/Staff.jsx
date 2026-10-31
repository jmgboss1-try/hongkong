import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore'
import { useAuth } from '../AuthContext'
import { toDate, hm, dayStatus, breakForShift, recBreak, planFor, reapplyDay } from '../lib/attendance'
import { deleteField } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')
const DAYS_KR = ['일','월','화','수','목','금','토']
const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', soft:'#ECE8E1', accent:'#C3261C', red:'#B42318', green:'#2E7D45', blue:'#2B5C9E', amber:'#B45309', purple:'#6B4FA0' }
const num = { fontVariantNumeric:'tabular-nums' }
const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
const ymOfDate = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}`
const toMin = s => { const [h,m] = String(s).split(':').map(Number); return h*60 + (m||0) }
const mondayOf = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay()+6)%7)); return x }

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
export default function Staff() {
  const { isOwner } = useAuth()
  const [weekOffset, setWeekOffset] = useState(0)
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
    await setDoc(doc(db,'users',u.uid), { ...u, status:'approved', grade:+grade, wage:+wage||10030, joinDate:joinDate||'' })
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
    if (val && !val.off && (!val.start || !val.end)) return alert('시작과 끝 시각을 넣어 주세요')
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
      else if (s && nowMin >= (toMin(s.end) <= toMin(s.start) ? 1440 : toMin(s.end))) { state = '안 왔어요 (결근)'; color = T.red }
      else if (s && nowMin > toMin(s.start)) { state = `아직 안 옴 · ${nowMin - toMin(s.start)}분 지남`; color = T.red }
      else if (s) { state = `${s.start} 출근 예정`; color = T.sub }
      else { state = '—'; color = T.sub }
      return { u, c, s, state, color, order: s ? toMin(s.start) : 9999 }
    }).sort((a,b) => a.order - b.order)
  const inNow = todayRows.filter(r => r.c.rec?.in && !r.c.rec?.out).length
  const plannedNow = todayRows.filter(r => r.s && toMin(r.s.start) <= nowMin && nowMin < toMin(r.s.end)).length

  // ── 이번 주 근무표 ──
  const showSun = staff.some(u => week[6] && cellOf(u, week[6]).shifts.length)
  const days = showSun ? week : week.slice(0,6)
  // 사장은 모든 직원 (유동 근무자 칸을 채우려면), 직원은 이번 주에 근무가 있는 사람만
  const rows = isOwner ? staff : staff.filter(u => days.some(d => { const c = cellOf(u, d); return c.planned || c.shifts.length || c.rec?.in }))
  // 시간대별 인원: 예정(대타 반영) 기준, 한 시간 칸에 걸쳐 있으면 1명
  let hFrom = 24, hTo = 0
  const shiftsByDay = days.map(d => rows.flatMap(u => cellOf(u, d).shifts))
  shiftsByDay.flat().forEach(s => { hFrom = Math.min(hFrom, Math.floor(toMin(s.start)/60)); hTo = Math.max(hTo, Math.ceil((toMin(s.end) <= toMin(s.start) ? 1440 : toMin(s.end))/60)) })
  const hours = hTo > hFrom ? Array.from({length:hTo-hFrom}, (_,i)=>hFrom+i) : []
  // 그 시간 칸에 근무하는 분이 있으면 1명 (브레이크로 그 시간 전체를 쉬면 빼고)
  const ov = (a0,a1,b0,b1) => Math.max(0, Math.min(a1,b1) - Math.max(a0,b0))
  const countAt = (list, h) => list.filter(s => {
    const a = toMin(s.start), b = toMin(s.end) <= a ? 1440 : toMin(s.end), h0 = h*60, h1 = h0+60
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
  const navBtn = (label, onClick, on) => (
    <button type="button" onClick={onClick}
      style={{background: on ? T.ink : 'none', color: on ? '#FFFFFF' : T.ink, border:`1px solid ${on ? T.ink : T.rule}`, borderRadius:4, padding:'6px 10px', cursor:'pointer', fontFamily:'inherit', fontSize:13}}>{label}</button>
  )
  const linkBtn = color => ({ background:'none', border:'none', borderBottom:`1px solid ${color}`, color, padding:0, fontSize:11, cursor:'pointer', fontFamily:'inherit' })
  const timeStyle = { width:'100%', boxSizing:'border-box', fontSize:12, padding:'2px 4px', border:'1px solid #CBC5BA', borderRadius:4, fontFamily:'inherit' }
  const th = { padding:'8px 8px', fontSize:12, fontWeight:600, color:T.sub, borderBottom:`1px solid ${T.ink}`, textAlign:'center', whiteSpace:'nowrap' }
  const td = { padding:'7px 8px', borderBottom:`1px solid ${T.soft}`, textAlign:'center', verticalAlign:'top', whiteSpace:'nowrap', fontSize:12, ...num }

  return (
    <div style={{maxWidth:1100}}>
      <header style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap', paddingBottom:10, borderBottom:`3px double ${T.ink}`, marginBottom:22}}>
        <h1 style={{fontSize:24, fontWeight:800, margin:0, fontFamily:'inherit', color:T.ink}}>스케쥴</h1>
        <div style={{display:'flex', alignItems:'center', gap:6, flexWrap:'wrap'}}>
          {navBtn('이전 주', ()=>setWeekOffset(w=>w-1))}
          {navBtn('이번 주', ()=>setWeekOffset(0), weekOffset===0)}
          {navBtn('다음 주', ()=>setWeekOffset(w=>w+1))}
        </div>
      </header>

      {/* 사장: 가입 승인 대기 */}
      {isOwner && pending.length>0 && (
        <section style={{marginBottom:28}}>
          {sectionTitle(`가입 승인 대기 ${pending.length}명`)}
          <div style={{display:'flex', flexDirection:'column', gap:12, paddingTop:6}}>
            {pending.map(u=><PendingCard key={u.uid} u={u} onApprove={approveUser} onReject={rejectUser}/>)}
          </div>
        </section>
      )}

      {loading ? <div style={{color:T.sub, padding:'30px 0'}}>불러오는 중...</div> : <>
        {/* 지금 매장 */}
        <section style={{marginBottom:30}}>
          {sectionTitle(`지금 매장 · ${hm(now)}`, closedOf(todayD) ? (holidayOf(dateStr(todayD))?.reason || '오늘은 휴무일') : `지금 근무 예정 ${plannedNow}명 · 출근해 있는 사람 ${inNow}명`)}
          {todayRows.length === 0 ? <div style={{fontSize:13, color:T.sub, padding:'10px 0'}}>오늘 근무 예정인 사람이 없어요</div> :
            todayRows.map(({u, s, state, color, c}) => (
              <div key={u.uid} style={{display:'flex', alignItems:'baseline', gap:10, padding:'8px 0', borderBottom:`1px solid ${T.soft}`, fontSize:14, flexWrap:'wrap'}}>
                <b style={{minWidth:64}}>{u.name}</b>
                <span style={{...num, color:T.sub, fontSize:13}}>{s ? `${s.start}~${s.end}` : '예정 없음'}{c.covering.length ? ` (${nameOf(c.covering[0].for)} 대타)` : ''}</span>
                <span style={{flex:1}}/>
                <span style={{fontWeight:700, color, ...num}}>{state}</span>
              </div>
            ))}
        </section>

        {/* 이번 주 근무표 */}
        <section style={{marginBottom:30}}>
          {sectionTitle(`${weekOffset===0 ? '이번 주' : weekOffset===1 ? '다음 주' : weekOffset===-1 ? '지난주' : ''} 근무표 · ${weekLabel}`,
            isOwner ? <span style={{display:'flex', gap:10, alignItems:'baseline', flexWrap:'wrap'}}>
              <span>칸을 눌러 그날 시간·휴무를 바꿔요 (파란 글씨 = 직접 넣은 칸)</span>
              <button type="button" disabled={busy} onClick={copyLastWeek} style={linkBtn(T.blue)}>지난주와 같게</button>
            </span> : '대타·임시휴무 반영, 지난 날은 실제 출퇴근')}
          {rows.length === 0 ? <div style={{fontSize:13, color:T.sub, padding:'10px 0'}}>인원관리에서 직원별 요일 출퇴근 예정 시각을 넣으면 근무표가 만들어져요</div> : (
            <div style={{overflowX:'auto'}}>
              <table style={{borderCollapse:'collapse', width:'100%', minWidth: 90 + days.length*110, tableLayout:'fixed'}}>
                <thead>
                  <tr>
                    <th style={{...th, textAlign:'left', width:80}}>이름</th>
                    {days.map(d => {
                      const ds = dateStr(d), isToday = ds === dateStr(now)
                      return <th key={ds} style={{...th, color: d.getDay()===0 ? T.red : d.getDay()===6 ? T.blue : isToday ? T.accent : T.sub,
                        borderBottom:`${isToday ? 3 : 1}px solid ${isToday ? T.accent : T.ink}`}}>
                        {DAYS_KR[d.getDay()]} {d.getMonth()+1}/{d.getDate()}{isToday ? ' 오늘' : ''}
                      </th>
                    })}
                  </tr>
                  {/* 매장 일정 · 휴무 */}
                  <tr>
                    <td style={{...td, textAlign:'left', color:T.sub}}>매장 일정</td>
                    {days.map(d => {
                      const ds = dateStr(d), ev = events[ds.slice(0,7)]?.[ds.slice(8,10)], hol = holidayOf(ds)
                      return (
                        <td key={ds} style={{...td, whiteSpace:'normal', background: closedOf(d) ? '#F3F1EC' : undefined}}>
                          {hol && <div style={{color:T.sub, fontWeight:700}}>{hol.reason || '임시휴무'}</div>}
                          {!hol && d.getDay()===0 && <div style={{color:T.sub}}>휴무</div>}
                          {editDay === ds ? (
                            <input autoFocus defaultValue={ev||''} placeholder="일정" onBlur={e=>saveEvent(ds, e.target.value.trim())}
                              onKeyDown={e=>e.key==='Enter' && e.target.blur()}
                              style={{width:'100%', boxSizing:'border-box', fontSize:12, padding:'3px 5px', border:'1px solid #CBC5BA', borderRadius:4, fontFamily:'inherit'}}/>
                          ) : ev ? <div onClick={()=>isOwner && setEditDay(ds)} style={{color:T.accent, fontWeight:700, cursor: isOwner ? 'pointer' : 'default'}}>{ev}</div>
                            : isOwner && <button type="button" onClick={()=>setEditDay(ds)} style={{background:'none', border:'none', color:T.faint, fontSize:11, cursor:'pointer', fontFamily:'inherit'}}>+ 일정</button>}
                        </td>
                      )
                    })}
                  </tr>
                  {/* 일찍 마감한 날: 그 시각 이후 예정은 잘림 (조퇴로 안 잡힘) */}
                  {(isOwner || days.some(d => plans[ymOfDate(d)]?.closeAt?.[pad(d.getDate())])) && (
                    <tr>
                      <td style={{...td, textAlign:'left', color:T.sub}}>일찍 마감</td>
                      {days.map(d => {
                        const ds = dateStr(d), close = plans[ds.slice(0,7)]?.closeAt?.[ds.slice(8,10)]
                        if (closeEdit?.ds === ds) return (
                          <td key={ds} style={{...td, whiteSpace:'normal'}}>
                            <input type="time" value={closeEdit.time} onChange={e=>setCloseEdit(c=>({...c,time:e.target.value}))} aria-label="마감 시각"
                              style={{width:'100%', boxSizing:'border-box', fontSize:12, padding:'2px 4px', border:'1px solid #CBC5BA', borderRadius:4, fontFamily:'inherit'}}/>
                            <div style={{display:'flex', gap:6, justifyContent:'center', marginTop:4}}>
                              <button type="button" disabled={busy || !closeEdit.time} onClick={()=>saveClose(closeEdit.time)} style={linkBtn(T.accent)}>저장</button>
                              {close && <button type="button" disabled={busy} onClick={()=>saveClose(null)} style={linkBtn(T.red)}>지우기</button>}
                              <button type="button" onClick={()=>setCloseEdit(null)} style={linkBtn(T.sub)}>취소</button>
                            </div>
                          </td>
                        )
                        return (
                          <td key={ds} style={td}>
                            {close ? <span onClick={()=>isOwner && setCloseEdit({ ds, time:close })} style={{color:T.accent, fontWeight:700, cursor: isOwner ? 'pointer' : 'default'}}>{close} 마감</span>
                              : isOwner && !closedOf(d) && <button type="button" onClick={()=>setCloseEdit({ ds, time:'20:00' })} style={{background:'none', border:'none', color:T.faint, fontSize:11, cursor:'pointer', fontFamily:'inherit'}}>+ 마감</button>}
                          </td>
                        )
                      })}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {rows.map(u => (
                    <tr key={u.uid}>
                      <td style={{...td, textAlign:'left', fontWeight:700, fontSize:13}}>{u.name}</td>
                      {days.map(d => {
                        const c = cellOf(u, d)
                        const inD = toDate(c.rec?.in), outD = toDate(c.rec?.out)
                        return (
                          cellEdit?.uid === u.uid && cellEdit?.ds === c.ds ? (
                          <td key={c.ds} style={{...td, whiteSpace:'normal', background:'#FFFFFF', outline:`2px solid ${T.accent}`}}>
                            <div style={{display:'flex', flexDirection:'column', gap:3}}>
                              <input type="time" value={cellEdit.start} onChange={e=>setCellEdit(x=>({...x,start:e.target.value}))} aria-label="출근 예정" style={timeStyle}/>
                              <input type="time" value={cellEdit.end} onChange={e=>setCellEdit(x=>({...x,end:e.target.value}))} aria-label="퇴근 예정" style={timeStyle}/>
                            </div>
                            <div style={{display:'flex', gap:6, justifyContent:'center', flexWrap:'wrap', marginTop:4}}>
                              <button type="button" disabled={busy} onClick={()=>saveCell({ start:cellEdit.start, end:cellEdit.end })} style={linkBtn(T.accent)}>저장</button>
                              <button type="button" disabled={busy} onClick={()=>saveCell({ off:true })} style={linkBtn(T.sub)}>휴무</button>
                              {c.override && <button type="button" disabled={busy} onClick={()=>saveCell(null)} style={linkBtn(T.blue)}>기본으로</button>}
                              <button type="button" onClick={()=>setCellEdit(null)} style={linkBtn(T.sub)}>취소</button>
                            </div>
                          </td>
                          ) :
                          <td key={c.ds} onClick={()=>isOwner && !c.closed && setCellEdit({ uid:u.uid, ds:c.ds, start:c.planned?.start || '', end:c.planned?.end || '' })}
                            title={isOwner && !c.closed ? '눌러서 이날 시간 바꾸기' : undefined}
                            style={{...td, cursor: isOwner && !c.closed ? 'pointer' : 'default', background: c.closed ? '#F3F1EC' : c.today ? '#C3261C08' : undefined}}>
                            {c.override?.off && !c.closed && !c.rec?.in && <div style={{color:T.faint}}>휴무</div>}
                            {c.planned && !c.closed && (
                              <div style={{color: c.gaveAway ? T.faint : c.override && !c.rec?.in ? T.blue : T.ink, textDecoration: c.gaveAway ? 'line-through' : 'none', fontWeight:600}}>{c.planned.start}~{c.planned.end}{c.planned.cut ? ' (마감)' : ''}</div>
                            )}
                            {c.brk && c.planned && !c.gaveAway && !c.closed && <div style={{color:T.sub, fontSize:11}}>휴게 {c.brk.start}~{c.brk.end}</div>}
                            {c.gaveAway && <div style={{color:T.purple, fontSize:11}}>대타 {nameOf(c.gaveAway.confirmedUid)}</div>}
                            {c.seeking && !c.gaveAway && <div style={{color:T.amber, fontSize:11, fontWeight:700}}>대타 구하는 중</div>}
                            {c.covering.map((v,i) => <div key={i} style={{color:T.purple, fontWeight:600}}>{v.start}~{v.end}<div style={{fontSize:11}}>{nameOf(v.for)} 대신</div></div>)}
                            {inD && (
                              <div style={{fontSize:11, color: c.st?.late || c.st?.leftEarly ? T.red : T.green, marginTop:2}}>
                                {hm(inD)}~{outD ? hm(outD) : ''}{c.st?.late ? ` 지각${c.st.late}분` : ''}{c.st?.leftEarly ? ` 조퇴${c.st.leftEarly}분` : ''}
                              </div>
                            )}
                            {c.missing && <div style={{fontSize:11, color:T.red, fontWeight:700}}>{c.past ? '결근' : '아직 안 옴'}</div>}
                            {!c.planned && !c.override?.off && !c.covering.length && !inD && !c.closed && <span style={{color:T.faint}}>{isOwner ? '+' : '·'}</span>}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  <tr>
                    <td style={{...td, textAlign:'left', color:T.sub, borderTop:`3px double ${T.ink}`}}>근무 인원</td>
                    {shiftsByDay.map((l,i) => <td key={i} style={{...td, borderTop:`3px double ${T.ink}`, fontWeight:700}}>{l.length ? `${l.length}명` : ''}</td>)}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 시간대별 인원 */}
        {hours.length > 0 && (
          <section style={{marginBottom:30}}>
            {sectionTitle('시간대별 인원', '예정 기준 (대타 반영). 진할수록 사람이 많아요')}
            <div style={{overflowX:'auto'}}>
              <table style={{borderCollapse:'collapse', width:'100%', minWidth: 90 + days.length*110, tableLayout:'fixed'}}>
                <thead>
                  <tr><th style={{...th, textAlign:'left', width:80}}>시간</th>{days.map(d => <th key={dateStr(d)} style={th}>{DAYS_KR[d.getDay()]} {d.getMonth()+1}/{d.getDate()}</th>)}</tr>
                </thead>
                <tbody>
                  {hours.map(h => (
                    <tr key={h}>
                      <td style={{...td, textAlign:'left', color:T.sub, padding:'4px 8px'}}>{h}시</td>
                      {shiftsByDay.map((l,i) => {
                        const n = countAt(l, h)
                        return <td key={i} style={{...td, padding:'4px 8px', fontWeight:700, color: n/maxCount > 0.6 ? '#FFFFFF' : T.ink,
                          background: n ? `rgba(195,38,28,${0.12 + 0.68*n/maxCount})` : 'transparent'}}>{n || ''}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </>}
    </div>
  )
}
