// 배달앱 사장님 사이트 엑셀 → 날짜별 주문수·매출·가게 부담 할인·정산금액
//
// 지금 읽을 수 있는 형식
//   쿠팡이츠 매출내역: 주문 1건이 한 줄, 취소는 금액이 마이너스인 '취소' 줄
//   배민 정산명세서('상세' 시트, 비밀번호가 걸려 있음): 정산대상일·주문유형별 합계 한 줄. 주문 건수 칸은 없어서
//     배민 배달(알뜰·한집)은 건당 배달비(3,400원)로 건수를 셈 — 출력물의 '배달 N건'과 맞음
//     포장·가게배달은 배달비가 없어 그날 배달 1건 평균 금액으로 추정 (ordersEstimated)
// 결과는 revenue/_apps-{YYYY-MM} 문서에 { [앱]: { [dd]: { orders, orderAmount, payAmount, totalAmount, discount, payout, ads } } } 로 저장
//   (없는 값은 null — 배민 orders, 아직 입금 전인 날의 payout 등)
//   (매장 계정도 revenue 문서는 쓸 수 있어서 같은 컬렉션에 둠)

import { decryptXlsx, isEncryptedXlsx } from './officeDecrypt.js'

const norm = s => String(s ?? '').replace(/\s+/g, '')
const num = v => typeof v === 'number' ? v : (+String(v ?? '').replace(/[^0-9.-]/g, '') || 0)
const pad = n => String(n).padStart(2, '0')

function toDate(v, XLSX) {
  if (typeof v === 'number' && v > 30000 && v < 80000) {
    const d = XLSX.SSF.parse_date_code(v)
    return `${d.y}-${pad(d.m)}-${pad(d.d)}`
  }
  const m = String(v ?? '').match(/(\d{4})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/)
  return m ? `${m[1]}-${pad(+m[2])}-${pad(+m[3])}` : null
}

// 두 줄짜리 머리글: 윗줄 묶음 이름(예: '매출액') 아래 칸 이름(예: '결제금액')의 열 번호
function groupCol(top, sub, group, name) {
  const start = top.findIndex(c => norm(c) === group)
  if (start < 0) return -1
  let end = top.findIndex((c, i) => i > start && norm(c) !== '')
  if (end < 0) end = sub.length
  for (let i = start; i < end; i++) if (norm(sub[i]) === name) return i
  return -1
}

function parseCoupang(rows, XLSX) {
  const top = rows[0], sub = rows[1]
  const col = {
    date:   sub.findIndex(c => norm(c) === '일자'),
    kind:   sub.findIndex(c => norm(c) === '거래유형'),
    total:  groupCol(top, sub, '매출액', '총금액'),
    order:  groupCol(top, sub, '매출액', '주문금액'),
    pay:    groupCol(top, sub, '매출액', '결제금액'),
    coupon: groupCol(top, sub, '쿠폰', '상점부담'),
    instD:  groupCol(top, sub, '즉시할인', '배달전용'),
    instF:  groupCol(top, sub, '즉시할인', '음식전용'),
    payout: groupCol(top, sub, '정산금액', '산정후'),
  }
  if ([col.date, col.kind, col.order, col.pay].some(i => i < 0)) throw new Error('쿠팡이츠 엑셀의 칸(일자·거래유형·주문금액·결제금액)을 찾지 못했어요')
  const days = {}
  for (const r of rows.slice(2)) {
    const date = toDate(r[col.date], XLSX)
    const kind = norm(r[col.kind])
    if (!date || (kind !== '결제' && kind !== '취소')) continue
    const d = days[date] ||= { orders:0, orderAmount:0, payAmount:0, totalAmount:0, discount:0, payout:0 }
    d.orders += kind === '결제' ? 1 : -1          // 취소 줄은 금액이 이미 마이너스
    d.orderAmount += num(r[col.order])
    d.payAmount   += num(r[col.pay])
    if (col.total >= 0)  d.totalAmount += num(r[col.total])
    if (col.coupon >= 0) d.discount += num(r[col.coupon])
    if (col.instD >= 0)  d.discount += num(r[col.instD])
    if (col.instF >= 0)  d.discount += num(r[col.instF])
    if (col.payout >= 0) d.payout += num(r[col.payout])
  }
  return days
}

const DELIVERY_FEE = 3400   // 배민 배달(알뜰·한집) 건당 배달비 — 바뀌면 여기만 고치면 됨

// 배민 정산명세서: 머리글 3줄(묶음 / 항목 / 세부 항목), 맨 아래 줄 이름으로 열을 찾음
function parseBaemin(rows, XLSX) {
  const head = rows[2]
  const at = name => head.findIndex(c => norm(c) === norm(name))
  const col = {
    date: at('정산대상기간'), type: at('주문유형/기타'), status: at('상태'), payout: at('(H) 입금금액'),
    orderNow: at('바로결제주문금액'), orderMeet: at('만나서결제주문금액'),
    coupon: at('파트너부담쿠폰'), instant: at('주문금액 즉시할인'), menu: at('메뉴할인'),
    tipOne: at('한집배달 배달팁 즉시할인'), tipSave: at('알뜰배달 배달팁 즉시할인'),
    feeOne: at('배민1 한집배달 배달비'), feeSave: at('알뜰배달 배달비'),
    ad: at('우리가게클릭 이용요금'), adVat: head.findIndex((c, i) => i > at('우리가게클릭 이용요금') && norm(c) === '부가세'),
  }
  if ([col.date, col.type, col.orderNow].some(i => i < 0)) throw new Error('배민 정산명세서의 칸(정산대상기간·주문유형·주문금액)을 찾지 못했어요')
  const v = (r, i) => i >= 0 ? num(r[i]) : 0
  const days = {}, paid = {}, count = {}
  const day = date => days[date] ||= { orders:null, ordersEstimated:0, orderAmount:0, payAmount:0, totalAmount:null, discount:0, payout:0, ads:0 }
  for (const r of rows.slice(3)) {
    const dates = String(r[col.date] ?? '').split('~').map(x => toDate(x.trim(), XLSX)).filter(Boolean)
    if (!dates.length) continue
    if (norm(r[col.type]) === '우리가게클릭') {
      // 광고비: 기간으로 묶인 줄은 그 날짜들에 나눠 담음
      const all = []
      for (let d = new Date(`${dates[0]}T00:00:00Z`), end = dates[dates.length - 1]; d.toISOString().slice(0,10) <= end; d.setUTCDate(d.getUTCDate() + 1)) all.push(d.toISOString().slice(0,10))
      const cost = -(v(r, col.ad) + v(r, col.adVat))
      for (const d of all) day(d).ads += cost / all.length
      continue
    }
    const d = day(dates[0])
    const order = v(r, col.orderNow) + v(r, col.orderMeet)
    const disc = v(r, col.coupon) + v(r, col.instant) + v(r, col.menu)   // 음수로 들어 있음
    d.orderAmount += order
    d.payAmount += order + disc                                          // 출력물의 '결제금액'과 같은 기준 (메뉴할인 등 뺀 금액)
    d.discount += -(disc + v(r, col.tipOne) + v(r, col.tipSave))
    d.payout += v(r, col.payout)
    paid[dates[0]] = (paid[dates[0]] ?? true) && (col.status < 0 || norm(r[col.status]) === '입금완료')
    const c = count[dates[0]] ||= { delivered:0, deliveredAmount:0, others:[] }
    const fee = -(v(r, col.feeOne) + v(r, col.feeSave))
    if (fee > 0) { c.delivered += fee / DELIVERY_FEE; c.deliveredAmount += order }
    else if (order > 0) c.others.push(order)
  }
  if (col.feeOne >= 0 || col.feeSave >= 0) for (const [date, c] of Object.entries(count)) {
    const avg = c.delivered ? c.deliveredAmount / c.delivered : 25000
    const est = c.others.reduce((a, amt) => a + Math.max(1, Math.round(amt / avg)), 0)
    days[date].orders = Math.round(c.delivered) + est
    days[date].ordersEstimated = est
  }
  for (const [date, d] of Object.entries(days)) {
    if (!paid[date]) d.payout = null      // 아직 입금 전이면 입금금액이 0으로 나와서 비워 둠
    d.ads = Math.round(d.ads)
  }
  // 광고비만 있는 날(주문이 없는 날)은 매출 0으로 들어가지 않게 뺌
  for (const date of Object.keys(days)) if (!(date in paid)) delete days[date]
  return days
}

// 형식 알아보기: 머리글에 있는 이름으로 (rows, h = 머리글 첫 줄 번호)
const FORMATS = [
  { platform:'coupang', label:'쿠팡이츠', test: (rows, h) => (rows[h+1] || []).some(c => norm(c) === '쿠팡부담') && rows[h].some(c => norm(c) === '매출액'), parse: parseCoupang },
  { platform:'baemin',  label:'배달의민족', test: (rows, h) => rows[h].some(c => norm(c) === '정산대상기간') && (rows[h+2] || []).some(c => norm(c) === '바로결제주문금액'), parse: parseBaemin },
]

// password: 비밀번호가 걸린 파일이면 필요. 없으면 err.code === 'NEED_PASSWORD'
export async function readDeliveryExcel(file, password) {
  const mod = await import('xlsx')
  const XLSX = mod.CFB ? mod : (mod.default || mod)
  let data = await file.arrayBuffer()
  if (isEncryptedXlsx(data, XLSX)) {
    if (!password) { const e = new Error('비밀번호가 걸린 파일이에요. 비밀번호를 입력해 주세요'); e.code = 'NEED_PASSWORD'; throw e }
    data = await decryptXlsx(data, password, XLSX)
  }
  const wb = XLSX.read(data, { type:'array' })
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header:1, raw:true, defval:'' })
    for (let h = 0; h < Math.min(rows.length - 1, 10); h++) {
      const f = FORMATS.find(f => f.test(rows, h))
      if (f) return { platform: f.platform, label: f.label, days: f.parse(rows.slice(h), XLSX) }
    }
  }
  throw new Error('아직 읽을 수 없는 엑셀 형식이에요. 지금은 쿠팡이츠 매출내역과 배민 정산명세서가 돼요 (다른 앱은 샘플을 보내주시면 추가할게요)')
}

// 앱에 적힌 하루 매출과 가장 가까운 엑셀 금액 칸 (없으면 결제금액 — 배민 출력물의 '총 결제금액'과 같은 기준)
export const SALES_FIELDS = [
  { key:'payAmount',   label:'결제금액' },
  { key:'orderAmount', label:'주문금액' },
  { key:'totalAmount', label:'총금액' },
]
export function pickSalesField(days, entered) {
  let best = { key:'payAmount', diff:null, n:0 }
  for (const f of SALES_FIELDS) {
    if (Object.values(days).every(v => v[f.key] == null)) continue
    let diff = 0, n = 0
    for (const [date, v] of Object.entries(days)) {
      if (entered[date] == null) continue
      diff += Math.abs(v[f.key] - entered[date]); n++
    }
    if (n && (best.diff == null || diff < best.diff)) best = { key:f.key, diff, n }
  }
  return best
}
