// 배달앱 사장님 사이트 엑셀 → 날짜별 주문수·매출·가게 부담 할인·정산금액
//
// 지금 읽을 수 있는 형식: 쿠팡이츠 매출내역 (주문 1건이 한 줄, 취소는 금액이 마이너스인 '취소' 줄)
// 결과는 revenue/_apps-{YYYY-MM} 문서에 { [앱]: { [dd]: { orders, orderAmount, payAmount, totalAmount, discount, payout } } } 로 저장
//   (매장 계정도 revenue 문서는 쓸 수 있어서 같은 컬렉션에 둠)

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

// 형식 알아보기: 머리글에 있는 이름으로
const FORMATS = [
  { platform:'coupang', label:'쿠팡이츠', test: (top, sub) => sub.some(c => norm(c) === '쿠팡부담') && top.some(c => norm(c) === '매출액'), parse: parseCoupang },
]

export async function readDeliveryExcel(file) {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(await file.arrayBuffer(), { type:'array' })
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header:1, raw:true, defval:'' })
    for (let h = 0; h < Math.min(rows.length - 1, 10); h++) {
      const f = FORMATS.find(f => f.test(rows[h], rows[h + 1]))
      if (f) return { platform: f.platform, label: f.label, days: f.parse(rows.slice(h), XLSX) }
    }
  }
  throw new Error('아직 읽을 수 없는 엑셀 형식이에요. 지금은 쿠팡이츠 매출내역만 돼요 (다른 앱은 샘플을 보내주시면 추가할게요)')
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
    let diff = 0, n = 0
    for (const [date, v] of Object.entries(days)) {
      if (entered[date] == null) continue
      diff += Math.abs(v[f.key] - entered[date]); n++
    }
    if (n && (best.diff == null || diff < best.diff)) best = { key:f.key, diff, n }
  }
  return best
}
