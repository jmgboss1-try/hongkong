// 급여 공제 계산 (급여관리와 원천징수영수증이 같이 씀)
//  employType 'part' = 3.3% (사업소득: 소득세 3% + 지방소득세 0.3%), 'full' = 4대보험 (근로소득), 'none' = 공제 없음
//  ins: 그 직원의 4대보험 고지 금액 {pension, health, care, employ} (인원관리에서 넣음). 있으면 비율 대신 그 금액을 그대로 뗌
export function calcDeduction(totalPay, employType, ins) {
  if(employType === 'none') return { tax:0, pension:0, health:0, employ:0, care:0, total:0 }
  if(employType !== 'part' && ins) {
    const pension = +ins.pension || 0, health = +ins.health || 0, care = +ins.care || 0, employ = +ins.employ || 0
    return { tax:0, pension, health, employ, care, total: pension + health + employ + care, fixedIns: true }
  }
  if(employType === 'part') {
    const tax = Math.round(totalPay * 0.033)
    return { tax, pension:0, health:0, employ:0, care:0, total:tax }
  }
  const pension = Math.round(totalPay * 0.045)
  const health  = Math.round(totalPay * 0.03545)
  const employ  = Math.round(totalPay * 0.009)
  const care    = Math.round(health   * 0.1295)
  const total   = pension + health + employ + care
  return { tax:0, pension, health, employ, care, total }
}
// 저장된 공제를 보고 어느 쪽인지 (3.3%면 tax, 4대보험이면 보험료가 있음)
export const deductionKind = d => (d?.pension || d?.health || d?.employ || d?.care) ? 'full' : (d?.tax ? 'part' : 'none')
// 3.3%를 소득세 3% / 지방소득세 0.3% 로 나눔 (지방소득세 = 전체 - 소득세)
export const splitTax = (tax, base) => { const income = Math.round(base * 0.03); return tax ? { income: Math.min(income, tax), local: tax - Math.min(income, tax) } : { income: 0, local: 0 } }

// 직원별 4대보험 금액 이력 insuranceHistory = [{ month:'YYYY-MM', pension, health, care, employ }] (userPrivate, 시급 이력과 같은 방식)
// 그 달에 적용되는 것 = month <= ym 중 가장 최근. 네 금액이 모두 0이면 '금액 안 정함' → null (비율로 계산)
export function insuranceFor(history, ym) {
  const h = (Array.isArray(history) ? history : []).filter(x => x?.month && x.month <= ym).sort((a, b) => a.month < b.month ? 1 : -1)[0]
  if (!h) return null
  return ['pension', 'health', 'care', 'employ'].some(k => (+h[k] || 0) > 0) ? h : null
}

// 공제합계만 알 때 대략 나눠 보기 (2026년 근로자 부담 요율, 추정값):
//  국민연금 4.75% (기준소득월액 40만~637만원), 건강보험 3.595%, 장기요양 = 건강보험료 × 13.14%, 고용보험 0.9%
//  각 보험료는 10원 미만 버림. 나머지를 소득세 : 지방소득세 = 10 : 1 로 나눔
//  보험료 추정이 공제합계보다 크면 보험료를 비율대로 줄여서 합계가 공제합계와 같게 맞춤
export const EST_RATES_2026 = { pension: 0.0475, health: 0.03595, careOfHealth: 0.1314, employ: 0.009, pensionMin: 400000, pensionMax: 6370000 }
export function splitDeduction(salary, total) {
  const R = EST_RATES_2026, floor10 = n => Math.floor(Math.round(n * 100) / 1000) * 10   // 소수 오차 없이 10원 미만 버림
  const pay = Math.max(0, +salary || 0), sum = Math.max(0, Math.round(+total || 0))
  let pension = floor10(Math.min(Math.max(pay, R.pensionMin), R.pensionMax) * R.pension)
  let health = floor10(pay * R.health)
  let care = floor10(health * R.careOfHealth)
  let employ = floor10(pay * R.employ)
  let ins = pension + health + care + employ, scaled = false
  if (ins > sum && ins > 0) {
    const k = sum / ins; scaled = true
    pension = floor10(pension * k); health = floor10(health * k); care = floor10(care * k); employ = sum - pension - health - care
    ins = sum
  }
  const rest = sum - ins
  const incomeTax = floor10(rest / 1.1), localTax = rest - incomeTax
  return { pension, health, care, employ, incomeTax, localTax, scaled }
}
