import { useState } from 'react'
import { db } from '../firebase'
import { doc, setDoc } from 'firebase/firestore'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Grid } from '@astryxdesign/core/Grid'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Selector } from '@astryxdesign/core/Selector'
import { TextArea } from '@astryxdesign/core/TextArea'
import { List, ListItem } from '@astryxdesign/core/List'
import { LedgerCard } from '../astryx/AstryxPage'
import { LINE_DEFS, DEFAULT_LINES, FREQ_DEFS, FREQ_LABELS, TONES, DEFAULT_LIFE } from '../lib/storeLife'

// 우리 매장 '매장 장면 설정' (사장님만): 손님·직원 대사, 일이 얼마나 자주 생기나, 키오스크/포스 주문 비율, 사장님 기본 반응
// rewards/storeLife 에 저장 (매장계정·직원이 읽을 수 있는 곳이라 규칙을 안 바꿔도 됨)
const toText = list => (list || []).join('\n')
const fromText = text => String(text).split('\n').map(x => x.trim()).filter(Boolean)

export default function StoreLifeSettings({ raw }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(null)   // 고치는 중인 값 (열 때 저장된 값으로 채움)
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)

  const start = () => {
    setForm({
      freq: { ...DEFAULT_LIFE.freq, ...(raw?.freq || {}) },
      kioskRate: raw?.kioskRate ?? DEFAULT_LIFE.kioskRate,
      tone: raw?.tone || DEFAULT_LIFE.tone,
      lines: Object.fromEntries(LINE_DEFS.map(([k]) => [k, toText(raw?.lines?.[k]?.length ? raw.lines[k] : DEFAULT_LINES[k])])),
    })
    setOpen(true); setMsg('')
  }
  const save = async () => {
    setSaving(true); setMsg('')
    try {
      const lines = Object.fromEntries(Object.entries(form.lines).map(([k, v]) => [k, fromText(v)]))
      await setDoc(doc(db, 'rewards', 'storeLife'), { freq: form.freq, kioskRate: +form.kioskRate, tone: form.tone, lines }, { merge: true })
      setMsg('저장했어요. 매장 그림에 바로 반영돼요')
    } catch (e) { console.error(e); setMsg('저장하지 못했어요') }
    setSaving(false)
  }
  const setLine = (k, v) => setForm(f => ({ ...f, lines: { ...f.lines, [k]: v } }))

  return (
    <LedgerCard title="매장 장면 설정" right={<HStack gap={2} vAlign="center">
      <Text type="supporting" color="secondary">손님·직원 대사, 일이 얼마나 자주 생기나, 사장님 반응</Text>
      <Button size="sm" label={open ? '접기' : '고치기'} onClick={() => open ? setOpen(false) : start()}/>
    </HStack>}>
      {open && form && <>
        <List hasDividers edge="flush">
          {FREQ_DEFS.map(([k, label]) => (
            <ListItem key={k} label={label} endContent={<Selector label={label} isLabelHidden size="sm" value={String(form.freq[k])}
              onChange={v => v != null && setForm(f => ({ ...f, freq: { ...f.freq, [k]: +v } }))} options={FREQ_LABELS.map((l, i) => ({ value:String(i), label:l }))}/>}/>
          ))}
          <ListItem label="키오스크로 주문하는 손님" endContent={<Selector label="키오스크 비율" isLabelHidden size="sm" value={String(form.kioskRate)}
            onChange={v => v && setForm(f => ({ ...f, kioskRate: +v }))} options={[100, 90, 80, 70, 60, 50].map(v => ({ value:String(v), label:`${v}% (포스 ${100 - v}%)` }))}/>}/>
          <ListItem label="주방 실수 때 사장님 반응" endContent={<Selector label="사장님 반응" isLabelHidden size="sm" value={form.tone}
            onChange={v => v && setForm(f => ({ ...f, tone: v }))} options={TONES.map(([k, l]) => ({ value:k, label:l }))}/>}/>
        </List>
        <Text type="supporting" color="secondary">실수가 생기면 사장님 화면에 '다그치기 · 다독이기 · 위로' 버튼이 12초 동안 나와요. 고르면 모든 화면에서 사장님 캐릭터가 그렇게 말하고, 안 고르면 위 기본 반응으로 말해요.</Text>

        <Heading level={5}>대사</Heading>
        <Text type="supporting" color="secondary">한 줄에 하나씩. 그중 하나를 골라서 말해요. '/'를 넣으면 말풍선이 두 줄이 되고, 손님끼리 수다는 '말1 &gt; 말2'로 적어요.</Text>
        <Grid columns={{ minWidth: 300, max: 2, repeat: 'fit' }} gap={3}>
          {LINE_DEFS.map(([k, label, who]) => (
            <VStack key={k} gap={1}>
              <HStack gap={2} vAlign="center" hAlign="between">
                <HStack gap={2} vAlign="center"><Text weight="bold">{label}</Text><Badge label={who}/></HStack>
                {form.lines[k] !== toText(DEFAULT_LINES[k]) && <Button size="sm" variant="ghost" label="기본으로" onClick={() => setLine(k, toText(DEFAULT_LINES[k]))}/>}
              </HStack>
              <TextArea label={label} isLabelHidden rows={Math.min(5, Math.max(2, form.lines[k].split('\n').length))} value={form.lines[k]} onChange={v => setLine(k, v)}/>
            </VStack>
          ))}
        </Grid>
        <HStack gap={2} vAlign="center">
          <Button variant="primary" label={saving ? '저장 중…' : '저장'} isDisabled={saving} onClick={save}/>
          <Button label="닫기" onClick={() => setOpen(false)}/>
          {msg && <Text type="supporting" color={msg.startsWith('저장했') ? 'secondary' : 'accent'}>{msg}</Text>}
        </HStack>
      </>}
    </LedgerCard>
  )
}
