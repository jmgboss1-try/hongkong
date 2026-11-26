import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { TextInput } from '@astryxdesign/core/TextInput'
import { DateInput } from '@astryxdesign/core/DateInput'
import { List, ListItem } from '@astryxdesign/core/List'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { AstryxPage, PageHeader, LedgerCard } from '../astryx/AstryxPage'

const pad = n => String(n).padStart(2, '0')
const wonFmt = n => (n || 0).toLocaleString('ko-KR') + '원'

const ITEMS = [
  { key: 'tang',   label: '탕소스', color: '#C3261C', emoji: '' },
  { key: 'cho',    label: '초단맛', color: '#B42318', emoji: '' },
  { key: 'noodle', label: '면',     color: '#2B5C9E', emoji: '' },
]

const TAGS = ['평일', '주말', '이벤트', '명절', '기타']

// 두 날짜 사이의 모든 날짜 배열 반환
function getDatesInRange(start, end) {
  const dates = []
  const s = new Date(start)
  const e = new Date(end)
  while (s <= e) {
    dates.push(s.toISOString().slice(0, 10))
    s.setDate(s.getDate() + 1)
  }
  return dates
}

// 매출 데이터에서 특정 날짜 범위 합산
async function fetchRevenueForRange(startDate, endDate) {
  const dates = getDatesInRange(startDate, endDate)
  // 관련 월들 추출 (YYYY-MM)
  const months = [...new Set(dates.map(d => d.slice(0, 7)))]

  let total = 0
  for (const month of months) {
    try {
      const snap = await getDoc(doc(db, 'revenue', month))
      if (!snap.exists()) continue
      const data = snap.data()
      for (const date of dates) {
        if (date.slice(0, 7) !== month) continue
        const dd = pad(+date.slice(8, 10))
        const r = data[dd]
        if (!r) continue
        // kiosk/del/pos 합산 (마감 기준)
        total += (r.kiosk || 0) + (r.del || 0) + (r.pos || 0)
      }
    } catch(e) { console.error(e) }
  }
  return total
}

export default function ConsumptionAnalysis() {
  const [records, setRecords]         = useState([])
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [showForm, setShowForm]       = useState(false)
  const [fetchingRevenue, setFetchingRevenue] = useState(false)

  // 입력 폼
  const [form, setForm] = useState({
    label: '', tag: '이벤트',
    startDate: '', endDate: '',
    revenue: '',
    tang: '', cho: '', noodle: '',
    memo: '',
  })

  // 백테스팅
  const [testRevenue, setTestRevenue] = useState('')

  async function load() {
    setLoading(true)
    try {
      const snap = await getDoc(doc(db, 'consumption', 'records'))
      setRecords(snap.exists() ? (snap.data().list || []) : [])
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // 기간 선택 시 매출 자동 불러오기
  async function handleDateChange(key, value) {
    const newForm = { ...form, [key]: value }
    setForm(newForm)

    const start = key === 'startDate' ? value : newForm.startDate
    const end   = key === 'endDate'   ? value : newForm.endDate

    if (start && end && start <= end) {
      setFetchingRevenue(true)
      try {
        const rev = await fetchRevenueForRange(start, end)
        setForm(f => ({ ...f, [key]: value, revenue: rev || '' }))
      } catch(e) { console.error(e) }
      setFetchingRevenue(false)
    }
  }

  function setF(key, val) { setForm(f => ({ ...f, [key]: val })) }

  async function saveRecord() {
    if (!form.label.trim())    return alert('상황명을 입력해주세요')
    if (!form.startDate)       return alert('시작일을 입력해주세요')
    if (!form.endDate)         return alert('종료일을 입력해주세요')
    if (!form.revenue)         return alert('매출을 확인해주세요')
    if (!form.tang && !form.cho && !form.noodle) return alert('소비량을 입력해주세요')

    setSaving(true)
    try {
      const days = getDatesInRange(form.startDate, form.endDate).length
      const newRecord = {
        id:        Date.now().toString(),
        label:     form.label,
        tag:       form.tag,
        startDate: form.startDate,
        endDate:   form.endDate,
        days,
        revenue:   +form.revenue,
        tang:      +form.tang   || 0,
        cho:       +form.cho    || 0,
        noodle:    +form.noodle || 0,
        memo:      form.memo,
        createdAt: new Date().toISOString(),
      }
      const newList = [...records, newRecord].sort((a, b) => a.startDate > b.startDate ? -1 : 1)
      await setDoc(doc(db, 'consumption', 'records'), { list: newList })
      setRecords(newList)
      setForm({ label:'', tag:'이벤트', startDate:'', endDate:'', revenue:'', tang:'', cho:'', noodle:'', memo:'' })
      setShowForm(false)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  async function deleteRecord(id) {
    if (!window.confirm('이 기록을 삭제하시겠습니까?')) return
    const newList = records.filter(r => r.id !== id)
    await setDoc(doc(db, 'consumption', 'records'), { list: newList })
    setRecords(newList)
  }

  // 전체 평균 소비율 계산 (매출 100만원당 봉 수)
  const totalRevenue = records.reduce((a, r) => a + r.revenue, 0)
  const avgPer100 = {}
  for (const item of ITEMS) {
    const totalConsumed = records.reduce((a, r) => a + (r[item.key] || 0), 0)
    avgPer100[item.key] = totalRevenue > 0
      ? (totalConsumed / totalRevenue * 1000000)
      : 0
  }

  // 백테스팅 계산
  const testAmt = +testRevenue || 0
  const testResult = {}
  for (const item of ITEMS) {
    testResult[item.key] = avgPer100[item.key] > 0
      ? Math.ceil(avgPer100[item.key] * testAmt / 1000000)
      : null
  }

  const hasData = records.length > 0

  const numIn = v => v.replace(/[^0-9]/g, '')
  const statCard = (item, big, sub) => (
    <Card key={item.key} variant="muted" padding={3}>
      <VStack gap={1}>
        <Text type="label" color="secondary">{item.label}</Text>
        {big}
        {sub && <Text type="supporting" color="secondary">{sub}</Text>}
      </VStack>
    </Card>
  )

  return (
    <AstryxPage>
    <VStack gap={4}>
      <PageHeader title="소비분석" sub="재료 소비 패턴 분석 · 발주 수량 예측" right={<Button variant="primary" label="+ 소비 기록" onClick={() => setShowForm(v => !v)}/>}/>

      {showForm && (
        <LedgerCard title="소비 기록 입력">
          <TextInput label="상황명" placeholder="예: 5월 이벤트, 어버이날 주말" value={form.label} onChange={v=>setF('label', v)}/>
          <VStack gap={1}>
            <Text type="label">태그</Text>
            <HStack gap={1} wrap="wrap">{TAGS.map(t => <Button key={t} size="sm" variant={form.tag===t ? 'primary' : 'secondary'} label={t} onClick={()=>setF('tag', t)}/>)}</HStack>
          </VStack>
          <HStack gap={2} vAlign="end" wrap="wrap">
            <DateInput label="시작일" value={form.startDate} onChange={v=>handleDateChange('startDate', v || '')}/>
            <DateInput label="종료일" value={form.endDate} onChange={v=>handleDateChange('endDate', v || '')}/>
            <TextInput label="기간 매출 (원)" description={fetchingRevenue ? '불러오는 중...' : form.revenue ? '매출에서 자동으로 채웠어요' : '날짜 선택 시 자동입력'}
              inputMode="numeric" width={180} value={form.revenue ? (+form.revenue).toLocaleString('ko-KR') : ''} onChange={v=>setF('revenue', numIn(v))}/>
          </HStack>
          <Card variant="muted" padding={3}>
            <VStack gap={2}>
              <Text weight="bold">재료 소비량 (봉)</Text>
              <Grid columns={{ minWidth: 120, max: 3, repeat: 'fit' }} gap={2}>
                {ITEMS.map(item => <TextInput key={item.key} label={item.label} inputMode="numeric" placeholder="0" value={form[item.key]} onChange={v=>setF(item.key, numIn(v))}/>)}
              </Grid>
            </VStack>
          </Card>
          <TextInput label="메모" isOptional placeholder="특이사항, 날씨, 행사 규모 등" value={form.memo} onChange={v=>setF('memo', v)}/>
          <HStack gap={2}>
            <Button variant="primary" label={saving ? '저장 중...' : '저장'} isDisabled={saving} onClick={saveRecord}/>
            <Button label="취소" onClick={()=>setShowForm(false)}/>
          </HStack>
        </LedgerCard>
      )}

      {loading ? <Text color="secondary">불러오는 중...</Text> : !hasData ? (
        <EmptyState title="아직 기록된 데이터가 없어요" description="소비 기록을 입력하면 발주 예측이 자동으로 계산됩니다"/>
      ) : <>
        <LedgerCard title={`매출 100만원당 평균 소비량 (${records.length}건 데이터 기준)`}>
          <Grid columns={{ minWidth: 140, max: 3, repeat: 'fit' }} gap={2}>
            {ITEMS.map(item => statCard(item, <Text type="display-3" hasTabularNumbers>{avgPer100[item.key] > 0 ? avgPer100[item.key].toFixed(1) : '—'}봉</Text>, '100만원 매출 기준'))}
          </Grid>
        </LedgerCard>

        <LedgerCard title="발주 수량 예측">
          <HStack gap={2} vAlign="end" wrap="wrap">
            <TextInput label="예상 매출 (원)" inputMode="numeric" placeholder="예: 2,000,000" width={200} value={testRevenue ? (+testRevenue).toLocaleString('ko-KR') : ''} onChange={v=>setTestRevenue(numIn(v))}/>
            {testAmt > 0 && <Text color="secondary">→ {wonFmt(testAmt)} 예상 시</Text>}
          </HStack>
          {testAmt > 0 ? (
            <Grid columns={{ minWidth: 140, max: 3, repeat: 'fit' }} gap={2}>
              {ITEMS.map(item => {
                const qty = testResult[item.key]
                return statCard(item, qty !== null ? <Text type="display-3" color="accent" hasTabularNumbers>{qty}봉 준비</Text> : <Text color="secondary">데이터 부족</Text>, qty !== null ? `±${Math.ceil(qty*0.1)}봉 여유 권장` : null)
              })}
            </Grid>
          ) : <Text type="supporting" color="secondary">예상 매출을 입력하면 필요 발주량이 자동으로 계산됩니다</Text>}
        </LedgerCard>

        <LedgerCard title={`소비 기록 (${records.length}건)`}>
          <List hasDividers edge="flush">
            {records.map(r => {
              const days = getDatesInRange(r.startDate, r.endDate).length
              return (
                <ListItem key={r.id} align="start"
                  label={<HStack gap={2} vAlign="center" wrap="wrap"><Text weight="bold">{r.label}</Text><Badge label={r.tag}/><Text type="supporting" color="secondary" hasTabularNumbers>{r.startDate} ~ {r.endDate} ({days}일)</Text></HStack>}
                  description={<VStack gap={2}>
                    <Text weight="bold" hasTabularNumbers>{wonFmt(r.revenue)}</Text>
                    <HStack gap={3} wrap="wrap">
                      {ITEMS.map(item => <Text key={item.key} type="supporting" hasTabularNumbers>{item.label} <Text weight="bold">{r[item.key]}봉</Text> <Text color="secondary">(일평균 {(r[item.key] / days).toFixed(1)}봉)</Text></Text>)}
                    </HStack>
                    {r.memo && <Text type="supporting" color="secondary">{r.memo}</Text>}
                  </VStack>}
                  endContent={<Button size="sm" variant="ghost" label="삭제" onClick={()=>deleteRecord(r.id)}/>}/>
              )
            })}
          </List>
        </LedgerCard>
      </>}
    </VStack>
    </AstryxPage>
  )
}
