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

// 기록 하나 → 인정 시간 계산 (분)
//  - 예정 출근보다 GRACE_MIN 넘게 일찍 오면 그 시간은 earlyMins (승인해야 인정), 10분 이내면 예정 시각부터
//  - 예정 퇴근보다 GRACE_MIN 넘게 늦게 나가면 lateMins (승인해야 인정), 10분 이내면 예정 시각까지
//  - 예정이 없는 날은 전체가 unschedMins (승인해야 인정)
export function calcRecord(rec) {
  const inD = toDate(rec?.in), outD = toDate(rec?.out)
  if (!inD || !outD) return null
  const inM = inD.getHours()*60 + inD.getMinutes()
  let outM = outD.getHours()*60 + outD.getMinutes()
  outM += Math.round((new Date(outD.getFullYear(),outD.getMonth(),outD.getDate()) - new Date(inD.getFullYear(),inD.getMonth(),inD.getDate())) / 86400000) * 1440
  const S = toMin(rec.schedStart)
  let E = toMin(rec.schedEnd)
  if (S != null && E != null && E <= S) E += 1440 // 자정 넘어 끝나는 근무 (예: 18:00~01:00)
  let base = 0, early = 0, late = 0, unsched = 0
  if (S == null || E == null) {
    unsched = Math.max(0, outM - inM)
  } else {
    if (inM < S - GRACE_MIN) early = S - inM
    if (outM > E + GRACE_MIN) late = outM - E
    base = Math.max(0, Math.min(outM, E) - Math.max(inM, S))
  }
  const total = base + (rec.earlyOk ? early : 0) + (rec.lateOk ? late : 0) + (rec.unschedOk ? unsched : 0)
  const pending = (early && rec.earlyOk == null) || (late && rec.lateOk == null) || (unsched && rec.unschedOk == null)
  return { base, early, late, unsched, total, pending: !!pending }
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
export function monthStatus({ ym, uid, user, recs, holidays, subs, since = DEFAULT_SINCE, now = new Date() }) {
  const [y, m] = ym.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  const todayStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
  const days = []
  const cnt = { worked:0, late:0, lateMins:0, leftEarly:0, leftEarlyMins:0, absent:0, noOut:0, scheduled:0 }
  for (let d = 1; d <= last; d++) {
    const dd = pad(d), dateStr = `${ym}-${dd}`, date = new Date(y, m-1, d)
    if (dateStr > todayStr) break
    const rec = recs?.[dd] || null
    const sched = rec?.schedStart ? { start:rec.schedStart, end:rec.schedEnd } : (rec?.in ? null : shiftFor(user, date))
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
  const [att, cfg, hol, subs] = await Promise.all([
    safe(getDoc(doc(db,'attendance',ym))),
    safe(getDoc(doc(db,'attendance','_config'))),
    safe(getDoc(doc(db,'checklist','holidays'))),
    safe(getDoc(doc(db,'substitutes','requests'))),
  ])
  return { att: att || {}, cfg, holidays: hol?.list || [], subs: subs?.list || [], since: cfg?.since || DEFAULT_SINCE }
}
