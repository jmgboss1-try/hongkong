import { useEffect, useState } from 'react'
import { db, auth } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useAuth } from '../AuthContext'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Selector } from '@astryxdesign/core/Selector'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Table } from '@astryxdesign/core/Table'
import { List, ListItem } from '@astryxdesign/core/List'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { AstryxPage, PageHeader, LedgerCard, Ledger, LedgerRow } from '../astryx/AstryxPage'

const pad = n => String(n).padStart(2,'0')
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const diffLabel = d => d == null ? '—' : d === 0 ? '일치' : d > 0 ? `+${d.toLocaleString()}원` : `${d.toLocaleString()}원`

const BILLS = [
  { id:'w50000', label:'오만원권', value:50000 },
  { id:'w10000', label:'만원권',   value:10000 },
  { id:'w5000',  label:'오천원권', value:5000  },
  { id:'w1000',  label:'천원권',   value:1000  },
  { id:'w500',   label:'오백원',   value:500   },
  { id:'w100',   label:'백원',     value:100   },
]

function CashForm({ type, baseAmount, onSave, existing }) {
  const [counts, setCounts] = useState(() => {
    if(existing) return existing.counts || {}
    return {}
  })
  const [cashSales, setCashSales] = useState(existing?.cashSales||'')
  const [memo, setMemo] = useState(existing?.memo||'')
  const [saving, setSaving] = useState(false)

  const total = BILLS.reduce((a,b) => a + (counts[b.id]||0)*b.value, 0)
  const expected = baseAmount + (type==='close' ? (+cashSales||0) : 0)
  const diff = total - expected

  async function save() {
    setSaving(true)
    await onSave({ counts, total, cashSales:+cashSales||0, memo, diff, savedAt: new Date().toISOString() })
    setSaving(false)
  }

  return (
    <VStack gap={3}>
      {/* 권종 입력 */}
      <List hasDividers edge="flush">
        {BILLS.map(b => (
          <ListItem key={b.id} label={<Text weight="bold">{b.label}</Text>}
            description={<Text type="supporting" color="secondary" hasTabularNumbers>{b.value.toLocaleString()}원</Text>}
            endContent={<HStack gap={1} vAlign="center">
              <Button size="sm" label="−" onClick={()=>setCounts(c=>({...c,[b.id]:Math.max(0,(c[b.id]||0)-1)}))}/>
              <TextInput label={`${b.label} 장수`} isLabelHidden size="sm" inputMode="numeric" width={64} value={counts[b.id] ? String(counts[b.id]) : ''}
                onChange={v=>setCounts(c=>({...c,[b.id]:+v.replace(/[^0-9]/g,'')||0}))}/>
              <Button size="sm" label="+" onClick={()=>setCounts(c=>({...c,[b.id]:(c[b.id]||0)+1}))}/>
              <Text type="supporting" color="accent" hasTabularNumbers textWrap="nowrap">{((counts[b.id]||0)*b.value).toLocaleString()}원</Text>
            </HStack>}/>
        ))}
      </List>

      {/* 현금 매출 (마감시에만) */}
      {type==='close' && (
        <TextInput label="현금 매출 (원)" inputMode="numeric" placeholder="0" value={cashSales ? (+cashSales).toLocaleString('ko-KR') : ''} onChange={v=>setCashSales(v.replace(/[^0-9]/g,''))}/>
      )}
      <TextInput label="메모" placeholder="특이사항 입력..." value={memo} onChange={v=>setMemo(v)}/>

      {/* 합계 & 차액 */}
      <Card variant="muted" padding={3}>
        <Ledger rows={<>
          <LedgerRow label="실제 시재 합계" value={total}/>
          <LedgerRow label={`기준 시재${type==='close'?'+현금매출':''}`} value={expected} sub/>
        </>} total={<LedgerRow label="차액 (오차)" text={diffLabel(diff)} strong tone={diff < 0 ? 'bad' : diff > 0 ? 'accent' : undefined}/>}/>
      </Card>

      <Button variant="primary" width="100%" label={saving?'저장 중...':`${type==='open'?'오픈':'마감'} 시재 저장`} isDisabled={saving} onClick={save}/>
    </VStack>
  )
}

export default function Cash() {
  const { isOwner, userData } = useAuth()
  const now = new Date()
  const today = `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  const todayDD = pad(now.getDate())

  const [baseAmount, setBaseAmount] = useState(0)
  const [tempBase, setTempBase] = useState('')
  const [activeType, setActiveType] = useState('open')
  const [records, setRecords] = useState({})
  const [loading, setLoading] = useState(true)
  const [viewDate, setViewDate] = useState(todayDD)
  const [showHistory, setShowHistory] = useState(false)
  const [histMonth, setHistMonth]     = useState(today)   // 이전 기록에서 볼 달
  const [histRecords, setHistRecords] = useState(null)    // 이번 달이 아닌 달의 기록

  // 포스기에서 하루 종일 켜두므로 1분마다 날짜를 다시 확인 — 날짜가 바뀌면 그날 문서를 새로 불러옴
  const [, setTick] = useState(0)
  useEffect(()=>{
    const id = setInterval(()=>setTick(t=>t+1), 60000)
    return ()=>clearInterval(id)
  },[])

  useEffect(()=>{
    async function load() {
      setLoading(true)
      try {
        // 기준 시재 불러오기
        const baseSnap = await getDoc(doc(db,'cashSettings','base'))
        if(baseSnap.exists()) setBaseAmount(baseSnap.data().amount||0)

        // 오늘 시재 기록
        const snap = await getDoc(doc(db,'cash',today))
        setRecords(snap.exists() ? snap.data() : {})
        setViewDate(todayDD)
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  },[today, todayDD])

  // 지난 달 기록 불러오기 (이번 달은 records를 그대로 사용)
  useEffect(()=>{
    if(!showHistory || histMonth===today) return
    let ignore = false
    getDoc(doc(db,'cash',histMonth))
      .then(snap=>{ if(!ignore) setHistRecords(snap.exists() ? snap.data() : {}) })
      .catch(e=>console.error(e))
    return ()=>{ ignore = true }
  },[showHistory, histMonth, today])

  async function saveBaseAmount() {
    const amt = +tempBase
    if(!amt) return alert('금액을 입력해주세요')
    await setDoc(doc(db,'cashSettings','base'), {amount:amt})
    setBaseAmount(amt)
    setTempBase('')
    alert(`기준 시재가 ${amt.toLocaleString()}원으로 설정됐습니다.`)
  }

async function saveRecord(type, data) {
  const now = new Date()
  const timeStr = now.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})
  const dateStr = now.toLocaleDateString('ko-KR')

  // 저장 직전 최신 데이터를 다시 읽음 — 다른 기기에서 저장한 오픈/마감 기록을 덮어쓰지 않도록
  const snap = await getDoc(doc(db,'cash',today))
  const latest = snap.exists() ? snap.data() : {}
  const newRecords = {
    ...latest,
    [todayDD]: {
      ...(latest[todayDD]||{}),
      [type]: {
        ...data,
        recordedAt: timeStr,
        recordedDate: dateStr,
        recordedBy: auth.currentUser?.email || '알 수 없음',
        recordedByName: userData?.name || '알 수 없음',
      }
    }
  }
  await setDoc(doc(db,'cash',today), { [todayDD]: newRecords[todayDD] }, { merge:true })
  setRecords(newRecords)
  alert(`${type==='open'?'오픈':'마감'} 시재가 저장됐습니다!`)
}

  const todayRecord = records[todayDD] || {}
  const shownRecords = histMonth===today ? records : (histRecords || {})
  const monthOpts = []
  for(let y=2022; y<=now.getFullYear(); y++) for(let m=1; m<=12; m++) {
    const ym = `${y}-${pad(m)}`
    if(ym <= today) monthOpts.push(ym)
  }
  monthOpts.reverse()

  const histDays = Object.keys(shownRecords).filter(k=>/^\d{2}$/.test(k)).sort().map(dd => ({ dd, r: shownRecords[dd] }))
  const diffCell = d => d === undefined ? <Text color="secondary">—</Text> : <Text hasTabularNumbers color={d < 0 ? 'accent' : d === 0 ? 'secondary' : 'primary'}>{diffLabel(d)}</Text>

  return (
    <AstryxPage>
    <VStack gap={4}>
      <PageHeader title="현금시재" sub={`${now.getFullYear()}년 ${now.getMonth()+1}월 ${now.getDate()}일`}/>

      {/* 기준 시재 설정 (사장만) */}
      {isOwner && (
        <LedgerCard title="기준 시재 설정" right={<Text type="supporting" color="secondary" hasTabularNumbers>현재 {baseAmount.toLocaleString()}원</Text>}>
          <HStack gap={2} vAlign="end">
            <TextInput label="기준 시재" isLabelHidden inputMode="numeric" placeholder={`현재: ${baseAmount.toLocaleString()}원`}
              value={tempBase ? (+tempBase).toLocaleString('ko-KR') : ''} onChange={v=>setTempBase(v.replace(/[^0-9]/g,''))}/>
            <Button variant="primary" label="설정" onClick={saveBaseAmount}/>
          </HStack>
        </LedgerCard>
      )}

      {/* 오늘 현황 요약 */}
      <Grid columns={2} gap={3}>
        {['open','close'].map(type => {
          const rec = todayRecord[type]
          return (
            <Card key={type} padding={4}>
              <VStack gap={1}>
                <HStack gap={2} vAlign="center"><Text type="label" color="secondary">{type==='open'?'오픈 시재':'마감 시재'}</Text>{rec ? <Badge variant="success" label="입력됨"/> : <Badge label="미입력"/>}</HStack>
                {rec && <>
                  <Text type="large" weight="bold" hasTabularNumbers>{rec.total?.toLocaleString()}원</Text>
                  <Text type="supporting" color="secondary">{rec.recordedAt} · {rec.recordedByName||rec.recordedBy||'?'}</Text>
                  <Text type="supporting" color={rec.diff < 0 ? 'accent' : 'secondary'} hasTabularNumbers>차액: {diffLabel(rec.diff)}</Text>
                  {rec.memo && <Text type="supporting">{rec.memo}</Text>}
                </>}
              </VStack>
            </Card>
          )
        })}
      </Grid>

      {/* 오픈/마감 */}
      <SegmentedControl label="오픈·마감" value={activeType} onChange={v=>v && setActiveType(v)}>
        <SegmentedControlItem value="open" label="오픈 시재"/>
        <SegmentedControlItem value="close" label="마감 시재"/>
      </SegmentedControl>

      {loading ? <Text color="secondary">불러오는 중...</Text> : (
        <LedgerCard title={activeType==='open'?'오픈 시재 입력':'마감 시재 입력'} right={todayRecord[activeType] && <Badge variant="success" label="저장됨"/>}>
          <CashForm key={activeType} type={activeType} baseAmount={baseAmount} existing={todayRecord[activeType]} onSave={(data)=>saveRecord(activeType,data)}/>
        </LedgerCard>
      )}

      {/* 사장만: 이전 기록 */}
      {isOwner && <>
        <Button width="100%" label={showHistory ? '이전 기록 닫기' : '이전 기록 보기'} onClick={()=>setShowHistory(v=>!v)}/>
        {showHistory && (
          <LedgerCard title={`${mLabel(histMonth)} 시재 기록`} right={
            <Selector label="달 고르기" isLabelHidden size="sm" value={histMonth} onChange={v=>{ if (!v) return; setHistRecords(null); setHistMonth(v) }} options={monthOpts.map(m=>({ value:m, label:mLabel(m) }))}/>}>
            {histMonth!==today && histRecords===null ? <Text color="secondary">불러오는 중...</Text> : (
              <HStack isScrollable>
                <Table data={histDays} idKey="dd" density="compact" emptyState={<EmptyState title="기록 없음" isCompact/>}
                  columns={[
                    { key:'dd', header:'날짜', width:64, renderCell: x => <Text textWrap="nowrap">{+x.dd}일</Text> },
                    { key:'ot', header:'오픈 시재', width:100, align:'end', renderCell: x => <Text hasTabularNumbers>{x.r.open?.total?.toLocaleString()||'—'}</Text> },
                    { key:'ob', header:'오픈 입력자', width:96, align:'end', renderCell: x => <Text type="supporting" color="secondary">{x.r.open?.recordedByName||x.r.open?.recordedBy||'—'}</Text> },
                    { key:'od', header:'오픈 차액', width:96, align:'end', renderCell: x => diffCell(x.r.open?.diff) },
                    { key:'ct', header:'마감 시재', width:100, align:'end', renderCell: x => <Text hasTabularNumbers>{x.r.close?.total?.toLocaleString()||'—'}</Text> },
                    { key:'cb', header:'마감 입력자', width:96, align:'end', renderCell: x => <Text type="supporting" color="secondary">{x.r.close?.recordedByName||x.r.close?.recordedBy||'—'}</Text> },
                    { key:'cd', header:'마감 차액', width:96, align:'end', renderCell: x => diffCell(x.r.close?.diff) },
                    { key:'cs', header:'현금매출', width:110, align:'end', renderCell: x => <Text hasTabularNumbers>{x.r.close?.cashSales ? x.r.close.cashSales.toLocaleString()+'원' : '—'}</Text> },
                    { key:'memo', header:'메모', width:200, renderCell: x => <Text type="supporting">{[x.r.open?.memo, x.r.close?.memo].filter(Boolean).join(' / ') || '—'}</Text> },
                  ]}/>
              </HStack>
            )}
          </LedgerCard>
        )}
      </>}
    </VStack>
    </AstryxPage>
  )
}
