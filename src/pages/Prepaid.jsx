import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { ClickableCard } from '@astryxdesign/core/ClickableCard'
import { Grid } from '@astryxdesign/core/Grid'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { TextInput } from '@astryxdesign/core/TextInput'
import { DateInput } from '@astryxdesign/core/DateInput'
import { Table } from '@astryxdesign/core/Table'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { AstryxPage, PageHeader, LedgerCard } from '../astryx/AstryxPage'

const pad = n => String(n).padStart(2,'0')
const todayStr = () => { const n=new Date(); return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}` }
const wonFmt = n => (n||0).toLocaleString('ko-KR')

// 업체 1곳의 장부를 날짜순으로 정렬하고 누적 잔액을 계산
function buildLedger(vendor) {
  const sorted = [...(vendor.entries||[])].sort((a,b)=>
    a.date===b.date ? String(a.id).localeCompare(String(b.id)) : a.date.localeCompare(b.date))
  let bal = 0
  return sorted.map(e=>{
    bal += e.kind==='charge' ? e.amount : -e.amount
    return { ...e, balance: bal }
  })
}
function balanceOf(vendor) {
  return (vendor.entries||[]).reduce((s,e)=> s + (e.kind==='charge' ? e.amount : -e.amount), 0)
}
function totalCharged(vendor) {
  return (vendor.entries||[]).filter(e=>e.kind==='charge').reduce((s,e)=>s+e.amount,0)
}
function totalUsed(vendor) {
  return (vendor.entries||[]).filter(e=>e.kind==='use').reduce((s,e)=>s+e.amount,0)
}


export default function Prepaid() {
  const { isOwner, isStore } = useAuth()
  const canEdit = isOwner || isStore // 사장·매장 계정 동일 권한
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)

  const [selectedId, setSelectedId] = useState(null)
  const [showArchived, setShowArchived] = useState(false)

  // 업체 추가/수정 폼
  const [showVendorForm, setShowVendorForm] = useState(false)
  const [vendorEditId, setVendorEditId] = useState(null) // null이면 신규
  const [vendorForm, setVendorForm] = useState({ name:'', contact:'', memo:'', lowAlert:'' })

  // 장부 항목 추가 폼
  const [entryForm, setEntryForm] = useState({ date: todayStr(), kind:'use', amount:'', memo:'' })
  // 장부 항목 수정
  const [editEntryId, setEditEntryId] = useState(null)
  const [editEntryForm, setEditEntryForm] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const snap = await getDoc(doc(db,'prepaid','vendors'))
      setVendors(snap.exists() ? (snap.data().list||[]) : [])
    } catch(e) { console.error(e) }
    setLoading(false)
  }
  useEffect(()=>{ load() },[])

  async function saveVendors(list) {
    await setDoc(doc(db,'prepaid','vendors'), { list })
    setVendors(list)
  }

  // ── 업체 관리 ──
  function openNewVendor() {
    setVendorEditId(null)
    setVendorForm({ name:'', contact:'', memo:'', lowAlert:'' })
    setShowVendorForm(true)
  }
  function openEditVendor(v) {
    setVendorEditId(v.id)
    setVendorForm({ name:v.name, contact:v.contact||'', memo:v.memo||'', lowAlert: v.lowAlert ? String(v.lowAlert) : '' })
    setShowVendorForm(true)
  }
  async function submitVendor() {
    if(!vendorForm.name.trim()) { alert('업체명을 입력하세요'); return }
    setSaving(true)
    const base = {
      name: vendorForm.name.trim(),
      contact: vendorForm.contact.trim(),
      memo: vendorForm.memo.trim(),
      lowAlert: +vendorForm.lowAlert || 0,
    }
    if(vendorEditId) {
      await saveVendors(vendors.map(v=>v.id===vendorEditId ? { ...v, ...base } : v))
    } else {
      const nv = { id:'v_'+Date.now(), ...base, archived:false, entries:[] }
      await saveVendors([...vendors, nv])
      setSelectedId(nv.id)
    }
    setShowVendorForm(false); setVendorEditId(null)
    setSaving(false)
  }
  async function toggleArchive(v) {
    await saveVendors(vendors.map(x=>x.id===v.id ? { ...x, archived: !x.archived } : x))
    if(!v.archived && selectedId===v.id) setSelectedId(null)
  }
  async function deleteVendor(v) {
    if(!window.confirm(`'${v.name}' 업체와 모든 장부 기록을 삭제합니다. 되돌릴 수 없어요. 삭제할까요?`)) return
    await saveVendors(vendors.filter(x=>x.id!==v.id))
    if(selectedId===v.id) setSelectedId(null)
  }

  // ── 장부 항목 ──
  async function addEntry() {
    const amount = +String(entryForm.amount).replace(/,/g,'')
    if(!selectedId || !amount || amount<=0) { alert('금액을 입력하세요'); return }
    setSaving(true)
    const entry = {
      id:'e_'+Date.now(), date:entryForm.date, kind:entryForm.kind,
      amount, memo:entryForm.memo.trim(),
    }
    await saveVendors(vendors.map(v=>v.id===selectedId ? { ...v, entries:[...(v.entries||[]), entry] } : v))
    setEntryForm(f=>({ ...f, amount:'', memo:'' }))
    setSaving(false)
  }
  function startEditEntry(e) {
    setEditEntryId(e.id)
    setEditEntryForm({ date:e.date, kind:e.kind, amount:String(e.amount), memo:e.memo||'' })
  }
  async function saveEditEntry() {
    const amount = +String(editEntryForm.amount).replace(/,/g,'')
    if(!amount || amount<=0) { alert('금액을 입력하세요'); return }
    setSaving(true)
    await saveVendors(vendors.map(v=>v.id!==selectedId ? v : {
      ...v,
      entries:(v.entries||[]).map(e=>e.id===editEntryId
        ? { ...e, date:editEntryForm.date, kind:editEntryForm.kind, amount, memo:editEntryForm.memo.trim() } : e)
    }))
    setEditEntryId(null); setEditEntryForm(null)
    setSaving(false)
  }
  async function deleteEntry(id) {
    if(!window.confirm('이 기록을 삭제할까요?')) return
    await saveVendors(vendors.map(v=>v.id!==selectedId ? v : {
      ...v, entries:(v.entries||[]).filter(e=>e.id!==id)
    }))
  }

  const activeVendors = vendors.filter(v=>!v.archived)
  const archivedVendors = vendors.filter(v=>v.archived)
  const totalBalance = activeVendors.reduce((s,v)=>s+balanceOf(v),0)
  const lowVendors = activeVendors.filter(v=>v.lowAlert>0 && balanceOf(v)<=v.lowAlert)

  const selected = vendors.find(v=>v.id===selectedId) || null
  const ledger = selected ? buildLedger(selected) : []
  const ledgerShown = [...ledger].reverse() // 최신이 위로

  function VendorCard(v) {
    const bal = balanceOf(v)
    const low = v.lowAlert>0 && bal<=v.lowAlert
    const isSel = v.id===selectedId
    return (
      <ClickableCard key={v.id} variant={isSel ? 'red' : 'default'} padding={4} label={v.name} onClick={()=>setSelectedId(isSel ? null : v.id)}>
        <VStack gap={1}>
          <HStack gap={2} vAlign="center" hAlign="between">
            <Text weight="bold" color={isSel ? 'inherit' : 'primary'}>{v.name}</Text>
            {low && <Badge variant="error" label="잔액 부족"/>}
          </HStack>
          <Text type="display-3" color={isSel ? 'inherit' : bal <= 0 ? 'secondary' : 'primary'} hasTabularNumbers>{wonFmt(bal)}원</Text>
          <Text type="supporting" color={isSel ? 'inherit' : 'secondary'} hasTabularNumbers>충전 {wonFmt(totalCharged(v))} · 사용 {wonFmt(totalUsed(v))}</Text>
        </VStack>
      </ClickableCard>
    )
  }
  const moneyIn = (label, val, set, o = {}) => (
    <TextInput label={label} isLabelHidden={o.hide} inputMode="numeric" placeholder={o.placeholder || '금액'} width={o.width || 130}
      value={val ? (+String(val).replace(/,/g,'')).toLocaleString('ko-KR') : ''} onChange={v=>set(v.replace(/[^0-9]/g,''))}/>
  )

  // 직원 계정은 접근 불가 (사장·매장 계정만)
  if(!isOwner && !isStore) return <Navigate to="/my-schedule" />

  return (
    <AstryxPage>
    <VStack gap={4}>
      <PageHeader title="선결제 관리" sub="업체·개인별 선결제 충전 / 차감 장부" right={canEdit && <Button variant="primary" label="+ 업체 추가" onClick={openNewVendor}/>}/>

      {/* 업체 추가/수정 */}
      {showVendorForm && (
        <LedgerCard title={vendorEditId ? '업체 정보 수정' : '새 업체 추가'}>
          <HStack gap={2} vAlign="end" wrap="wrap">
            <TextInput label="업체명" placeholder="예: 소망 이비인후과" value={vendorForm.name} onChange={v=>setVendorForm(f=>({...f,name:v}))}/>
            <TextInput label="연락처/담당자" isOptional value={vendorForm.contact} onChange={v=>setVendorForm(f=>({...f,contact:v}))}/>
          </HStack>
          <HStack gap={2} vAlign="end" wrap="wrap">
            <TextInput label="메모" isOptional placeholder="할인 조건, 유효기간 등" value={vendorForm.memo} onChange={v=>setVendorForm(f=>({...f,memo:v}))}/>
            <TextInput label="잔액 알림 기준 (원 이하)" inputMode="numeric" placeholder="예: 30,000" width={180}
              value={vendorForm.lowAlert ? (+vendorForm.lowAlert).toLocaleString('ko-KR') : ''} onChange={v=>setVendorForm(f=>({...f,lowAlert:v.replace(/[^0-9]/g,'')}))}/>
          </HStack>
          <HStack gap={2}>
            <Button variant="primary" label="저장" isDisabled={saving} onClick={submitVendor}/>
            <Button label="취소" onClick={()=>{setShowVendorForm(false);setVendorEditId(null)}}/>
          </HStack>
        </LedgerCard>
      )}

      {loading ? <Text color="secondary">불러오는 중...</Text> : <>
        <Grid columns={{ minWidth: 180, max: 2, repeat: 'fit' }} gap={3}>
          <Card variant="red" padding={4}><VStack gap={1}><Text type="label" color="inherit">전체 선결제 잔액</Text><Text type="display-3" color="inherit" hasTabularNumbers>{wonFmt(totalBalance)}원</Text></VStack></Card>
          <Card padding={4}><VStack gap={1}><Text type="label" color="secondary">관리 중인 업체</Text><Text type="display-3" hasTabularNumbers>{activeVendors.length}곳</Text></VStack></Card>
        </Grid>

        {lowVendors.length>0 && <Banner status="error" title="잔액이 기준 이하인 업체" description={lowVendors.map(v=>`${v.name}(${wonFmt(balanceOf(v))}원)`).join(', ')}/>}

        {activeVendors.length===0 ? <EmptyState title="등록된 업체가 없습니다" description={canEdit ? '오른쪽 위 "+ 업체 추가"로 시작하세요.' : undefined}/> : (
          <Grid columns={{ minWidth: 220, repeat: 'fill' }} gap={3}>{activeVendors.map(v=>VendorCard(v))}</Grid>
        )}

        {/* 선택한 업체 장부 */}
        {selected && (
          <LedgerCard title={selected.name} right={<Text type="large" weight="bold" hasTabularNumbers>잔액 {wonFmt(balanceOf(selected))}원</Text>}>
            {(selected.contact || selected.memo) && <Text type="supporting" color="secondary">{[selected.contact, selected.memo].filter(Boolean).join(' · ')}</Text>}
            {selected.lowAlert>0 && <Text type="supporting" color="secondary">잔액 {wonFmt(selected.lowAlert)}원 이하일 때 알림</Text>}
            {canEdit && (
              <HStack gap={2} wrap="wrap">
                <Button size="sm" label="업체 정보 수정" onClick={()=>openEditVendor(selected)}/>
                <Button size="sm" label="보관 처리" onClick={()=>toggleArchive(selected)}/>
                <Button size="sm" variant="destructive" label="업체 삭제" onClick={()=>deleteVendor(selected)}/>
              </HStack>
            )}

            {/* 기록 추가 */}
            <Card variant="muted" padding={3}>
              <HStack gap={2} vAlign="end" wrap="wrap">
                <DateInput label="날짜" value={entryForm.date} onChange={v=>setEntryForm(f=>({...f,date:v||f.date}))}/>
                <SegmentedControl label="충전·차감" value={entryForm.kind} onChange={v=>v && setEntryForm(f=>({...f,kind:v}))}>
                  <SegmentedControlItem value="charge" label="충전"/>
                  <SegmentedControlItem value="use" label="차감"/>
                </SegmentedControl>
                {moneyIn('금액', entryForm.amount, v=>setEntryForm(f=>({...f,amount:v})))}
                <TextInput label="메모" isOptional value={entryForm.memo} onChange={v=>setEntryForm(f=>({...f,memo:v}))}/>
                <Button variant="primary" label="기록" isDisabled={saving} onClick={addEntry}/>
              </HStack>
            </Card>

            {/* 고치는 기록 */}
            {editEntryId && editEntryForm && (
              <Card variant="muted" padding={3}>
                <VStack gap={2}>
                  <Text weight="bold">기록 고치기</Text>
                  <HStack gap={2} vAlign="end" wrap="wrap">
                    <DateInput label="날짜" value={editEntryForm.date} onChange={v=>setEditEntryForm(f=>({...f,date:v||f.date}))}/>
                    <SegmentedControl label="충전·차감" value={editEntryForm.kind} onChange={v=>v && setEditEntryForm(f=>({...f,kind:v}))}>
                      <SegmentedControlItem value="charge" label="충전"/>
                      <SegmentedControlItem value="use" label="차감"/>
                    </SegmentedControl>
                    {moneyIn('금액', editEntryForm.amount, v=>setEditEntryForm(f=>({...f,amount:v})))}
                    <TextInput label="메모" isOptional value={editEntryForm.memo} onChange={v=>setEditEntryForm(f=>({...f,memo:v}))}/>
                    <Button variant="primary" label="저장" isDisabled={saving} onClick={saveEditEntry}/>
                    <Button label="취소" onClick={()=>{setEditEntryId(null);setEditEntryForm(null)}}/>
                  </HStack>
                </VStack>
              </Card>
            )}

            {ledgerShown.length===0 ? <Text color="secondary">아직 기록이 없습니다. 기존 잔액이 있으면 "충전"으로 이월 금액을 먼저 기록하세요.</Text> : (
              <Table data={ledgerShown} idKey="id" density="compact"
                columns={[
                  { key:'date', header:'일자', renderCell: e => <Text hasTabularNumbers textWrap="nowrap">{e.date}</Text> },
                  { key:'charge', header:'충전', align:'end', renderCell: e => <Text weight="bold" hasTabularNumbers>{e.kind==='charge' ? wonFmt(e.amount) : ''}</Text> },
                  { key:'use', header:'차감', align:'end', renderCell: e => <Text weight="bold" color="accent" hasTabularNumbers>{e.kind==='use' ? wonFmt(e.amount) : ''}</Text> },
                  { key:'balance', header:'잔액', align:'end', renderCell: e => <Text hasTabularNumbers>{wonFmt(e.balance)}</Text> },
                  { key:'memo', header:'메모', renderCell: e => <Text type="supporting" color="secondary">{e.memo}</Text> },
                  ...(canEdit ? [{ key:'act', header:'', align:'end', renderCell: e => (
                    <HStack gap={0}>
                      <Button size="sm" variant="ghost" label="수정" onClick={()=>startEditEntry(e)}/>
                      <Button size="sm" variant="ghost" label="삭제" onClick={()=>deleteEntry(e.id)}/>
                    </HStack>) }] : []),
                ]}/>
            )}
          </LedgerCard>
        )}

        {/* 보관된 업체 */}
        {archivedVendors.length>0 && <>
          <HStack><Button variant="ghost" label={`${showArchived ? '접기' : '보기'} · 보관된 업체 (${archivedVendors.length})`} onClick={()=>setShowArchived(v=>!v)}/></HStack>
          {showArchived && (
            <Grid columns={{ minWidth: 220, repeat: 'fill' }} gap={3}>
              {archivedVendors.map(v => (
                <VStack key={v.id} gap={1}>
                  {VendorCard(v)}
                  {canEdit && <HStack><Button size="sm" label="보관 해제" onClick={()=>toggleArchive(v)}/></HStack>}
                </VStack>
              ))}
            </Grid>
          )}
        </>}
      </>}
    </VStack>
    </AstryxPage>
  )
}
