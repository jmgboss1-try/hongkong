import TimePick from './TimePick'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { List, ListItem } from '@astryxdesign/core/List'
import { Banner } from '@astryxdesign/core/Banner'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { TextInput } from '@astryxdesign/core/TextInput'
import { DateInput } from '@astryxdesign/core/DateInput'
import { Selector } from '@astryxdesign/core/Selector'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { AstryxPage, Legacy, LedgerCard } from '../astryx/AstryxPage'
import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, getDocs, collection, setDoc, deleteField, Timestamp } from 'firebase/firestore'
import { DEFAULT_RADIUS, DEFAULT_SINCE, GRACE_MIN, pad, hm, toDate, calcRecord, applyRecord, getPosition, minsLabel, monthStatus, breakFor, breakForShift, recBreak, DEFAULT_BREAKS } from '../lib/attendance'
import RewardGame from './RewardGame'
import RewardPrompt from './RewardPrompt'

// 기록의 '일찍 온 시간 인정' 상태 → 수정 칸 값
const earlyChoice = rec => typeof rec?.earlyAllow === 'number' ? String(rec.earlyAllow) : rec?.earlyOk === true ? 'all' : rec?.earlyOk === false ? 'no' : ''

const DAYS_KR = ['일','월','화','수','목','금','토']

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
  const [practice, setPractice] = useState(false) // 포상 게임 연습 (저장 안 됨)
  const [since, setSince] = useState('')
  const [plan, setPlan] = useState(null)       // schedule/{달} 근무표
  const [brkEdit, setBrkEdit] = useState(null)   // 요일별 브레이크 편집 {요일: {start,end}}
  const [dayBrk, setDayBrk] = useState(null)     // 날짜별 브레이크 편집 { date, start, end }

  async function load(sync) {
    try {
      const opt = p => p.then(x => x.exists() ? x.data() : null).catch(() => null)
      const [aSnap, cSnap, uSnap, hol, sub, rw, pl] = await Promise.all([
        getDoc(doc(db,'attendance',curMonth)), getDoc(doc(db,'attendance','_config')), getDocs(collection(db,'users')),
        opt(getDoc(doc(db,'checklist','holidays'))), opt(getDoc(doc(db,'substitutes','requests'))), opt(getDoc(doc(db,'rewards',curMonth))), opt(getDoc(doc(db,'schedule',curMonth))),
      ])
      let a = aSnap.exists() ? aSnap.data() : {}
      // 사장님·매장계정·투자자 기록은 근무관리에서 빼고 근무시간에도 반영하지 않음 (사장님이 출퇴근 화면을 열었던 기록 등)
      const skip = new Set()
      uSnap.forEach(d => { if (['owner','store','investor'].includes(d.data().role)) skip.add(d.id) })
      a = Object.fromEntries(Object.entries(a).filter(([uid]) => !skip.has(uid)))
      setCfg(cSnap.exists() ? cSnap.data() : null)
      const list = []
      uSnap.forEach(d => { const u = d.data(); if (u.status==='approved' && !['owner','store','investor'].includes(u.role)) list.push({ uid:d.id, ...u }) })
      setStaff(list.sort((x,y)=>(x.joinDate||'').localeCompare(y.joinDate||'')))
      setHolidays(hol?.list || []); setSubs(sub?.list || []); setReward(rw); setPlan(pl)
      if (sync) {
        // 직원 폰에서 근무시간 반영이 안 됐거나(권한) 승인 상태가 바뀐 기록을 근무관리에 맞춤
        let changed = false
        for (const [uid, days] of Object.entries(a)) for (const [dd, rec] of Object.entries(days||{})) {
          const c = calcRecord(rec)
          if (c && c.total !== rec.appliedMins) { await applyRecord(curMonth, uid, dd, rec); changed = true }
        }
        if (changed) {
          const s = await getDoc(doc(db,'attendance',curMonth)); a = Object.fromEntries(Object.entries(s.exists() ? s.data() : {}).filter(([uid]) => !skip.has(uid)))
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

  // 일찍 출근 일부만 인정 (분)
  async function decideEarly(r, mins) {
    setBusy(true)
    try {
      await setDoc(doc(db,'attendance',curMonth), { [r.uid]: { [r.dd]: { earlyAllow: mins } } }, { merge:true })
      await applyRecord(curMonth, r.uid, r.dd, { ...r.rec, earlyAllow: mins })
      await load(false); onApplied?.()
    } catch(e) { console.error(e); alert('저장하지 못했어요. 다시 시도해 주세요.') }
    setBusy(false)
  }
  // 이 분 이내로 일찍 온 건 그냥 예정 시각부터 (승인 대기 없음)
  async function saveEarlyGrace(v) {
    const c = { ...(cfg||{}), earlyGrace: v }
    await setDoc(doc(db,'attendance','_config'), c); setCfg(c); setNote(`예정보다 ${v}분 넘게 일찍 오면 승인 대기로 떠요 (앞으로 찍는 출근부터)`)
  }
  // 매장 기본 '일찍 출근 자동 인정' 분
  async function saveEarlyAuto(v) {
    const c = { ...(cfg||{}), earlyAuto: v }
    await setDoc(doc(db,'attendance','_config'), c); setCfg(c); setNote(v ? `예정보다 ${v}분까지 일찍 온 시간은 바로 인정해요 (앞으로 찍는 출근부터, 직원별 설정이 있으면 그게 먼저)` : '일찍 온 시간은 사장님이 승인해야 인정돼요')
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
      // 일찍 온 시간 인정: '' = 자동(그날 자동 인정 분만, 넘는 건 승인 대기) / 'all' = 전부 / 'no' = 자동만 / 숫자 = 그 분만큼
      const ea = edit.earlyAllow ?? ''
      const earlyFields = ea === 'all' ? { earlyOk:true, earlyAllow:null } : ea === 'no' ? { earlyOk:false, earlyAllow:null } : ea === '' ? { earlyOk:null, earlyAllow:null } : { earlyOk:null, earlyAllow:+ea }
      const rec = { ...(att[uid]?.[dd]||{}), in: Timestamp.fromDate(inD), ...(outD ? { out: Timestamp.fromDate(outD) } : {}), ...brk, earlyLeave: !!edit.earlyLeave, ...earlyFields }
      const earlyWrite = Object.fromEntries(Object.entries(earlyFields).map(([k, v]) => [k, v == null ? deleteField() : v]))
      await setDoc(doc(db,'attendance',curMonth), { [uid]: { [dd]: { in: rec.in, out: outD ? rec.out : deleteField(), editedByOwner: true, earlyLeave: !!edit.earlyLeave, ...(brkChanged ? { editedBreak: true } : {}), ...brk, ...earlyWrite } } }, { merge:true })
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
    .map(u => ({ u, st: monthStatus({ ym:curMonth, uid:u.uid, user:u, recs:att[u.uid], holidays, subs, plan, since: cfg?.since || DEFAULT_SINCE }) }))
  const perfectList = stats.filter(x => x.st.perfect)
  const monthOver = stats[0]?.st.monthOver ?? (curMonth < `${now.getFullYear()}-${pad(now.getMonth()+1)}`)

  const clockUrl = `${window.location.origin}/clock`
  // 시각 고르기: 아이폰 시간 칸은 지우거나 고치기가 불편해서 시·분 선택 (찍은 시각을 고치므로 1분 단위, 0~23시)
  const timeIn = (v, set, label) => <Legacy><TimePick value={v||''} onChange={set} label={label} step={1} allHours width={128}/></Legacy>
  const openEdit = r => setEdit({ uid:r.uid, dd:r.dd, in:hm(toDate(r.rec.in)), out: r.rec.out ? hm(toDate(r.rec.out)) : '', bStart:r.rec.breakStart||'', bEnd:r.rec.breakEnd||'', noBreak:!!r.rec.noBreak, earlyLeave:!!r.rec.earlyLeave, earlyAllow: earlyChoice(r.rec) })
  const recLine = r => {
    const inD = toDate(r.rec.in), outD = toDate(r.rec.out)
    const isEdit = edit && edit.uid===r.uid && edit.dd===r.dd
    return (
      <ListItem key={r.uid+r.dd} align="start"
        label={<HStack gap={2} vAlign="center" wrap="wrap">
          <Text color="secondary" hasTabularNumbers>{+r.dd}일 ({dow(r.dd)})</Text>
          <Text weight="bold">{name(r.uid)}</Text>
          {!isEdit && <Text hasTabularNumbers>{hm(inD)} ~ {outD ? hm(outD) : ''}</Text>}
          {!isEdit && !outD && <Badge variant="error" label="퇴근 안 찍음"/>}
        </HStack>}
        description={isEdit ? (
          <VStack gap={2}>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Text type="label">출퇴근</Text>{timeIn(edit.in, v=>setEdit(e=>({...e,in:v})), '출근')}<Text>~</Text>{timeIn(edit.out, v=>setEdit(e=>({...e,out:v})), '퇴근')}
            </HStack>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Text type="label">브레이크</Text>
              {timeIn(edit.bStart, v=>setEdit(e=>({...e,bStart:v,noBreak:false})), '브레이크 시작')}<Text>~</Text>{timeIn(edit.bEnd, v=>setEdit(e=>({...e,bEnd:v,noBreak:false})), '브레이크 끝')}
              <CheckboxInput label="못 쉼" value={!!edit.noBreak} onChange={v=>setEdit(x=>({...x,noBreak:v}))}/>
            </HStack>
            <HStack gap={3} vAlign="end" wrap="wrap">
              {r.rec.schedStart && (
                <Selector label="일찍 온 시간" size="sm" value={String(edit.earlyAllow ?? '')} onChange={v=>setEdit(x=>({...x, earlyAllow: v ?? ''}))}
                  options={[{ value:'', label:`자동${r.rec.earlyAuto ? ` (${r.rec.earlyAuto}분까지)` : ''}` }, { value:'all', label:'전부 인정' },
                    ...[10,15,20,30,40,60].map(m => ({ value:String(m), label:`${m}분만 인정` })), { value:'no', label:`인정 안 함${r.rec.earlyAuto ? ' (자동분만)' : ''}` }]}/>
              )}
              <CheckboxInput label="조퇴 (개근에서 빠져요)" value={!!edit.earlyLeave} onChange={v=>setEdit(x=>({...x,earlyLeave:v}))}/>
              <Button size="sm" variant="primary" label="저장" isDisabled={busy} onClick={saveEdit}/>
              <Button size="sm" label="취소" onClick={()=>setEdit(null)}/>
            </HStack>
          </VStack>
        ) : (
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Text type="supporting" color="secondary">{r.rec.schedStart ? `예정 ${r.rec.schedStart}~${r.rec.schedEnd||''}` : '예정 없음'}</Text>
            {r.rec.earlyLeave && <Badge variant="error" label="조퇴"/>}
            {r.c?.early > 0 && <Text type="supporting" color="secondary">일찍 {r.c.early}분 중 {r.c.earlyCounted}분 인정</Text>}
            {recBreak(r.rec) && <Text type="supporting" color="secondary">브레이크 {r.rec.breakStart}~{r.rec.breakEnd}</Text>}
            {r.rec.noBreak && <Badge variant="warning" label="브레이크 못 쉼"/>}
          </HStack>
        )}
        endContent={!isEdit && <HStack gap={1} vAlign="center">
          {r.c && <Text weight="bold" hasTabularNumbers>{minsLabel(r.c.total)}</Text>}
          {r.c?.pending && <Badge variant="warning" label="승인 대기"/>}
          <Button size="sm" variant="ghost" label="수정" onClick={()=>openEdit(r)}/>
          <Button size="sm" variant="ghost" label="삭제" onClick={()=>remove(r)}/>
        </HStack>}/>
    )
  }

  return (
    <AstryxPage>
    <LedgerCard title="NFC 출퇴근" right={<>
      {pending.length > 0 ? <Badge variant="warning" label={`승인 대기 ${pending.length}건`}/> : rows.length > 0 && <Text type="supporting" color="secondary">승인 대기 없음</Text>}
      <Button size="sm" label={showSet ? '설정 닫기' : '설정 (매장 위치·태그 주소)'} onClick={()=>setShowSet(v=>!v)}/>
    </>}>
      {showSet && (
        <Card variant="muted" padding={3}>
          <VStack gap={4}>
            <VStack gap={2}>
              <Heading level={5}>1. 매장 위치</Heading>
              <Text type="supporting" color="secondary">{cfg?.lat != null ? `저장됨 · 매장에서 ${cfg.radius || DEFAULT_RADIUS}m 안에서만 찍혀요` : '아직 없어요. 매장 안에서 아래 버튼을 눌러 주세요. 없으면 어디서든 찍혀요.'}</Text>
              <HStack gap={2} vAlign="end" wrap="wrap">
                <Button variant="primary" label="지금 이 기기 위치를 매장으로 저장" isDisabled={busy} onClick={saveStoreLocation}/>
                <TextInput label="범위 (m)" inputMode="numeric" width={100} value={radius} placeholder={String(cfg?.radius || DEFAULT_RADIUS)} onChange={v=>setRadius(v.replace(/[^0-9]/g,''))}/>
                {cfg && radius && <Button label="범위 저장" onClick={saveRadius}/>}
              </HStack>
            </VStack>
            <VStack gap={2}>
              <Heading level={5}>요일별 매장 브레이크</Heading>
              <Text type="supporting" color="secondary">이 시간을 통째로 포함하는 근무(풀타임)는 근무시간에서 자동으로 빠져요. 평일처럼 그때그때 다른 날은 비워 두고 아래 "날짜별 브레이크"에서 정해요.</Text>
              {brkEdit ? (
                <VStack gap={1}>
                  {[1,2,3,4,5,6,0].map(w => (
                    <HStack key={w} gap={2} vAlign="center">
                      <Text weight="bold">{DAYS_KR[w]}</Text>
                      {timeIn(brkEdit[w]?.start, v=>setBrkEdit(b=>({...b,[w]:{...(b[w]||{}),start:v}})), `${DAYS_KR[w]} 브레이크 시작`)}<Text>~</Text>
                      {timeIn(brkEdit[w]?.end, v=>setBrkEdit(b=>({...b,[w]:{...(b[w]||{}),end:v}})), `${DAYS_KR[w]} 브레이크 끝`)}
                      {(brkEdit[w]?.start || brkEdit[w]?.end) && <Button size="sm" variant="ghost" label="지우기" onClick={()=>setBrkEdit(b=>{ const n={...b}; delete n[w]; return n })}/>}
                    </HStack>
                  ))}
                  <HStack gap={2}><Button size="sm" variant="primary" label="저장" onClick={saveBreaks}/><Button size="sm" label="취소" onClick={()=>setBrkEdit(null)}/></HStack>
                </VStack>
              ) : (
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Text>{Object.entries(cfg?.breaks || DEFAULT_BREAKS).filter(([,v])=>v?.start).map(([w,v])=>`${DAYS_KR[w]} ${v.start}~${v.end}`).join(' · ') || '없음'}</Text>
                  <Button size="sm" label="바꾸기" onClick={()=>setBrkEdit({ ...(cfg?.breaks || DEFAULT_BREAKS) })}/>
                </HStack>
              )}
            </VStack>
            <VStack gap={2}>
              <Heading level={5}>지각·결근 집계 시작일</Heading>
              <HStack gap={2} vAlign="end" wrap="wrap">
                <DateInput label="집계 시작일" isLabelHidden value={since || cfg?.since || DEFAULT_SINCE} onChange={v=>setSince(v || '')}/>
                {since && <Button label="저장" onClick={saveSince}/>}
              </HStack>
              <Text type="supporting" color="secondary">이 날 전에는 기록이 없어도 결근으로 보지 않아요</Text>
            </VStack>
            <VStack gap={2}>
              <Heading level={5}>일찍 출근 기준</Heading>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Text>예정보다</Text>
                <Selector label="그냥 예정 시각부터 세는 범위" isLabelHidden size="sm" value={String(cfg?.earlyGrace ?? 10)} onChange={v=>v != null && saveEarlyGrace(+v)}
                  options={[0,5,10,15,20,30,60].map(m => ({ value:String(m), label: m ? `${m}분` : '1분이라도' }))}/>
                <Text>{(cfg?.earlyGrace ?? 10) ? '이내로 일찍 오면 그냥 예정 시각부터 세고, 그보다 일찍 오면 승인 대기' : '일찍 오면 승인 대기'}</Text>
              </HStack>
              <Text type="supporting" color="secondary">
                {(() => { const g = cfg?.earlyGrace ?? 10; const t = m => { const x = 8*60+30 - m; return `${Math.floor(x/60)}:${String(x%60).padStart(2,'0')}` }
                  return g ? `예: 8:30 출근이면 ${t(g)}~8:30에 온 건 8:30부터, ${t(g+1)} 또는 더 일찍 온 건 승인 대기` : '예: 8:30 출근이면 8:29에 와도 승인 대기' })()}
              </Text>
            </VStack>
            <VStack gap={2}>
              <Heading level={5}>일찍 출근 자동 인정 (매장 기본)</Heading>
              <HStack gap={2}>
              <Selector label="일찍 출근 자동 인정" isLabelHidden size="sm" value={String(cfg?.earlyAuto || 0)} onChange={v=>v != null && saveEarlyAuto(+v)}
                options={[{ value:'0', label:'안 함 (사장님이 승인)' }, ...[5,10,15,20,30,40,60].map(m => ({ value:String(m), label:`${m}분까지 바로 인정` }))]}/>
              </HStack>
              <Text type="supporting" color="secondary">예정보다 이만큼까지 일찍 온 시간은 승인 없이 급여에 들어가요. 더 일찍 온 시간은 승인 대기. 직원별로 다르게 하려면 인원관리에서</Text>
            </VStack>
            <VStack gap={2}>
              <Heading level={5}>2. NFC 태그에 넣을 주소</Heading>
              <HStack gap={2} vAlign="end" wrap="wrap">
                <TextInput label="태그 주소" isLabelHidden isReadOnly value={clockUrl} onChange={()=>{}}/>
                <Button label="복사" onClick={()=>{ navigator.clipboard?.writeText(clockUrl); setNote('주소를 복사했어요') }}/>
              </HStack>
              <Text type="supporting" color="secondary">
                NFC 스티커(NTAG213)에 폰 앱 "NFC Tools"로 넣어요: 쓰기 → 레코드 추가 → URL → 위 주소 → 쓰기 → 스티커에 폰 대기.
                직원은 폰 브라우저(아이폰은 Safari)에서 한 번 로그인해 두면, 태그에 댈 때마다 출근·퇴근이 찍혀요.
                예정보다 {GRACE_MIN}분 넘게 일찍 출근하거나 늦게 퇴근한 시간, 예정 없는 날 근무는 여기서 승인해야 근무시간에 들어가요.
              </Text>
            </VStack>
          </VStack>
        </Card>
      )}
      {note && <Text type="supporting" color="secondary">{note}</Text>}

      {rows.length === 0 && !showSet && (
        <Text color="secondary">이 달 출퇴근 기록이 없어요. 처음이면 설정에서 매장 위치를 저장하고 태그를 만들어 주세요.</Text>
      )}

      {/* 지난달 개근 포상 */}
      <RewardPrompt/>

      {/* 승인 대기 */}
      {pending.map(r=>{
        const inD = toDate(r.rec.in), outD = toDate(r.rec.out)
        const items = [
          r.c.early > r.c.earlyCounted && r.rec.earlyOk == null && r.rec.earlyAllow == null && ['earlyOk', `예정 ${r.rec.schedStart}보다 ${minsLabel(r.c.early)} 일찍 출근 (${hm(inD)})${r.c.earlyCounted ? ` · ${r.c.earlyCounted}분은 자동 인정됨` : ''}`],
          r.c.unsched && r.rec.unschedOk == null && ['unschedOk', `예정 없는 날 근무 ${hm(inD)}~${hm(outD)} (${minsLabel(r.c.unsched)})`],
        ].filter(Boolean)
        return (
          <Card key={'p'+r.uid+r.dd} variant="muted" padding={3}>
            <VStack gap={2}>
              <HStack gap={2} vAlign="center" wrap="wrap">
                <Badge variant="warning" label="승인 대기"/>
                <Text weight="bold">{+r.dd}일 ({dow(r.dd)}) {name(r.uid)}</Text>
                <Text type="supporting" color="secondary">지금 인정 {minsLabel(r.c.total)}</Text>
              </HStack>
              {items.map(([field, text])=>(
                <HStack key={field} gap={2} vAlign="center" wrap="wrap">
                  <Text>{text}</Text>
                  <Button size="sm" variant="primary" isDisabled={busy} label={field === 'earlyOk' ? `전부 인정 (${minsLabel(r.c.early)})` : '인정'} onClick={()=>decide(r, field, true)}/>
                  {field === 'earlyOk' && [10,15,20,30,40,60].filter(m => m < r.c.early && m > (r.c.earlyCounted || 0)).map(m => (
                    <Button key={m} size="sm" isDisabled={busy} label={`${m}분만`} onClick={()=>decideEarly(r, m)}/>
                  ))}
                  <Button size="sm" variant="destructive" isDisabled={busy} label={field === 'earlyOk' && r.c.earlyCounted ? `자동 ${r.c.earlyCounted}분만` : '인정 안 함'} onClick={()=>decide(r, field, false)}/>
                </HStack>
              ))}
            </VStack>
          </Card>
        )
      })}

      {/* 날짜별 브레이크: 평일처럼 그날그날 정하는 날 */}
      {(() => {
        const t = new Date(), tds = `${t.getFullYear()}-${pad(t.getMonth()+1)}-${pad(t.getDate())}`
        const cur = breakFor(cfg, t)
        return (
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Text weight="bold">브레이크</Text>
            {dayBrk ? <>
              <DateInput label="날짜" isLabelHidden size="sm" value={dayBrk.date} onChange={v=>setDayBrk(d=>({...d,date:v || d.date}))}/>
              {timeIn(dayBrk.start, v=>setDayBrk(d=>({...d,start:v})), '브레이크 시작')}<Text>~</Text>{timeIn(dayBrk.end, v=>setDayBrk(d=>({...d,end:v})), '브레이크 끝')}
              <Button size="sm" variant="primary" label="저장" isDisabled={busy} onClick={()=>saveDayBreak(false)}/>
              <Button size="sm" label="그날 브레이크 없음" isDisabled={busy} onClick={()=>saveDayBreak(true)}/>
              <Button size="sm" variant="ghost" label="취소" onClick={()=>setDayBrk(null)}/>
            </> : <>
              <Text color="secondary">오늘 {cur ? `${cur.start}~${cur.end}` : '없음'}</Text>
              <Button size="sm" label="날짜별 브레이크 정하기" onClick={()=>setDayBrk({ date:tds, start:cur?.start||'', end:cur?.end||'' })}/>
            </>}
          </HStack>
        )
      })()}

      {/* 지금 근무 중 (수정에서 퇴근 시각을 넣으면 퇴근 처리) */}
      {working.length > 0 && (
        <VStack gap={1}>
          <Heading level={5}>지금 근무 중</Heading>
          <List hasDividers edge="flush">
            {working.map(r => edit && edit.uid===r.uid && edit.dd===r.dd ? recLine(r) : (
              <ListItem key={r.uid} startContent={<StatusDot variant="success" label="근무 중"/>}
                label={<Text weight="bold">{name(r.uid)}</Text>}
                description={<Text type="supporting" color="secondary" hasTabularNumbers>{hm(toDate(r.rec.in))} 출근</Text>}
                endContent={<Button size="sm" variant="ghost" label="수정" onClick={()=>openEdit(r)}/>}/>
            ))}
          </List>
        </VStack>
      )}
      {noOut.length > 0 && (
        <VStack gap={1}>
          <Banner status="warning" title="퇴근을 안 찍은 기록이 있어요" description="수정에서 퇴근 시각을 넣어 주세요."/>
          <List hasDividers edge="flush">{noOut.map(recLine)}</List>
        </VStack>
      )}

      {/* 이 달 근태: 지각·조퇴·결근, 개근 (이름을 누르면 날짜별) */}
      {stats.length > 0 && (
        <VStack gap={2}>
          <Heading level={5}>이 달 근태</Heading>
          <Text type="supporting" color="secondary">지각·조퇴는 예정보다 1분이라도 늦거나 이르면, 결근은 예정일에 출근 기록이 없으면 · 이름을 누르면 날짜별로 보여요</Text>
          <List hasDividers edge="flush">
            {stats.map(({ u, st }) => {
              const c = st.cnt, open = openUid === u.uid
              const bad = st.days.filter(d=>d.late || d.leftEarly || d.absent || d.excused || d.noOut)
              return (
                <ListItem key={u.uid} align="start" onClick={()=>setOpenUid(open ? null : u.uid)} label={<Text weight="bold">{u.name}</Text>}
                  description={<VStack gap={1}>
                    <Text type="supporting" color={c.late || c.leftEarly || c.absent ? 'accent' : 'secondary'} hasTabularNumbers>
                      출근 {c.worked}일 · 지각 {c.late}회{c.late ? ` (${minsLabel(c.lateMins)})` : ''} · 조퇴 {c.leftEarly}회 · 결근 {c.absent}일{c.noOut > 0 ? ` · 퇴근 미기록 ${c.noOut}` : ''}
                    </Text>
                    {open && (bad.length === 0 ? <Text type="supporting" color="secondary">지각·조퇴·결근 없음</Text> : bad.map(d => (
                      <HStack key={d.dd} gap={2} vAlign="center" wrap="wrap">
                        <Text type="supporting" color="secondary" hasTabularNumbers>{+d.dd}일 ({dow(d.dd)})</Text>
                        {d.sched && <Text type="supporting" color="secondary">예정 {d.sched.start}~{d.sched.end||''}</Text>}
                        {d.rec?.in && <Text type="supporting" hasTabularNumbers>{hm(toDate(d.rec.in))} ~ {d.rec.out ? hm(toDate(d.rec.out)) : '—'}</Text>}
                        {d.late > 0 && <Badge variant="error" label={`지각 ${minsLabel(d.late)}`}/>}
                        {d.leftEarly > 0 && <Badge variant="error" label="조퇴"/>}
                        {d.noOut && <Badge variant="warning" label="퇴근 미기록"/>}
                        {d.absent && <><Badge variant="error" label="결근"/><Button size="sm" isDisabled={busy} label="결근 아님" onClick={()=>setExcused(u.uid, d.dd, true)}/></>}
                        {d.excused && <><Text type="supporting" color="secondary">결근 아님(사유 있음)</Text><Button size="sm" isDisabled={busy} label="결근으로 되돌리기" onClick={()=>setExcused(u.uid, d.dd, false)}/></>}
                      </HStack>
                    )))}
                  </VStack>}
                  endContent={st.perfect && <Badge variant="success" label={st.monthOver ? '개근' : '개근 중'}/>}/>
              )
            })}
          </List>

          {/* 개근 포상 */}
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Text weight="bold">개근 포상</Text>
            {reward?.list ? (
              <Text>{reward.list.map(r=>`${r.name} ${r.prize}${r.paid ? ' (상여 지급)' : ''}`).join(' · ')}</Text>
            ) : !monthOver ? (
              <Text type="supporting" color="secondary">이 달이 끝나면 개근한 직원끼리 게임을 할 수 있어요{perfectList.length ? ` · 지금까지 개근 ${perfectList.map(x=>x.u.name).join(', ')}` : ''}</Text>
            ) : perfectList.length ? (
              <><Text>개근 {perfectList.map(x=>x.u.name).join(', ')}</Text><Button size="sm" variant="primary" label="포상 게임 하기" onClick={()=>setShowGame(true)}/></>
            ) : <Text type="supporting" color="secondary">이 달 개근한 직원이 없어요</Text>}
            <Button size="sm" variant="ghost" label="연습해 보기" onClick={()=>setPractice(true)}/>
          </HStack>
        </VStack>
      )}
      <Legacy>
      {showGame && <RewardGame ym={curMonth} people={perfectList.map(x=>({ uid:x.u.uid, name:x.u.name }))}
        onClose={()=>setShowGame(false)} onSaved={()=>{ load(false); onApplied?.() }}/>}
      {practice && <RewardGame ym={curMonth} practice people={staff.map(u=>({ uid:u.uid, name:u.name }))} onClose={()=>setPractice(false)}/>}

      </Legacy>

      {rows.length > 0 && <>
        <Button size="sm" variant="ghost" label={showAll ? '이 달 기록 접기' : `이 달 출퇴근 기록 ${rows.length}건 보기`} onClick={()=>setShowAll(v=>!v)}/>
        {showAll && <List hasDividers edge="flush">{rows.map(recLine)}</List>}
      </>}
    </LedgerCard>
    </AstryxPage>
  )
}
