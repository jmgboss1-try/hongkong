import { db } from '../firebase'
import { doc, setDoc } from 'firebase/firestore'

// NFC 출퇴근
// attendance/{YYYY-MM} → { [uid]: { [dd]: { in, out (Timestamp), schedStart, schedEnd ('HH:MM'|null),
//   name, inDist, outDist, earlyOk, lateOk, unschedOk (true|false|undefined = 아직 안 정함), appliedMins } } }
// attendance/_config → { lat, lng, radius }  매장 위치 (사장님이 매장에서 저장)
// 찍힌 시간은 workhours(시간)·workextra(분)에 그날 근무시간으로 들어감

export const GRACE_MIN = 10      // 예정보다 이만큼 넘게 일찍 오거나 늦게 퇴근하면 사장님 승인 필요
export const DEFAULT_RADIUS = 150 // 매장에서 이 거리(m) 안에서만 찍힘

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
