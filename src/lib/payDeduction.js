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
