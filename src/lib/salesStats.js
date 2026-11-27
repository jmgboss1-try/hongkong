// 매출분석·대시보드가 같이 쓰는 배달앱 하루 값·평균과 '할인 목표' 계산
//  revenue/{YYYY-MM}[dd] 의 마감 값 (baemin… = 하루 매출, baeminOrders… = 마감 때 적은 주문 건수)
//  revenue/_apps-{YYYY-MM} = 배달앱 엑셀 (있으면 그날 그 앱은 이 값을 우선)
//  revenue/_salesEvents = { list:[{ id, title, kind, platforms, from, to, memo, perOrder?, margin?, funding?, appShare?, hqShare?, feeOn?, feeRate? }] }
//    perOrder = 손님이 받는 건당 할인 전체. funding 'collab'(협업 할인)이면 appShare(배달앱 지원)·hqShare(본사 지원)를 빼고 남은 게 매장 부담
//    feeOn 이면 할인액 전체에도 중개수수료(feeRate %)가 붙는다고 보고 매장 비용에 더함 (할인 전 금액 기준 수수료)
//    perOrder(건당 할인, 원)가 있는 할인 일정은 '할인 목표'로 추적: 할인 전 4주 평균으로 본전 주문 수를 구해 매일 비교
import { db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'

export const PLATFORMS = [
  { key:'baemin',   label:'배달의민족', short:'배민',   color:'#2E7D45' },
  { key:'coupang',  label:'쿠팡이츠',   short:'쿠팡',   color:'#B42318' },
  { key:'yogiyo',   label:'요기요',     short:'요기요', color:'#C3261C' },
  { key:'ddangyeo', label:'땡겨요',     short:'땡겨요', color:'#2B5C9E' },
]
export const EVENTS_DOC = ['revenue', '_salesEvents']
export const OPEN_END = '2099-12-31'      // 끝나는 날을 정하지 않은 일정
export const DEFAULT_MARGIN = 20           // 이익률 기본값 (%)
export const BASE_DAYS = 28                // 할인 전 비교 기간
export const DEFAULT_FEE_RATE = 7.8        // 할인액에 붙는 중개수수료 기본값 (%)

// 할인 한 건에 매장이 실제로 내는 돈: 매장 부담(단독이면 할인 전체, 협업이면 총 − 앱 지원 − 본사 지원) + 할인액 전체에 붙는 수수료
export function discountCost(ev) {
  const total = +ev.perOrder || 0
  const share = ev.funding === 'collab' ? Math.max(0, total - (+ev.appShare || 0) - (+ev.hqShare || 0)) : total
  const fee = ev.feeOn ? Math.round(total * (+ev.feeRate || DEFAULT_FEE_RATE) / 100) : 0
  return { total, share, fee, cost: share + fee }
}
// 목록·카드에 보일 한 줄: '건당 1,000원' / '총 5,000원 (앱 2,000 · 본사 1,500 · 매장 1,500)' (+ 수수료)
export function discountLabel(ev) {
  const w = n => (+n || 0).toLocaleString('ko-KR')
  const c = discountCost(ev)
  const head = ev.funding === 'collab'
    ? `총 ${w(c.total)}원 할인 (배달앱 ${w(ev.appShare)} · 본사 ${w(ev.hqShare)} · 매장 ${w(c.share)})`
    : `건당 ${w(c.total)}원 할인`
  return c.fee ? `${head} + 수수료 ${w(c.fee)}원 = 매장 ${w(c.cost)}원` : head
}

export const pad = n => String(n).padStart(2,'0')
const fmtDate = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`
const parseDate = s => new Date(`${s}T00:00:00Z`)
export const addDays = (s, n) => { const d = parseDate(s); d.setUTCDate(d.getUTCDate()+n); return fmtDate(d) }
export const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000)
export const dateRange = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out }
export const todayStr = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}` }
export const monthsOf = (from, to) => { const out = new Set(); for (let d = from; d <= to; d = addDays(d, 1)) out.add(d.slice(0,7)); return [...out] }

// 하루·앱 하나의 값. 배달앱 엑셀로 넣은 날은 그 값(가게 부담 할인·정산금액 포함), 아니면 마감 매출과 마감 때 적은 주문 건수
export function dayValue(months, date, p) {
  const m = months[date.slice(0,7)], dd = date.slice(8,10)
  const x = m?.apps?.[p]?.[dd]
  const rec = m?.rev?.[dd]
  const entered = rec && typeof rec[`${p}Orders`] === 'number' ? rec[`${p}Orders`] : null
  // 주문 건수: 마감 때 적은 건수가 있으면 그것(출력물 기준이라 정확), 없으면 엑셀 (배민은 포장·가게배달이 추정치)
  if (x) return { sales:x.sales, orders: entered ?? x.orders ?? null, discount:x.discount ?? null, payout:x.payout ?? null, ads:x.ads ?? null, excel:true }
  if (!rec) return { sales:null, orders:null, discount:null, payout:null, ads:null }
  const sales = typeof rec[p] === 'number' ? rec[p] : null
  const orders = typeof rec[`${p}Orders`] === 'number' ? rec[`${p}Orders`] : null
  return { sales, orders, discount:null, payout:null, ads:null }
}

// 여러 날의 평균. 주문수·객단가는 주문 건수를 적은 날만, 매출은 매출이 있는 날만 셈
export function stats(months, dates, p) {
  let salesN = 0, salesSum = 0, ordN = 0, ordSum = 0, ordSales = 0, discN = 0, discSum = 0, adsN = 0, adsSum = 0
  for (const d of dates) {
    const v = dayValue(months, d, p)
    if (v.sales != null) { salesN++; salesSum += v.sales }
    if (v.orders != null) { ordN++; ordSum += v.orders; ordSales += v.sales || 0 }
    if (v.discount != null) { discN++; discSum += v.discount }
    if (v.ads != null) { adsN++; adsSum += v.ads }
  }
  return {
    salesN, ordN, ordSum, salesSum, discN, discSum,
    discountPerDay: discN ? discSum / discN : null,
    adsN, adsPerDay: adsN ? adsSum / adsN : null,
    salesPerDay: salesN ? salesSum / salesN : null,
    ordersPerDay: ordN ? ordSum / ordN : null,
    aov: ordSum ? ordSales / ordSum : null,
  }
}

// 달 문서 읽기 { 'YYYY-MM': { rev, apps } }
export async function loadSalesMonths(ids) {
  const read = id => getDoc(doc(db, 'revenue', id)).then(s => s.exists() ? s.data() : {})
  const list = await Promise.all(ids.map(m => Promise.all([read(m), read(`_apps-${m}`).catch(() => ({}))]).then(([rev, apps]) => [m, { rev, apps }])))
  return Object.fromEntries(list)
}
export async function loadSalesEvents() {
  const s = await getDoc(doc(db, ...EVENTS_DOC))
  return s.exists() ? (s.data().list || []) : []
}

// 할인 목표로 추적할 일정: 건당 할인이 있고, 시작 전이거나 진행 중이거나 끝난 지 14일 안
export const isGoalEvent = (ev, today = todayStr()) =>
  ev.kind === 'discount' && +ev.perOrder > 0 && (ev.to || OPEN_END) >= addDays(today, -14)
export const goalMonths = (ev, today = todayStr()) => {
  const end = (ev.to || OPEN_END) < today ? ev.to : today
  return monthsOf(addDays(ev.from, -BASE_DAYS), end > ev.from ? end : ev.from)
}

// 할인 목표: 할인 전 4주 평균(주문·객단가)으로 '같은 이익을 내려면 하루 몇 건'을 구하고, 시작 뒤 실제와 비교
//  이익 = 주문 × (객단가 × 이익률 − 매장이 내는 건당 할인 비용), 할인 전은 할인 없이. 객단가는 할인 전 값 그대로 둔다고 가정
export function discountGoal(months, ev, today = todayStr()) {
  const d = discountCost(ev).cost, m = (+ev.margin || DEFAULT_MARGIN) / 100   // d = 매장이 실제로 내는 건당 할인 비용
  const apps = PLATFORMS.filter(p => !ev.platforms?.length || ev.platforms.includes(p.key))
  const baseDates = dateRange(addDays(ev.from, -BASE_DAYS), addDays(ev.from, -1))
  const started = ev.from <= today
  const end = (ev.to || OPEN_END) < today ? ev.to : today
  const during = started ? dateRange(ev.from, end) : []
  const last7 = during.slice(-7)
  const rows = apps.map(p => {
    const B = stats(months, baseDates, p.key), D = stats(months, during, p.key), L = stats(months, last7, p.key)
    const unit = B.aov != null ? B.aov * m : null
    const baseProfit = B.ordersPerDay != null && unit != null ? B.ordersPerDay * unit : null
    const after = unit != null ? unit - d : null
    const need = baseProfit != null && after > 0 ? baseProfit / after : null
    const actualProfit = D.ordersPerDay != null && D.aov != null ? D.ordersPerDay * (D.aov * m - d) : null
    return { ...p, base: B.ordersPerDay, baseAov: B.aov, baseProfit, after, need, impossible: after != null && after <= 0,
      actual: D.ordersPerDay, actualAov: D.aov, actualN: D.ordN, last7: L.ordersPerDay, actualProfit }
  })
  const ok = rows.filter(r => r.need != null)
  const sum = k => ok.reduce((a, r) => a + (r[k] || 0), 0)
  const daily = during.map(date => {
    const vals = ok.map(r => dayValue(months, date, r.key).orders)
    const has = vals.some(v => v != null)
    return { date, orders: has ? vals.reduce((a, v) => a + (v || 0), 0) : null }
  })
  const recorded = daily.filter(x => x.orders != null)
  const total = {
    base: sum('base'), need: sum('need'), baseProfit: sum('baseProfit'),
    actual: recorded.length ? recorded.reduce((a, x) => a + x.orders, 0) / recorded.length : null,
    last7: (() => { const l = recorded.slice(-7); return l.length ? l.reduce((a, x) => a + x.orders, 0) / l.length : null })(),
    days: recorded.length, hit: recorded.filter(x => x.orders >= sum('need')).length,
    actualProfit: ok.every(r => r.actualProfit != null) && ok.length ? sum('actualProfit') : null,
    yesterday: daily.find(x => x.date === addDays(today, -1))?.orders ?? null,
  }
  return { started, ended: (ev.to || OPEN_END) < today, d, margin: m * 100, apps, rows, total, daily, baseFrom: baseDates[0], baseTo: baseDates[baseDates.length - 1],
    noBase: !ok.length }
}
