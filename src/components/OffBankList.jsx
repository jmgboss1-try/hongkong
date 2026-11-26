import { useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { parseTxKey, currentClass, classLabel } from '../lib/bankReclass'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { List, ListItem } from '@astryxdesign/core/List'

const wonFmt = n => (n||0).toLocaleString('ko-KR')
const md = d => d && d.length >= 10 ? `${+d.slice(5,7)}/${+d.slice(8,10)}` : d
const dayDiff = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000)

// 통장 잔액 맞추기 → '통장 밖 지출'이 어느 날짜·어느 칸에서 생겼는지
//   칸마다: 적힌 금액 − 그 칸으로 들어간 통장 출금 = 통장으로 설명 안 되는 금액
//   근처(±3일) 같은 금액의 통장 출금이 다른 칸·영업 외로 이미 잡혀 있으면 '두 번 적힘' 의심으로 표시
export default function OffBankList({ ym, data, categories, detail, total, onChanged }) {
  const [busy, setBusy] = useState(null)
  const { rows, acks, unknown } = detail
  const outs = (data?.bankSeen||[]).map(parseTxKey).filter(t=>t.out)
  const ackKeys = new Set(acks.map(t=>t.key))
  // '이미 지출에 있음'으로 연결한 출금과 짝이 맞는 칸(같은 금액, 3일 안)은 정상 — 맨 아래로
  const paired = {}, usedAck = new Set()
  for (const r of rows) {
    if (r.amount <= 0) continue
    const t = acks.find(t => !usedAck.has(t.key) && t.amount === r.amount && Math.abs(dayDiff(t.date, r.date)) <= 3)
    if (t) { paired[r.day+r.cat] = t; usedAck.add(t.key) }
  }
  const suspects = r => r.amount > 0 && !paired[r.day+r.cat]
    ? outs.filter(t => t.out === r.amount && Math.abs(dayDiff(t.date, r.date)) <= 3 && !r.txs.some(x=>x.key===t.key) && !ackKeys.has(t.key))
    : []
  const sum = a => a.reduce((s,x)=>s+x.amount,0)
  const plus = rows.filter(r=>r.amount>0 && !paired[r.day+r.cat]), minus = rows.filter(r=>r.amount<0)
  const okRows = rows.filter(r=>paired[r.day+r.cat])
  const restAcks = acks.filter(t=>!usedAck.has(t.key))

  async function takeOut(r) {
    if (!confirm(`${md(r.date)} '${r.label}' 칸에서 ${wonFmt(r.amount)}원을 뺄까요?\n(통장 출금으로 들어온 ${wonFmt(r.bank)}원은 그대로 남아요)`)) return
    setBusy(r.day+r.cat)
    try {
      // 저장 직전 다시 읽기 (다른 화면에서 고쳤을 수 있음)
      const snap = await getDoc(doc(db,'expenses',ym))
      const d = snap.exists() ? snap.data() : {}
      const e = { ...(d[r.day]||{}) }
      const next = (e[r.cat]||0) - r.amount
      if (next < r.bank) throw new Error('그 사이 금액이 바뀌었어요. 화면을 새로 고친 뒤 다시 해 주세요.')
      e[r.cat] = next
      await setDoc(doc(db,'expenses',ym), { [r.day]: e }, { merge:true })
      await onChanged?.()
    } catch(err) { console.error(err); alert(err.message || '저장 중 오류가 발생했어요.') }
    setBusy(null)
  }

  const txList = list => (
    <List hasDividers edge="flush">
      {list.map(t => <ListItem key={t.key} label={t.desc||'—'} description={<Text type="supporting" color="secondary" hasTabularNumbers>{md(t.date)} {t.time.slice(0,5)}</Text>} endContent={<Text hasTabularNumbers>{wonFmt(t.amount)}</Text>}/>)}
    </List>
  )
  return (
    <Card variant="muted" padding={3}>
      <VStack gap={3}>
        <HStack hAlign="between" vAlign="center" gap={2}>
          <Heading level={5}>통장 밖 지출 찾기</Heading>
          <Text weight="bold" color="accent" hasTabularNumbers>{wonFmt(total)}원</Text>
        </HStack>
        <Text type="supporting" color="secondary">
          지출 칸에 적힌 금액 중 통장 출금으로 들어오지 않은 부분이에요. 현금으로 냈다면 맞는 것이고, 직원 지출입력·직접 입력으로 적었는데
          같은 돈이 통장 출금으로도 들어왔다면 두 번 적힌 것이라 빼야 해요. '두 번 적힘 의심'은 3일 안에 같은 금액이 통장에서 나간 경우예요.
        </Text>

        {!plus.length && !minus.length ? <Text color="secondary">통장 출금으로 설명 안 되는 칸이 없어요.</Text> : (
          <List hasDividers edge="flush">
            {[...plus, ...minus].map(r => {
              const sus = suspects(r)
              return (
                <ListItem key={r.day+r.cat} align="start"
                  label={<HStack gap={2} vAlign="center" wrap="wrap"><Text type="supporting" color="secondary" hasTabularNumbers>{md(r.date)}</Text><Text weight="bold">{r.label}</Text>{sus.length > 0 && <Badge variant="warning" label="두 번 적힘 의심"/>}</HStack>}
                  description={<VStack gap={1}>
                    <Text type="supporting" color="secondary" hasTabularNumbers>적힌 금액 {wonFmt(r.entered)} · 통장 출금 {r.bank ? wonFmt(r.bank) : '—'}</Text>
                    {r.amount < 0 && <Text type="supporting" color="accent">칸 금액이 통장 출금보다 적어요. 칸에서 금액을 손으로 줄였을 수 있어요.</Text>}
                    {sus.map(t => <Text key={t.key} type="supporting">{md(t.date)} {t.time.slice(0,5)} 통장 출금 '{t.desc||'—'}' {wonFmt(t.out)}원 → 지금 '{classLabel(currentClass(data, t).value, categories)}'</Text>)}
                    {r.amount > 0 && <HStack><Button size="sm" label={busy===r.day+r.cat ? '...' : `두 번 적힌 거면 이 칸에서 ${wonFmt(r.amount)}원 빼기`} isDisabled={busy===r.day+r.cat} onClick={()=>takeOut(r)}/></HStack>}
                  </VStack>}
                  endContent={<Text weight="bold" color={r.amount > 0 ? 'accent' : 'primary'} hasTabularNumbers>{r.amount>0 ? '+' : '−'}{wonFmt(Math.abs(r.amount))}</Text>}/>
              )
            })}
          </List>
        )}

        {okRows.length > 0 && (
          <VStack gap={1}>
            <Text weight="bold">통장 출금과 짝이 맞는 칸 {okRows.length}건 <Text type="supporting" color="secondary">('이미 지출에 있음'으로 연결한 출금, 정상)</Text></Text>
            <List hasDividers edge="flush">
              {okRows.map(r => { const t = paired[r.day+r.cat]; return (
                <ListItem key={r.day+r.cat} label={<Text type="supporting" hasTabularNumbers>{md(r.date)} {r.label} {wonFmt(r.amount)}</Text>} description={`= ${md(t.date)} 통장 출금 '${t.desc||'—'}'`}/>
              )})}
            </List>
          </VStack>
        )}
        {restAcks.length > 0 && (
          <VStack gap={1}>
            <Text weight="bold">'이미 지출에 있음'으로 연결했지만 짝을 못 찾은 통장 출금 {restAcks.length}건 <Text hasTabularNumbers>− {wonFmt(sum(restAcks))}</Text></Text>
            <Text type="supporting" color="secondary">위 목록의 금액 중 이만큼은 이 출금들로 설명돼요(날짜나 금액이 조금 달라 짝을 못 맞춘 것). 연결한 지출이 실제로 적혀 있는지 확인해 보세요.</Text>
            {txList(restAcks)}
          </VStack>
        )}
        {unknown.length > 0 && (
          <VStack gap={1}>
            <Text weight="bold">어느 칸인지 기록이 없는 통장 출금 {unknown.length}건 <Text hasTabularNumbers>− {wonFmt(sum(unknown))}</Text></Text>
            <Text type="supporting" color="secondary">아래 '통장 거래 분류 보기·바꾸기'에서 칸을 확인하면 위 목록이 정확해져요.</Text>
            {txList(unknown)}
          </VStack>
        )}
      </VStack>
    </Card>
  )
}
