import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { prevYmOf, monthNum, parseAmount } from '../lib/rewards'
import { Roulette } from './RewardGame'

const T = { ink:'#1D1B18', sub:'#6E6A63', accent:'#C3261C', green:'#2E7D45' }

// 직원 내 기록 맨 위: 지난달 개근 포상 룰렛 (사장님이 '각자 룰렛'으로 열었을 때, 한 번만 돌릴 수 있음)
export default function MyRewardSpin({ uid, name }) {
  const ym = prevYmOf()
  const m = monthNum(ym)
  const [rw, setRw] = useState(null)
  const [mine, setMine] = useState(null) // 내 결과
  const [err, setErr] = useState('')

  useEffect(() => {
    let off = false
    getDoc(doc(db,'rewards',ym)).then(s => {
      if (off || !s.exists()) return
      const r = s.data()
      setRw(r); setMine(r.spins?.[uid] || (r.list||[]).find(x => x.uid === uid) || null)
    }).catch(() => {})
    return () => { off = true }
  }, [ym, uid])

  if (!rw) return null
  const eligible = (rw.eligible||[]).some(e => e.uid === uid)
  if (!eligible) return null

  async function onResult(_p, prize) {
    try {
      // 이미 돌렸는지 다시 확인하고 내 칸에만 저장
      const s = await getDoc(doc(db,'rewards',ym))
      const cur = s.exists() ? s.data().spins?.[uid] : null
      if (cur) { setMine(cur); return }
      const spin = { prize, amount: parseAmount(prize), name, at: new Date().toISOString() }
      await setDoc(doc(db,'rewards',ym), { spins: { [uid]: spin } }, { merge:true })
      setMine(spin)
    } catch(e) { console.error(e); setErr('결과를 저장하지 못했어요. 사장님께 결과를 알려 주세요: ' + prize) }
  }

  const box = { borderLeft:`4px solid ${T.accent}`, background:'#C3261C0D', borderRadius:'0 4px 4px 0', padding:'14px 16px', marginBottom:20 }
  if (mine) return (
    <section style={{...box, borderLeftColor:T.green, background:'#2E7D450F'}}>
      <div style={{fontSize:15, fontWeight:800, color:T.green}}>{m}월 개근 포상</div>
      <div style={{fontSize:20, fontWeight:800, marginTop:4}}>{mine.prize}</div>
      <div style={{fontSize:12, color:T.sub, marginTop:2}}>한 달 동안 지각·조퇴·결근 없이 일해 줘서 고마워요.</div>
    </section>
  )
  if (rw.status !== 'open') return null
  return (
    <section style={box}>
      <div style={{fontSize:16, fontWeight:800}}>{m}월 개근을 축하해요! 룰렛을 돌려 포상을 받으세요</div>
      <div style={{fontSize:12, color:T.sub, margin:'2px 0 10px'}}>한 번만 돌릴 수 있어요. 결과는 사장님과 매장 화면에 보여요.</div>
      <Roulette people={[{ uid, name }]} prizes={rw.prizes||['꽝']} results={{}} onResult={onResult}/>
      {err && <div style={{fontSize:13, color:'#B42318', marginTop:8}}>{err}</div>}
    </section>
  )
}
