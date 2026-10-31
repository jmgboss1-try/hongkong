import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, getDocs, collection, setDoc, deleteField, Timestamp } from 'firebase/firestore'
import { DEFAULT_RADIUS, DEFAULT_SINCE, GRACE_MIN, pad, hm, toDate, calcRecord, applyRecord, getPosition, minsLabel, monthStatus, breakFor, breakForShift, recBreak, DEFAULT_BREAKS } from '../lib/attendance'
import RewardGame from './RewardGame'

const DAYS_KR = ['일','월','화','수','목','금','토']
const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', soft:'#ECE8E1', accent:'#C3261C', red:'#B42318', green:'#2E7D45', blue:'#2B5C9E', amber:'#B45309' }
const num = { fontVariantNumeric:'tabular-nums' }

function Btn({ children, onClick, kind = 'plain', disabled }) {
  const solid = kind==='primary' || kind==='ok'
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{fontFamily:'inherit', cursor:'pointer', borderRadius:4, whiteSpace:'nowrap', fontSize:12, padding:'4px 10px',
        fontWeight: solid ? 700 : 500, background: kind==='primary' ? T.accent : kind==='ok' ? T.green : '#FFFFFF',
        color: solid ? '#FFFFFF' : kind==='danger' ? T.red : T.ink,
        border: solid ? 'none' : `1px solid ${kind==='danger' ? '#E8C4BF' : T.rule}`, opacity: disabled ? 0.6 : 1}}>
      {children}
    </button>
  )
}

// 근무관리 맨 위: NFC 출퇴근 기록, 승인 대기, 퇴근 안 찍은 기록, 설정(매장 위치·태그 주소)
// 찍힌 기록은 근무관리 근무시간(workhours/workextra)에 자동으로 들어가고, 승인하면 그 시간도 더해짐
export default function AttendancePanel({ curMonth, nameMap, onApplied }) {
  const [att, setAtt] = useState({})
  const [cfg, setCfg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [showSet, setShowSet] = useState(false)
  const [edit, setEdit] = useState(null) // { uid, dd, in:'HH:MM', out:'HH:MM' }
  const [radius, setRadius] = useState('')
  const [note, setNote] = useState('')
  const [staff, setStaff] = useState([])      // 근태를 볼 직원 (users 문서 그대로)
  const [holidays, setHolidays] = useState([]) // checklist/holidays
  const [subs, setSubs] = useState([])         // substitutes/requests
  const [reward, setReward] = useState(null)   // rewards/{달}
  const [openUid, setOpenUid] = useState(null) // 근태 상세를 펼친 직원
  const [showGame, setShowGame] = useState(false)
  const [since, setSince] = useState('')
  const [brkEdit, setBrkEdit] = useState(null)   // 요일별 브레이크 편집 {요일: {start,end}}
  const [dayBrk, setDayBrk] = useState(null)     // 날짜별 브레이크 편집 { date, start, end }

  async function load(sync) {
    try {
      const opt = p => p.then(x => x.exists() ? x.data() : null).catch(() => null)
      const [aSnap, cSnap, uSnap, hol, sub, rw] = await Promise.all([
        getDoc(doc(db,'attendance',curMonth)), getDoc(doc(db,'attendance','_config')), getDocs(collection(db,'users')),
        opt(getDoc(doc(db,'checklist','holidays'))), opt(getDoc(doc(db,'substitutes','requests'))), opt(getDoc(doc(db,'rewards',curMonth))),
      ])
      let a = aSnap.exists() ? aSnap.data() : {}
      setCfg(cSnap.exists() ? cSnap.data() : null)
      const list = []
      uSnap.forEach(d => { const u = d.data(); if (u.status==='approved' && !['owner','store','investor'].includes(u.role)) list.push({ uid:d.id, ...u }) })
      setStaff(list.sort((x,y)=>(x.joinDate||'').localeCompare(y.joinDate||'')))
      setHolidays(hol?.list || []); setSubs(sub?.list || []); setReward(rw)
      if (sync) {
        // 직원 폰에서 근무시간 반영이 안 됐거나(권한) 승인 상태가 바뀐 기록을 근무관리에 맞춤
        let changed = false
        for (const [uid, days] of Object.entries(a)) for (const [dd, rec] of Object.entries(days||{})) {
          const c = calcRecord(rec)
          if (c && c.total !== rec.appliedMins) { await applyRecord(curMonth, uid, dd, rec); changed = true }
        }
        if (changed) {
          const s = await getDoc(doc(db,'attendance',curMonth)); a = s.exists() ? s.data() : {}
          onApplied?.()
        }
      }
      setAtt(a)
    } catch(e) { console.error(e); setNote('출퇴근 기록을 불러오지 못했어요 (Firestore 규칙: attendance).') }
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(()=>{ load(true) }, [curMonth])

  const name = uid => att[uid] && Object.values(att[uid]).find(r=>r?.name)?.name || nameMap?.[uid] || '—'
  const [cy, cm] = curMonth.split('-').map(Number)
  const dow = dd => DAYS_KR[new Date(cy, cm-1, +dd).getDay()]
  const now = new Date()
  const todayDd = `${now.getFullYear()}-${pad(now.getMonth()+1)}` === curMonth ? pad(now.getDate()) : null

  const rows = []
  for (const [uid, days] of Object.entries(att)) for (const [dd, rec] of Object.entries(days||{}))
    if (rec?.in) rows.push({ uid, dd, rec, c: calcRecord(rec) })
  rows.sort((a,b)=> b.dd.localeCompare(a.dd) || toDate(a.rec.in) - toDate(b.rec.in))
  const pending = rows.filter(r=>r.c?.pending)
  const working = rows.filter(r=>!r.rec.out && r.dd===todayDd)
  const noOut = rows.filter(r=>!r.rec.out && r.dd!==todayDd)

  async function decide(r, field, ok) {
    setBusy(true)
    try {
      await setDoc(doc(db,'attendance',curMonth), { [r.uid]: { [r.dd]: { [field]: ok } } }, { merge:true })
      await applyRecord(curMonth, r.uid, r.dd, { ...r.rec, [field]: ok })
      await load(false); onApplied?.()
    } catch(e) { console.error(e); alert('저장하지 못했어요. 다시 시도해 주세요.') }
    setBusy(false)
  }

  async function saveEdit() {
    const { uid, dd } = edit
    if (!edit.in) return alert('출근 시각을 넣어 주세요')
    setBusy(true)
    const at = (s, plusDay) => { const [h,m] = s.split(':').map(Number); return new Date(cy, cm-1, +dd + (plusDay?1:0), h, m) }
    const inD = at(edit.in)
    const outD = edit.out ? at(edit.out, edit.out < edit.in) : null
    try {
      if ((edit.bStart && !edit.bEnd) || (!edit.bStart && edit.bEnd)) { setBusy(false); return alert('브레이크는 시작과 끝을 같이 넣어 주세요') }
      const orig = att[uid]?.[dd] || {}
      const brkChanged = edit.bStart !== (orig.breakStart||'') || edit.bEnd !== (orig.breakEnd||'') || !!edit.noBreak !== !!orig.noBreak
      const brk = edit.noBreak ? { noBreak:true } : edit.bStart ? { breakStart:edit.bStart, breakEnd:edit.bEnd, noBreak:false } : { breakStart:null, breakEnd:null, noBreak:false }
      const rec = { ...(att[uid]?.[dd]||{}), in: Timestamp.fromDate(inD), ...(outD ? { out: Timestamp.fromDate(outD) } : {}), ...brk }
      await setDoc(doc(db,'attendance',curMonth), { [uid]: { [dd]: { in: rec.in, out: outD ? rec.out : deleteField(), editedByOwner: true, ...(brkChanged ? { editedBreak: true } : {}), ...brk } } }, { merge:true })
      if (outD) await applyRecord(curMonth, uid, dd, rec)
      setEdit(null); await load(false); onApplied?.()
    } catch(e) { console.error(e); alert('저장하지 못했어요. 다시 시도해 주세요.') }
    setBusy(false)
  }

  async function remove(r) {
    if (!window.confirm(`${+r.dd}일 ${name(r.uid)} 출퇴근 기록을 지울까요? 근무관리에 들어간 그날 시간도 0이 돼요.`)) return
    setBusy(true)
    try {
      await setDoc(doc(db,'attendance',curMonth), { [r.uid]: { [r.dd]: deleteField() } }, { merge:true })
      if (r.rec.appliedMins != null) {
        await setDoc(doc(db,'workhours',curMonth), { [r.uid]: { [r.dd]: 0 } }, { merge:true })
        await setDoc(doc(db,'workextra',curMonth), { [r.uid]: { [r.dd]: 0 } }, { merge:true })
      }
      await load(false); onApplied?.()
    } catch(e) { console.error(e); alert('지우지 못했어요.') }
    setBusy(false)
  }

  // 결근 처리: 사유가 있는 날은 '결근 아님' (출근 기록 없이 excused 표시)
  async function setExcused(uid, dd, on) {
    setBusy(true)
    try {
      await setDoc(doc(db,'attendance',curMonth), { [uid]: { [dd]: { excused: on ? true : deleteField() } } }, { merge:true })
      await load(false)
    } catch(e) { console.error(e); alert('저장하지 못했어요.') }
    setBusy(false)
  }
  async function saveSince() {
    if (!since) return
    const c = { ...(cfg||{}), since }
    await setDoc(doc(db,'attendance','_config'), c); setCfg(c); setNote('집계 시작일을 저장했어요')
  }

  // 요일별 매장 브레이크 저장
  async function saveBreaks() {
    const clean = Object.fromEntries(Object.entries(brkEdit||{}).filter(([,v]) => v?.start && v?.end))
    const c = { ...(cfg||{}), breaks: clean }
    await setDoc(doc(db,'attendance','_config'), c); setCfg(c); setBrkEdit(null); setNote('요일별 브레이크를 저장했어요 (앞으로 찍는 출근부터 적용)')
  }
  // 그날만 브레이크 바꾸기: 설정에 남기고, 그날 이미 출근한 사람 기록에도 바로 반영 (풀타임만, 기록에서 직접 고친 건 그대로)
  async function saveDayBreak(none) {
    const { date } = dayBrk
    if (!none && (!dayBrk.start || !dayBrk.end)) return alert('브레이크 시작과 끝을 넣어 주세요')
    setBusy(true)
    try {
      const val = none ? { none:true } : { start:dayBrk.start, end:dayBrk.end }
      const c = { ...(cfg||{}), breakDates: { ...(cfg?.breakDates||{}), [date]: val } }
      await setDoc(doc(db,'attendance','_config'), c); setCfg(c)
      const ym = date.slice(0,7), dd = date.slice(8,10)
      const aSnap = await getDoc(doc(db,'attendance',ym)); const a = aSnap.exists() ? aSnap.data() : {}
      const d = new Date(+date.slice(0,4), +date.slice(5,7)-1, +dd)
      for (const [uid, days] of Object.entries(a)) {
        const rec = days?.[dd]
        if (!rec?.in || rec.editedBreak) continue
        const br = rec.schedStart ? breakForShift(c, d, { start:rec.schedStart, end:rec.schedEnd }) : null
        const upd = br ? { breakStart:br.start, breakEnd:br.end, noBreak:false } : { breakStart:null, breakEnd:null, noBreak:false }
        await setDoc(doc(db,'attendance',ym), { [uid]: { [dd]: upd } }, { merge:true })
        if (rec.out) await applyRecord(ym, uid, dd, { ...rec, ...upd })
      }
      setDayBrk(null); await load(false); onApplied?.(); setNote(`${+date.slice(5,7)}월 ${+dd}일 브레이크를 ${none ? '없음으로' : `${val.start}~${val.end}로`} 바꿨어요`)
    } catch(e) { console.error(e); alert('저장하지 못했어요.') }
    setBusy(false)
  }

  async function saveStoreLocation() {
    setBusy(true); setNote('')
    try {
      const p = await getPosition()
      const c = { lat:p.lat, lng:p.lng, radius: +radius || cfg?.radius || DEFAULT_RADIUS, savedAt: new Date().toISOString() }
      await setDoc(doc(db,'attendance','_config'), c)
      setCfg(c); setNote(`매장 위치를 저장했어요 (오차 약 ${p.acc}m). 매장에서 저장해야 정확해요.`)
    } catch(e) { setNote(e.message || '위치를 저장하지 못했어요') }
    setBusy(false)
  }
  async function saveRadius() {
    if (!cfg) return
    const c = { ...cfg, radius: +radius || DEFAULT_RADIUS }
    await setDoc(doc(db,'attendance','_config'), c); setCfg(c); setNote('범위를 저장했어요')
  }

  // 직원별 이 달 근태 (예정 시각을 넣었거나 기록이 있는 직원만)
  const stats = staff
    .filter(u => (u.shiftTimes && Object.keys(u.shiftTimes).length) || att[u.uid])
    .map(u => ({ u, st: monthStatus({ ym:curMonth, uid:u.uid, user:u, recs:att[u.uid], holidays, subs, since: cfg?.since || DEFAULT_SINCE }) }))
  const perfectList = stats.filter(x => x.st.perfect)
  const monthOver = stats[0]?.st.monthOver ?? (curMonth < `${now.getFullYear()}-${pad(now.getMonth()+1)}`)

  const clockUrl = `${window.location.origin}/clock`
  const sectionTitle = (text, right) => (
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:10, flexWrap:'wrap', borderBottom:`2px solid ${T.ink}`, paddingBottom:6, marginBottom:6}}>
      <h2 style={{fontSize:16, fontWeight:800, margin:0, fontFamily:'inherit', color:T.ink}}>{text}</h2>
      {right && <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', fontSize:12, color:T.sub}}>{right}</div>}
    </div>
  )
  const link = (label, onClick) => (
    <button type="button" onClick={onClick} style={{background:'none', border:'none', borderBottom:`1px solid ${T.blue}`, color:T.blue, padding:0, fontSize:12, cursor:'pointer', fontFamily:'inherit'}}>{label}</button>
  )
  const timeIn = (v, set, label) => (
    <input type="time" value={v||''} onChange={e=>set(e.target.value)} aria-label={label}
      style={{background:'#FFFFFF', border:'1px solid #CBC5BA', borderRadius:4, padding:'4px 6px', fontSize:13, fontFamily:'inherit', ...num}}/>
  )
  const recLine = r => {
    const inD = toDate(r.rec.in), outD = toDate(r.rec.out)
    const isEdit = edit && edit.uid===r.uid && edit.dd===r.dd
    return (
      <div key={r.uid+r.dd} style={{display:'flex', alignItems:'center', gap:10, padding:'7px 0', borderBottom:`1px solid ${T.soft}`, fontSize:13, flexWrap:'wrap'}}>
        <span style={{...num, color:T.sub, minWidth:62}}>{+r.dd}일 ({dow(r.dd)})</span>
        <span style={{fontWeight:700, minWidth:56}}>{name(r.uid)}</span>
        {isEdit ? (
          <>
            {timeIn(edit.in, v=>setEdit(e=>({...e,in:v})), '출근')}<span>~</span>{timeIn(edit.out, v=>setEdit(e=>({...e,out:v})), '퇴근')}
            <span style={{color:T.sub, marginLeft:6}}>브레이크</span>
            {timeIn(edit.bStart, v=>setEdit(e=>({...e,bStart:v,noBreak:false})), '브레이크 시작')}<span>~</span>{timeIn(edit.bEnd, v=>setEdit(e=>({...e,bEnd:v,noBreak:false})), '브레이크 끝')}
            <label style={{display:'flex', alignItems:'center', gap:4, color:T.sub}}>
              <input type="checkbox" checked={!!edit.noBreak} onChange={e=>setEdit(x=>({...x,noBreak:e.target.checked}))}/> 못 쉼
            </label>
            <Btn kind="primary" onClick={saveEdit} disabled={busy}>저장</Btn>
            <Btn onClick={()=>setEdit(null)}>취소</Btn>
          </>
        ) : (
          <>
            <span style={{...num}}>{hm(inD)} ~ {outD ? hm(outD) : <span style={{color:T.red}}>퇴근 안 찍음</span>}</span>
            <span style={{color:T.sub, fontSize:12}}>{r.rec.schedStart ? `예정 ${r.rec.schedStart}~${r.rec.schedEnd}` : '예정 없음'}</span>
            {recBreak(r.rec) && <span style={{color:T.sub, fontSize:12}}>브레이크 {r.rec.breakStart}~{r.rec.breakEnd}</span>}
            {r.rec.noBreak && <span style={{color:T.amber, fontSize:12}}>브레이크 못 쉼</span>}
            <span style={{flex:1}}/>
            {r.c && <span style={{...num, fontWeight:600}}>{minsLabel(r.c.total)}</span>}
            {r.c?.pending && <span style={{color:T.amber, fontSize:12, fontWeight:700}}>승인 대기</span>}
            <button type="button" onClick={()=>setEdit({ uid:r.uid, dd:r.dd, in:hm(inD), out: outD ? hm(outD) : '', bStart:r.rec.breakStart||'', bEnd:r.rec.breakEnd||'', noBreak:!!r.rec.noBreak })}
              style={{background:'none', border:'none', color:T.sub, fontSize:12, cursor:'pointer', padding:0, fontFamily:'inherit'}}>수정</button>
            <button type="button" onClick={()=>remove(r)}
              style={{background:'none', border:'none', color:T.red, fontSize:12, cursor:'pointer', padding:0, fontFamily:'inherit'}}>삭제</button>
          </>
        )}
      </div>
    )
  }

  return (
    <section style={{marginBottom:28}}>
      {sectionTitle('NFC 출퇴근', <>
        {pending.length > 0 ? <span style={{color:T.amber, fontWeight:700}}>승인 대기 {pending.length}건</span> : rows.length > 0 && <span>승인 대기 없음</span>}
        {link(showSet ? '설정 닫기' : '설정 (매장 위치·태그 주소)', ()=>setShowSet(v=>!v))}
      </>)}

      {showSet && (
        <div style={{background:'#F3F1EC', borderRadius:4, padding:'12px 14px', margin:'8px 0 12px', fontSize:13, lineHeight:1.7}}>
          <div style={{fontWeight:700}}>1. 매장 위치</div>
          <div style={{color:T.sub}}>
            {cfg?.lat != null ? `저장됨 · 매장에서 ${cfg.radius || DEFAULT_RADIUS}m 안에서만 찍혀요` : '아직 없어요. 매장 안에서 아래 버튼을 눌러 주세요. 없으면 어디서든 찍혀요.'}
          </div>
          <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', margin:'6px 0 12px'}}>
            <Btn kind="primary" onClick={saveStoreLocation} disabled={busy}>지금 이 기기 위치를 매장으로 저장</Btn>
            <span style={{color:T.sub}}>범위</span>
            <input type="text" inputMode="numeric" value={radius} placeholder={String(cfg?.radius || DEFAULT_RADIUS)} onChange={e=>setRadius(e.target.value.replace(/[^0-9]/g,''))}
              aria-label="범위(m)" style={{width:64, background:'#FFFFFF', border:'1px solid #CBC5BA', borderRadius:4, padding:'4px 6px', fontSize:13, textAlign:'right', ...num}}/>
            <span style={{color:T.sub}}>m</span>
            {cfg && radius && <Btn onClick={saveRadius}>범위 저장</Btn>}
          </div>
          <div style={{fontWeight:700}}>요일별 매장 브레이크</div>
          <div style={{color:T.sub}}>이 시간을 통째로 포함하는 근무(풀타임)는 근무시간에서 자동으로 빠져요. 평일처럼 그때그때 다른 날은 비워 두고 아래 "날짜별 브레이크"에서 정해요.</div>
          {brkEdit ? (
            <div style={{display:'flex', flexDirection:'column', gap:4, margin:'6px 0 12px'}}>
              {[1,2,3,4,5,6,0].map(w => (
                <div key={w} style={{display:'flex', alignItems:'center', gap:6}}>
                  <span style={{width:18, fontWeight:700}}>{DAYS_KR[w]}</span>
                  {timeIn(brkEdit[w]?.start, v=>setBrkEdit(b=>({...b,[w]:{...(b[w]||{}),start:v}})), `${DAYS_KR[w]} 브레이크 시작`)}<span>~</span>
                  {timeIn(brkEdit[w]?.end, v=>setBrkEdit(b=>({...b,[w]:{...(b[w]||{}),end:v}})), `${DAYS_KR[w]} 브레이크 끝`)}
                  {(brkEdit[w]?.start || brkEdit[w]?.end) && <button type="button" onClick={()=>setBrkEdit(b=>{ const n={...b}; delete n[w]; return n })}
                    style={{background:'none', border:'none', color:T.red, fontSize:12, cursor:'pointer', fontFamily:'inherit'}}>지우기</button>}
                </div>
              ))}
              <div style={{display:'flex', gap:6, marginTop:4}}><Btn kind="primary" onClick={saveBreaks}>저장</Btn><Btn onClick={()=>setBrkEdit(null)}>취소</Btn></div>
            </div>
          ) : (
            <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', margin:'4px 0 12px'}}>
              <span>{Object.entries(cfg?.breaks || DEFAULT_BREAKS).filter(([,v])=>v?.start).map(([w,v])=>`${DAYS_KR[w]} ${v.start}~${v.end}`).join(' · ') || '없음'}</span>
              <Btn onClick={()=>setBrkEdit({ ...(cfg?.breaks || DEFAULT_BREAKS) })}>바꾸기</Btn>
            </div>
          )}
          <div style={{fontWeight:700}}>지각·결근 집계 시작일</div>
          <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', margin:'4px 0 12px'}}>
            <input type="date" value={since || cfg?.since || DEFAULT_SINCE} onChange={e=>setSince(e.target.value)} aria-label="집계 시작일"
              style={{background:'#FFFFFF', border:'1px solid #CBC5BA', borderRadius:4, padding:'4px 6px', fontSize:13, fontFamily:'inherit'}}/>
            {since && <Btn onClick={saveSince}>저장</Btn>}
            <span style={{color:T.sub}}>이 날 전에는 기록이 없어도 결근으로 보지 않아요</span>
          </div>
          <div style={{fontWeight:700}}>2. NFC 태그에 넣을 주소</div>
          <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', margin:'4px 0'}}>
            <code style={{background:'#FFFFFF', border:`1px solid ${T.rule}`, borderRadius:4, padding:'3px 8px', fontSize:13}}>{clockUrl}</code>
            <Btn onClick={()=>{ navigator.clipboard?.writeText(clockUrl); setNote('주소를 복사했어요') }}>복사</Btn>
          </div>
          <div style={{color:T.sub}}>
            NFC 스티커(NTAG213)에 폰 앱 "NFC Tools"로 넣어요: 쓰기 → 레코드 추가 → URL → 위 주소 → 쓰기 → 스티커에 폰 대기.
            직원은 폰 브라우저(아이폰은 Safari)에서 한 번 로그인해 두면, 태그에 댈 때마다 출근·퇴근이 찍혀요.
            예정보다 {GRACE_MIN}분 넘게 일찍 출근하거나 늦게 퇴근한 시간, 예정 없는 날 근무는 여기서 승인해야 근무시간에 들어가요.
          </div>
        </div>
      )}
      {note && <div style={{fontSize:12, color:T.blue, margin:'4px 0'}}>{note}</div>}

      {rows.length === 0 && !showSet && (
        <div style={{fontSize:13, color:T.sub, padding:'10px 0'}}>이 달 출퇴근 기록이 없어요. 처음이면 설정에서 매장 위치를 저장하고 태그를 만들어 주세요.</div>
      )}

      {/* 승인 대기 */}
      {pending.map(r=>{
        const inD = toDate(r.rec.in), outD = toDate(r.rec.out)
        const items = [
          r.c.early && r.rec.earlyOk == null && ['earlyOk', `예정 ${r.rec.schedStart}보다 ${minsLabel(r.c.early)} 일찍 출근 (${hm(inD)})`],
          r.c.late && r.rec.lateOk == null && ['lateOk', `예정 ${r.rec.schedEnd}보다 ${minsLabel(r.c.late)} 늦게 퇴근 (${hm(outD)})`],
          r.c.unsched && r.rec.unschedOk == null && ['unschedOk', `예정 없는 날 근무 ${hm(inD)}~${hm(outD)} (${minsLabel(r.c.unsched)})`],
        ].filter(Boolean)
        return (
          <div key={'p'+r.uid+r.dd} style={{borderLeft:`4px solid ${T.amber}`, background:'#B4530910', borderRadius:'0 4px 4px 0', padding:'8px 12px', marginTop:6}}>
            <div style={{fontSize:13, fontWeight:700}}>{+r.dd}일 ({dow(r.dd)}) {name(r.uid)} <span style={{fontWeight:400, color:T.sub}}>· 지금 인정 {minsLabel(r.c.total)}</span></div>
            {items.map(([field, text])=>(
              <div key={field} style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginTop:4, fontSize:13}}>
                <span style={{flex:1, minWidth:200}}>{text}</span>
                <Btn kind="ok" onClick={()=>decide(r, field, true)} disabled={busy}>인정</Btn>
                <Btn kind="danger" onClick={()=>decide(r, field, false)} disabled={busy}>인정 안 함</Btn>
              </div>
            ))}
          </div>
        )
      })}

      {/* 날짜별 브레이크: 평일처럼 그날그날 정하는 날 */}
      {(() => {
        const t = new Date(), tds = `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}`
        const cur = breakFor(cfg, t)
        return (
          <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', fontSize:13, marginTop:10}}>
            <b>브레이크</b>
            {dayBrk ? <>
              <input type="date" value={dayBrk.date} onChange={e=>setDayBrk(d=>({...d,date:e.target.value}))} aria-label="날짜"
                style={{background:'#FFFFFF', border:'1px solid #CBC5BA', borderRadius:4, padding:'4px 6px', fontSize:13, fontFamily:'inherit'}}/>
              {timeIn(dayBrk.start, v=>setDayBrk(d=>({...d,start:v})), '브레이크 시작')}<span>~</span>{timeIn(dayBrk.end, v=>setDayBrk(d=>({...d,end:v})), '브레이크 끝')}
              <Btn kind="primary" onClick={()=>saveDayBreak(false)} disabled={busy}>저장</Btn>
              <Btn onClick={()=>saveDayBreak(true)} disabled={busy}>그날 브레이크 없음</Btn>
              <Btn onClick={()=>setDayBrk(null)}>취소</Btn>
            </> : <>
              <span style={{color:T.sub}}>오늘 {cur ? `${cur.start}~${cur.end}` : '없음'}</span>
              <Btn onClick={()=>setDayBrk({ date:tds, start:cur?.start||'', end:cur?.end||'' })}>날짜별 브레이크 정하기</Btn>
            </>}
          </div>
        )
      })()}

      {/* 지금 근무 중 · 퇴근 안 찍은 기록 */}
      {working.length > 0 && (
        <div style={{fontSize:13, marginTop:10}}>
          <span style={{color:T.sub}}>지금 근무 중 </span>
          {working.map(r=><span key={r.uid} style={{marginRight:12}}><b>{name(r.uid)}</b> <span style={{...num, color:T.sub}}>{hm(toDate(r.rec.in))}~</span></span>)}
        </div>
      )}
      {noOut.length > 0 && (
        <div style={{marginTop:10}}>
          <div style={{fontSize:12, fontWeight:700, color:T.red}}>퇴근을 안 찍은 기록 · 수정에서 퇴근 시각을 넣어 주세요</div>
          {noOut.map(recLine)}
        </div>
      )}

      {/* 이 달 근태: 지각·조퇴·결근, 개근 */}
      {stats.length > 0 && (
        <div style={{marginTop:14}}>
          <div style={{fontSize:12, fontWeight:700, color:T.sub, padding:'4px 0', borderBottom:`1px solid ${T.rule}`}}>
            이 달 근태 <span style={{fontWeight:400}}>· 지각·조퇴는 예정보다 1분이라도 늦거나 이르면, 결근은 예정일에 출근 기록이 없으면 (이름을 누르면 날짜별로 보여요)</span>
          </div>
          {stats.map(({ u, st }) => {
            const c = st.cnt, open = openUid === u.uid
            return (
              <div key={u.uid} style={{borderBottom:`1px solid ${T.soft}`}}>
                <div onClick={()=>setOpenUid(open ? null : u.uid)} style={{display:'flex', alignItems:'baseline', gap:10, padding:'7px 0', fontSize:13, cursor:'pointer', flexWrap:'wrap'}}>
                  <b style={{minWidth:56}}>{u.name}</b>
                  <span style={{...num, color:T.sub}}>출근 {c.worked}일</span>
                  <span style={{...num, color: c.late ? T.red : T.sub}}>지각 {c.late}회{c.late ? ` (${minsLabel(c.lateMins)})` : ''}</span>
                  <span style={{...num, color: c.leftEarly ? T.red : T.sub}}>조퇴 {c.leftEarly}회{c.leftEarly ? ` (${minsLabel(c.leftEarlyMins)})` : ''}</span>
                  <span style={{...num, color: c.absent ? T.red : T.sub}}>결근 {c.absent}일</span>
                  {c.noOut > 0 && <span style={{color:T.amber}}>퇴근 미기록 {c.noOut}</span>}
                  <span style={{flex:1}}/>
                  {st.perfect && <span style={{fontSize:12, fontWeight:800, color:T.green}}>{st.monthOver ? '개근' : '개근 중'}</span>}
                </div>
                {open && (
                  <div style={{padding:'0 0 8px 12px'}}>
                    {st.days.filter(d=>d.late || d.leftEarly || d.absent || d.excused || d.noOut).length === 0 && <div style={{fontSize:12, color:T.sub}}>지각·조퇴·결근 없음</div>}
                    {st.days.filter(d=>d.late || d.leftEarly || d.absent || d.excused || d.noOut).map(d => (
                      <div key={d.dd} style={{display:'flex', alignItems:'center', gap:10, fontSize:12, padding:'3px 0', flexWrap:'wrap'}}>
                        <span style={{...num, color:T.sub, minWidth:62}}>{+d.dd}일 ({dow(d.dd)})</span>
                        {d.sched && <span style={{color:T.sub}}>예정 {d.sched.start}~{d.sched.end}</span>}
                        {d.rec?.in && <span style={{...num}}>{hm(toDate(d.rec.in))} ~ {d.rec.out ? hm(toDate(d.rec.out)) : '—'}</span>}
                        {d.late > 0 && <b style={{color:T.red}}>지각 {minsLabel(d.late)}</b>}
                        {d.leftEarly > 0 && <b style={{color:T.red}}>조퇴 {minsLabel(d.leftEarly)}</b>}
                        {d.noOut && <b style={{color:T.amber}}>퇴근 미기록</b>}
                        {d.absent && <><b style={{color:T.red}}>결근</b><Btn onClick={()=>setExcused(u.uid, d.dd, true)} disabled={busy}>결근 아님</Btn></>}
                        {d.excused && <><span style={{color:T.sub}}>결근 아님(사유 있음)</span><Btn onClick={()=>setExcused(u.uid, d.dd, false)} disabled={busy}>결근으로 되돌리기</Btn></>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          {/* 개근 포상 */}
          <div style={{marginTop:10, fontSize:13, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
            <b>개근 포상</b>
            {reward?.list ? (
              <span>{reward.list.map(r=>`${r.name} ${r.prize}${r.paid ? ' (상여 지급)' : ''}`).join(' · ')}</span>
            ) : !monthOver ? (
              <span style={{color:T.sub}}>이 달이 끝나면 개근한 직원끼리 게임을 할 수 있어요{perfectList.length ? ` · 지금까지 개근 ${perfectList.map(x=>x.u.name).join(', ')}` : ''}</span>
            ) : perfectList.length ? (
              <><span>개근 {perfectList.map(x=>x.u.name).join(', ')}</span><Btn kind="primary" onClick={()=>setShowGame(true)}>포상 게임 하기</Btn></>
            ) : <span style={{color:T.sub}}>이 달 개근한 직원이 없어요</span>}
          </div>
        </div>
      )}
      {showGame && <RewardGame ym={curMonth} people={perfectList.map(x=>({ uid:x.u.uid, name:x.u.name }))}
        onClose={()=>setShowGame(false)} onSaved={()=>{ load(false); onApplied?.() }}/>}

      {rows.length > 0 && (
        <div style={{marginTop:10}}>
          {link(showAll ? '이 달 기록 접기' : `이 달 출퇴근 기록 ${rows.length}건 보기`, ()=>setShowAll(v=>!v))}
          {showAll && <div style={{marginTop:6}}>{rows.map(recLine)}</div>}
        </div>
      )}
    </section>
  )
}
