// 근로계약서 (고용노동부 표준근로계약서 기준) · 재직증명서
//  contracts/{uid}/items/{id} = {
//    kind: 'part'(단시간근로자) | 'regular'(기간의 정함이 없는) | 'fixed'(기간의 정함이 있는),
//    name, startDate, endDate, place, job,
//    days: { [0-6]: { start, end, breakMin } }   (단시간: 요일별 근로시간)
//    hours: { start, end, breakMin, workDays:[0-6], weeklyHoliday:0-6 }   (통상: 소정근로시간·근무일·주휴일)
//    wage: { type:'hourly'|'monthly', amount }, bonus:{ has, amount }, otherPay, weeklyPay (주휴수당 지급),
//    payDay, payMethod, insurance:{ employ, accident, pension, health }, extra,
//    status:'sent'|'signed', createdAt, empSign(PNG data URL), empSignedAt, empAddress, empPhone }
//  사장님이 만들어 보내고(sent), 직원이 내 급여에서 주소를 적고 손가락으로 서명(signed). 직인은 rewards/bizSeal
//  규칙: 본인만 읽고, 본인은 sent → signed 로 서명 칸만 바꿀 수 있음 (firestore.rules)
import { db } from '../firebase'
import { collection, deleteDoc, doc, getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { POSITIONS } from './avatar'

export const KIND_LABELS = { part:'단시간근로자', regular:'기간의 정함이 없는 근로자', fixed:'기간의 정함이 있는 근로자' }
export const DOW = ['일','월','화','수','목','금','토']
export const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0]

const pad = n => String(n).padStart(2, '0')
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
export const krDate = s => s ? `${s.slice(0, 4)}년 ${+s.slice(5, 7)}월 ${+s.slice(8, 10)}일` : '        년    월    일'
export const toMin = s => { if (!s) return null; const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0) }
// 하루 실제 근로시간 (분): 종업 − 시업 − 휴게
export const dayMinutes = d => { const a = toMin(d?.start), b = toMin(d?.end); return a == null || b == null ? null : Math.max(0, (b < a ? b + 1440 : b) - a - (+d.breakMin || 0)) }
export const hm = m => m == null ? '' : `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ''}`
export const jobOf = u => (u?.positions?.length ? u.positions : [u?.position || 'hall']).map(p => POSITIONS.find(x => x.id === p)?.label.split(' ')[0]).filter(Boolean).join('·') || '홀'

// 직원 정보로 새 계약서 초안
export function draftContract(u, biz) {
  const full = u.employType === 'full'
  const workDays = Array.isArray(u.workDays) && u.workDays.length ? u.workDays : [1, 2, 3, 4, 5]
  const st = u.shiftTimes || {}
  const days = Object.fromEntries(workDays.map(d => [d, { start: st[d]?.start || '', end: st[d]?.end || '', breakMin: 0 }]))
  const first = workDays.map(d => st[d]).find(x => x?.start) || {}
  return {
    kind: full ? 'regular' : 'part',
    name: u.name || '',
    startDate: u.joinDate || todayISO(), endDate: '',
    place: biz?.address ? `${biz.name || '홍콩반점 중앙대점'} (${biz.address})` : (biz?.name || '홍콩반점 중앙대점'),
    job: `매장 ${jobOf(u)} 업무`,
    days,
    hours: { start: first.start || '', end: first.end || '', breakMin: 60, workDays, weeklyHoliday: 0 },
    wage: u.payType === 'fixed' ? { type: 'monthly', amount: +u.fixedSalary || 0 } : { type: 'hourly', amount: +u.wage || 10030 },
    bonus: { has: false, amount: 0 }, otherPay: '', weeklyPay: true,
    payDay: 10, payMethod: 'account',
    insurance: { employ: true, accident: true, pension: full, health: full },
    extra: '',
  }
}

export async function loadContracts(uid) {
  const s = await getDocs(collection(db, 'contracts', uid, 'items'))
  return s.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
}
export async function sendContract(uid, c) {
  const id = c.id || `c${Date.now()}`
  const { id: _omit, ...data } = c
  void _omit
  await setDoc(doc(db, 'contracts', uid, 'items', id), { ...data, status: 'sent', createdAt: c.createdAt || new Date().toISOString() })
  return id
}
export const deleteContract = (uid, id) => deleteDoc(doc(db, 'contracts', uid, 'items', id))
// 직원 서명 (규칙: 본인이 sent 인 계약서에 이 칸들만)
export const signContract = (uid, id, { sign, address, phone }) =>
  updateDoc(doc(db, 'contracts', uid, 'items', id), { status: 'signed', empSign: sign, empSignedAt: new Date().toISOString(), empAddress: address || '', empPhone: phone || '' })
