import { useEffect, useState } from 'react'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Heading } from '@astryxdesign/core/Text'
import { Grid } from '@astryxdesign/core/Grid'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Button } from '@astryxdesign/core/Button'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { TextInput } from '@astryxdesign/core/TextInput'
import { DateInput } from '@astryxdesign/core/DateInput'
import { Selector } from '@astryxdesign/core/Selector'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { AstryxPage, Legacy, PageHeader } from '../astryx/AstryxPage'
import CountUp from '../components/CountUp'
import { avgHoursFromPattern } from '../lib/attendance'
import { POSITIONS } from '../lib/avatar'
import TimeSelect from '../astryx/TimeSelect'
import { db, auth } from '../firebase'
import { collection, getDocs, getDoc, doc, setDoc } from 'firebase/firestore'
import GradeBadge from '../astryx/GradeBadge'
import { loadPrivateMap, withPrivate, saveUser } from '../lib/privateInfo'
import { insuranceFor } from '../lib/payDeduction'
import ContractManager from '../components/ContractManager'
import EmploymentCert from '../components/EmploymentCert'

function calcTenure(joinDate, leaveDate) {
  if (!joinDate) return '—'
  const end = leaveDate ? new Date(leaveDate) : new Date()
  const join = new Date(joinDate)
  const diffDays = Math.floor((end-join)/(1000*60*60*24))
  const years = Math.floor(diffDays/365)
  const months = Math.floor((diffDays%365)/30)
  if (years > 0) return `${years}년 ${months}개월`
  if (months > 0) return `${months}개월`
  return `${diffDays}일`
}

function calcSeverance(joinDate, leaveDate, wage, avgHours) {
  if (!joinDate) return 0
  const end = leaveDate ? new Date(leaveDate) : new Date()
  const join = new Date(joinDate)
  const diffDays = Math.floor((end-join)/(1000*60*60*24))
  if (diffDays < 365) return 0
  const years = diffDays / 365
  const dailyWage = (wage * (avgHours||8)) / 30
  return Math.round(dailyWage * 30 * years)
}

function maskSSN(ssn) {
  if (!ssn) return '—'
  return ssn.slice(0,6) + '-●●●●●●'
}

// 계정 역할 표시 — 매장/투자자 계정은 일반 직원과 권한이 다름 (매출입력 등)
function RoleBadge({ role }) {
  if (role === 'store') return <Badge variant="info" label="매장계정"/>
  if (role === 'investor') return <Badge variant="success" label="투자자"/>
  return <Badge variant="neutral" label="직원"/>
}

// 직원 비밀번호 새로 정해주기 (직원이 비밀번호·이메일 비밀번호를 다 잊었을 때) — 서버 함수 /api/set-password
function SetPasswordBox({ m }) {
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { ok, text }
  async function submit() {
    if (pw.length < 6) return setMsg({ ok:false, text:'비밀번호는 6자 이상으로 정해주세요' })
    if (!window.confirm(`${m.name} 직원의 비밀번호를 '${pw}'(으)로 바꿀까요?\n직원에게 이 비밀번호를 알려주고, 로그인한 뒤엔 기억하기 쉬운 걸로 바꾸라고 해주세요.`)) return
    setBusy(true); setMsg(null)
    try {
      const token = await auth.currentUser.getIdToken()
      const r = await fetch('/api/set-password', { method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token}` },
        body: JSON.stringify({ uid:m.uid, password:pw }) })
      const j = await r.json().catch(()=>({}))
      if (!r.ok) throw new Error(j.error || '비밀번호를 바꾸지 못했어요')
      setMsg({ ok:true, text:`바꿨어요. 아이디 ${m.email||'(이메일)'} / 비밀번호 ${pw} 로 로그인하면 돼요.` })
      setPw('')
    } catch(e) { setMsg({ ok:false, text:e.message }) }
    setBusy(false)
  }
  if (m.role === 'owner') return null
  if (!open) return (
    <HStack><Button size="sm" variant="ghost" label="비밀번호 새로 정해주기" onClick={()=>setOpen(true)}/></HStack>
  )
  return (
    <Card variant="muted" padding={3}>
      <VStack gap={2}>
        <Text type="supporting" color="secondary">직원이 비밀번호를 잊었을 때 새 비밀번호를 정해줘요. 아이디(이메일)는 그대로예요.</Text>
        <HStack gap={2} vAlign="end" wrap="wrap">
          <TextInput label="새 비밀번호" description="6자 이상" value={pw} onChange={v=>setPw((v||'').trim())}
            autoComplete="off" onEnter={submit}/>
          <Button variant="primary" label={busy ? '바꾸는 중...' : '바꾸기'} isDisabled={busy} onClick={submit}/>
          <Button variant="ghost" label="닫기" onClick={()=>{ setOpen(false); setPw(''); setMsg(null) }}/>
        </HStack>
        {msg && <Banner status={msg.ok ? 'success' : 'error'} title={msg.text}/>}
      </VStack>
    </Card>
  )
}

function MemberCard({ m, onEdit, onRetire }) {
  const [showDetail, setShowDetail] = useState(false)
  const [paper, setPaper] = useState(null)   // 'contract' | 'cert' (근로계약서·재직증명서 창)
  const tenure = calcTenure(m.joinDate)
  const severance = calcSeverance(m.joinDate, null, m.wage||10030, m.avgHours||8)
  const facts = [
    ['연락처', m.phone||'—'],
    ['이메일', m.email||'—'],
    ['계좌번호', m.account||'—'],
    ['주민번호', maskSSN(m.ssn)],
    ...(m.payType==='fixed'
      ? [['월 고정급', `${(m.fixedSalary||0).toLocaleString()}원`]]
      : [['시급', `${(m.wage||10030).toLocaleString()}원`], ['평균 근무시간', `${m.avgHours||8}h/일`]]),
  ]

  return (
    <Card>
      <VStack gap={3}>
        <HStack hAlign="between" vAlign="center" gap={2}>
          <VStack gap={1}>
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Heading level={4}>{m.name}</Heading>
              <GradeBadge joinDate={m.joinDate}/><RoleBadge role={m.role}/>
            </HStack>
            <Text type="supporting" color="secondary">입사일: {m.joinDate||'미입력'} · 근속 {tenure}</Text>
          </VStack>
          <Button size="sm" variant="ghost" label={showDetail ? '접기' : '자세히'} onClick={()=>setShowDetail(v=>!v)}/>
        </HStack>
        {showDetail && <>
          <Grid columns={{ minWidth: 150, max: 3, repeat: 'fit' }} gap={2}>
            {facts.map(([label, val]) => (
              <Card key={label} variant="muted" padding={2}>
                <VStack gap={0}>
                  <Text type="supporting" color="secondary">{label}</Text>
                  <Text hasTabularNumbers>{val}</Text>
                </VStack>
              </Card>
            ))}
          </Grid>
          <Card variant="muted" padding={3}>
            <HStack hAlign="between" vAlign="center" gap={2} wrap="wrap">
              <VStack gap={0}>
                <Text type="supporting" color="secondary">예상 퇴직금 (현재 기준)</Text>
                <Text type="large" weight="bold" color="accent" hasTabularNumbers>{severance > 0 ? `${severance.toLocaleString()}원` : '1년 미만 (해당없음)'}</Text>
              </VStack>
              <Text type="supporting" color="secondary" hasTabularNumbers>근속 {tenure} · 시급 {(m.wage||10030).toLocaleString()}원</Text>
            </HStack>
          </Card>
          <SetPasswordBox m={m}/>
          <HStack gap={2} wrap="wrap">
            <Button variant="primary" label="정보 수정" onClick={()=>onEdit(m)}/>
            <Button variant="destructive" label="퇴직 처리" onClick={()=>onRetire(m)}/>
            <Button label="근로계약서" onClick={()=>setPaper('contract')}/>
            <Button label="재직증명서" onClick={()=>setPaper('cert')}/>
          </HStack>
          {paper && <Legacy>
            {paper === 'contract' && <ContractManager member={m} onClose={()=>setPaper(null)}/>}
            {paper === 'cert' && <EmploymentCert member={m} onClose={()=>setPaper(null)}/>}
          </Legacy>}
        </>}
      </VStack>
    </Card>
  )
}

function RetiredCard({ m, onRestore }) {
  const [showDetail, setShowDetail] = useState(false)
  const [cert, setCert] = useState(false)   // 경력증명서 창
  const tenure = calcTenure(m.joinDate, m.leaveDate)
  const severance = calcSeverance(m.joinDate, m.leaveDate, m.wage||10030, m.avgHours||8)

  return (
    <Card variant="muted" padding={4}>
      <VStack gap={3}>
        <HStack gap={2} vAlign="center" hAlign="between">
          <VStack gap={1}>
            <HStack gap={2} vAlign="center"><Heading level={4}>{m.name}</Heading><Badge label="퇴직"/></HStack>
            <Text type="supporting" color="secondary" hasTabularNumbers>{m.joinDate||'?'} ~ {m.leaveDate||'?'} · 근속 {tenure}</Text>
          </VStack>
          <Button size="sm" variant="ghost" label={showDetail ? '접기' : '자세히'} onClick={()=>setShowDetail(v=>!v)}/>
        </HStack>
        {showDetail && <>
          <Grid columns={{ minWidth: 160, repeat: 'fit' }} gap={2}>
            {[
              ['입사일', m.joinDate||'—'],
              ['퇴사일', m.leaveDate||'—'],
              ['연락처', m.phone||'—'],
              ['계좌번호', m.account||'—'],
              ['마지막 시급', `${(m.wage||10030).toLocaleString()}원`],
              ['평균 근무시간', `${m.avgHours||8}h/일`],
            ].map(([label,val])=>(
              <Card key={label} padding={2}>
                <VStack gap={0}><Text type="supporting" color="secondary">{label}</Text><Text hasTabularNumbers>{val}</Text></VStack>
              </Card>
            ))}
          </Grid>
          <Card padding={3}>
            <HStack gap={2} vAlign="center" hAlign="between">
              <VStack gap={0}>
                <Text type="supporting" color="secondary">퇴직금 (퇴사일 기준)</Text>
                <Text type="large" weight="bold" color="accent" hasTabularNumbers>{severance > 0 ? severance.toLocaleString()+'원' : '1년 미만 (해당없음)'}</Text>
              </VStack>
              <Text type="supporting" color="secondary" hasTabularNumbers>근속 {tenure} · 시급 {(m.wage||10030).toLocaleString()}원</Text>
            </HStack>
          </Card>
          <HStack gap={2}>
            <Button label="복직 처리" onClick={()=>onRestore(m)}/>
            <Button label="경력증명서" onClick={()=>setCert(true)}/>
          </HStack>
          {cert && <Legacy><EmploymentCert member={m} onClose={()=>setCert(false)}/></Legacy>}
        </>}
      </VStack>
    </Card>
  )
}

// 고르기 칸 (설명은 고른 것 아래 한 줄)
const PAY_TYPES = [{key:'hourly', label:'시급제', desc:'근무시간 기반 계산'}, {key:'fixed', label:'고정급제', desc:'매달 고정 금액 지급'}]
const EMPLOY_TYPES = [{key:'part', label:'아르바이트', desc:'3.3% 원천징수'}, {key:'full', label:'정직원', desc:'4대보험 적용'}, {key:'none', label:'공제없음', desc:'세전 지급'}]
const ROLES = [{key:'staff', label:'직원', desc:'스케쥴·내 급여 등 직원 메뉴'}, {key:'store', label:'매장계정', desc:'매출입력·체크리스트 등 매장 메뉴'}, {key:'investor', label:'투자자', desc:'매출·투자관리 조회만'}]
const HOLIDAY_BASES = [{key:'contract', label:'소정근로 기준', desc:'법적 기준'}, {key:'actual', label:'실제근무 기준', desc:'복지 적용'}]
function choice(label, value, onChange, opts, note) {
  return (
    <VStack gap={2}>
      <Text type="label">{label}</Text>
      <HStack><SegmentedControl label={label} value={value} onChange={v=>v && onChange(v)}>
        {opts.map(o => <SegmentedControlItem key={o.key} value={o.key} label={o.label}/>)}
      </SegmentedControl></HStack>
      <Text type="supporting" color="secondary">{opts.find(o => o.key === value)?.desc}{note ? ` · ${note}` : ''}</Text>
    </VStack>
  )
}
function formField(label, type, key, val, set) {
  if (type === 'date') return <DateInput key={key} label={label} value={val || ''} onChange={v=>set(v || '')}/>
  if (type === 'number' || type === 'decimal') return <TextInput key={key} label={label} inputMode={type === 'number' ? 'numeric' : 'decimal'} value={String(val ?? '')}
    onChange={v=>set(v.replace(type === 'number' ? /[^0-9]/g : /[^0-9.]/g, ''))}/>
  return <TextInput key={key} label={label} value={String(val ?? '')} onChange={set}/>
}

export default function Members() {
  const [members, setMembers] = useState([])
  const [retired, setRetired] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showRetired, setShowRetired] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [retireForm, setRetireForm] = useState(null) // 퇴직 처리 중인 직원
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({})
  const [addSaving, setAddSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [snap, priv] = await Promise.all([getDocs(collection(db,'users')), loadPrivateMap()])
      const active = [], ret = []
      snap.forEach(d => {
        const data = withPrivate({ uid:d.id, ...d.data() }, priv)
        if(data.role === 'owner') return
        if(data.status === 'approved') active.push({uid:d.id,...data})
        if(data.status === 'retired') ret.push({uid:d.id,...data})
      })
      setMembers(active.sort((a,b)=>a.joinDate>b.joinDate?1:-1))
      setRetired(ret.sort((a,b)=>a.leaveDate>b.leaveDate?-1:1))
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(()=>{ load() },[])

  function setF(key,val){ setForm(f=>({...f,[key]:val})) }

  async function save() {
    if(!form.name?.trim()) return alert('이름을 입력해주세요')
    setSaving(true)
    try {
      const now = new Date()
      const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
      const [userSnap, privSnap] = await Promise.all([getDoc(doc(db,'users',form.uid)), getDoc(doc(db,'userPrivate',form.uid))])
      const existingData = { ...(userSnap.exists() ? userSnap.data() : {}), ...(privSnap.exists() ? privSnap.data() : {}) }

      // ── 시급 이력 ──
      const existingHistory = existingData.wageHistory || []
      const oldWage = existingData.wage || 10030
      const newWage = +form.wage || 10030
      const hasPriorHistory = existingHistory.some(h => h.month < thisMonth)
      const newHistory = existingHistory.filter(h => h.month !== thisMonth)
      if (!hasPriorHistory && oldWage !== newWage) {
        const joinMonth = form.joinDate ? form.joinDate.slice(0,7) : '2022-10'
        newHistory.push({ month: joinMonth, wage: oldWage })
      }
      newHistory.push({ month: thisMonth, wage: newWage })
      newHistory.sort((a,b) => a.month > b.month ? 1 : -1)

      // ── 4대보험 금액 이력 (정직원): 공단 고지서 금액. 바뀐 경우만 '적용 시작 달'에 한 줄 남김 ──
      const KEYS = ['pension','health','care','employ']
      let newInsHistory = existingData.insuranceHistory || []
      if ((form.employType||'part') === 'full') {
        const from = form.insFrom || thisMonth
        const cur = insuranceFor(newInsHistory, from) || {}
        const next = Object.fromEntries(KEYS.map(k => [k, Math.max(0, Math.round(+form['ins_'+k] || 0))]))
        if (KEYS.some(k => (+cur[k]||0) !== next[k]))
          newInsHistory = [...newInsHistory.filter(h => h.month !== from), { month: from, ...next }].sort((a,b) => a.month > b.month ? 1 : -1)
      }

      // ── 근무스케쥴(소정근로일/평균근무시간) 이력 — 시급 이력과 동일한 패턴 ──
      const existingScheduleHistory = existingData.scheduleHistory || []
      const oldWorkDays = existingData.workDays || [1,2,3,4,5]
      const oldAvgHours = existingData.avgHours || 8
      const newWorkDays = form.workDays || [1,2,3,4,5]
      const newAvgHours = +form.avgHours || 8
      const scheduleChanged = JSON.stringify(oldWorkDays) !== JSON.stringify(newWorkDays) || oldAvgHours !== newAvgHours
      const hasPriorScheduleHistory = existingScheduleHistory.some(h => h.month < thisMonth)
      const newScheduleHistory = existingScheduleHistory.filter(h => h.month !== thisMonth)
      if (!hasPriorScheduleHistory && scheduleChanged) {
        const joinMonth = form.joinDate ? form.joinDate.slice(0,7) : '2022-10'
        newScheduleHistory.push({ month: joinMonth, workDays: oldWorkDays, avgHours: oldAvgHours })
      }
      newScheduleHistory.push({ month: thisMonth, workDays: newWorkDays, avgHours: newAvgHours })
      newScheduleHistory.sort((a,b) => a.month > b.month ? 1 : -1)

      await saveUser(form.uid, {
        name: form.name,
        role: form.role || 'staff',
        wage: newWage,
        joinDate: form.joinDate || '',
        phone: form.phone || '',
        email: form.email || '',
        account: form.account || '',
        ssn: form.ssn || '',
        avgHours: newAvgHours,
        workDays: newWorkDays,
        holidayBase: form.holidayBase || 'contract',
        employType: form.employType || 'part',
        insuranceHistory: newInsHistory,
        payType: form.payType || 'hourly',
        fixedSalary: +form.fixedSalary || 0,
        wageHistory: newHistory,
        scheduleHistory: newScheduleHistory,
        shiftTimes: form.shiftTimes || {},
        positions: form.positions?.length ? form.positions : [form.position || 'hall'],
        position: (form.positions?.length ? form.positions : [form.position || 'hall'])[0],
        // 일찍 출근 자동 인정 분 (null = 매장 기본 따름, 근무관리 → NFC 출퇴근 → 설정)
        earlyAuto: form.earlyAuto === '' || form.earlyAuto == null ? null : +form.earlyAuto,
      })

      await load()
      setShowForm(false)
      setForm({})
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  async function retireMember() {
    if(!retireForm?.leaveDate) return alert('퇴사일을 입력해주세요')
    setSaving(true)
    try {
      await setDoc(doc(db,'users',retireForm.uid), {
        status: 'retired',
        leaveDate: retireForm.leaveDate,
      }, {merge:true})
      setRetireForm(null)
      await load()
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  async function restoreMember(m) {
    if(!window.confirm(`${m.name}님을 다시 재직 상태로 복직 처리하시겠습니까?`)) return
    setSaving(true)
    try {
      await setDoc(doc(db,'users',m.uid), {
        status: 'approved',
        leaveDate: '',
      }, {merge:true})
      await load()
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  async function addMember() {
    if(!addForm.name?.trim()) return alert('이름을 입력해주세요')
    setAddSaving(true)
    try {
      const newUid = 'manual_' + Date.now()
      await saveUser(newUid, {
        name:         addForm.name.trim(),
        role:         'staff',
        status:       'approved',
        joinDate:     addForm.joinDate || '',
        phone:        addForm.phone || '',
        account:      addForm.account || '',
        ssn:          addForm.ssn || '',
        wage:         +addForm.wage || 10030,
        avgHours:     +addForm.avgHours || 8,
        workDays:     addForm.workDays || [1,2,3,4,5],
        holidayBase:  addForm.holidayBase || 'contract',
        employType:   addForm.employType || 'part',
        payType:      addForm.payType || 'hourly',
        fixedSalary:  +addForm.fixedSalary || 0,
        wageHistory:  [{ month: (addForm.joinDate||'').slice(0,7) || '2022-10', wage: +addForm.wage||10030 }],
        scheduleHistory: [{ month: (addForm.joinDate||'').slice(0,7) || '2022-10',
          workDays: addForm.workDays || [1,2,3,4,5], avgHours: +addForm.avgHours || 8 }],
        manualEntry:  true,
      })
      setShowAddForm(false)
      setAddForm({})
      await load()
    } catch(e) { console.error(e) }
    setAddSaving(false)
  }

  function editMember(m) {
    const now = new Date(), ym = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
    const ins = insuranceFor(m.insuranceHistory, ym) || {}
    setForm({...m, workDays: Array.isArray(m.workDays) ? m.workDays : [1,2,3,4,5], insFrom: ym,
      ins_pension: ins.pension || '', ins_health: ins.health || '', ins_care: ins.care || '', ins_employ: ins.employ || ''})
    setShowForm(true)
    window.scrollTo({top:0,behavior:'smooth'})
  }

  const totalSeverance = members.reduce((a,m)=>
    a+calcSeverance(m.joinDate,null,m.wage||10030,m.avgHours||8),0)

  return (
    <AstryxPage>
    <VStack gap={4}>
      <PageHeader title="인원관리" sub="사장 전용 — 승인된 직원 정보"
        right={<Button variant="primary" label="+ 직원 추가" onClick={()=>{ setShowAddForm(v=>!v); setAddForm({payType:'hourly',employType:'part',workDays:[1,2,3,4,5]}) }}/>}/>

      {/* 총 퇴직금 */}
      <Card>
        <HStack hAlign="between" vAlign="center" gap={3} wrap="wrap">
          <VStack gap={1}>
            <Text type="label" color="secondary">전체 예상 퇴직금 합계</Text>
            <Text type="display-3" hasTabularNumbers><CountUp value={totalSeverance}/><Text type="large" color="inherit"> 원</Text></Text>
          </VStack>
          <Text color="secondary">재직 {members.length}명 · 퇴직 {retired.length}명</Text>
        </HStack>
      </Card>

      {/* 직원 추가 폼 */}
      {showAddForm && (
        <Card padding={4}>
          <VStack gap={4}>
            <HStack gap={2} vAlign="center" hAlign="between"><Heading level={4}>새 직원 추가</Heading><Button size="sm" variant="ghost" label="닫기" onClick={()=>setShowAddForm(false)}/></HStack>
            {choice('급여 방식', addForm.payType||'hourly', v=>setAddForm(f=>({...f,payType:v})), PAY_TYPES)}
            <Grid columns={{ minWidth: 180, repeat: 'fill' }} gap={3}>
              {[
                ['이름','text','name'],
                ['입사일','date','joinDate'],
                ['연락처','text','phone'],
                ['계좌번호','text','account'],
                ['주민등록번호','text','ssn'],
                ...((addForm.payType||'hourly')==='fixed'
                  ? [['월 고정급 (원)','number','fixedSalary']]
                  : [['시급 (원)','number','wage'], ['평균근무시간(h/일)','decimal','avgHours']]),
              ].map(([label,type,key])=> formField(label, type, key, addForm[key]||'', v=>setAddForm(f=>({...f,[key]:v}))))}
            </Grid>
            {choice('고용 유형 (공제 기준)', addForm.employType||'part', v=>setAddForm(f=>({...f,employType:v})), EMPLOY_TYPES)}
            <HStack gap={2} vAlign="center" wrap="wrap">
              <Button variant="primary" label={addSaving?'추가 중...':'직원 추가'} isDisabled={addSaving} onClick={addMember}/>
              <Button label="취소" onClick={()=>setShowAddForm(false)}/>
              <Text type="supporting" color="secondary">이 직원은 앱 로그인 없이 급여관리에만 반영돼요</Text>
            </HStack>
          </VStack>
        </Card>
      )}

      {/* 퇴직 처리 */}
      {retireForm && (
        <Card padding={4}>
          <VStack gap={3}>
            <Heading level={4}>{retireForm.name} 퇴직 처리</Heading>
            <DateInput label="퇴사일" value={retireForm.leaveDate||''} onChange={v=>setRetireForm(f=>({...f,leaveDate:v||''}))}/>
            {retireForm.leaveDate && (
              <Card variant="muted" padding={3}>
                <VStack gap={1}>
                  <Text type="supporting" color="secondary">퇴직금 (퇴사일 기준)</Text>
                  <Text type="large" weight="bold" color="accent" hasTabularNumbers>{calcSeverance(retireForm.joinDate, retireForm.leaveDate, retireForm.wage||10030, retireForm.avgHours||8).toLocaleString()}원</Text>
                  <Text type="supporting" color="secondary">근속 {calcTenure(retireForm.joinDate, retireForm.leaveDate)}</Text>
                </VStack>
              </Card>
            )}
            <HStack gap={2}>
              <Button variant="destructive" label={saving?'처리 중...':'퇴직 확정'} isDisabled={saving} onClick={retireMember}/>
              <Button label="취소" onClick={()=>setRetireForm(null)}/>
            </HStack>
          </VStack>
        </Card>
      )}

      {/* 수정 폼 */}
      {showForm && (
        <Card padding={4}>
          <VStack gap={4}>
            <HStack gap={2} vAlign="center" hAlign="between"><Heading level={4}>{form.name} 정보 수정</Heading><Button size="sm" variant="ghost" label="닫기" onClick={()=>setShowForm(false)}/></HStack>
            <Grid columns={{ minWidth: 180, repeat: 'fill' }} gap={3}>
              {[
                ['이름','text','name',form.name||''],
                ['입사일','date','joinDate',form.joinDate||''],
                ['연락처','text','phone',form.phone||''],
                ['계좌번호','text','account',form.account||''],
                ['주민등록번호','text','ssn',form.ssn||''],
                ...((form.payType||'hourly')==='fixed'
                  ? [['월 고정급 (원)','number','fixedSalary',form.fixedSalary||0]]
                  : [['시급','number','wage',form.wage||10030], ['평균근무시간(h/일)','decimal','avgHours',form.avgHours||8]]),
              ].map(([label,type,key,val])=> formField(label, type, key, val, v=>setF(key,v)))}
            </Grid>

            {choice('계정 역할 (볼 수 있는 메뉴가 바뀜)', form.role||'staff', v=>setF('role', v), ROLES,
              '매장계정·투자자로 바꾸면 급여 목록에서 빠져요. 바뀐 역할은 그 사람이 앱을 새로 열면 적용돼요.')}
            {choice('급여 방식', form.payType||'hourly', v=>setF('payType', v), PAY_TYPES)}

            <VStack gap={2}>
              <Text type="label">소정근로일 (주휴수당 기준)</Text>
              <HStack gap={1} wrap="wrap">
                {['월','화','수','목','금','토','일'].map((day,i)=>{
                  const idx = i+1===7 ? 0 : i+1
                  const current = form.workDays || [1,2,3,4,5]
                  const checked = current.includes(idx)
                  return <Button key={day} size="sm" variant={checked ? 'primary' : 'secondary'} label={day}
                    onClick={()=>setF('workDays', checked ? current.filter(d=>d!==idx) : [...current, idx].sort())}/>
                })}
              </HStack>
              <Text type="supporting" color="secondary">주 {Array.isArray(form.workDays)?form.workDays.length:5}일 소정근로</Text>
            </VStack>

            <VStack gap={2}>
              <HStack><Selector label="일찍 출근 자동 인정" description="예정보다 일찍 온 시간을 이만큼까지는 승인 없이 급여에 넣어요" value={String(form.earlyAuto ?? '')} onChange={v=>setF('earlyAuto', v ?? '')}
                options={[{ value:'', label:'매장 기본 따름' }, { value:'0', label:'안 함 (사장님이 승인)' }, ...[5,10,15,20,30,40,60].map(m => ({ value:String(m), label:`${m}분까지 바로 인정` }))]}/></HStack>
              <Text type="supporting" color="secondary">더 일찍 온 시간은 근무관리에서 승인 대기로 떠요 · 다음 출근부터 적용</Text>
            </VStack>

            <VStack gap={2}>
              <Text type="label">포지션 (우리 매장 화면에서 캐릭터가 일하는 자리 · 여러 개 고르면 그 사이를 오가요)</Text>
              <HStack gap={1} wrap="wrap">
                {POSITIONS.map(p => {
                  const cur = form.positions?.length ? form.positions : [form.position || 'hall']
                  const on = cur.includes(p.id)
                  // 여러 개 고를 수 있음 (고른 자리들을 오가며 일함). 하나는 꼭 남김
                  const toggle = () => { const next = on ? cur.filter(x => x !== p.id) : [...cur, p.id]; if (next.length) setF('positions', next) }
                  return <Button key={p.id} size="sm" variant={on ? 'primary' : 'secondary'} label={p.label} onClick={toggle}/>
                })}
              </HStack>
            </VStack>

            {/* 요일별 기본 출근 시간 (시각 고르기는 아직 예전 칸) */}
            <VStack gap={2}>
              <Text type="label">요일별 기본 출근 시간</Text>
              <Text type="supporting" color="secondary">고정 근무자만 · 퇴근은 안 넣어도 돼요, 찍은 시각까지 인정 · 시간이 유동적이면 비워 두고 스케쥴 근무표에서 주마다 넣어요</Text>
              {['월','화','수','목','금','토','일'].map((day,i)=>{
                const idx = i+1===7 ? 0 : i+1
                if(!(form.workDays || [1,2,3,4,5]).includes(idx)) return null
                const st = form.shiftTimes?.[idx] || {}
                const setT = (k,v) => setF('shiftTimes', { ...(form.shiftTimes||{}), [idx]: { ...st, [k]: v } })
                return (
                  <HStack key={day} gap={2} vAlign="center" wrap="wrap">
                    <Text weight="bold">{day}</Text>
                    <TimeSelect value={st.start||''} onChange={v=>setT('start',v)} label={`${day} 출근`} clearable/>
                    <Text color="secondary">~</Text>
                    <TimeSelect value={st.end||''} onChange={v=>setT('end',v)} label={`${day} 퇴근`} clearable/>
                    {idx===[1,2,3,4,5,6,0].find(d=>(form.workDays||[1,2,3,4,5]).includes(d)) && st.start && (
                      <Button size="sm" variant="ghost" label="모든 근무일에 같게" onClick={()=>setF('shiftTimes', Object.fromEntries((form.workDays||[1,2,3,4,5]).map(d=>[d,{start:st.start,end:st.end||''}])))}/>
                    )}
                  </HStack>
                )
              })}
              <Text type="supporting" color="secondary">
                여기 넣은 시간이 매주 스케쥴 근무표에 자동으로 채워져요. 특정 날만 다르면 스케쥴에서 그 칸만 바꾸면 돼요.
                근무표에도 시간이 없는 날 출퇴근을 찍으면 그날 근무 전체가 승인 대기로 가요.
              </Text>
              {(() => {
                const avg = avgHoursFromPattern(form.shiftTimes, form.workDays || [1,2,3,4,5])
                if (avg == null || +form.avgHours === avg) return null
                return (
                  <HStack gap={2} vAlign="center" wrap="wrap">
                    <Text>위 시간으로 계산한 하루 평균 <b>{avg}시간</b> (토요일 브레이크 제외) · 지금 평균근무시간 {form.avgHours||8}시간</Text>
                    <Button size="sm" label="평균근무시간에 넣기" onClick={()=>setF('avgHours', avg)}/>
                  </HStack>
                )
              })()}
            </VStack>

            {choice('주휴수당 계산 기준', form.holidayBase||'contract', v=>setF('holidayBase', v), HOLIDAY_BASES)}
            {choice('고용 유형 (공제 기준)', form.employType||'part', v=>setF('employType', v), EMPLOY_TYPES)}

            {/* 4대보험 금액 (정직원): 공단 고지서에 나온 근로자 부담분. 넣으면 급여에서 이 금액을 그대로 뗌 */}
            {(form.employType||'part') === 'full' && (
              <VStack gap={2}>
                <Text type="label">4대보험 금액 (고지서의 근로자 부담분, 월)</Text>
                <Grid columns={{ minWidth: 130, repeat: 'fit' }} gap={2}>
                  {[['pension','국민연금'],['health','건강보험'],['care','장기요양'],['employ','고용보험']].map(([k,l]) => (
                    <TextInput key={k} label={l} inputMode="numeric" placeholder="0" value={form['ins_'+k] === '' || form['ins_'+k] == null ? '' : (+form['ins_'+k]).toLocaleString('ko-KR')}
                      onChange={v=>setF('ins_'+k, v.replace(/[^0-9]/g,''))}/>
                  ))}
                  <TextInput label="적용 시작 달" placeholder="YYYY-MM" value={form.insFrom || ''} onChange={v=>setF('insFrom', v.replace(/[^0-9-]/g,'').slice(0,7))}/>
                </Grid>
                <Text type="supporting" color="secondary">
                  합계 {['pension','health','care','employ'].reduce((a,k)=>a+(+form['ins_'+k]||0),0).toLocaleString('ko-KR')}원.
                  넣으면 '적용 시작 달'부터 매달 이 금액을 그대로 떼고, 금액이 바뀌면 새 달로 다시 넣으면 돼요 (예전 달은 그대로).
                  모두 비워 두면 예전처럼 급여 × 비율로 계산해요.
                </Text>
              </VStack>
            )}

            <HStack gap={2}>
              <Button variant="primary" label={saving?'저장 중...':'저장'} isDisabled={saving} onClick={save}/>
              <Button label="취소" onClick={()=>setShowForm(false)}/>
            </HStack>
          </VStack>
        </Card>
      )}

      {/* 재직 직원 목록 */}
      {loading ? <Text color="secondary">불러오는 중...</Text> : (
        <VStack gap={3}>
          {members.length===0 && <EmptyState title="승인된 직원이 없습니다" isCompact/>}
          {members.map(m=>(
            <MemberCard key={m.uid} m={m} onEdit={editMember} onRetire={m=>setRetireForm({...m,leaveDate:''})}/>
          ))}
        </VStack>
      )}

      {/* 퇴직자 목록 */}
      <Button width="100%" label={`${showRetired ? '접기' : '보기'} · 퇴직자 기록 (${retired.length}명)`} onClick={()=>setShowRetired(v=>!v)}/>
      {showRetired && (retired.length===0 ? <EmptyState title="퇴직자 기록이 없습니다" isCompact/> : (
        <VStack gap={3}>
          {retired.map(m=><RetiredCard key={m.uid} m={m} onRestore={restoreMember}/>)}
        </VStack>
      ))}
    </VStack>
    </AstryxPage>
  )
}
