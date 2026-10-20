// 통장 잔액 맞추기 계산 — expenses/{YYYY-MM} 문서 하나로 계산
//
//   전월 이월 + 실입금 − 지출                      = 영업 잔액 (앱)
//   + 영업 외 입금 − 영업 외 출금                  = 계산상 통장 잔액
//   vs PDF로 올린 거래로 계산한 실제 통장 끝 잔액
//
// 계좌내역 가져오기(BankImport)가 남기는 기록:
//   bankSeen    : 그 달 통장 거래 키 목록 ('날짜|시간|출금|입금|잔액|내용|순번')
//   importedKeys: 지출로 반영한 출금 키 목록
//   nonOp       : 영업 외 거래 [{ key, date, dir:'in'|'out', amount, kind, desc }]

export const NONOP_LABELS = { loan:'🤝 대여금(형)', loan_sangam:'🏪 상암점 대여금', invest:'💼 투자·정산', personal:'👤 개인 이체', other:'📎 기타 영업외' }

const parseKey = k => {
  const [date, time, out, inn, balance] = String(k).split('|')
  return { date, time, out: +out || 0, in: +inn || 0, balance: balance === '' ? null : +balance }
}

const isDay = k => /^\d{2}$/.test(k)

export function bankSummary(data, categories) {
  const d = data || {}
  const carryover = d.carryover || 0
  const dayEntries = Object.entries(d).filter(([k,v]) => isDay(k) && v && typeof v === 'object').map(([,v]) => v)
  const deposit = dayEntries.reduce((a,e) => a + (e.deposit||0), 0)
  const expense = categories
    ? dayEntries.reduce((a,e) => a + categories.reduce((s,c) => s + (e[c.id]||0), 0), 0)
    : dayEntries.reduce((a,e) => a + Object.entries(e).reduce((s,[k,v]) => s + (k!=='deposit' && typeof v==='number' ? v : 0), 0), 0)
  const operating = carryover + deposit - expense

  const nonOp = d.nonOp || []
  const nonOpIn  = nonOp.filter(x=>x.dir==='in').reduce((a,x)=>a+(x.amount||0),0)
  const nonOpOut = nonOp.filter(x=>x.dir==='out').reduce((a,x)=>a+(x.amount||0),0)
  const byKind = {}
  for (const x of nonOp) {
    const b = (byKind[x.kind||'other'] ||= { in:0, out:0 })
    b[x.dir==='in'?'in':'out'] += x.amount||0
  }
  const expected = operating + nonOpIn - nonOpOut

  const seen = (d.bankSeen || []).map(parseKey).sort((a,b) => (a.date+a.time).localeCompare(b.date+b.time))
  if (!seen.length) return { carryover, deposit, expense, operating, nonOpIn, nonOpOut, byKind, expected, bank:null }

  const bankIn  = seen.reduce((a,t)=>a+t.in,0)
  const bankOut = seen.reduce((a,t)=>a+t.out,0)
  const first = seen[0]
  const opening = first.balance === null ? null : first.balance - first.in + first.out
  const closing = opening === null ? null : opening + bankIn - bankOut
  const nonOpKeys = new Set(nonOp.map(x=>x.key))
  // 통장 거래 중 지출로 반영된 출금 합계 (영업 외로 뺀 건 제외)
  const importedOut = (d.importedKeys||[]).filter(k=>!nonOpKeys.has(k)).map(parseKey).reduce((a,t)=>a+t.out,0)

  const bank = {
    from: first.date, to: seen[seen.length-1].date,
    opening, closing, in: bankIn, out: bankOut, count: seen.length,
    diff: closing === null ? null : closing - expected,
    // 차이가 생기는 이유 (합하면 diff)
    reasons: {
      carryover: opening === null ? null : opening - carryover,     // 통장 시작 잔액 − 앱 전월 이월
      unhandledIn: bankIn - deposit - nonOpIn,                      // 통장 입금 중 실입금·영업외 어디에도 안 잡힌 금액
      unhandledOut: -(bankOut - importedOut - nonOpOut),            // 통장 출금 중 지출·영업외 어디에도 안 잡힌 금액 (빼야 하는 쪽)
      offBank: expense - importedOut,                               // 통장 밖에서 낸 지출(현금·직접 입력·고정지출 납부 등)
    },
  }
  return { carryover, deposit, expense, operating, nonOpIn, nonOpOut, byKind, expected, bank }
}
