import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, deleteField, Timestamp } from 'firebase/firestore'
import { DEFAULT_RADIUS, GRACE_MIN, pad, hm, toDate, calcRecord, applyRecord, getPosition, minsLabel } from '../lib/attendance'

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

  async function load(sync) {
    try {
      const [aSnap, cSnap] = await Promise.all([getDoc(doc(db,'attendance',curMonth)), getDoc(doc(db,'attendance','_config'))])
      let a = aSnap.exists() ? aSnap.data() : {}
      setCfg(cSnap.exists() ? cSnap.data() : null)
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
    const at = (s, plusDay) => { const [h,m] = s.split(':').map(Number); return new Date(cy, cm-1, +dd + (plusDay?1:0), h, m) }
    const inD = at(edit.in)
    const outD = edit.out ? at(edit.out, edit.out < edit.in) : null
    setBusy(true)
    try {
      const rec = { ...(att[uid]?.[dd]||{}), in: Timestamp.fromDate(inD), ...(outD ? { out: Timestamp.fromDate(outD) } : {}) }
      await setDoc(doc(db,'attendance',curMonth), { [uid]: { [dd]: { in: rec.in, out: outD ? rec.out : deleteField(), editedByOwner: true } } }, { merge:true })
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
            <Btn kind="primary" onClick={saveEdit} disabled={busy}>저장</Btn>
            <Btn onClick={()=>setEdit(null)}>취소</Btn>
          </>
        ) : (
          <>
            <span style={{...num}}>{hm(inD)} ~ {outD ? hm(outD) : <span style={{color:T.red}}>퇴근 안 찍음</span>}</span>
            <span style={{color:T.sub, fontSize:12}}>{r.rec.schedStart ? `예정 ${r.rec.schedStart}~${r.rec.schedEnd}` : '예정 없음'}</span>
            <span style={{flex:1}}/>
            {r.c && <span style={{...num, fontWeight:600}}>{minsLabel(r.c.total)}</span>}
            {r.c?.pending && <span style={{color:T.amber, fontSize:12, fontWeight:700}}>승인 대기</span>}
            <button type="button" onClick={()=>setEdit({ uid:r.uid, dd:r.dd, in:hm(inD), out: outD ? hm(outD) : '' })}
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

      {rows.length > 0 && (
        <div style={{marginTop:10}}>
          {link(showAll ? '이 달 기록 접기' : `이 달 출퇴근 기록 ${rows.length}건 보기`, ()=>setShowAll(v=>!v))}
          {showAll && <div style={{marginTop:6}}>{rows.map(recLine)}</div>}
        </div>
      )}
    </section>
  )
}
