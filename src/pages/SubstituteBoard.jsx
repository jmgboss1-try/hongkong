import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Selector } from '@astryxdesign/core/Selector'
import { TextInput } from '@astryxdesign/core/TextInput'
import { DateInput } from '@astryxdesign/core/DateInput'
import { List, ListItem } from '@astryxdesign/core/List'
import { AstryxPage, PageHeader, LedgerCard } from '../astryx/AstryxPage'

const pad = n => String(n).padStart(2,'0')
const DAYS_KR = ['일','월','화','수','목','금','토']

const HOURS = Array.from({length:24},(_,i)=>pad(i))
const MINUTES = ['00','30']

function todayStr() {
  const n = new Date()
  return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}`
}

function dateLabel(dateStr) {
  if(!dateStr) return ''
  const d = new Date(dateStr)
  return `${d.getMonth()+1}/${d.getDate()}(${DAYS_KR[d.getDay()]})`
}

function toDateStr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
}

// 이번주(일~토) 시작일 기준으로 2주치(14일) 날짜 배열 생성
function get2WeeksDates() {
  const today = new Date()
  const sunday = new Date(today)
  sunday.setDate(today.getDate() - today.getDay()) // 이번주 일요일로 이동
  const weeks = [[], []]
  for(let w=0; w<2; w++){
    for(let i=0; i<7; i++){
      const d = new Date(sunday)
      d.setDate(sunday.getDate() + w*7 + i)
      weeks[w].push(d)
    }
  }
  return weeks
}

function isPast(dateStr) {
  if(!dateStr) return false
  const today = todayStr()
  return dateStr < today
}

export default function SubstituteBoard() {
  const [employees, setEmployees] = useState([])
  const [requests, setRequests]   = useState([]) // [{id, requesterUid, date, startH, startM, endH, endM, reason, applicants:[uid], confirmedUid, createdAt}]
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    requesterUid:'', date: todayStr(), startH:'09', startM:'00', endH:'18', endM:'00', reason:'',
  })

  async function load() {
    setLoading(true)
    try {
      const usersSnap = await getDocs(collection(db,'users'))
      const emps = []
      usersSnap.forEach(d=>{
        const data = d.data()
        if(data.status==='approved' && !['owner','store','investor'].includes(data.role))
          emps.push({ uid:d.id, name:data.name })
      })
      setEmployees(emps)

      const reqSnap = await getDoc(doc(db,'substitutes','requests'))
      setRequests(reqSnap.exists() ? (reqSnap.data().list||[]) : [])
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(()=>{ load() },[])

  const nameOf = uid => employees.find(e=>e.uid===uid)?.name || '—'

  async function saveRequests(newList) {
    await setDoc(doc(db,'substitutes','requests'), { list:newList })
    setRequests(newList)
  }

  async function addRequest() {
    if(!form.requesterUid) return alert('대타가 필요한 직원을 선택해주세요')
    if(!form.date) return alert('날짜를 선택해주세요')
    setSaving(true)
    try {
      const newReq = {
        id: Date.now().toString(),
        requesterUid: form.requesterUid,
        date: form.date,
        startH: form.startH, startM: form.startM,
        endH: form.endH, endM: form.endM,
        reason: form.reason || '',
        applicants: [],
        confirmedUid: null,
        createdAt: new Date().toISOString(),
      }
      await saveRequests([...requests, newReq])
      setForm({ requesterUid:'', date: todayStr(), startH:'09', startM:'00', endH:'18', endM:'00', reason:'' })
      setShowForm(false)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  async function toggleApplicant(reqId, uid) {
    const newList = requests.map(r=>{
      if(r.id !== reqId) return r
      const applicants = r.applicants.includes(uid)
        ? r.applicants.filter(a=>a!==uid)
        : [...r.applicants, uid]
      return { ...r, applicants }
    })
    await saveRequests(newList)
  }

  async function confirmApplicant(reqId, uid) {
    const newList = requests.map(r=>
      r.id === reqId ? { ...r, confirmedUid: uid } : r
    )
    await saveRequests(newList)
  }

  async function cancelConfirm(reqId) {
    const newList = requests.map(r=>
      r.id === reqId ? { ...r, confirmedUid: null } : r
    )
    await saveRequests(newList)
  }

  async function deleteRequest(reqId) {
    if(!window.confirm('이 대타 요청을 삭제하시겠습니까?')) return
    await saveRequests(requests.filter(r=>r.id!==reqId))
  }

  // 지난 날짜는 자동으로 목록에서 숨김 (완전 삭제는 안 함, 필터만)
  const visibleRequests = requests
    .filter(r=>!isPast(r.date))
    .sort((a,b)=> a.date===b.date ? 0 : (a.date>b.date?1:-1))

  const unconfirmed = visibleRequests.filter(r=>!r.confirmedUid)
  const confirmed   = visibleRequests.filter(r=>r.confirmedUid)

  const timeLabel = r => `${r.startH}:${r.startM}~${r.endH}:${r.endM}`

  const hourOpts = HOURS.map(h => ({ value:h, label:`${h}시` }))
  const minOpts = MINUTES.map(m => ({ value:m, label:`${m}분` }))
  const pickT = (k, label, opts) => <Selector label={label} isLabelHidden size="sm" value={form[k]} onChange={v => v && setForm(f => ({ ...f, [k]: v }))} options={opts}/>
  const today = toDateStr(new Date())

  return (
    <AstryxPage>
    <VStack gap={4}>
      <PageHeader title="대타 구함" sub="대타 요청 및 지원 현황" right={<Button variant="primary" label="+ 대타 요청" onClick={()=>setShowForm(v=>!v)}/>}/>

      {/* 요청 등록 */}
      {showForm && (
        <LedgerCard title="대타 요청 등록">
          <VStack gap={2}>
            <Text type="label">대타가 필요한 직원</Text>
            <HStack gap={1} wrap="wrap">
              {employees.map(e => <Button key={e.uid} size="sm" variant={form.requesterUid===e.uid ? 'primary' : 'secondary'} label={e.name} onClick={()=>setForm(f=>({...f,requesterUid:e.uid}))}/>)}
            </HStack>
          </VStack>
          <HStack><DateInput label="날짜" value={form.date} onChange={v=>setForm(f=>({...f,date:v||''}))}/></HStack>
          <VStack gap={2}>
            <Text type="label">시간대</Text>
            <HStack gap={1} vAlign="center" wrap="wrap">
              {pickT('startH', '시작 시', hourOpts)}{pickT('startM', '시작 분', minOpts)}
              <Text color="secondary">~</Text>
              {pickT('endH', '끝 시', hourOpts)}{pickT('endM', '끝 분', minOpts)}
            </HStack>
          </VStack>
          <TextInput label="사유" isOptional placeholder="개인사정 등" value={form.reason} onChange={v=>setForm(f=>({...f,reason:v}))}/>
          <HStack gap={2}>
            <Button variant="primary" label={saving?'등록 중...':'등록'} isDisabled={saving} onClick={addRequest}/>
            <Button label="취소" onClick={()=>setShowForm(false)}/>
          </HStack>
        </LedgerCard>
      )}

      {loading ? <Text color="secondary">불러오는 중...</Text> : <>
        {/* 2주간 현황 */}
        <LedgerCard title="2주간 대타 현황">
          {get2WeeksDates().map((week, wi) => (
            <VStack key={wi} gap={1}>
              <Text type="supporting" weight="bold" color="secondary">{wi===0 ? '이번주' : '다음주'}</Text>
              <Grid columns={7} gap={1}>
                {week.map((d, di) => {
                  const ds = toDateStr(d), isToday = ds === today
                  const dayReqs = requests.filter(r=>r.date===ds)
                  return (
                    <Card key={di} variant={isToday ? 'default' : 'muted'} padding={1.5}>
                      <VStack gap={1} minHeight={60}>
                        <Text type="supporting" weight="bold" color={isToday || di===0 ? 'accent' : 'secondary'} justify="center" hasTabularNumbers>{d.getMonth()+1}/{d.getDate()} ({DAYS_KR[di]})</Text>
                        {dayReqs.map(r => <Badge key={r.id} variant={r.confirmedUid ? 'success' : 'error'} label={nameOf(r.confirmedUid || r.requesterUid)}/>)}
                      </VStack>
                    </Card>
                  )
                })}
              </Grid>
            </VStack>
          ))}
        </LedgerCard>

        {/* 미확정 */}
        <LedgerCard title={`미확정 (${unconfirmed.length}건)`}>
          {unconfirmed.length === 0 ? <Text color="secondary">미확정 대타 요청이 없습니다</Text> : (
            <List hasDividers edge="flush">
              {unconfirmed.map(r => (
                <ListItem key={r.id} align="start"
                  label={<Text weight="bold">{nameOf(r.requesterUid)} <Text color="secondary">대타 구함</Text></Text>}
                  description={<VStack gap={2}>
                    <Text weight="bold" color="accent" hasTabularNumbers>{dateLabel(r.date)} · {timeLabel(r)}</Text>
                    {r.reason && <Text type="supporting" color="secondary">사유: {r.reason}</Text>}
                    <Text type="supporting" color="secondary">지원자 선택 (여러 명 지원 가능)</Text>
                    <HStack gap={1} wrap="wrap">
                      {employees.filter(e=>e.uid!==r.requesterUid).map(e => (
                        <Button key={e.uid} size="sm" variant={r.applicants.includes(e.uid) ? 'primary' : 'secondary'} label={e.name} onClick={()=>toggleApplicant(r.id, e.uid)}/>
                      ))}
                    </HStack>
                    {r.applicants.length > 0 && (
                      <HStack gap={1} vAlign="center" wrap="wrap">
                        <Text type="supporting" color="secondary">확정:</Text>
                        {r.applicants.map(uid => <Button key={uid} size="sm" label={`${nameOf(uid)} 확정`} onClick={()=>confirmApplicant(r.id, uid)}/>)}
                      </HStack>
                    )}
                  </VStack>}
                  endContent={<Button size="sm" variant="ghost" label="삭제" onClick={()=>deleteRequest(r.id)}/>}/>
              ))}
            </List>
          )}
        </LedgerCard>

        {/* 확정 */}
        <LedgerCard title={`확정됨 (${confirmed.length}건)`}>
          {confirmed.length === 0 ? <Text color="secondary">확정된 대타가 없습니다</Text> : (
            <List hasDividers edge="flush">
              {confirmed.map(r => (
                <ListItem key={r.id}
                  label={<Text weight="bold">{nameOf(r.requesterUid)} → {nameOf(r.confirmedUid)} <Text color="secondary">대타 확정</Text></Text>}
                  description={<Text color="accent" hasTabularNumbers>{dateLabel(r.date)} · {timeLabel(r)}</Text>}
                  endContent={<HStack gap={1}>
                    <Button size="sm" variant="ghost" label="확정 취소" onClick={()=>cancelConfirm(r.id)}/>
                    <Button size="sm" variant="ghost" label="삭제" onClick={()=>deleteRequest(r.id)}/>
                  </HStack>}/>
              ))}
            </List>
          )}
        </LedgerCard>
      </>}
    </VStack>
    </AstryxPage>
  )
}
