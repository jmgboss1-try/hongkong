import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, orderBy, query } from 'firebase/firestore'
import { useAuth } from '../AuthContext'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { TextInput } from '@astryxdesign/core/TextInput'
import { TabList, Tab } from '@astryxdesign/core/TabList'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { AstryxPage, PageHeader, LedgerCard } from '../astryx/AstryxPage'

const URGENCY = {
  normal: { label:'일반', color:'#6E6A63', bg:'rgba(94,101,133,0.15)' },
  urgent: { label:'긴급', color:'#B42318', bg:'rgba(180,35,24,0.15)' },
}

const STATUS = {
  pending:  { label:'대기중',   color:'var(--hk-accent)', bg:'rgba(var(--hk-accent-rgb),0.15)'  },
  checked:  { label:'확인완료', color:'#2B5C9E', bg:'rgba(43,92,158,0.15)' },
  done:     { label:'완료',     color:'#2E7D45', bg:'rgba(46,125,69,0.15)'  },
}

export default function Order() {
  const { user, userData, isOwner } = useAuth()
  const [orders, setOrders] = useState([])
  const [presets, setPresets] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('list')
  const [filterStatus, setFilterStatus] = useState('all')

  // 새 요청 폼
  const [selPreset, setSelPreset] = useState('')
  const [customItem, setCustomItem] = useState('')
  const [qty, setQty] = useState('')
  const [urgency, setUrgency] = useState('normal')
  const [memo, setMemo] = useState('')

  // 품목 관리 (사장)
  const [newPreset, setNewPreset] = useState('')
  const [newPresetUnit, setNewPresetUnit] = useState('')

  async function load() {
    setLoading(true)
    try {
      const orderSnap = await getDocs(query(collection(db,'orders'), orderBy('createdAt','desc')))
      const list = []
      orderSnap.forEach(d => list.push({id:d.id, ...d.data()}))
      setOrders(list)

      const presetSnap = await getDocs(collection(db,'orderPresets'))
      const pList = []
      presetSnap.forEach(d => pList.push({id:d.id, ...d.data()}))
      setPresets(pList.sort((a,b)=>a.name>b.name?1:-1))
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function addOrder() {
    const itemName = selPreset || customItem.trim()
    if(!itemName) return alert('품목을 선택하거나 입력해주세요')
    if(!qty) return alert('수량을 입력해주세요')

    const preset = presets.find(p=>p.name===selPreset)
    await addDoc(collection(db,'orders'), {
      itemName,
      unit: preset?.unit || '',
      qty: +qty,
      urgency,
      memo: memo.trim(),
      status: 'pending',
      authorName: userData?.name || '직원',
      authorUid: user.uid,
      createdAt: new Date().toISOString(),
    })
    setSelPreset(''); setCustomItem(''); setQty(''); setUrgency('normal'); setMemo('')
    await load()
    setActiveTab('list')
  }

  async function updateStatus(id, status) {
    await updateDoc(doc(db,'orders',id), { status, checkedAt: new Date().toISOString() })
    await load()
  }

  async function deleteOrder(id) {
    if(!window.confirm('삭제하시겠습니까?')) return
    await deleteDoc(doc(db,'orders',id))
    await load()
  }

  async function addPreset() {
    if(!newPreset.trim()) return alert('품목명을 입력해주세요')
    await addDoc(collection(db,'orderPresets'), {
      name: newPreset.trim(),
      unit: newPresetUnit.trim() || '개'
    })
    setNewPreset(''); setNewPresetUnit('')
    await load()
  }

  async function deletePreset(id) {
    if(!window.confirm('품목을 삭제하시겠습니까?')) return
    await deleteDoc(doc(db,'orderPresets',id))
    await load()
  }

  function timeAgo(iso) {
    const diff = (new Date() - new Date(iso)) / 1000
    if(diff < 60) return '방금 전'
    if(diff < 3600) return `${Math.floor(diff/60)}분 전`
    if(diff < 86400) return `${Math.floor(diff/3600)}시간 전`
    return `${Math.floor(diff/86400)}일 전`
  }

  const filtered = filterStatus==='all' ? orders : orders.filter(o=>o.status===filterStatus)
  const pendingCount = orders.filter(o=>o.status==='pending').length
  const urgentCount = orders.filter(o=>o.status==='pending'&&o.urgency==='urgent').length

  const STATUS_BADGE = { pending:'warning', checked:'info', done:'success' }

  return (
    <AstryxPage>
    <VStack gap={4}>
      <PageHeader title="발주 요청" sub="재고 부족 및 주문 요청 관리"/>

      <Grid columns={{ minWidth: 150, max: 3, repeat: 'fit' }} gap={3}>
        {[['대기중 요청', pendingCount, true], ['긴급 요청', urgentCount], ['전체 요청', orders.length]].map(([label, val, filled]) => (
          <Card key={label} variant={filled ? 'red' : 'default'} padding={4}>
            <VStack gap={1}><Text type="label" color={filled ? 'inherit' : 'secondary'}>{label}</Text><Text type="display-3" color={filled ? 'inherit' : 'primary'} hasTabularNumbers>{val}건</Text></VStack>
          </Card>
        ))}
      </Grid>

      <TabList value={activeTab} onChange={v=>v && setActiveTab(v)}>
        <Tab value="list" label="요청 목록"/>
        <Tab value="add" label="요청 등록"/>
        {isOwner && <Tab value="preset" label="품목 관리"/>}
      </TabList>

      {activeTab==='list' && <>
        <HStack>
          <SegmentedControl label="상태" value={filterStatus} onChange={v=>v && setFilterStatus(v)}>
            {[['all','전체'],['pending','대기중'],['checked','확인완료'],['done','완료']].map(([key,label]) => <SegmentedControlItem key={key} value={key} label={label}/>)}
          </SegmentedControl>
        </HStack>
        {loading ? <Text color="secondary">불러오는 중...</Text> : filtered.length===0 ? <EmptyState title="요청이 없습니다" isCompact/> : (
          <VStack gap={2}>
            {filtered.map(o => (
              <Card key={o.id} padding={4}>
                <HStack gap={3} vAlign="start" hAlign="between" wrap="wrap">
                  <VStack gap={1}>
                    <HStack gap={2} vAlign="center" wrap="wrap">
                      <Badge variant={o.urgency==='urgent' ? 'error' : 'neutral'} label={URGENCY[o.urgency]?.label || '일반'}/>
                      <Badge variant={STATUS_BADGE[o.status] || 'neutral'} label={STATUS[o.status]?.label || o.status}/>
                      <Text type="supporting" color="secondary">{timeAgo(o.createdAt)}</Text>
                    </HStack>
                    <Text type="large" weight="bold">{o.itemName} <Text color="accent" hasTabularNumbers>{o.qty}{o.unit}</Text></Text>
                    {o.memo && <Text color="secondary">{o.memo}</Text>}
                    <Text type="supporting" color="secondary">요청자: {o.authorName}</Text>
                  </VStack>
                  <HStack gap={1}>
                    {isOwner && o.status==='pending' && <Button size="sm" variant="primary" label="확인" onClick={()=>updateStatus(o.id,'checked')}/>}
                    {isOwner && o.status==='checked' && <Button size="sm" variant="primary" label="완료" onClick={()=>updateStatus(o.id,'done')}/>}
                    {isOwner && <Button size="sm" variant="ghost" label="삭제" onClick={()=>deleteOrder(o.id)}/>}
                    {!isOwner && o.authorUid===user.uid && o.status==='pending' && <Button size="sm" variant="ghost" label="취소" onClick={()=>deleteOrder(o.id)}/>}
                  </HStack>
                </HStack>
              </Card>
            ))}
          </VStack>
        )}
      </>}

      {activeTab==='add' && (
        <LedgerCard title="발주 요청 등록">
          <VStack gap={2}>
            <Text type="label">품목 선택</Text>
            <HStack gap={1} wrap="wrap">
              {presets.map(p => <Button key={p.id} size="sm" variant={selPreset===p.name ? 'primary' : 'secondary'} label={p.name} onClick={()=>{setSelPreset(p.name);setCustomItem('')}}/>)}
            </HStack>
            <TextInput label="직접 입력" isLabelHidden placeholder="목록에 없으면 직접 입력..." value={customItem} onChange={v=>{setCustomItem(v);setSelPreset('')}}/>
          </VStack>
          <TextInput label="수량" inputMode="numeric" placeholder="0" value={qty} onChange={v=>setQty(v.replace(/[^0-9]/g,''))}/>
          <VStack gap={2}>
            <Text type="label">긴급도</Text>
            <HStack><SegmentedControl label="긴급도" value={urgency} onChange={v=>v && setUrgency(v)}>
              {Object.entries(URGENCY).map(([key,v]) => <SegmentedControlItem key={key} value={key} label={v.label}/>)}
            </SegmentedControl></HStack>
          </VStack>
          <TextInput label="메모" isOptional placeholder="추가 설명..." value={memo} onChange={v=>setMemo(v)}/>
          <Button variant="primary" width="100%" label="요청 등록" onClick={addOrder}/>
        </LedgerCard>
      )}

      {activeTab==='preset' && isOwner && <>
        <LedgerCard title="품목 추가">
          <HStack gap={2} vAlign="end" wrap="wrap">
            <TextInput label="품목명" placeholder="예: 춘장, 양파, 식용유" value={newPreset} onChange={v=>setNewPreset(v)}/>
            <TextInput label="단위" placeholder="예: 개, kg, 박스" value={newPresetUnit} onChange={v=>setNewPresetUnit(v)} width={140}/>
            <Button variant="primary" label="추가" onClick={addPreset}/>
          </HStack>
        </LedgerCard>
        <LedgerCard title={`등록된 품목 (${presets.length}개)`}>
          {presets.length===0 ? <Text color="secondary">등록된 품목이 없습니다</Text> : (
            <Grid columns={{ minWidth: 170, repeat: 'fill' }} gap={2}>
              {presets.map(p => (
                <Card key={p.id} variant="muted" padding={3}>
                  <HStack gap={2} vAlign="center" hAlign="between">
                    <VStack gap={0}><Text weight="bold">{p.name}</Text><Text type="supporting" color="secondary">{p.unit}</Text></VStack>
                    <Button size="sm" variant="ghost" label="삭제" onClick={()=>deletePreset(p.id)}/>
                  </HStack>
                </Card>
              ))}
            </Grid>
          )}
        </LedgerCard>
      </>}
    </VStack>
    </AstryxPage>
  )
}
