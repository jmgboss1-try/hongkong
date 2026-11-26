import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { collection, addDoc, getDocs, doc, setDoc, deleteDoc, orderBy, query, where } from 'firebase/firestore'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { TextInput } from '@astryxdesign/core/TextInput'
import { DateInput } from '@astryxdesign/core/DateInput'
import { Table } from '@astryxdesign/core/Table'
import { TabList, Tab } from '@astryxdesign/core/TabList'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { AstryxPage, PageHeader, LedgerCard } from '../astryx/AstryxPage'

const pad = n => String(n).padStart(2,'0')
const today = () => {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
}

// 재고 직접 고치기: 바꾸면 저장 버튼이 나옴
function StockEdit({ item, onSave }) {
  const [v, setV] = useState(String(item.stock ?? ''))
  const changed = v !== String(item.stock ?? '')
  return (
    <HStack gap={1} vAlign="center">
      <TextInput label={`${item.name} 재고`} isLabelHidden size="sm" inputMode="decimal" width={80} value={v} onChange={x=>setV(x.replace(/[^0-9.]/g, ''))} onEnter={()=>changed && onSave(v)}/>
      {changed && <Button size="sm" variant="primary" label="저장" onClick={()=>onSave(v)}/>}
    </HStack>
  )
}

export default function Inventory() {
  const [items, setItems] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('list')

  // 품목 관리
  const [newItemName, setNewItemName] = useState('')
  const [newItemUnit, setNewItemUnit] = useState('')
  const [newItemStock, setNewItemStock] = useState('')

  // 입고/사용 기록
  const [logType, setLogType] = useState('use') // 'in' | 'use'
  const [logItem, setLogItem] = useState('')
  const [logQty, setLogQty] = useState('')
  const [logDate, setLogDate] = useState(today())
  const [logMemo, setLogMemo] = useState('')

  // 기간 조회
  const [startDate, setStartDate] = useState(()=>{
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`
  })
  const [endDate, setEndDate] = useState(today())

  async function load() {
    setLoading(true)
    try {
      const itemSnap = await getDocs(collection(db,'inventoryItems'))
      const itemList = []
      itemSnap.forEach(d => itemList.push({id:d.id, ...d.data()}))
      setItems(itemList.sort((a,b)=>a.name>b.name?1:-1))

      const logSnap = await getDocs(query(collection(db,'inventoryLogs'), orderBy('date','desc')))
      const logList = []
      logSnap.forEach(d => logList.push({id:d.id, ...d.data()}))
      setLogs(logList)
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(()=>{ load() },[])

  async function addItem() {
    if(!newItemName.trim()) return alert('품목명을 입력해주세요')
    await addDoc(collection(db,'inventoryItems'), {
      name: newItemName.trim(),
      unit: newItemUnit.trim() || '개',
      stock: +newItemStock || 0,
      createdAt: new Date().toISOString()
    })
    setNewItemName(''); setNewItemUnit(''); setNewItemStock('')
    await load()
  }

  async function deleteItem(id) {
    if(!window.confirm('품목을 삭제하시겠습니까?\n관련 기록은 유지됩니다.')) return
    await deleteDoc(doc(db,'inventoryItems',id))
    await load()
  }

  async function updateStock(id, stock) {
    await setDoc(doc(db,'inventoryItems',id), {stock:+stock}, {merge:true})
    await load()
  }

  async function addLog() {
    if(!logItem) return alert('품목을 선택해주세요')
    if(!logQty) return alert('수량을 입력해주세요')
    const item = items.find(i=>i.id===logItem)
    if(!item) return

    // 재고 업데이트
    const newStock = logType==='in'
      ? item.stock + (+logQty)
      : item.stock - (+logQty)

    await setDoc(doc(db,'inventoryItems',logItem), {stock: Math.max(0,newStock)}, {merge:true})

    // 기록 저장
    await addDoc(collection(db,'inventoryLogs'), {
      itemId: logItem,
      itemName: item.name,
      unit: item.unit,
      type: logType,
      qty: +logQty,
      date: logDate,
      memo: logMemo.trim(),
      createdAt: new Date().toISOString()
    })

    setLogQty(''); setLogMemo(''); setLogDate(today())
    await load()
    setActiveTab('list')
  }

  async function deleteLog(id, log) {
    if(!window.confirm('기록을 삭제하시겠습니까?\n재고가 복원됩니다.')) return
    const item = items.find(i=>i.id===log.itemId)
    if(item) {
      const restored = log.type==='in'
        ? item.stock - log.qty
        : item.stock + log.qty
      await setDoc(doc(db,'inventoryItems',log.itemId), {stock:Math.max(0,restored)}, {merge:true})
    }
    await deleteDoc(doc(db,'inventoryLogs',id))
    await load()
  }

  // 기간별 통계
  const filteredLogs = logs.filter(l => l.date >= startDate && l.date <= endDate)
  const statsByItem = items.map(item => {
    const itemLogs = filteredLogs.filter(l=>l.itemId===item.id)
    const totalIn = itemLogs.filter(l=>l.type==='in').reduce((a,l)=>a+l.qty,0)
    const totalUse = itemLogs.filter(l=>l.type==='use').reduce((a,l)=>a+l.qty,0)
    return { ...item, totalIn, totalUse, logCount: itemLogs.length }
  }).filter(s=>s.logCount>0)

  const stockText = item => <Text weight="bold" color={item.stock <= 5 ? 'accent' : 'primary'} hasTabularNumbers>{item.stock}{item.unit}</Text>
  const numIn = v => v.replace(/[^0-9.]/g, '')

  return (
    <AstryxPage>
    <VStack gap={4}>
      <PageHeader title="재고관리" sub="사장 전용 — 식재료/소스 관리"/>
      <TabList value={activeTab} onChange={v=>v && setActiveTab(v)}>
        <Tab value="list" label="품목 목록"/>
        <Tab value="log" label="입고/사용 기록"/>
        <Tab value="history" label="기록 내역"/>
        <Tab value="stats" label="기간별 통계"/>
      </TabList>

      {loading ? <Text color="secondary">불러오는 중...</Text> : <>
        {activeTab==='list' && <>
          <LedgerCard title="품목 추가">
            <HStack gap={2} vAlign="end" wrap="wrap">
              <TextInput label="품목명" placeholder="예: 춘장, 식용유" value={newItemName} onChange={v=>setNewItemName(v)} onEnter={addItem}/>
              <TextInput label="단위" placeholder="kg, L, 개" width={100} value={newItemUnit} onChange={v=>setNewItemUnit(v)}/>
              <TextInput label="초기 재고" inputMode="decimal" placeholder="0" width={110} value={newItemStock} onChange={v=>setNewItemStock(numIn(v))}/>
              <Button variant="primary" label="추가" onClick={addItem}/>
            </HStack>
          </LedgerCard>
          <LedgerCard title={`등록된 품목 (${items.length}개)`}>
            <Table data={items} idKey="id" density="compact" emptyState={<EmptyState title="등록된 품목이 없습니다" isCompact/>}
              columns={[
                { key:'name', header:'품목명', renderCell: it => <Text weight="bold">{it.name}</Text> },
                { key:'unit', header:'단위', renderCell: it => <Text color="secondary">{it.unit}</Text> },
                { key:'stock', header:'현재 재고', align:'end', renderCell: it => stockText(it) },
                { key:'edit', header:'직접 수정', renderCell: it => <StockEdit key={it.id + ':' + it.stock} item={it} onSave={v=>updateStock(it.id, v)}/> },
                { key:'act', header:'', align:'end', renderCell: it => <Button size="sm" variant="ghost" label="삭제" onClick={()=>deleteItem(it.id)}/> },
              ]}/>
          </LedgerCard>
        </>}

        {activeTab==='log' && (
          <LedgerCard title="입고 / 사용 기록">
            <HStack><SegmentedControl label="유형" value={logType} onChange={v=>v && setLogType(v)}>
              <SegmentedControlItem value="use" label="사용"/>
              <SegmentedControlItem value="in" label="입고"/>
            </SegmentedControl></HStack>
            <HStack><DateInput label="날짜" value={logDate} onChange={v=>setLogDate(v||logDate)}/></HStack>
            <VStack gap={2}>
              <Text type="label">품목</Text>
              <HStack gap={1} wrap="wrap">
                {items.map(it => <Button key={it.id} size="sm" variant={logItem===it.id ? 'primary' : 'secondary'} label={`${it.name} (${it.stock}${it.unit})`} onClick={()=>setLogItem(it.id)}/>)}
              </HStack>
            </VStack>
            <TextInput label={`${logType==='in'?'입고':'사용'} 수량${logItem ? ` (현재: ${items.find(i=>i.id===logItem)?.stock}${items.find(i=>i.id===logItem)?.unit})` : ''}`}
              inputMode="decimal" placeholder="0" value={logQty} onChange={v=>setLogQty(numIn(v))}/>
            <TextInput label="메모" isOptional placeholder="특이사항..." value={logMemo} onChange={v=>setLogMemo(v)}/>
            <Button variant="primary" width="100%" label={`${logType==='in'?'입고 기록':'사용 기록'} 저장`} onClick={addLog}/>
          </LedgerCard>
        )}

        {activeTab==='history' && (
          <LedgerCard title="전체 기록 내역">
            <Table data={logs} idKey="id" density="compact" emptyState={<EmptyState title="기록이 없습니다" isCompact/>}
              columns={[
                { key:'date', header:'날짜', renderCell: l => <Text hasTabularNumbers textWrap="nowrap">{l.date}</Text> },
                { key:'item', header:'품목', renderCell: l => <Text weight="bold">{l.itemName}</Text> },
                { key:'type', header:'유형', renderCell: l => <Badge variant={l.type==='in' ? 'success' : 'error'} label={l.type==='in' ? '입고' : '사용'}/> },
                { key:'qty', header:'수량', align:'end', renderCell: l => <Text weight="bold" hasTabularNumbers>{l.type==='in'?'+':'−'}{l.qty}{l.unit}</Text> },
                { key:'memo', header:'메모', renderCell: l => <Text type="supporting" color="secondary">{l.memo||'—'}</Text> },
                { key:'act', header:'', align:'end', renderCell: l => <Button size="sm" variant="ghost" label="삭제" onClick={()=>deleteLog(l.id, l)}/> },
              ]}/>
          </LedgerCard>
        )}

        {activeTab==='stats' && <>
          <LedgerCard title="기간 설정">
            <HStack gap={2} wrap="wrap">
              <DateInput label="시작일" value={startDate} onChange={v=>v && setStartDate(v)}/>
              <DateInput label="종료일" value={endDate} onChange={v=>v && setEndDate(v)}/>
            </HStack>
          </LedgerCard>
          <LedgerCard title={`${startDate} ~ ${endDate} 품목별 현황`}>
            <Table data={statsByItem} idKey="id" density="compact" emptyState={<EmptyState title="해당 기간에 기록이 없습니다" isCompact/>}
              columns={[
                { key:'name', header:'품목', renderCell: it => <Text weight="bold">{it.name}</Text> },
                { key:'unit', header:'단위', renderCell: it => <Text color="secondary">{it.unit}</Text> },
                { key:'in', header:'입고량', align:'end', renderCell: it => <Text hasTabularNumbers>+{it.totalIn}{it.unit}</Text> },
                { key:'use', header:'사용량', align:'end', renderCell: it => <Text hasTabularNumbers>−{it.totalUse}{it.unit}</Text> },
                { key:'stock', header:'현재 재고', align:'end', renderCell: it => stockText(it) },
              ]}/>
          </LedgerCard>
        </>}
      </>}
    </VStack>
    </AstryxPage>
  )
}
