// 급여 공제 계산 (급여관리와 원천징수영수증이 같이 씀)
//  employType 'part' = 3.3% (사업소득: 소득세 3% + 지방소득세 0.3%), 'full' = 4대보험 (근로소득), 'none' = 공제 없음
export function calcDeduction(totalPay, employType) {
  if(employType === 'none') return { tax:0, pension:0, health:0, employ:0, care:0, total:0 }
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
