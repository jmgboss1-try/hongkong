import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore'
import { PhotoField, PhotoViewer } from '../astryx/PhotoField'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Divider } from '@astryxdesign/core/Divider'
import { TextInput } from '@astryxdesign/core/TextInput'
import { DateInput } from '@astryxdesign/core/DateInput'
import { TabList, Tab } from '@astryxdesign/core/TabList'
import { List, ListItem } from '@astryxdesign/core/List'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { AstryxPage, Legacy, PageHeader, LedgerCard } from '../astryx/AstryxPage'

const pad = n => String(n).padStart(2,'0')
const todayStr = () => { const n=new Date(); return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}` }
const wonFmt = n => (n||0).toLocaleString('ko-KR')

const PLATFORMS = [
  { key:'baemin',   label:'배달의민족', color:'#2E7D45' },
  { key:'coupang',  label:'쿠팡이츠',   color:'#B42318' },
  { key:'yogiyo',   label:'요기요',     color:'#C3261C' },
  { key:'ddangyeo', label:'땡겨요',     color:'#2B5C9E' },
]
const TYPES  = ['오배송','메뉴누락','파손','기타']
const CAUSES = [
  { key:'store',    label:'매장',   color:'#B42318' },
  { key:'rider',    label:'라이더', color:'#C3261C' },
  { key:'customer', label:'고객',   color:'#2B5C9E' },
]

// 기록 하나의 단계 — 예전 기록(승인/최종확인/처리완료 따로 관리)도 그대로 읽을 수 있게 변환
//   open: 진행중 / paid: 보상완료 / rejected: 거절 / closed: 금액 없이 완료 처리된 예전 기록
function stageOf(r) {
  if(r.claimStatus === 'rejected') return 'rejected'
  if(r.finalConfirmed) return 'paid'
  if(r.status === 'done') return 'closed'
  return 'open'
}
const STAGE_BADGE = {
  open:     { label:'진행중',   color:'#C3261C', badge:'warning' },
  paid:     { label:'보상완료', color:'#2E7D45', badge:'success' },
  rejected: { label:'거절',     color:'#B42318', badge:'error' },
  closed:   { label:'완료',        color:'#6E6A63', badge:'neutral' },
}

function emptyForm() {
  return { date: todayStr(), platform:'baemin', lossAmount:'', memo:'',
    orderNo:'', orderAmount:'', type:'', cause:'' }
}

const numIn = v => v.replace(/[^0-9]/g, '')
const moneyVal = v => v === '' || v == null ? '' : (+v).toLocaleString('ko-KR')

// 하나 고르기 (다시 누르면 해제 가능)
function ToggleGroup({ options, value, onChange, allowEmpty }) {
  return (
    <HStack gap={1} wrap="wrap">
      {options.map(opt => {
        const key = opt.key ?? opt, label = opt.label ?? opt, selected = value === key
        return <Button key={key} size="sm" variant={selected ? 'primary' : 'secondary'} label={label} onClick={()=>onChange(selected && allowEmpty ? '' : key)}/>
      })}
    </HStack>
  )
}

// 등록/수정 공용 폼 — 기본 4칸 + 접을 수 있는 상세
function ClaimForm({ value, onChange }) {
  const [showDetail, setShowDetail] = useState(!!(value.orderNo || value.orderAmount || value.type || value.cause))
  const set = (k,v) => onChange({ ...value, [k]: v })
  return (
    <VStack gap={3}>
      <HStack gap={2} vAlign="end" wrap="wrap">
        <DateInput label="날짜" value={value.date} onChange={v=>set('date', v || value.date)}/>
        <TextInput label="손실 금액 (원)" inputMode="numeric" placeholder="0" width={150} value={moneyVal(value.lossAmount)} onChange={v=>set('lossAmount', numIn(v))}/>
      </HStack>
      <VStack gap={1}><Text type="label">플랫폼</Text><ToggleGroup options={PLATFORMS} value={value.platform} onChange={v=>set('platform',v)}/></VStack>
      <TextInput label="내용" placeholder="예: 짬뽕 누락, 라이더 오배송" value={value.memo} onChange={v=>set('memo',v)}/>
      <HStack><Button size="sm" variant="ghost" label={showDetail ? '상세 접기' : '상세 (주문번호·주문금액·유형·원인) — 선택'} onClick={()=>setShowDetail(v=>!v)}/></HStack>
      {showDetail && (
        <Card variant="muted" padding={3}>
          <VStack gap={3}>
            <HStack gap={2} vAlign="end" wrap="wrap">
              <TextInput label="주문번호" value={value.orderNo} onChange={v=>set('orderNo',v)}/>
              <TextInput label="주문 금액 (원)" inputMode="numeric" placeholder="0" width={150} value={moneyVal(value.orderAmount)} onChange={v=>set('orderAmount', numIn(v))}/>
            </HStack>
            <VStack gap={1}><Text type="label">유형</Text><ToggleGroup options={TYPES} value={value.type} onChange={v=>set('type',v)} allowEmpty/></VStack>
            <VStack gap={1}><Text type="label">원인</Text><ToggleGroup options={CAUSES} value={value.cause} onChange={v=>set('cause',v)} allowEmpty/></VStack>
          </VStack>
        </Card>
      )}
    </VStack>
  )
}

// 타임라인 기록 종류 — 플랫폼과 주고받은 과정을 날짜별로 남김
const EVENT_KINDS = [
  { key:'contact',  label:'연락·문의', color:'#2B5C9E', badge:'info' },
  { key:'approved', label:'승인',      color:'#2E7D45', badge:'success' },
  { key:'rejected', label:'반려',      color:'#B42318', badge:'error' },
  { key:'paid',     label:'입금확인',  color:'#2E7D45', badge:'success' },
  { key:'memo',     label:'메모',      color:'#6E6A63', badge:'neutral' },
]
const eventKindOf = k => EVENT_KINDS.find(e=>e.key===k) || EVENT_KINDS[4]
const receivedOf = r => (r.timeline||[]).filter(e=>e.kind==='paid').reduce((a,e)=>a+(e.amount||0),0)
const mdLabel = d => d ? `${+d.slice(5,7)}/${+d.slice(8,10)}` : ''

// 사진은 lossClaims/records(문서 하나에 모든 건)에 넣으면 1MB 한도를 금방 넘으므로
// 기록마다 lossClaimPhotos/{기록 id} 별도 문서에 저장하고, 기록에는 장수(photoCount)만 남김
function EventPhotos({ eventId, count }) {
  const [images, setImages] = useState(null)
  async function open() {
    try {
      const snap = await getDoc(doc(db,'lossClaimPhotos',eventId))
      setImages(snap.exists() ? (snap.data().images||[]) : [])
    } catch(e) { console.error(e); alert('사진을 불러오지 못했어요') }
  }
  return (
    <>
      <Button size="sm" variant="ghost" label={`사진 ${count}`} onClick={open}/>
      {images && <PhotoViewer images={images} label="손실보상 첨부 사진" onClose={()=>setImages(null)}/>}
    </>
  )
}

function Timeline({ r, editable, saving, onAdd, onDelete, onNextCheck }) {
  const [ev, setEv] = useState({ date: todayStr(), kind:'contact', amount:'', note:'' })
  const [images, setImages] = useState([])
  const [showPhotos, setShowPhotos] = useState(false)
  const events = (r.timeline||[]).slice().sort((a,b)=>a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  async function add() {
    if(!ev.note.trim() && !(+ev.amount) && images.length===0) return alert('내용이나 금액, 사진을 입력해주세요')
    const id = Date.now().toString()
    if(images.length) {
      try { await setDoc(doc(db,'lossClaimPhotos',id), { claimId: r.id, images }) }
      catch(e) { console.error(e); return alert('사진 저장에 실패했어요. 다시 시도해 주세요') }
    }
    const ok = await onAdd({ id, date: ev.date, kind: ev.kind, amount: +ev.amount||0, note: ev.note.trim(),
      ...(images.length ? { photoCount: images.length } : {}) })
    if(ok) { setEv(v=>({ ...v, amount:'', note:'' })); setImages([]); setShowPhotos(false) }
  }
  return (
    <VStack gap={3}>
      <Divider/>
      {events.length===0 && <Text type="supporting" color="secondary">아직 기록이 없어요</Text>}
      {events.length > 0 && (
        <List hasDividers edge="flush">
          {events.map(e => {
            const k = eventKindOf(e.kind)
            return (
              <ListItem key={e.id} startContent={<Badge variant={k.badge} label={k.label}/>}
                label={<HStack gap={2} vAlign="center" wrap="wrap">
                  <Text>{e.note}</Text>
                  {e.amount > 0 && <Text weight="bold" hasTabularNumbers>{wonFmt(e.amount)}원</Text>}
                  {e.photoCount > 0 && <EventPhotos eventId={e.id} count={e.photoCount}/>}
                </HStack>}
                description={<Text type="supporting" color="secondary" hasTabularNumbers>{e.date}</Text>}
                endContent={editable && <Button size="sm" variant="ghost" label="삭제" isDisabled={saving} onClick={()=>onDelete(e.id)}/>}/>
            )
          })}
        </List>
      )}
      {editable && <>
        <ToggleGroup options={EVENT_KINDS} value={ev.kind} onChange={v=>setEv(x=>({...x,kind:v}))}/>
        <HStack gap={2} vAlign="end" wrap="wrap">
          <DateInput label="날짜" isLabelHidden value={ev.date} onChange={v=>setEv(x=>({...x,date:v||x.date}))}/>
          <TextInput label="내용" isLabelHidden placeholder="예: 쿠팡 상담원 - 나머지 금액 자동정산 예정 문자 받음" value={ev.note} onChange={v=>setEv(x=>({...x,note:v}))} onEnter={add}/>
          <TextInput label="금액" isLabelHidden inputMode="numeric" placeholder="금액(선택)" width={120} value={moneyVal(ev.amount)} onChange={v=>setEv(x=>({...x,amount:numIn(v)}))}/>
          <Button size="sm" variant={showPhotos || images.length ? 'primary' : 'secondary'} label={`사진${images.length ? ` ${images.length}` : ''}`} onClick={()=>setShowPhotos(v=>!v)}/>
          <Button size="sm" variant="primary" label="+ 기록" isDisabled={saving} onClick={add}/>
        </HStack>
        {showPhotos && <PhotoField images={images} onChange={setImages} max={3}/>}
        <HStack gap={2} vAlign="end" wrap="wrap">
          <DateInput label="다음 확인일" value={r.nextCheck||''} onChange={v=>onNextCheck(v || '')}/>
          {r.nextCheck && <Button size="sm" label="지우기" onClick={()=>onNextCheck('')}/>}
          <Text type="supporting" color="secondary">그날이 되면 카드가 표시되고 맨 위로 올라와요</Text>
        </HStack>
      </>}
    </VStack>
  )
}

export default function LossClaims() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [tab, setTab]         = useState('open') // 'open' | 'done'

  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState(emptyForm())
  const [editId, setEditId]     = useState(null)
  const [editForm, setEditForm] = useState(null)

  // 카드 안 인라인 입력: { id, kind:'paid'|'rejected', date, amount, reason }
  const [action, setAction] = useState(null)
  const [openTimeline, setOpenTimeline] = useState({}) // id → 타임라인 펼침 여부

  useEffect(()=>{
    getDoc(doc(db,'lossClaims','records'))
      .then(snap=>setRecords(snap.exists() ? (snap.data().list||[]) : []))
      .catch(e=>console.error(e))
      .finally(()=>setLoading(false))
  },[])

  // 저장 직전 최신 목록을 다시 읽어서 변경 적용 — 포스기와 사장님 폰에서 동시에 써도 서로 덮어쓰지 않도록
  async function update(fn) {
    setSaving(true)
    try {
      const snap = await getDoc(doc(db,'lossClaims','records'))
      const latest = snap.exists() ? (snap.data().list||[]) : []
      const next = fn(latest)
      await setDoc(doc(db,'lossClaims','records'), { list: next })
      setRecords(next)
      return true
    } catch(e) { console.error(e); alert('저장 중 오류가 발생했습니다.'); return false }
    finally { setSaving(false) }
  }
  const patch = (id, fields) => update(list => list.map(r => r.id===id ? { ...r, ...fields } : r))

  const addEvent = (id, ev) => update(list => list.map(r => r.id===id ? { ...r, timeline: [...(r.timeline||[]), ev] } : r))
  const deleteEvent = async (id, evId) => {
    if(!window.confirm('이 기록을 지울까요?')) return
    const ok = await update(list => list.map(r => r.id===id ? { ...r, timeline: (r.timeline||[]).filter(e=>e.id!==evId) } : r))
    if(ok) deletePhotos([evId])
  }
  // 첨부 사진 문서 삭제 (없는 문서를 지워도 문제없음)
  const deletePhotos = ids => Promise.all(ids.map(id => deleteDoc(doc(db,'lossClaimPhotos',id)).catch(e=>console.error(e))))
  const setNextCheck = (id, date) => patch(id, { nextCheck: date })

  const toNumbers = f => ({ ...f, lossAmount:+f.lossAmount||0, orderAmount:+f.orderAmount||0 })

  async function addRecord() {
    if(!form.date) return alert('날짜를 입력해주세요')
    const ok = await update(list => [...list, {
      id: Date.now().toString(), ...toNumbers(form),
      claimStatus:'pending', status:'active', createdAt:new Date().toISOString(),
    }])
    if(ok) { setForm(emptyForm()); setShowForm(false); setTab('open') }
  }

  async function saveEdit() {
    const ok = await patch(editId, toNumbers(editForm))
    if(ok) { setEditId(null); setEditForm(null) }
  }

  async function saveAction() {
    if(action.kind === 'paid') {
      const amount = +action.amount || 0
      if(amount <= 0) return alert('받은 보상 금액을 입력해주세요')
      const ok = await update(list => list.map(r => r.id===action.id ? { ...r,
        claimStatus:'approved', approvedDate: action.date,
        finalConfirmed:true, finalConfirmedDate: action.date, finalAmount: amount, status:'done', nextCheck:'',
        timeline: [...(r.timeline||[]), { id: Date.now().toString(), date: action.date, kind:'memo', amount, note:'보상완료 처리' }],
      } : r))
      if(ok) setAction(null)
    } else {
      const ok = await update(list => list.map(r => r.id===action.id ? { ...r,
        claimStatus:'rejected', rejectReason: action.reason||'', status:'done', nextCheck:'',
        timeline: [...(r.timeline||[]), { id: Date.now().toString(), date: todayStr(), kind:'rejected', amount:0, note:`거절로 종료${action.reason?` — ${action.reason}`:''}` }],
      } : r))
      if(ok) setAction(null)
    }
  }

  async function reopen(id) {
    if(!window.confirm('다시 진행중으로 되돌릴까요?')) return
    await update(list => list.map(r => r.id===id ? { ...r, claimStatus:'pending', finalConfirmed:false, status:'active',
      timeline: [...(r.timeline||[]), { id: Date.now().toString(), date: todayStr(), kind:'memo', amount:0, note:'다시 진행중으로 되돌림' }],
    } : r))
  }

  async function deleteRecord(id) {
    if(!window.confirm('이 기록을 삭제하시겠습니까?')) return
    const photoIds = (records.find(r=>r.id===id)?.timeline||[]).filter(e=>e.photoCount>0).map(e=>e.id)
    const ok = await update(list => list.filter(r => r.id!==id))
    if(ok) deletePhotos(photoIds)
  }

  const openList = records.filter(r => stageOf(r)==='open')
  const doneList = records.filter(r => stageOf(r)!=='open')
  const today = todayStr()
  const isDue = r => stageOf(r)==='open' && r.nextCheck && r.nextCheck <= today
  const dueCount = openList.filter(isDue).length
  // 확인할 날이 된 건이 맨 위, 나머지는 최신순
  const shown = (tab==='open' ? openList : doneList).slice()
    .sort((a,b)=> (isDue(b)-isDue(a)) || b.date.localeCompare(a.date))

  const openLoss  = openList.reduce((a,r)=>a+(r.lossAmount||0),0)
  const paidTotal = records.filter(r=>stageOf(r)==='paid').reduce((a,r)=>a+(r.finalAmount||0),0)

  return (
    <AstryxPage>
    <VStack gap={4}>
      <PageHeader title="손실보상" sub="배달 사고 등록 → 보상 받으면 금액만 입력"
        right={<Button variant="primary" label={showForm ? '닫기' : '+ 사고 등록'} onClick={()=>{ setShowForm(v=>!v); setForm(emptyForm()) }}/>}/>

      <Grid columns={{ minWidth: 160, max: 4, repeat: 'fit' }} gap={3}>
        {[
          ['진행중', `${openList.length}건`, true],
          ['진행중 손실 금액', `${wonFmt(openLoss)}원`],
          ['지금까지 받은 보상', `${wonFmt(paidTotal)}원`],
          ...(dueCount>0 ? [['오늘 다시 확인할 건', `${dueCount}건`]] : []),
        ].map(([label, val, filled]) => (
          <Card key={label} variant={filled ? 'red' : 'default'} padding={4}>
            <VStack gap={1}><Text type="label" color={filled ? 'inherit' : 'secondary'}>{label}</Text><Text type="large" weight="bold" color={filled ? 'inherit' : 'primary'} hasTabularNumbers>{val}</Text></VStack>
          </Card>
        ))}
      </Grid>

      {showForm && (
        <LedgerCard title="사고 등록">
          <ClaimForm value={form} onChange={setForm}/>
          <HStack><Button variant="primary" label={saving?'등록 중...':'등록'} isDisabled={saving} onClick={addRecord}/></HStack>
        </LedgerCard>
      )}

      <TabList value={tab} onChange={v=>v && setTab(v)}>
        <Tab value="open" label={`진행중 (${openList.length})`}/>
        <Tab value="done" label={`완료 (${doneList.length})`}/>
      </TabList>

      {loading ? <Text color="secondary">불러오는 중...</Text> : shown.length === 0 ? (
        <EmptyState title={tab==='open' ? '진행중인 사고가 없습니다' : '완료된 사고가 없습니다'} isCompact/>
      ) : (
        <VStack gap={3}>
          {shown.map(r => {
            const pf = PLATFORMS.find(p=>p.key===r.platform)
            const cause = CAUSES.find(c=>c.key===r.cause)
            const stage = stageOf(r)
            const badge = STAGE_BADGE[stage]
            const act = action?.id===r.id ? action : null
            const fee = stage==='paid' && r.orderAmount>0 ? r.orderAmount - (r.finalAmount||0) : null
            const due = isDue(r)
            const received = receivedOf(r)
            const tlCount = (r.timeline||[]).length
            const tlOpen = !!openTimeline[r.id]

            if (editId === r.id) return (
              <LedgerCard key={r.id} title="사고 수정">
                <ClaimForm value={editForm} onChange={setEditForm}/>
                <HStack gap={2}>
                  <Button variant="primary" label={saving?'저장 중...':'저장'} isDisabled={saving} onClick={saveEdit}/>
                  <Button label="취소" onClick={()=>{setEditId(null);setEditForm(null)}}/>
                </HStack>
              </LedgerCard>
            )

            return (
              <Card key={r.id} padding={4}>
                <VStack gap={2}>
                  <HStack gap={3} vAlign="start" hAlign="between" wrap="wrap">
                    <VStack gap={1}>
                      <HStack gap={2} vAlign="center" wrap="wrap">
                        <Text weight="bold" hasTabularNumbers>{r.date}</Text>
                        <Badge label={pf?.label || r.platform}/>
                        <Badge variant={badge.badge} label={badge.label}/>
                        {stage==='open' && r.nextCheck && <Badge variant={due ? 'error' : 'neutral'} label={due ? '오늘 확인!' : `${mdLabel(r.nextCheck)} 재확인`}/>}
                      </HStack>
                      {r.memo && <Text>{r.memo}</Text>}
                      <HStack gap={3} wrap="wrap">
                        <Text type="supporting" color="secondary" hasTabularNumbers>손실 <Text weight="bold" color="accent">{wonFmt(r.lossAmount)}원</Text></Text>
                        {stage==='open' && received>0 && <Text type="supporting" color="secondary" hasTabularNumbers>지금까지 입금 <Text weight="bold">{wonFmt(received)}원</Text></Text>}
                        {stage==='paid' && <Text type="supporting" color="secondary" hasTabularNumbers>보상 <Text weight="bold">{wonFmt(r.finalAmount)}원</Text> ({r.finalConfirmedDate})</Text>}
                        {fee!==null && <Text type="supporting" color="secondary" hasTabularNumbers>수수료 −{wonFmt(fee)}원</Text>}
                        {stage==='rejected' && r.rejectReason && <Text type="supporting" color="secondary">사유 {r.rejectReason}</Text>}
                        {r.orderNo && <Text type="supporting" color="secondary" hasTabularNumbers>#{r.orderNo}</Text>}
                        {r.type && <Text type="supporting" color="secondary">{r.type}</Text>}
                        {cause && <Text type="supporting" color="secondary">원인: {cause.label}</Text>}
                      </HStack>
                    </VStack>
                    <HStack gap={1} wrap="wrap">
                      <Button size="sm" variant={tlOpen ? 'primary' : 'secondary'} label={`타임라인${tlCount>0 ? ` ${tlCount}` : ''}`} onClick={()=>setOpenTimeline(o=>({...o,[r.id]:!o[r.id]}))}/>
                      {stage==='open' && !act && <>
                        <Button size="sm" variant="primary" label="보상 받음" onClick={()=>setAction({ id:r.id, kind:'paid', date:todayStr(), amount: received ? String(received) : '' })}/>
                        <Button size="sm" label="거절됨" onClick={()=>setAction({ id:r.id, kind:'rejected', reason:'' })}/>
                      </>}
                      {stage!=='open' && <Button size="sm" label="되돌리기" onClick={()=>reopen(r.id)}/>}
                      {stage==='open' && <Button size="sm" variant="ghost" label="수정" onClick={()=>{ setEditId(r.id); setEditForm({ ...emptyForm(), ...r }) }}/>}
                      <Button size="sm" variant="ghost" label="삭제" onClick={()=>deleteRecord(r.id)}/>
                    </HStack>
                  </HStack>

                  {act && (
                    <Card variant="muted" padding={3}>
                      <HStack gap={2} vAlign="end" wrap="wrap">
                        {act.kind==='paid' ? <>
                          <DateInput label="받은 날짜" value={act.date} onChange={v=>setAction({...act,date:v||act.date})}/>
                          <TextInput label="받은 보상 금액 (원)" inputMode="numeric" placeholder="0" width={170} value={moneyVal(act.amount)} onChange={v=>setAction({...act,amount:numIn(v)})} onEnter={saveAction}/>
                        </> : (
                          <TextInput label="거절 사유" isOptional value={act.reason} onChange={v=>setAction({...act,reason:v})} onEnter={saveAction}/>
                        )}
                        <Button variant="primary" label={saving?'저장 중...':'완료'} isDisabled={saving} onClick={saveAction}/>
                        <Button label="취소" onClick={()=>setAction(null)}/>
                      </HStack>
                    </Card>
                  )}

                  {tlOpen && (
                    <Timeline r={r} editable={stage==='open'} saving={saving}
                      onAdd={ev=>addEvent(r.id, ev)}
                      onDelete={evId=>deleteEvent(r.id, evId)}
                      onNextCheck={d=>setNextCheck(r.id, d)}/>
                  )}
                </VStack>
              </Card>
            )
          })}
        </VStack>
      )}
    </VStack>
    </AstryxPage>
  )
}
