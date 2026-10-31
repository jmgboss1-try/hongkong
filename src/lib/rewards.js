import { db } from '../firebase'
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore'
import { loadMonthContext, monthStatus, pad } from './attendance'

// 개근 포상
// rewards/{YYYY-MM} = {
//   status: 'open'(직원이 각자 룰렛) | 'skip'(이번 달 안 함) | 'done'(끝남),
//   game: 'roulette' | 'ladder', prizes: ['3만원', ...], eligible: [{uid,name}],
//   spins: { uid: {prize, amount, at} }    ← 직원이 자기 계정에서 돌린 결과 (자기 칸만 씀)
//   list: [{uid,name,prize,amount,paid}]   ← 사장님이 화면에서 한꺼번에 한 게임(사다리 등) 결과
//   paid: { uid: true }                    ← 급여 상여에 넣은 사람
// }

// '1만원' '1만 5천원' '5,000원' '3천원' → 원 (꽝 등 숫자 없으면 0)
export function parseAmount(text) {
  const s = String(text||'').replace(/[,\s원]/g,'')
  let total = 0, m
  if ((m = s.match(/(\d+(?:\.\d+)?)만/))) total += Math.round(parseFloat(m[1])*10000)
  if ((m = s.match(/(\d+(?:\.\d+)?)천/))) total += Math.round(parseFloat(m[1])*1000)
  if (!total && (m = s.match(/^\d+$/))) total = +m[0]
  return total
}

export const prevYmOf = (d = new Date()) => { const x = new Date(d.getFullYear(), d.getMonth()-1, 1); return `${x.getFullYear()}-${pad(x.getMonth()+1)}` }
export const monthNum = ym => +ym.slice(5,7)

// 결과 모으기: 사장님이 한 게임(list)과 직원이 각자 돌린 룰렛(spins)
export function rewardResults(rw) {
  if (!rw) return []
  const names = Object.fromEntries((rw.eligible||[]).map(e => [e.uid, e.name]))
  const fromList = (rw.list||[]).map(r => ({ ...r, paid: r.paid || !!rw.paid?.[r.uid] }))
  const fromSpins = Object.entries(rw.spins||{}).map(([uid, s]) => ({ uid, name: names[uid] || s.name || '—', prize: s.prize, amount: s.amount||0, paid: !!rw.paid?.[uid] }))
  const seen = new Set(fromList.map(r => r.uid))
  return [...fromList, ...fromSpins.filter(r => !seen.has(r.uid))]
}

// 그 달 개근한 직원 (달이 끝났을 때만)
export async function loadEligible(ym) {
  const [ctx, usersSnap] = await Promise.all([loadMonthContext(ym), getDocs(collection(db,'users'))])
  const list = []
  usersSnap.forEach(d => {
    const u = { uid:d.id, ...d.data() }
    if (u.status !== 'approved' || ['owner','store','investor'].includes(u.role)) return
    const st = monthStatus({ ym, uid:u.uid, user:u, recs:ctx.att[u.uid], holidays:ctx.holidays, subs:ctx.subs, plan:ctx.plan, since:ctx.since })
    if (st.perfect && st.monthOver) list.push({ uid:u.uid, name:u.name })
  })
  return list
}

// 급여 상여에 넣기 (bonuses/{달}[uid] 에 더함, 저장 직전에 다시 읽음)
export async function addRewardBonuses(ym, rows, gameLabel) {
  const snap = await getDoc(doc(db,'bonuses',ym))
  const b = snap.exists() ? snap.data() : {}
  const [y, m] = ym.split('-').map(Number)
  const day = `${ym}-${pad(new Date(y, m, 0).getDate())}`
  let n = Date.now()
  for (const r of rows) if (r.amount > 0)
    b[r.uid] = [...(b[r.uid]||[]), { id:String(n++), date:day, amount:r.amount, memo:`${m}월 개근 포상 (${gameLabel}: ${r.prize})` }]
  await setDoc(doc(db,'bonuses',ym), b)
  await setDoc(doc(db,'rewards',ym), { paid: Object.fromEntries(rows.filter(r=>r.amount>0).map(r => [r.uid, true])) }, { merge:true })
}
