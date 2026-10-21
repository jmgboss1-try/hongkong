import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { NONOP_LABELS, investOption, INVEST_OPTIONS, appendInvestmentRecords } from './bankRecon'

// 통장 거래 한 건의 분류를 바꾸기 — 원래 들어간 곳에서 빼고 새 곳에 넣음
//
// 분류 값 (출금):  카테고리 id | 'ack'(다른 곳에 이미 적은 지출과 연결만) | 'nonop:<kind>' | '__inv:<투자자>:<종류>' | ''(미분류)
// 분류 값 (입금):  'deposit'(실입금) | 'nonop:<kind>' | ''(미분류)
// expenses/{YYYY-MM} 에 남는 기록:
//   importedKeys : 지출(또는 ack)로 처리한 출금 키
//   bankCls      : { 키: 카테고리 id | 'ack' } — 지출 출금이 어느 칸에 들어갔는지 (이 기록이 없는 예전 건은 '원래 카테고리'를 물어봄)
//   nonOp        : 영업 외 거래 (투자관리 회수는 investor·category 포함)

const LEDGER_OF = { loan:'hyung', loan_sangam:'hyung' }

export const parseTxKey = k => {
  const [date, time, out, inn, , desc] = String(k).split('|')
  return { key:k, date, time, out:+out||0, in:+inn||0, desc }
}

// 지금 분류 알아내기
export function currentClass(data, tx) {
  const rec = (data.nonOp||[]).find(x=>x.key===tx.key)
  if (rec) {
    if (rec.investor) return { value:`__inv:${rec.investor}:${rec.category}`, rec }
    return { value:`nonop:${rec.kind==='loan_sangam' ? 'loan' : rec.kind}`, rec }
  }
  if (tx.in) return { value:'deposit' }            // 입금은 영업 외로 안 뺐으면 실입금에 들어가 있음
  if ((data.importedKeys||[]).includes(tx.key)) {
    const c = (data.bankCls||{})[tx.key]
    return c ? { value:c } : { value:'?expense' }  // 지출로 반영됐는데 어느 칸인지 기록 없음(예전 건)
  }
  return { value:'' }
}

// 예전 건(카테고리 기록 없음)의 원래 카테고리 추측: 그날 그 금액 이상이 들어 있는 칸이 하나뿐이면 그 칸
export function guessFromCat(data, tx, categories) {
  const e = data[tx.date.slice(8,10)] || {}
  const c = categories.filter(c => (e[c.id]||0) >= tx.out)
  return c.length === 1 ? c[0].id : ''
}

export function classLabel(value, categories) {
  if (!value) return '미분류'
  if (value === 'deposit') return '💰 실입금'
  if (value === 'ack') return '✓ 다른 곳에 적은 지출과 연결'
  if (value === '?expense') return '지출 (카테고리 기록 없음)'
  if (value.startsWith('nonop:')) return NONOP_LABELS[value.slice(6)] || '영업 외'
  const inv = investOption(value)
  if (inv) return inv.label
  return categories.find(c=>c.id===value)?.label || value
}

export function classOptions(tx, categories) {
  const secs = ['재료비','관리비','인건비']
  const nonop = Object.entries(NONOP_LABELS).map(([k,l])=>({ value:`nonop:${k}`, label:l, group:'영업 외 (지출 아님)' }))
  if (tx.in) return [{ value:'deposit', label:'💰 실입금 (매출 입금)' }, ...nonop]
  return [
    ...secs.flatMap(sec=>categories.filter(c=>c.sec===sec).map(c=>({ value:c.id, label:c.label, group:sec }))),
    ...nonop,
    ...INVEST_OPTIONS.map(o=>({ value:o.value, label:o.label, group:'투자관리 회수로 기록 (영업 외)' })),
    { value:'ack', label:'✓ 이미 지출에 있음 (금액 안 더함)' },
  ]
}

async function removeByBankKey(path, key) {
  const [col, id] = path
  const s = await getDoc(doc(db, col, id))
  if (!s.exists()) return
  const list = (s.data().list||[]).filter(r=>r.bankKey !== key)
  await setDoc(doc(db, col, id), { ...s.data(), list })
}

// 분류 바꾸기. from === '?expense'면 fromCat(원래 카테고리)을 받아서 거기서 뺌
export async function reclassify({ ym, tx, to, fromCat, categories }) {
  const snap = await getDoc(doc(db,'expenses',ym))
  const d = snap.exists() ? snap.data() : {}
  const cur = currentClass(d, tx)
  const from = cur.value === '?expense' ? fromCat : cur.value
  if (from === to) {
    // 예전 건을 원래 카테고리 그대로 두는 경우: 금액은 그대로, 어느 칸인지 기록만 남김
    if (cur.value === '?expense' && to) {
      await setDoc(doc(db,'expenses',ym), { bankCls: { ...(d.bankCls||{}), [tx.key]: to } }, { merge:true })
    }
    return
  }
  const dd = tx.date.slice(8,10)
  const day = () => { const e = { ...(d[dd]||{}) }; categories.forEach(c=>{ if(e[c.id]===undefined) e[c.id]=0 }); d[dd] = e; return e }
  const amount = tx.out || tx.in
  let keys = [...(d.importedKeys||[])]
  let nonOp = [...(d.nonOp||[])]
  const cls = { ...(d.bankCls||{}) }

  // 1) 원래 자리에서 빼기
  if (from === 'deposit') {
    const e = day(); e.deposit = Math.max(0, (e.deposit||0) - amount)
  } else if (from && (from.startsWith('nonop:') || investOption(from))) {
    const rec = nonOp.find(x=>x.key===tx.key)
    nonOp = nonOp.filter(x=>x.key!==tx.key)
    if (rec?.investor) await removeByBankKey(['investment','records'], tx.key)
    else if (LEDGER_OF[rec?.kind]) await removeByBankKey(['loans', LEDGER_OF[rec.kind]], tx.key)
  } else if (from) { // 지출 카테고리 또는 ack
    if (from !== 'ack') {
      const e = day()
      if ((e[from]||0) < amount) throw new Error(`${+tx.date.slice(5,7)}/${+dd} '${classLabel(from, categories)}' 칸에 ${amount.toLocaleString()}원이 없어요. 원래 카테고리를 다시 확인해 주세요.`)
      e[from] -= amount
    }
    keys = keys.filter(k=>k!==tx.key)
    delete cls[tx.key]
  }

  // 2) 새 자리에 넣기
  const inv = investOption(to)
  if (to === 'deposit') {
    const e = day(); e.deposit = (e.deposit||0) + amount
  } else if (to && (to.startsWith('nonop:') || inv)) {
    const kind = inv ? 'invest' : to.slice(6)
    nonOp.push({ key:tx.key, date:tx.date, dir: tx.out ? 'out' : 'in', amount, kind, desc:tx.desc,
      ...(inv ? { investor:inv.investor, category:inv.category } : {}) })
    if (inv) await appendInvestmentRecords([{ key:tx.key, date:tx.date, amount, desc:tx.desc, investor:inv.investor, category:inv.category }])
    else if (LEDGER_OF[kind]) {
      const id = LEDGER_OF[kind]
      const s = await getDoc(doc(db,'loans',id))
      const list = s.exists() ? (s.data().list||[]) : []
      if (!list.some(r=>r.bankKey===tx.key)) {
        list.push({ id:String(Date.now()), date:tx.date, type: tx.out ? 'lent' : 'received', amount,
          memo:`계좌내역 분류 변경 (${tx.desc})`, bankKey:tx.key })
        list.sort((a,b)=>a.date.localeCompare(b.date))
        await setDoc(doc(db,'loans',id), { list })
      }
    }
  } else if (to) { // 지출 카테고리 또는 ack
    if (to !== 'ack') { const e = day(); e[to] = (e[to]||0) + amount }
    keys.push(tx.key)
    cls[tx.key] = to
  }

  d.importedKeys = keys
  d.nonOp = nonOp
  d.bankCls = cls
  await setDoc(doc(db,'expenses',ym), d)
}
