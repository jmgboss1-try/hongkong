import { useState } from 'react'
import { db } from '../firebase'
import { doc, setDoc } from 'firebase/firestore'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { TextInput } from '@astryxdesign/core/TextInput'
import { AstryxPage, PageHeader, LedgerCard } from '../astryx/AstryxPage'

const pad = n => String(n).padStart(2,'0')

const FIELDS = [
  { id:'hq',   label:'본사발주',   sec:'재료비' },
  { id:'veg',  label:'야채',       sec:'재료비' },
  { id:'oil',  label:'기름',       sec:'재료비' },
  { id:'box',  label:'용기&기타',  sec:'재료비' },
  { id:'gas',  label:'가스비',     sec:'관리비' },
  { id:'elec', label:'전기',       sec:'관리비' },
  { id:'omg',  label:'기타관리',   sec:'관리비' },
  { id:'rent', label:'임대료',     sec:'관리비' },
  { id:'dfee', label:'배달대행비', sec:'관리비' },
  { id:'meal', label:'식대',       sec:'인건비' },
]

export default function ExpensesInput() {
  const now = new Date()
  const today = `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  const todayDD = pad(now.getDate())
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const setF = (key,val) => setForm(f=>({...f,[key]:val}))

  async function save() {
    setSaving(true)
    try {
      // 지출 문서 전체를 읽지 않고 오늘 칸의 이 항목들만 덧씀 (직원은 지출 문서를 읽을 수 없음, 오늘 칸만 쓸 수 있음)
      const entry = {}
      FIELDS.forEach(f => { entry[f.id] = +form[f.id]||0 })
      await setDoc(doc(db,'expenses',today), { [todayDD]: entry }, { merge:true })
      setDone(true)
      setForm({})
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  const secs = ['재료비','관리비','인건비']
  const total = FIELDS.reduce((a,f)=>a+(+form[f.id]||0),0)

  return (
    <AstryxPage>
    <VStack gap={4}>
      <PageHeader title="오늘 지출 입력" sub={`${now.getFullYear()}년 ${now.getMonth()+1}월 ${now.getDate()}일 — 당일만 입력 가능`}/>
      {done ? (
        <Card padding={6}>
          <VStack gap={3} hAlign="center">
            <Heading level={3}>오늘 지출 입력 완료!</Heading>
            <Text color="secondary">{now.getMonth()+1}월 {now.getDate()}일 지출이 저장됐어요.</Text>
            <Button variant="primary" label="다시 입력" onClick={()=>setDone(false)}/>
          </VStack>
        </Card>
      ) : <>
        <Banner status="info" title="당일 지출만 입력 가능합니다." description="입력한 내역은 사장님만 조회할 수 있어요."/>
        <LedgerCard title="지출 입력" right={total > 0 && <Text weight="bold" hasTabularNumbers>합계 {total.toLocaleString('ko-KR')}원</Text>}>
          {secs.map(sec => (
            <VStack key={sec} gap={2}>
              <Heading level={5}>{sec}</Heading>
              <Grid columns={{ minWidth: 150, repeat: 'fill' }} gap={2}>
                {FIELDS.filter(f=>f.sec===sec).map(f => (
                  <TextInput key={f.id} label={f.label} inputMode="numeric" placeholder="0"
                    value={form[f.id] ? (+form[f.id]).toLocaleString('ko-KR') : ''} onChange={v=>setF(f.id, v.replace(/[^0-9]/g,''))}/>
                ))}
              </Grid>
            </VStack>
          ))}
          <HStack><Button variant="primary" label={saving?'저장 중...':'오늘 지출 저장'} isDisabled={saving} onClick={save}/></HStack>
        </LedgerCard>
      </>}
    </VStack>
    </AstryxPage>
  )
}
