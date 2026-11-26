import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { prevYmOf, monthNum, loadEligible, rewardResults, addRewardBonuses, addRewardPoints, rewardIsPoints } from '../lib/rewards'
import { loadPointConfig } from '../lib/points'
import RewardGame from './RewardGame'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { TextInput } from '@astryxdesign/core/TextInput'
import { List, ListItem } from '@astryxdesign/core/List'
import { AstryxPage, Legacy } from '../astryx/AstryxPage'

const won = n => (n||0).toLocaleString('ko-KR')

// 사장님: 지난달 개근 포상을 할지 묻고(직원이 각자 룰렛 / 지금 사다리 / 안 함), 진행 상황과 포인트 지급 (예전 현금 상품 달은 상여)
// 대시보드와 근무관리 맨 위에 같은 카드로 나옴. 할 일이 없으면(개근 없음, 끝났고 다 지급) 아무것도 안 보임
export default function RewardPrompt() {
  const ym = prevYmOf()
  const m = monthNum(ym)
  const [rw, setRw] = useState(undefined)   // rewards/{ym} (undefined = 불러오는 중, null = 아직 안 정함)
  const [eligible, setEligible] = useState([])
  const [prizeText, setPrizeText] = useState('30포인트, 20포인트, 10포인트, 꽝')
  const [ladder, setLadder] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let off = false
    ;(async () => {
      try {
        const s = await getDoc(doc(db,'rewards',ym))
        const r = s.exists() ? s.data() : null
        const [el, cfg] = await Promise.all([r?.eligible || loadEligible(ym), loadPointConfig()])
        if (!off) { setRw(r); setEligible(el); if (cfg.prizes) setPrizeText(cfg.prizes) }
      } catch(e) { console.error(e); if (!off) setRw(null) }
    })()
    return () => { off = true }
  }, [ym, reload])

  const prizes = prizeText.split(/[,\n]/).map(s=>s.trim()).filter(Boolean)
  async function decide(status) {
    if (status === 'open' && !prizes.length) return alert('룰렛에 들어갈 상품을 적어 주세요')
    setBusy(true)
    try {
      await setDoc(doc(db,'rewards',ym), { status, eligible, unit:'point', ...(status==='open' ? { game:'roulette', prizes, openedAt:new Date().toISOString() } : { decidedAt:new Date().toISOString() }) }, { merge:true })
      setReload(k=>k+1)
    } catch(e) { console.error(e); alert('저장하지 못했어요.') }
    setBusy(false)
  }
  const isPts = rewardIsPoints(rw)
  async function payAll(rows) {
    const label = rw?.game==='ladder' ? '사다리' : '룰렛'
    if (isPts) {
      if (!window.confirm(`${rows.map(r=>`${r.name} ${r.amount}P`).join(', ')}를 포인트로 줄까요?`)) return
    } else if (!window.confirm(`${rows.map(r=>`${r.name} ${won(r.amount)}원`).join(', ')}을 ${m}월 급여 상여에 넣을까요?`)) return
    setBusy(true)
    try { if (isPts) await addRewardPoints(ym, rows, label); else await addRewardBonuses(ym, rows, label); setReload(k=>k+1) }
    catch(e) { console.error(e); alert('저장하지 못했어요.') }
    setBusy(false)
  }
  async function close() {
    await setDoc(doc(db,'rewards',ym), { status:'done' }, { merge:true }); setReload(k=>k+1)
  }

  if (rw === undefined) return null
  if (!eligible.length) return null
  const results = rewardResults(rw)
  const unpaid = results.filter(r => r.amount > 0 && !r.paid)
  if (rw?.status === 'skip') return null
  if (rw && rw.status !== 'open' && !unpaid.length) return null // 끝났고 다 지급함

  return (
    <AstryxPage>
      <Card variant="muted" padding={4}>
        {!rw ? (
          <VStack gap={3}>
            <VStack gap={1}>
              <Heading level={4}>{m}월 개근 {eligible.length}명 · 포상 게임을 할까요?</Heading>
              <Text color="secondary">{eligible.map(e=>e.name).join(', ')}</Text>
            </VStack>
            <TextInput label="룰렛 상품" description="쉼표로 나눠 적기, 같은 걸 여러 번 적으면 잘 나와요" value={prizeText} onChange={v=>setPrizeText(v)}/>
            <HStack gap={2} wrap="wrap">
              <Button variant="primary" label="직원이 각자 룰렛 돌리기" isDisabled={busy} onClick={()=>decide('open')}/>
              <Button label="지금 여기서 사다리로" isDisabled={busy} onClick={()=>setLadder(true)}/>
              <Button variant="ghost" label="이번 달은 안 함" isDisabled={busy} onClick={()=>decide('skip')}/>
            </HStack>
            <Text type="supporting" color="secondary">"각자 룰렛"을 고르면 개근한 직원의 내 기록에 룰렛이 떠서 한 번씩 돌릴 수 있어요. 결과는 여기와 매장 화면에 보여요.</Text>
          </VStack>
        ) : (
          <VStack gap={3}>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Heading level={4}>{m}월 개근 포상</Heading>
              {rw.status==='open' && <Badge variant="info" label="직원 룰렛 진행 중"/>}
            </HStack>
            <List hasDividers edge="flush">
              {eligible.map(e => {
                const r = results.find(x => x.uid === e.uid)
                return (
                  <ListItem key={e.uid} label={<Text weight="bold">{e.name}</Text>}
                    description={<Text color={r ? 'primary' : 'secondary'}>{r ? r.prize : '아직 안 돌림'}</Text>}
                    endContent={<HStack gap={2} vAlign="center">
                      {r && <Text hasTabularNumbers>{isPts ? `${r.amount}P` : `${won(r.amount)}원`}</Text>}
                      {r?.paid && <Badge variant="success" label={isPts ? '포인트 지급' : '상여 지급'}/>}
                    </HStack>}/>
                )
              })}
            </List>
            <HStack gap={2} wrap="wrap">
              {unpaid.length > 0 && <Button variant="primary" label={isPts ? `${unpaid.length}명 포인트 지급` : `${unpaid.length}명 ${m}월 급여 상여에 넣기`} isDisabled={busy} onClick={()=>payAll(unpaid)}/>}
              {rw.status === 'open' && <Button label="룰렛 마감" isDisabled={busy} onClick={close}/>}
            </HStack>
          </VStack>
        )}
        {ladder && <Legacy><RewardGame ym={ym} people={eligible} onClose={()=>{ setLadder(false); setReload(k=>k+1) }} onSaved={()=>setReload(k=>k+1)}/></Legacy>}
      </Card>
    </AstryxPage>
  )
}
