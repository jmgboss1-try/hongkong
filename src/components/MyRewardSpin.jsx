import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { prevYmOf, monthNum, parseAmount } from '../lib/rewards'
import { Roulette } from './RewardGame'
import { VStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { Legacy } from '../astryx/AstryxPage'


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

  if (mine) return (
    <Card variant="muted" padding={4}>
      <VStack gap={1}>
        <Badge variant="success" label={`${m}월 개근 포상`}/>
        <Heading level={3}>{mine.prize}</Heading>
        <Text type="supporting" color="secondary">한 달 동안 지각·조퇴·결근 없이 일해 줘서 고마워요.</Text>
      </VStack>
    </Card>
  )
  if (rw.status !== 'open') return null
  return (
    <Card variant="muted" padding={4}>
      <VStack gap={2}>
        <Heading level={4}>{m}월 개근을 축하해요! 룰렛을 돌려 포상을 받으세요</Heading>
        <Text type="supporting" color="secondary">한 번만 돌릴 수 있어요. 결과는 사장님과 매장 화면에 보여요.</Text>
        <Legacy><Roulette people={[{ uid, name }]} prizes={rw.prizes||['꽝']} results={{}} onResult={onResult}/></Legacy>
        {err && <Banner status="error" title={err}/>}
      </VStack>
    </Card>
  )
}
