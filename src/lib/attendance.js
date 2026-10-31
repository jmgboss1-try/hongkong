import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'

// NFC 출퇴근
// attendance/{YYYY-MM} → { [uid]: { [dd]: { in, out (Timestamp), schedStart, schedEnd ('HH:MM'|null),
//   name, inDist, outDist, earlyOk, lateOk, unschedOk (true|false|undefined = 아직 안 정함), appliedMins } } }
// attendance/_config → { lat, lng, radius, since }  매장 위치 (사장님이 매장에서 저장), 지각·결근 집계 시작일
// 결근인데 사유가 있으면 기록에 { excused:true, excuseNote } (출근 기록 없이)
// 찍힌 시간은 workhours(시간)·workextra(분)에 그날 근무시간으로 들어감

export const GRACE_MIN = 10      // 예정보다 이만큼 넘게 일찍 오거나 늦게 퇴근하면 사장님 승인 필요
export const DEFAULT_RADIUS = 150 // 매장에서 이 거리(m) 안에서만 찍힘
export const DEFAULT_SINCE = '2026-11-01' // NFC 출퇴근을 쓰기 시작한 날: 이전 날짜는 결근·지각을 따지지 않음
const CLOSED_DOW = 0 // 일요일 휴무 (체크리스트와 같음)

export const pad = n => String(n).padStart(2,'0')
export const ymOf = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}`
export const ddOf = d => pad(d.getDate())
export const hm = d => d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '—'
export const toDate = t => !t ? null : t.toDate ? t.toDate() : new Date(t)
const toMin = s => { if(!s) return null; const [h,m] = s.split(':').map(Number); return h*60 + (m||0) }
export const minsLabel = m => m >= 60 ? `${Math.floor(m/60)}시간${m%60 ? ` ${m%60}분` : ''}` : `${m}분`

// 이 날(요일)의 예정 출퇴근 시각 — 인원관리에서 요일별로 넣은 shiftTimes {요일번호: {start, end}}
export function shiftFor(userData, date) {
  const s = userData?.shiftTimes?.[date.getDay()]
  return s?.start && s?.end ? { start:s.start, end:s.end } : null
}

// ── 브레이크 ──
// 기본: 요일별 매장 브레이크 _config.breaks {요일: {start,end}} (없으면 토요일 14:30~16:30)
// 그날만: _config.breakDates {'YYYY-MM-DD': {start,end} | {none:true}} (평일처럼 유동적인 날)
// 출근할 때 그날 브레이크를 기록에 복사(breakStart/breakEnd)하고, 사장님이 기록마다 바꾸거나 noBreak(못 쉼)로 할 수 있음
export const DEFAULT_BREAKS = { 6: { start:'14:30', end:'16:30' } }
export function breakFor(cfg, date) {
  const ds = `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`
  const day = cfg?.breakDates?.[ds]
  if (day) return day.none ? null : (day.start && day.end ? { start:day.start, end:day.end } : null)
  const w = (cfg?.breaks || DEFAULT_BREAKS)[date.getDay()]
  return w?.start && w?.end ? { start:w.start, end:w.end } : null
}
// 이 근무에 자동으로 붙일 브레이크: 예정 근무가 브레이크 시간을 통째로 포함할 때만 (풀타임). 일부만 걸치는 근무는 사장님이 기록에서 넣음
export function breakForShift(cfg, date, shift) {
  const br = breakFor(cfg, date)
  if (!br || !shift) return null
  const S = toMin(shift.start), B0 = toMin(br.start), B1 = toMin(br.end)
  let E = toMin(shift.end); if (E <= S) E += 1440
  return S <= B0 && E >= B1 ? br : null
}
export const recBreak = rec => !rec?.noBreak && rec?.breakStart && rec?.breakEnd ? { start:rec.breakStart, end:rec.breakEnd } : null
const overlap = (a0, a1, b0, b1) => Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

// 기록 하나 → 인정 시간 계산 (분)
//  - 예정 출근보다 GRACE_MIN 넘게 일찍 오면 그 시간은 earlyMins (승인해야 인정), 10분 이내면 예정 시각부터
//  - 예정 퇴근보다 GRACE_MIN 넘게 늦게 나가면 lateMins (승인해야 인정), 10분 이내면 예정 시각까지
//  - 예정이 없는 날은 전체가 unschedMins (승인해야 인정)
//  - 브레이크 시간은 인정 시간에서 뺌 (breakMins)
export function calcRecord(rec) {
  const inD = toDate(rec?.in), outD = toDate(rec?.out)
  if (!inD || !outD) return null
  const inM = inD.getHours()*60 + inD.getMinutes()
  let outM = outD.getHours()*60 + outD.getMinutes()
  outM += Math.round((new Date(outD.getFullYear(),outD.getMonth(),outD.getDate()) - new Date(inD.getFullYear(),inD.getMonth(),inD.getDate())) / 86400000) * 1440
  const S = toMin(rec.schedStart)
  let E = toMin(rec.schedEnd)
  if (S != null && E != null && E <= S) E += 1440 // 자정 넘어 끝나는 근무 (예: 18:00~01:00)
  const br = recBreak(rec)
  const B0 = br ? toMin(br.start) : 0, B1 = br ? toMin(br.end) : 0
  const minus = (a, b) => br ? overlap(a, b, B0, B1) : 0 // 이 구간 중 브레이크와 겹친 분
  let base = 0, early = 0, late = 0, unsched = 0, brk = 0
  if (S == null || E == null) {
    unsched = Math.max(0, outM - inM - minus(inM, outM))
    if (rec.unschedOk) brk += minus(inM, outM)
  } else {
    const a = Math.max(inM, S), b = Math.min(outM, E)
    base = Math.max(0, b - a - (b > a ? minus(a, b) : 0))
    brk += b > a ? minus(a, b) : 0
    if (inM < S - GRACE_MIN) { early = S - inM - minus(inM, S); if (rec.earlyOk) brk += minus(inM, S) }
    if (outM > E + GRACE_MIN) { late = outM - E - minus(E, outM); if (rec.lateOk) brk += minus(E, outM) }
  }
  const total = base + (rec.earlyOk ? early : 0) + (rec.lateOk ? late : 0) + (rec.unschedOk ? unsched : 0)
  const pending = (early && rec.earlyOk == null) || (late && rec.lateOk == null) || (unsched && rec.unschedOk == null)
  return { base, early, late, unsched, total, breakMins: brk, pending: !!pending }
}

// 인정 시간을 근무관리(workhours 시간 + workextra 분)에 넣고, 넣은 값을 기록에 남김
export async function applyRecord(ym, uid, dd, rec) {
  const c = calcRecord(rec)
  if (!c) return null
  await setDoc(doc(db,'workhours',ym), { [uid]: { [dd]: Math.floor(c.total/60) } }, { merge:true })
  await setDoc(doc(db,'workextra',ym), { [uid]: { [dd]: c.total % 60 } }, { merge:true })
  await setDoc(doc(db,'attendance',ym), { [uid]: { [dd]: { appliedMins: c.total } } }, { merge:true })
  return c
}

// 두 좌표 사이 거리 (m)
export function distanceM(a, b) {
  const R = 6371000, rad = x => x*Math.PI/180
  const dLat = rad(b.lat-a.lat), dLng = rad(b.lng-a.lng)
  const h = Math.sin(dLat/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLng/2)**2
  return Math.round(2*R*Math.asin(Math.sqrt(h)))
}

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('이 폰에서는 위치를 확인할 수 없어요'))
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat:p.coords.latitude, lng:p.coords.longitude, acc:Math.round(p.coords.accuracy||0) }),
      e => reject(new Error(e.code === 1 ? '위치 권한을 허용해야 출퇴근을 찍을 수 있어요. 브라우저 설정에서 이 사이트의 위치를 허용해 주세요.' : '위치를 확인하지 못했어요. 잠시 후 다시 대 주세요.')),
      { enableHighAccuracy:true, timeout:12000, maximumAge:0 })
  })
}

// ── 지각·조퇴·결근 ──
// 지각: 예정 출근보다 1분이라도 늦게 찍음 / 조퇴: 예정 퇴근보다 1분이라도 일찍 찍음
// 결근: 예정 출퇴근 시각이 있는 날인데 출근 기록이 없음 (일요일·임시휴무, 대타로 빠진 날, 사장님이 '결근 아님'으로 한 날, 집계 시작일 전은 제외)
const minsOfDay = d => d.getHours()*60 + d.getMinutes()

export function dayStatus(rec, sched) {
  const inD = toDate(rec?.in), outD = toDate(rec?.out)
  const S = toMin(sched?.start)
  let E = toMin(sched?.end)
  if (S != null && E != null && E <= S) E += 1440
  let late = 0, leftEarly = 0
  if (inD && S != null && minsOfDay(inD) > S) late = minsOfDay(inD) - S
  if (inD && outD && E != null) {
    let outM = minsOfDay(outD) + Math.round((new Date(outD.getFullYear(),outD.getMonth(),outD.getDate()) - new Date(inD.getFullYear(),inD.getMonth(),inD.getDate())) / 86400000) * 1440
    if (outM < E) leftEarly = E - outM
  }
  return { late, leftEarly }
}

// 한 직원의 한 달: 날짜별 상태와 합계, 개근 여부
//  user: users 문서 (shiftTimes, joinDate) / recs: attendance/{ym}[uid] / holidays: checklist/holidays.list / subs: substitutes/requests.list
//  plan: schedule/{ym} 문서 (근무표에서 직접 바꾼 날, 일찍 마감)
export function monthStatus({ ym, uid, user, recs, holidays, subs, plan, since = DEFAULT_SINCE, now = new Date() }) {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
  const days = []
  const cnt = { worked:0, late:0, lateMins:0, leftEarly:0, leftEarlyMins:0, absent:0, noOut:0, scheduled:0 }
  for (let d = 1; d <= last; d++) {
    const dd = pad(d), dateStr = `${ym}-${dd}`, date = new Date(y, m-1, d)
    if (dateStr > todayStr) break
    const rec = recs?.[dd] || null
    const sched = rec?.schedStart ? { start:rec.schedStart, end:rec.schedEnd } : (rec?.in ? null : planFor(user, date, plan, uid))
    const counted = dateStr >= since && (!user?.joinDate || dateStr >= user.joinDate)
    const closed = date.getDay() === CLOSED_DOW || (holidays||[]).some(h => h.startDate <= dateStr && dateStr <= h.endDate)
    const subOut = (subs||[]).some(r => r.requesterUid === uid && r.confirmedUid && r.date === dateStr)
    const st = { dd, dateStr, sched, rec, counted, closed, subOut, late:0, leftEarly:0, absent:false, noOut:false, excused:!!rec?.excused }
    if (rec?.in) {
      Object.assign(st, dayStatus(rec, sched))
      st.noOut = !rec.out && dateStr < todayStr
      if (counted) {
        cnt.worked++
        if (st.late) { cnt.late++; cnt.lateMins += st.late }
        if (st.leftEarly) { cnt.leftEarly++; cnt.leftEarlyMins += st.leftEarly }
        if (st.noOut) cnt.noOut++
      }
    } else if (sched && !closed && !subOut && counted) {
      cnt.scheduled++
      // 오늘은 예정 퇴근 시각이 지나야 결근으로 봄
      const over = dateStr < todayStr || minsOfDay(now) > (toMin(sched.end) <= toMin(sched.start) ? 1440 : toMin(sched.end))
      if (over && !rec?.excused) { st.absent = true; cnt.absent++ }
    }
    if (rec?.in || st.absent || st.excused) days.push(st)
  }
  const monthOver = todayStr > `${ym}-${pad(last)}`
  const perfect = cnt.worked > 0 && !cnt.late && !cnt.leftEarly && !cnt.absent
  return { days, cnt, perfect, monthOver, started: `${ym}-${pad(last)}` >= since }
}

// 한 달 집계에 필요한 문서들 (권한이 없는 문서는 빈 값으로)
export async function loadMonthContext(ym) {
  const safe = p => p.then(s => s.exists() ? s.data() : null).catch(() => null)
  const [att, cfg, hol, subs, plan] = await Promise.all([
    safe(getDoc(doc(db,'attendance',ym))),
    safe(getDoc(doc(db,'attendance','_config'))),
    safe(getDoc(doc(db,'checklist','holidays'))),
    safe(getDoc(doc(db,'substitutes','requests'))),
    safe(getDoc(doc(db,'schedule',ym))),
  ])
  return { att: att || {}, cfg, holidays: hol?.list || [], subs: subs?.list || [], plan, since: cfg?.since || DEFAULT_SINCE }
}

// ── 대타 → 주휴 ──
// 주휴 계산은 빠진 날 비고에 '대타'가 있으면 그 주 주휴를 살려줌. 대타 게시판에서 확정된 날은
// 비고를 안 적어도 '대타'로 본다 (계산용 사본만 바꾸고 저장된 비고는 그대로)
export function withSubMemos(memos, subs, ym) {
  const out = { ...(memos||{}) }
  for (const r of subs||[]) {
    if (!r?.confirmedUid || !r.requesterUid || String(r.date).slice(0,7) !== ym) continue
    const dd = r.date.slice(8,10)
    const cur = out[r.requesterUid]?.[dd] || ''
    if (cur.includes('대타')) continue
    out[r.requesterUid] = { ...(out[r.requesterUid]||{}), [dd]: cur ? `${cur} (대타)` : '대타' }
  }
  return out
}
export const loadSubs = () => getDoc(doc(db,'substitutes','requests')).then(s => s.exists() ? (s.data().list||[]) : []).catch(() => [])

// ── 근무표 (스케쥴 탭에서 주마다 짜는 예정) ──
// schedule/{YYYY-MM} = { shifts: { uid: { dd: {start,end} | {off:true} } }, closeAt: { dd: 'HH:MM' } }
//  - 그날 칸을 직접 넣었으면 그 시간(또는 휴무), 아니면 인원관리의 요일별 기본 패턴(shiftTimes)
//  - 일찍 마감한 날(closeAt)은 그 시각 이후 예정은 잘라냄 (그 전에 끝나는 근무는 그대로, 마감 뒤에 시작하는 근무는 없음)
export function planFor(user, date, plan, uid) {
  const dd = pad(date.getDate())
  const o = plan?.shifts?.[uid || user?.uid]?.[dd]
  let p = o ? (o.off ? null : (o.start && o.end ? { start:o.start, end:o.end, custom:true } : null)) : shiftFor(user, date)
  const close = plan?.closeAt?.[dd]
  if (p && close) {
    const S = toMin(p.start), C = toMin(close)
    let E = toMin(p.end); if (E <= S) E += 1440
    const Cm = C < S ? C + 1440 : C
    if (C <= S && C + 1440 >= E) p = null           // 마감 뒤에 시작하는 근무
    else if (Cm < E) p = { ...p, end: close, cut: true }
  }
  return p
}

// 근무표나 마감 시각을 바꾼 뒤: 그날 이미 찍힌 기록의 예정·브레이크를 새 근무표로 맞추고 근무시간을 다시 계산
export async function reapplyDay(date, { users, plan, cfg }) {
  const ym = `${date.getFullYear()}-${pad(date.getMonth()+1)}`, dd = pad(date.getDate())
  const snap = await getDoc(doc(db,'attendance',ym))
  const att = snap.exists() ? snap.data() : {}
  for (const [uid, days] of Object.entries(att)) {
    const rec = days?.[dd]
    if (!rec?.in) continue
    const user = users.find(u => u.uid === uid)
    const p = planFor(user, date, plan, uid)
    const upd = { schedStart: p?.start || null, schedEnd: p?.end || null }
    if (!rec.editedBreak) {
      const br = p ? breakForShift(cfg, date, p) : null
      Object.assign(upd, br ? { breakStart:br.start, breakEnd:br.end } : { breakStart:null, breakEnd:null })
    }
    if (upd.schedStart === (rec.schedStart||null) && upd.schedEnd === (rec.schedEnd||null) && upd.breakStart === undefined) continue
    await setDoc(doc(db,'attendance',ym), { [uid]: { [dd]: upd } }, { merge:true })
    if (rec.out) await applyRecord(ym, uid, dd, { ...rec, ...upd })
  }
}

// 요일별 기본 패턴으로 하루 평균 근무시간 (브레이크 기본값은 빼고). 패턴이 없으면 null
export function avgHoursFromPattern(shiftTimes, workDays, cfg) {
  const days = (workDays || []).filter(w => shiftTimes?.[w]?.start && shiftTimes?.[w]?.end)
  if (!days.length) return null
  const total = days.reduce((a, w) => {
    const s = shiftTimes[w], S = toMin(s.start); let E = toMin(s.end); if (E <= S) E += 1440
    const br = (cfg?.breaks || DEFAULT_BREAKS)[w]
    const b = br && toMin(br.start) >= S && toMin(br.end) <= E ? toMin(br.end) - toMin(br.start) : 0
    return a + (E - S - b)
  }, 0)
  return Math.round(total / days.length / 60 * 10) / 10
}
