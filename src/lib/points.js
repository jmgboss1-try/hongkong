// 포인트 제도 (개근 포상 → 포인트, 포인트 상점)
//  설정  rewards/points = { start:'YYYY-MM', monthly, boost, late, absent, streakExtra, prizes }   (직원도 읽음, 사장님이 씀)
//  상점  rewards/shop   = { items:[{id,name,cost,qty,stock,restockDays,restockAt,img,desc}],
//                           requests:[{id,uid,name,itemId,itemName,cost,at,status:'pending'|'approved'|'rejected',decidedAt,how}] }
//         직원은 교환 신청만 arrayUnion 으로 덧붙임. 공개 교환 이력 = approved 요청 (누가·무엇을·언제)
//  개인  points/{uid} = { adjust:[{id,date,amount,note}], games:[{id,date,amount,note}] }   (본인·사장님만 읽음)
//         points/{uid}/codes/{요청id} = { img, text, note }   (상품권 바코드·선물코드, 사장님이 승인할 때 넣음)
//  자동  매달 기본 포인트, 지난달 개근이면 부스트, 지각·결근 감점(바로 앞 근무일도 지각·결근이면 추가 감점)은
//        출퇴근 기록에서 계산 (저장 안 함). 잔액은 0 아래로 안 내려감. 퇴사하면 소멸
import { db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'
import { loadMonthContext, monthStatus, pad } from './attendance'

export const DEFAULT_POINT_CONFIG = {
  start: '2026-12', monthly: 100, boost: 20, late: 10, absent: 10, streakExtra: 10,
  prizes: '30포인트, 20포인트, 10포인트, 꽝',
}
export async function loadPointConfig() {
  try { const s = await getDoc(doc(db, 'rewards', 'points')); return { ...DEFAULT_POINT_CONFIG, ...(s.exists() ? s.data() : {}) } }
  catch { return DEFAULT_POINT_CONFIG }
}
export async function loadShop() {
  try { const s = await getDoc(doc(db, 'rewards', 'shop')); const d = s.exists() ? s.data() : {}; return { items: d.items || [], requests: d.requests || [] } }
  catch { return { items: [], requests: [] } }
}
export async function loadPersonal(uid) {
  try { const s = await getDoc(doc(db, 'points', uid)); const d = s.exists() ? s.data() : {}; return { adjust: d.adjust || [], games: d.games || [], ok: true } }
  catch { return { adjust: [], games: [], ok: false } }
}

const ymOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
const addMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); return ymOf(new Date(y, m - 1 + n, 1)) }
export const todayStr = (d = new Date()) => `${ymOf(d)}-${pad(d.getDate())}`

// 시작 달 앞 달(부스트 판정용)부터 이번 달까지 출퇴근 자료
export async function loadPointMonths(config, now = new Date()) {
  const out = {}
  const cur = ymOf(now)
  if (config.start > cur) return out
  for (let ym = addMonth(config.start, -1); ym <= cur; ym = addMonth(ym, 1)) out[ym] = loadMonthContext(ym)
  const keys = Object.keys(out), vals = await Promise.all(Object.values(out))
  return Object.fromEntries(keys.map((k, i) => [k, vals[i]]))
}

// 상품 재고: 다 떨어지면 재입고일(restockAt)이 지나야 다시 qty 만큼
export function effectiveStock(item, today = todayStr()) {
  if ((item.stock ?? 0) > 0) return item.stock
  return item.restockAt && today >= item.restockAt ? (item.qty || 0) : 0
}
// 대기 중인 신청까지 뺀 지금 교환 가능한 수량
export const availableStock = (item, requests, today) =>
  Math.max(0, effectiveStock(item, today) - requests.filter(r => r.itemId === item.id && r.status === 'pending').length)

// 한 사람의 포인트 내역(날짜순, 잔액 포함) — 자동 적립·감점 + 사장님 조정 + 게임 + 교환
export function pointLedger({ uid, user, config, months, personal, requests, now = new Date() }) {
  const ev = []
  const join = user?.joinDate ? String(user.joinDate).slice(0, 7) : null
  const cur = ymOf(now)
  let prevBad = false
  for (let ym = config.start; ym <= cur; ym = addMonth(ym, 1)) {
    if (join && ym < join) continue
    ev.push({ date: `${ym}-01`, amount: +config.monthly || 0, kind: 'monthly', note: `${+ym.slice(5)}월 기본 포인트` })
    const prev = addMonth(ym, -1), pc = months[prev]
    if (pc && (+config.boost || 0) > 0) {
      const ps = monthStatus({ ym: prev, uid, user, recs: pc.att[uid], holidays: pc.holidays, subs: pc.subs, plan: pc.plan, since: pc.since, now })
      if (ps.perfect && ps.monthOver) ev.push({ date: `${ym}-01`, amount: +config.boost, kind: 'boost', note: `${+prev.slice(5)}월 개근 부스트` })
    }
    const c = months[ym]
    if (!c) continue
    const st = monthStatus({ ym, uid, user, recs: c.att[uid], holidays: c.holidays, subs: c.subs, plan: c.plan, since: c.since, now })
    for (const d of st.days) {
      if (!d.counted || d.excused) continue
      const bad = d.absent ? 'absent' : d.late > 0 ? 'late' : null
      if (bad) {
        ev.push({ date: d.dateStr, amount: -(+config[bad] || 0), kind: bad, note: bad === 'absent' ? '결근' : `지각 ${d.late}분` })
        if (prevBad && (+config.streakExtra || 0) > 0) ev.push({ date: d.dateStr, amount: -(+config.streakExtra), kind: 'streak', note: '연속 지각·결근 추가 감점' })
      }
      prevBad = !!bad
    }
  }
  for (const a of personal?.adjust || []) ev.push({ date: a.date, amount: +a.amount || 0, kind: 'adjust', note: a.note || '사장님 조정' })
  for (const g of personal?.games || []) ev.push({ date: g.date, amount: +g.amount || 0, kind: 'game', note: g.note || '개근 게임' })
  for (const r of requests || []) if (r.uid === uid && r.status !== 'rejected')
    ev.push({ date: String(r.at).slice(0, 10), amount: -(+r.cost || 0), kind: 'exchange', note: `${r.itemName} 교환${r.status === 'pending' ? ' (확인 대기)' : ''}`, reqId: r.id })
  const order = { monthly: 0, boost: 1, game: 2, adjust: 3, late: 4, absent: 4, streak: 5, exchange: 6 }
  ev.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (order[a.kind] ?? 9) - (order[b.kind] ?? 9))
  let bal = 0
  for (const e of ev) { const before = bal; bal = Math.max(0, bal + e.amount); e.applied = bal - before; e.balance = bal }
  return { entries: ev, balance: bal }
}

// '30포인트' '30P' '30' → 30 (꽝 등 숫자 없으면 0)
export function parsePoints(text) {
  const m = String(text || '').replace(/,/g, '').match(/(\d+)/)
  return m ? +m[1] : 0
}
