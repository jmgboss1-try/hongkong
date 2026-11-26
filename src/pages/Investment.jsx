import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { collection, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore'
import { useAuth } from '../AuthContext'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Divider } from '@astryxdesign/core/Divider'
import { Selector } from '@astryxdesign/core/Selector'
import { TextInput } from '@astryxdesign/core/TextInput'
import { DateInput } from '@astryxdesign/core/DateInput'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { List, ListItem } from '@astryxdesign/core/List'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { AstryxPage, PageHeader, LedgerCard } from '../astryx/AstryxPage'

const pad = n => String(n).padStart(2,'0')
const newId = () => `${Date.now()}`
const wonFmt = n => (n||0).toLocaleString('ko-KR') + '원'
const dateFmt = d => d ? d.slice(0,10) : '—'

// 오늘 날짜 (YYYY-MM-DD)
function todayStr() {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
}

// 금액 입력 포맷 헬퍼
function fmtAmount(val) {
  const num = val.replace(/[^0-9]/g, '')
  return num ? Number(num).toLocaleString('ko-KR') : ''
}
function parseAmount(val) {
  return +val.replace(/[^0-9]/g, '') || 0
}

const INVESTORS = {
  terry: { name: '테리', ratio: 0.7, color: '#C3261C', emoji: '' },
  hyung:  { name: '형',   ratio: 0.3, color: '#2B5C9E', emoji: '' },
}

// 형 대출금 별도 설정 (투자금과 이자율 다름)
const HYUNG_LOAN = {
  amount: 12000000,   // 1200만원
  rate: 0.10,         // 연 10%
}

// 투자자별 카테고리 분리
const CATEGORIES_BY_INVESTOR = {
  terry: [
    { key: 'investment', label: '투자금 회수' },
    { key: 'loss',       label: '운영 손해분 회수' },
    { key: 'severance',  label: '퇴직금 대납 회수' },
    { key: 'salary',     label: '미지급 월급 회수' },
  ],
  hyung: [
    { key: 'investment', label: '투자금 회수' },
    { key: 'loan',       label: '대출금 상환 회수' },
  ],
}
// 전체 카테고리 (집계/테이블용)
const ALL_CATEGORIES = [
  { key: 'investment', label: '투자금 회수' },
  { key: 'loss',       label: '운영 손해분 회수' },
  { key: 'severance',  label: '퇴직금 대납 회수' },
  { key: 'loan',       label: '대출금 상환 회수' },
  { key: 'salary',     label: '미지급 월급 회수' },
]

// 미지급 월급 (테리): 사장님이 못 받은 달을 직접 적음 (띄엄띄엄이든 연속이든)
//  terry.unpaidSalary = [{ id, ym:'YYYY-MM', amount, memo }]  — 금액은 적을 때 급여관리 '내 급여 설정'(payrollOwner, 다음 달로 이어짐)의 세후 월급으로 채워 줌
//  회수 목표 = 적은 달 금액 합계. 나중에 받으면 '회수 입력'에서 미지급 월급 회수로 적음
const nextYm = ym => { const [y,m] = ym.split('-').map(Number); return m === 12 ? `${y+1}-01` : `${y}-${pad(m+1)}` }
// payrollOwner 문서들로 그 달 세후 월급 (그 달 이전 가장 최근 설정)
const netSalaryOf = (ownerDocs, ym) => {
  const cfg = [...ownerDocs].filter(d => d.id <= ym).sort((a,b)=>b.id.localeCompare(a.id))[0]
  return cfg ? Math.max(0, (+cfg.salary||0) - (+cfg.deduction||0)) : 0
}
const salaryTargetOf = cfg => (cfg?.unpaidSalary || []).reduce((a,x)=>a+(+x.amount||0), 0)
// 연속된 달은 묶어서 '2026.07~09, 2026.11' 처럼
function monthRuns(yms) {
  const out = []
  for (const ym of [...yms].sort()) {
    const last = out[out.length-1]
    if (last && nextYm(last.to) === ym) last.to = ym; else out.push({ from: ym, to: ym })
  }
  return out.map(r => r.from === r.to ? r.from.replace('-','.')
    : r.from.slice(0,4) === r.to.slice(0,4) ? `${r.from.replace('-','.')}~${r.to.slice(5)}` : `${r.from.replace('-','.')}~${r.to.replace('-','.')}`).join(', ')
}

// 단리 이자 계산 (연 5%, 일 단위)
function calcInterest(principal, fromDate, toDate, rate = 0.05) {
  if (!principal || !fromDate) return 0
  const from = new Date(fromDate)
  const to   = toDate ? new Date(toDate) : new Date()
  const days  = Math.max(0, Math.floor((to - from) / (1000*60*60*24)))
  return Math.round(principal * rate * (days / 365))
}

// 추가 투입(additions: [{ id, month:'YYYY-MM', date?, amount, kind, noInterest, memo }])은 각각 따로 회수 항목('add:<id>')
// 투자금 회수(category 'investment')는 추가 투입분부터 먼저 채우고(먼저 들어간 것부터), 다 채우면 최초 투자금으로
const additionStart = a => a.date || (a.month ? `${a.month}-01` : '')
const sortedAdditions = cfg => [...(cfg.additions || [])].filter(a=>a.amount).sort((a,b)=>additionStart(a).localeCompare(additionStart(b)))
const additionLabel = a => `${a.kind==='operating' ? '추가 운영자금' : '추가 투자금'} 회수 (${(a.date||a.month||'').replace(/-/g,'.')}${a.memo ? ` · ${a.memo}` : ''})`
// 투자자별 회수 항목: 추가 투입분(회수 순서대로) → 기본 항목
const categoriesFor = (uid, cfg) => [
  ...sortedAdditions(cfg || {}).map(a => ({ key:`add:${a.id}`, label: additionLabel(a), addition:a })),
  ...(CATEGORIES_BY_INVESTOR[uid] || CATEGORIES_BY_INVESTOR.terry),
]

// 투자금 회수 배분. 각 원금 조각은 연 5% 단리(조각마다 시작일부터), 다 회수된 날 이자 계산을 멈춤
//   flowsOf(key) → [{ date, amount }]  회수 기록(+) · 넘긴 금액(−) · 넘겨받은 금액(+)
//   돌려주는 값: { pieces:[{ key, amount, target, paid, doneAt }], surplus } — surplus는 모든 조각을 채우고 남은 투자금 회수
function allocateInvest(cfg, flowsOf, today) {
  const pieces = [
    ...sortedAdditions(cfg).map(a => ({ key:`add:${a.id}`, amount:a.amount, start:additionStart(a), interest:!a.noInterest })),
    { key:'investment', amount: cfg.amount || 0, start: cfg.startDate || '', interest: true },
  ].map(p => ({ ...p, paid:0, doneAt:null }))
  const owedAt = (p, d) => p.amount + (p.interest ? calcInterest(p.amount, p.start, d) : 0)
  const events = [
    ...flowsOf('investment').map(f => ({ ...f, to:null })),
    ...pieces.filter(p=>p.key!=='investment').flatMap(p => flowsOf(p.key).map(f => ({ ...f, to:p.key }))),
    ...pieces.filter(p=>p.start).map(p => ({ date:p.start, amount:0, to:null })), // 새 투입일에 남은 회수분을 먼저 채우도록
  ].filter(e => e.date <= today)
  let surplus = 0
  for (const d of [...new Set(events.map(e=>e.date))].sort()) {
    const evs = events.filter(e=>e.date===d)
    for (const e of evs.filter(e=>e.to)) pieces.find(p=>p.key===e.to).paid += e.amount
    let avail = surplus + evs.filter(e=>!e.to).reduce((a,e)=>a+e.amount,0)
    for (const p of pieces) {
      if (avail <= 0) break
      if (p.doneAt || (p.start && p.start > d) || !p.amount) continue
      const pay = Math.min(avail, Math.max(0, owedAt(p, d) - p.paid))
      p.paid += pay; avail -= pay
    }
    if (avail < 0) { pieces[pieces.length-1].paid += avail; avail = 0 }
    surplus = avail
    for (const p of pieces) if (!p.doneAt && p.amount && p.paid > 0 && (!p.start || p.start <= d) && p.paid >= owedAt(p, d)) p.doneAt = d
  }
  for (const p of pieces) p.target = p.amount ? owedAt(p, p.doneAt || today) : 0
  return { pieces, surplus }
}

// 대출금 연간 일시 이자 계산
// - 대출 시작일(= 1월30일)에 첫 이자 즉시 부과
// - 매년 1월30일에 잔여 잔액 기준 10% 이자 추가
function calcLoanLumpSum(principal, loanStartDate, loanPayments, today, rate = 0.10) {
  if (!principal || !loanStartDate) return { totalInterest: 0, totalOwed: principal, schedule: [], nextDate: null }

  const start = new Date(loanStartDate)
  const now   = new Date(today)
  const schedule = []
  let totalInterest = 0

  for (let year = 0; year <= 20; year++) {
    const anniv = new Date(start)
    anniv.setFullYear(start.getFullYear() + year)
    if (anniv > now) {
      // 다음 이자 날짜
      schedule.push({ date: anniv.toISOString().slice(0,10), upcoming: true })
      break
    }
    const annivStr = anniv.toISOString().slice(0,10)
    // 이 시점까지의 상환 합계
    const paid = loanPayments.filter(p => p.date <= annivStr).reduce((a,p)=>a+p.amount,0)
    // 이 시점 잔액 (이전 이자 포함)
    const balance = Math.max(0, principal + totalInterest - paid)
    if (balance <= 0) break
    const interest = Math.round(balance * rate)
    totalInterest += interest
    schedule.push({ date: annivStr, balance, interest, upcoming: false })
  }

  return { totalInterest, totalOwed: principal + totalInterest, schedule }
}

function RecoveryBar({ value, max, label = '회수' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <VStack gap={1}>
      <HStack hAlign="between"><Text type="supporting" color="secondary" hasTabularNumbers>{wonFmt(value)} 회수</Text><Text type="supporting" weight="bold" color={pct >= 100 ? 'primary' : 'accent'} hasTabularNumbers>{pct}%</Text></HStack>
      <ProgressBar label={label} isLabelHidden value={Math.min(value, max || 0)} max={max || 1}/>
      <Text type="supporting" color="secondary" hasTabularNumbers>목표 {wonFmt(max)}</Text>
    </VStack>
  )
}

// 미지급 월급: 못 받은 달 목록과 (사장님) 적기·지우기
function SalaryMonths({ cfg, open, setOpen, canEdit, ownerDocs, onAdd, onRemove, saving }) {
  const list = [...(cfg.unpaidSalary || [])].sort((a,b)=>a.ym.localeCompare(b.ym))
  const thisYm = todayStr().slice(0,7)
  const [f, setF] = useState({ from: thisYm, to: '', amount: '', memo: '' })
  const months = (() => { const out = []; let ym = f.from; const to = f.to && f.to >= f.from ? f.to : f.from
    for (let i=0; i<60 && ym && ym <= to; i++) { out.push(ym); ym = nextYm(ym) } return out })()
  const amtOf = ym => f.amount ? parseAmount(f.amount) : netSalaryOf(ownerDocs, ym)
  const dup = months.filter(ym => list.some(x => x.ym === ym))
  const ymIn = v => v.replace(/[^0-9-]/g, '').slice(0, 7)
  return (
    <VStack gap={2}>
      <HStack><Button size="sm" variant="ghost" label={`${list.length ? `못 받은 달 ${list.length}개월: ${monthRuns(list.map(x=>x.ym))}` : '아직 적은 달이 없어요'} · ${open ? '접기' : canEdit ? '보기·적기' : '보기'}`} onClick={()=>setOpen(!open)}/></HStack>
      {open && (
        <Card padding={3}>
          <VStack gap={2}>
            {list.length > 0 && (
              <List hasDividers edge="flush">
                {list.map(x => (
                  <ListItem key={x.id} label={<Text hasTabularNumbers>{x.ym.replace('-','.')}</Text>} description={x.memo || undefined}
                    endContent={<HStack gap={1} vAlign="center"><Text hasTabularNumbers>{wonFmt(x.amount)}</Text>{canEdit && <Button size="sm" variant="ghost" label="지우기" isDisabled={saving} onClick={()=>onRemove(x.id)}/>}</HStack>}/>
                ))}
              </List>
            )}
            {canEdit && <>
              <Text weight="bold">못 받은 달 적기</Text>
              <HStack gap={2} vAlign="end" wrap="wrap">
                <TextInput label="시작 달" placeholder="YYYY-MM" width={110} value={f.from} onChange={v=>setF(x=>({...x, from:ymIn(v)}))}/>
                <TextInput label="끝 달" isOptional placeholder="YYYY-MM" width={110} value={f.to} onChange={v=>setF(x=>({...x, to:ymIn(v)}))}/>
                <TextInput label="금액" placeholder="비우면 세후 월급" inputMode="numeric" width={150} value={f.amount} onChange={v=>setF(x=>({...x, amount:fmtAmount(v)}))}/>
                <TextInput label="메모" isOptional value={f.memo} onChange={v=>setF(x=>({...x, memo:v}))}/>
              </HStack>
              <Text type="supporting" color="secondary">
                {months.length ? `${monthRuns(months)} · ${months.length}개월 · 합계 ${wonFmt(months.reduce((a,ym)=>a+amtOf(ym),0))}` : '달을 골라 주세요'}
                {!f.amount && months.some(ym=>!amtOf(ym)) && ' · 급여 설정이 없는 달은 금액을 적어 주세요'}
                {dup.length > 0 && ` · 이미 적은 달(${monthRuns(dup)})은 빼고 넣어요`}
              </Text>
              <HStack><Button variant="primary" label="넣기" isDisabled={saving || !months.length} onClick={async ()=>{
                const rows = months.filter(ym=>!dup.includes(ym)).map(ym=>({ ym, amount: amtOf(ym), memo: f.memo.trim() })).filter(r=>r.amount>0)
                if (!rows.length) return alert('넣을 달이 없어요 (금액이 0이거나 이미 적은 달이에요)')
                if (await onAdd(rows)) setF({ from: thisYm, to:'', amount:'', memo:'' })
              }}/></HStack>
              <Text type="supporting" color="secondary">연속이면 시작 달과 끝 달을, 한 달이면 시작 달만 적으세요. 나중에 받으면 '회수 입력'에서 미지급 월급 회수로 적으면 돼요.</Text>
            </>}
          </VStack>
        </Card>
      )}
    </VStack>
  )
}

export default function Investment() {
  const { isInvestor, isOwner } = useAuth()
  const [showSalary, setShowSalary] = useState(false)
  const [ownerDocs, setOwnerDocs] = useState([])  // payrollOwner (미지급 월급 금액 채우기용, 사장님만)
  const [config, setConfig]   = useState({
    terry: { amount: 0, startDate: '', interestRate: 0.05 },
    hyung:  { amount: 0, startDate: '', interestRate: 0.05 },
  })
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)

  const [showConfig, setShowConfig]   = useState(false)
  const [editConfig, setEditConfig]   = useState({})
  const [showForm, setShowForm]       = useState(false)
  const [filterInv, setFilterInv]     = useState('all') // 'all' | 'terry' | 'hyung'
  const [form, setForm]               = useState({ date:todayStr(), amount:'', investor:'terry', category:'investment', memo:'' })
  const [transferForm, setTransferForm] = useState({})  // { key:'uid:category', to, amount }

  async function load(own) {
    setLoading(true)
    try {
      const [cfgSnap, recSnap] = await Promise.all([
        getDoc(doc(db,'investment','config')),
        getDoc(doc(db,'investment','records')),
      ])
      if (cfgSnap.exists()) setConfig(cfgSnap.data())
      if (recSnap.exists()) setRecords(recSnap.data().list || [])
    } catch(e) { console.error(e) }
    setLoading(false)
    // 사장님: 미지급 월급 금액 채우기용 급여 설정 (화면은 기다리지 않음)
    if (own) getDocs(collection(db,'payrollOwner'))
      .then(ps => setOwnerDocs(ps.docs.map(d=>({ id:d.id, ...d.data() })).filter(d=>/^\d{4}-\d{2}$/.test(d.id))))
      .catch(e => console.error(e))
  }

  useEffect(()=>{ load(isOwner) },[isOwner])

  async function saveConfig() {
    for (const uid of Object.keys(INVESTORS)) {
      const bad = (editConfig[uid]?.additions || []).find(a => !a.month || !a.amount)
      if (bad) return alert(`${INVESTORS[uid].name}: 추가 투입은 투입 연월과 금액을 입력해 주세요`)
    }
    setSaving(true)
    try {
      // 넘기기 기록(transfers)은 설정 화면 밖에서 바뀌므로 저장 직전 값을 유지
      const snap = await getDoc(doc(db,'investment','config'))
      const next = { ...editConfig, transfers: (snap.exists() ? snap.data().transfers : null) || [] }
      await setDoc(doc(db,'investment','config'), next)
      setConfig(next)
      setShowConfig(false)
    } catch(e) { console.error(e); alert('저장 중 오류가 발생했어요') }
    setSaving(false)
  }

  // 한 회수 항목에서 초과 회수된 금액을 같은 투자자의 다른 항목으로 넘기기
  async function saveTransfer(uid, from) {
    const t = transferForm
    const amount = parseAmount(t.amount || '')
    if (!t.to || !amount) return alert('넘길 항목과 금액을 골라주세요')
    setSaving(true)
    try {
      const snap = await getDoc(doc(db,'investment','config'))
      const cur = snap.exists() ? snap.data() : config
      const transfers = [...(cur.transfers || []), { id: newId(), date: todayStr(), investor: uid, from, to: t.to, amount, memo: '초과 회수분 넘기기' }]
      await setDoc(doc(db,'investment','config'), { transfers }, { merge: true })
      setConfig({ ...cur, transfers })
      setTransferForm({})
    } catch(e) { console.error(e); alert('저장 중 오류가 발생했어요') }
    setSaving(false)
  }

  async function deleteTransfer(id) {
    if (!window.confirm('이 넘기기 기록을 취소할까요? 금액이 원래 항목으로 돌아가요.')) return
    const snap = await getDoc(doc(db,'investment','config'))
    const cur = snap.exists() ? snap.data() : config
    const transfers = (cur.transfers || []).filter(t => t.id !== id)
    await setDoc(doc(db,'investment','config'), { transfers }, { merge: true })
    setConfig({ ...cur, transfers })
  }

  async function saveRecord() {
    if (!form.amount || !form.date) return alert('날짜와 금액을 입력해주세요')
    setSaving(true)
    try {
      const newRecord = {
        id:        Date.now().toString(),
        date:      form.date,
        amount:    parseAmount(form.amount),
        investor:  form.investor,
        category:  form.category,
        memo:      form.memo,
        createdAt: new Date().toISOString(),
      }
      const snap = await getDoc(doc(db,'investment','records'))
      const latest = snap.exists() ? (snap.data().list || []) : records
      const newList = [...latest, newRecord].sort((a,b)=>a.date>b.date?1:-1)
      await setDoc(doc(db,'investment','records'), { list: newList })
      setRecords(newList)
      setForm({ date:todayStr(), amount:'', investor:'terry', category:'investment', memo:'' })
      setShowForm(false)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  async function deleteRecord(id) {
    if (!window.confirm('이 회수 내역을 삭제하시겠습니까?')) return
    const snap = await getDoc(doc(db,'investment','records'))
    const newList = (snap.exists() ? (snap.data().list || []) : records).filter(r => r.id !== id)
    await setDoc(doc(db,'investment','records'), { list: newList })
    setRecords(newList)
  }

  // 미지급 월급: 못 받은 달 적기·지우기 (저장 직전 다시 읽음)
  async function saveUnpaid(change) {
    setSaving(true)
    try {
      const snap = await getDoc(doc(db,'investment','config'))
      const cur = snap.exists() ? snap.data() : config
      const next = change(cur.terry?.unpaidSalary || [])
      await updateDoc(doc(db,'investment','config'), { 'terry.unpaidSalary': next })
      setConfig({ ...cur, terry: { ...(cur.terry||{}), unpaidSalary: next } })
      setSaving(false); return true
    } catch(e) { console.error(e); alert('저장 중 오류가 발생했어요'); setSaving(false); return false }
  }
  const addUnpaid = rows => saveUnpaid(list => [...list.filter(x => !rows.some(r => r.ym === x.ym)),
    ...rows.map((r,i) => ({ id:`${Date.now()}${i}`, ...r }))].sort((a,b)=>a.ym.localeCompare(b.ym)))
  const removeUnpaid = id => window.confirm('이 달을 미지급 월급에서 지울까요?') && saveUnpaid(list => list.filter(x => x.id !== id))

  const today = todayStr()
  const transfers = config.transfers || []
  const catLabel = (uid, key) => categoriesFor(uid, config[uid]).find(c=>c.key===key)?.label
    || ALL_CATEGORIES.find(c=>c.key===key)?.label || (String(key).startsWith('add:') ? '추가 투입 회수 (삭제된 항목)' : key)
  // 항목별 회수 흐름: 회수 기록(+) · 넘긴 금액(−) · 넘겨받은 금액(+)
  const flows = (uid, cat) => [
    ...records.filter(r => r.investor===uid && r.category===cat).map(r => ({ date:r.date, amount:r.amount||0 })),
    ...transfers.filter(t => t.investor===uid && t.from===cat).map(t => ({ date:t.date, amount:-(t.amount||0) })),
    ...transfers.filter(t => t.investor===uid && t.to===cat).map(t => ({ date:t.date, amount:t.amount||0 })),
  ]

  // 형 대출금 이자 계산 (연간 일시 부과, 매년 1월30일)
  const hyungLoanStartDate = config.hyung?.loanStartDate || ''
  const hyungLoanPayments  = flows('hyung','loan')
  const hyungLoanCalc      = calcLoanLumpSum(HYUNG_LOAN.amount, hyungLoanStartDate, hyungLoanPayments, today, HYUNG_LOAN.rate)
  const hyungLoanInterest  = hyungLoanCalc.totalInterest

  const summary = {}
  for (const uid of Object.keys(INVESTORS)) {
    const inv      = config[uid] || {}
    const alloc    = allocateInvest(inv, key => flows(uid, key), today)
    const principal = alloc.pieces.reduce((a,p)=>a+p.amount,0)
    const interest = alloc.pieces.reduce((a,p)=>a+p.target-p.amount,0)
    const pieceOf  = key => alloc.pieces.find(p=>p.key===key)

    // 형의 경우 대출금 원금+이자도 회수 목표에 포함
    const loanTarget = uid === 'hyung' ? HYUNG_LOAN.amount + hyungLoanInterest : 0
    // 테리의 경우 운영손해분/퇴직금 목표도 포함
    const lossTarget      = uid === 'terry' ? (inv.lossAmount     || 0) : 0
    const severanceTarget = uid === 'terry' ? (inv.severanceAmount|| 0) : 0
    const salaryTarget    = uid === 'terry' ? salaryTargetOf(inv) : 0
    const totalTarget = principal + interest + loanTarget + lossTarget + severanceTarget + salaryTarget

    const recovered = records
      .filter(r => r.investor === uid)
      .reduce((a,r) => a + (r.amount||0), 0)

    const byCategory = {}, targetOf = {}, doneAt = {}
    for (const cat of ALL_CATEGORIES) byCategory[cat.key] = flows(uid, cat.key).reduce((a,f) => a + f.amount, 0)
    for (const p of alloc.pieces) { byCategory[p.key] = p.paid; targetOf[p.key] = p.target; doneAt[p.key] = p.doneAt }
    byCategory.investment = pieceOf('investment').paid + alloc.surplus

    summary[uid] = { principal, interest, totalTarget, recovered, targetOf, doneAt,
      remaining:      Math.max(0, totalTarget - recovered), byCategory,
      loanTarget:     uid === 'hyung' ? loanTarget : 0,
      loanInterest:   uid === 'hyung' ? hyungLoanInterest : 0,
      loanSchedule:   uid === 'hyung' ? hyungLoanCalc.schedule : [],
      lossTarget,
      severanceTarget,
      salaryTarget }
  }

  const totalPrincipal  = Object.values(summary).reduce((a,s)=>a+s.principal,0)
  const totalInterest   = Object.values(summary).reduce((a,s)=>a+s.interest,0)
  const totalTarget     = Object.values(summary).reduce((a,s)=>a+s.totalTarget,0)
  const totalRecovered  = Object.values(summary).reduce((a,s)=>a+s.recovered,0)
  const totalRemaining  = Object.values(summary).reduce((a,s)=>a+s.remaining,0)

  // 회수 내역 (달별)
  const filtered = filterInv === 'all' ? records : records.filter(r=>r.investor===filterInv)
  const grouped = {}
  ;[...filtered].sort((a,b)=>b.date.localeCompare(a.date)).forEach(r=>{
    const ym = r.date.slice(0,7)
    if(!grouped[ym]) grouped[ym] = []
    grouped[ym].push(r)
  })
  const amountIn = (label, val, set, o = {}) => (
    <TextInput label={label} inputMode="numeric" placeholder="0" width={o.width} value={val ? Number(val).toLocaleString('ko-KR') : ''} onChange={v=>set(+v.replace(/[^0-9]/g,'') || 0)}/>
  )
  const stat = (label, val) => (
    <Card key={label} variant="muted" padding={2}>
      <VStack gap={0}><Text type="supporting" color="secondary">{label}</Text><Text weight="bold" hasTabularNumbers>{wonFmt(val)}</Text></VStack>
    </Card>
  )

  return (
    <AstryxPage>
    <VStack gap={4}>
      <PageHeader title="투자관리" sub="사장 전용 — 투자금 회수 현황" right={!isInvestor && <>
        <Button label="투자금 설정" onClick={()=>{ setEditConfig(JSON.parse(JSON.stringify(config))); setShowConfig(v=>!v) }}/>
        <Button variant="primary" label="+ 회수 입력" onClick={()=>{setShowForm(v=>!v); setForm(f=>({...f, date:todayStr()}))}}/>
      </>}/>

      {/* 투자금 설정 */}
      {showConfig && (
        <LedgerCard title="투자금 설정">
          <Grid columns={{ minWidth: 320, max: 2, repeat: 'fit' }} gap={3}>
            {Object.entries(INVESTORS).map(([uid,inv]) => {
              const setField = (key, val) => setEditConfig(prev=>({ ...prev, [uid]: {...(prev[uid]||{}), [key]: val} }))
              return (
                <Card key={uid} variant="muted" padding={3}>
                  <VStack gap={3}>
                    <Heading level={4}>{inv.name} ({(inv.ratio*100).toFixed(0)}%)</Heading>
                    {amountIn('투자 원금 (원)', editConfig[uid]?.amount, v=>setField('amount', v))}
                    <DateInput label="투자 시작일" value={editConfig[uid]?.startDate || ''} onChange={v=>setField('startDate', v || '')}/>
                    {uid==='terry' && <>
                      {amountIn('운영 손해분 목표 (원)', editConfig[uid]?.lossAmount, v=>setField('lossAmount', v))}
                      {amountIn('퇴직금 대납 목표 (원)', editConfig[uid]?.severanceAmount, v=>setField('severanceAmount', v))}
                    </>}
                    {uid==='hyung' && <DateInput label="대출 시작일 (연10%)" value={editConfig[uid]?.loanStartDate || ''} onChange={v=>setField('loanStartDate', v || '')}/>}

                    {/* 추가 투입 (투자금·운영자금) */}
                    <Divider/>
                    <HStack hAlign="between" vAlign="center">
                      <Text weight="bold">추가 투입</Text>
                      <Button size="sm" label="+ 추가" onClick={()=>setEditConfig(prev=>({ ...prev, [uid]: { ...(prev[uid]||{}),
                        additions: [...(prev[uid]?.additions||[]), { id: newId(), month: todayStr().slice(0,7), date:'', amount:0, kind:'investment', noInterest:false, memo:'' }] } }))}/>
                    </HStack>
                    {!(editConfig[uid]?.additions||[]).length && (
                      <Text type="supporting" color="secondary">최초 투자 뒤에 더 넣은 투자금·운영자금을 기록해요. 항목마다 따로 회수 현황이 생기고, 투자금 회수는 추가 투입분(먼저 넣은 것부터)을 먼저 채워요</Text>
                    )}
                    {(editConfig[uid]?.additions||[]).map(a => {
                      const setA = patch => setEditConfig(prev=>({ ...prev, [uid]: { ...(prev[uid]||{}),
                        additions: (prev[uid]?.additions||[]).map(x => x.id===a.id ? { ...x, ...patch } : x) } }))
                      return (
                        <Card key={a.id} padding={3}>
                          <Grid columns={2} gap={2}>
                            <TextInput label="투입 연월" placeholder="YYYY-MM" isRequired value={a.month||''}
                              onChange={v=>{ const m = v.replace(/[^0-9-]/g,'').slice(0,7); setA({ month:m, date: a.date && !a.date.startsWith(m) ? '' : a.date }) }}/>
                            <DateInput label="정확한 날짜" isOptional value={a.date||''} onChange={v=>setA({ date:v || '', month: v ? v.slice(0,7) : a.month })}/>
                            {amountIn('금액 (원)', a.amount, v=>setA({ amount:v }))}
                            <Selector label="종류" value={a.kind||'investment'} onChange={v=>v && setA({ kind:v })} options={[{ value:'investment', label:'투자금' }, { value:'operating', label:'운영자금' }]}/>
                          </Grid>
                          <VStack gap={2}>
                            <TextInput label="메모" isOptional placeholder="예: 냉장고 교체" value={a.memo||''} onChange={v=>setA({ memo:v })}/>
                            <HStack hAlign="between" vAlign="center">
                              <CheckboxInput label="연 5% 이자 붙이기" value={!a.noInterest} onChange={v=>setA({ noInterest: !v })}/>
                              <Button size="sm" variant="ghost" label="삭제" onClick={()=>setEditConfig(prev=>({ ...prev, [uid]: { ...(prev[uid]||{}),
                                additions: (prev[uid]?.additions||[]).filter(x=>x.id!==a.id) } }))}/>
                            </HStack>
                          </VStack>
                        </Card>
                      )
                    })}
                    <Text type="supporting" color="secondary">투자 이자: 연 5% 단리{uid==='hyung' ? ' / 대출금 1,200만원 연 10% 단리' : ''}</Text>
                  </VStack>
                </Card>
              )
            })}
          </Grid>
          <HStack gap={2}>
            <Button variant="primary" label={saving?'저장 중...':'저장'} isDisabled={saving} onClick={saveConfig}/>
            <Button label="취소" onClick={()=>setShowConfig(false)}/>
          </HStack>
        </LedgerCard>
      )}

      {/* 회수 입력 */}
      {showForm && (
        <LedgerCard title="회수 입력">
          <HStack gap={2} vAlign="end" wrap="wrap">
            <DateInput label="날짜" value={form.date} onChange={v=>setForm(f=>({...f,date:v||f.date}))}/>
            <TextInput label="회수 금액 (원)" inputMode="numeric" placeholder="0" width={160} value={form.amount} onChange={v=>setForm(f=>({...f, amount:fmtAmount(v)}))}/>
            <Selector label="대상 투자자" value={form.investor} onChange={v=>v && setForm(f=>({...f, investor:v, category:'investment'}))}
              options={Object.entries(INVESTORS).map(([uid,inv])=>({ value:uid, label:inv.name }))}/>
            <Selector label="카테고리" value={form.category} onChange={v=>v && setForm(f=>({...f,category:v}))}
              options={categoriesFor(form.investor, config[form.investor]).map(c=>({ value:c.key, label:c.label }))}/>
          </HStack>
          <TextInput label="메모" isOptional placeholder="비고 사항" value={form.memo} onChange={v=>setForm(f=>({...f,memo:v}))}/>
          <HStack gap={2}>
            <Button variant="primary" label={saving?'저장 중...':'저장'} isDisabled={saving} onClick={saveRecord}/>
            <Button label="취소" onClick={()=>setShowForm(false)}/>
          </HStack>
        </LedgerCard>
      )}

      {loading ? <Text color="secondary">불러오는 중...</Text> : <>
        {/* 전체 요약 */}
        <Card padding={4}>
          <VStack gap={3}>
            <HStack gap={3} hAlign="between" vAlign="start" wrap="wrap">
              <VStack gap={0}>
                <Text type="label" color="secondary">전체 회수 현황</Text>
                <Text type="display-3" color="accent" hasTabularNumbers>{wonFmt(totalRecovered)} <Text type="large" color="secondary">/ {wonFmt(totalTarget)}</Text></Text>
              </VStack>
              <Grid columns={3} gap={2}>
                {stat('총 원금', totalPrincipal)}
                {stat('누적 이자', totalInterest)}
                {stat('잔여 회수', totalRemaining)}
              </Grid>
            </HStack>
            <RecoveryBar value={totalRecovered} max={totalTarget} label="전체 회수"/>
          </VStack>
        </Card>

        {/* 투자자별 */}
        <Grid columns={{ minWidth: 340, max: 2, repeat: 'fit' }} gap={3}>
          {Object.entries(INVESTORS).map(([uid,inv]) => {
            const s = summary[uid]
            const inv_cfg = config[uid] || {}
            const pct = s.totalTarget > 0 ? Math.min(100, Math.round(s.recovered/s.totalTarget*100)) : 0
            return (
              <LedgerCard key={uid} title={`${inv.name} · 투자 비율 ${(inv.ratio*100).toFixed(0)}%`} right={pct >= 100 && <Badge variant="success" label="완료"/>}>
                <Grid columns={2} gap={2}>
                  {stat('투자 원금', s.principal)}
                  {stat('누적 이자(5%)', s.interest)}
                  {stat('총 회수 목표', s.totalTarget)}
                  {stat('회수 완료', s.recovered)}
                </Grid>
                <RecoveryBar value={s.recovered} max={s.totalTarget} label={`${inv.name} 회수`}/>

                {/* 카테고리별 */}
                <Text type="label" color="secondary">카테고리별 회수 현황</Text>
                <VStack gap={2}>
                  {categoriesFor(uid, inv_cfg).map(cat => {
                    const val = s.byCategory[cat.key] || 0
                    const target = s.targetOf[cat.key] !== undefined ? s.targetOf[cat.key]
                      : cat.key==='loss' ? s.lossTarget : cat.key==='severance' ? s.severanceTarget
                      : cat.key==='loan' ? s.loanTarget : cat.key==='salary' ? s.salaryTarget : 0
                    const notSet = target === 0 && cat.key !== 'investment' && cat.key !== 'salary' && !cat.addition
                    const excess = target > 0 ? val - target : 0
                    const tKey = `${uid}:${cat.key}`
                    const others = categoriesFor(uid, inv_cfg).filter(c=>c.key!==cat.key)
                    return (
                      <Card key={cat.key} variant="muted" padding={2}>
                        <VStack gap={1}>
                          <HStack hAlign="between" vAlign="center" gap={2}>
                            <Text type="supporting" color="secondary">{cat.key==='investment' && (inv_cfg.additions||[]).length ? '최초 투자금 회수' : cat.label}</Text>
                            <Text type="supporting" weight={val > 0 ? 'bold' : undefined} color={val > 0 ? 'primary' : 'secondary'} hasTabularNumbers>
                              {val>0 ? wonFmt(val) : '—'}{target>0 ? ` / ${wonFmt(target)}` : ''}
                            </Text>
                          </HStack>
                          {target > 0 && <ProgressBar label={cat.label} isLabelHidden value={Math.min(val, target)} max={target}/>}
                          {notSet && <Text type="supporting" color="accent">목표 금액 미설정 (투자금 설정에서 입력)</Text>}
                          {cat.key === 'salary' && <SalaryMonths cfg={inv_cfg} open={showSalary} setOpen={setShowSalary} canEdit={isOwner}
                            ownerDocs={ownerDocs} onAdd={addUnpaid} onRemove={removeUnpaid} saving={saving}/>}
                          {s.doneAt[cat.key] && <Text type="supporting" color="secondary">{s.doneAt[cat.key]}에 다 회수{cat.addition?.noInterest ? '됐어요' : '돼서 이자 계산을 멈췄어요'}</Text>}
                          {cat.addition && !s.doneAt[cat.key] && <Text type="supporting" color="secondary">{cat.addition.noInterest ? '이자 없음' : `${additionStart(cat.addition)}부터 연 5% 단리`} · 투자금 회수는 이 항목부터 먼저 채워져요</Text>}
                          {excess > 0 && (
                            <HStack gap={2} vAlign="center" wrap="wrap">
                              <Text type="supporting" color="accent" hasTabularNumbers>초과 회수 {wonFmt(excess)}</Text>
                              {!isInvestor && others.length > 0 && transferForm.key !== tKey && (
                                <Button size="sm" label="다른 항목으로 넘기기" onClick={()=>setTransferForm({ key:tKey, to: others[0].key, amount: excess.toLocaleString('ko-KR') })}/>
                              )}
                            </HStack>
                          )}
                          {transferForm.key === tKey && (
                            <HStack gap={2} vAlign="end" wrap="wrap">
                              <TextInput label="넘길 금액" isLabelHidden size="sm" inputMode="numeric" width={120} value={transferForm.amount||''} onChange={v=>setTransferForm(f=>({ ...f, amount: fmtAmount(v) }))}/>
                              <Text type="supporting" color="secondary">원 →</Text>
                              <Selector label="받을 항목" isLabelHidden size="sm" value={transferForm.to} onChange={v=>v && setTransferForm(f=>({ ...f, to:v }))} options={others.map(c=>({ value:c.key, label:c.label }))}/>
                              <Button size="sm" variant="primary" label="넘기기" isDisabled={saving} onClick={()=>saveTransfer(uid, cat.key)}/>
                              <Button size="sm" label="취소" onClick={()=>setTransferForm({})}/>
                            </HStack>
                          )}
                        </VStack>
                      </Card>
                    )
                  })}
                </VStack>

                {/* 넘기기 기록 */}
                {transfers.some(t=>t.investor===uid) && (
                  <VStack gap={1}>
                    <Text type="label" color="secondary">넘기기 기록</Text>
                    <List hasDividers edge="flush">
                      {transfers.filter(t=>t.investor===uid).map(t => (
                        <ListItem key={t.id} label={<Text type="supporting">{t.date} {catLabel(uid, t.from)} → {catLabel(uid, t.to)}</Text>}
                          endContent={<HStack gap={1} vAlign="center"><Text type="supporting" hasTabularNumbers>{wonFmt(t.amount)}</Text>{!isInvestor && <Button size="sm" variant="ghost" label="취소" onClick={()=>deleteTransfer(t.id)}/>}</HStack>}/>
                      ))}
                    </List>
                  </VStack>
                )}

                {/* 형: 대출금 상환 */}
                {uid === 'hyung' && (
                  <Card variant="muted" padding={3}>
                    <VStack gap={2}>
                      <Text weight="bold">대출금 상환 현황</Text>
                      <Grid columns={2} gap={2}>
                        {stat('대출 원금', HYUNG_LOAN.amount)}
                        {stat('누적 이자(연10%)', s.loanInterest)}
                        {stat('상환 목표', HYUNG_LOAN.amount + s.loanInterest)}
                        {stat('상환 완료', s.byCategory['loan'] || 0)}
                      </Grid>
                      {s.loanSchedule.length > 0 && <>
                        <Text type="label" color="secondary">이자 부과 일정</Text>
                        <List hasDividers edge="flush">
                          {s.loanSchedule.map((item, i) => (
                            <ListItem key={i}
                              label={<Text type="supporting" color={item.upcoming ? 'accent' : 'primary'}>{item.upcoming ? '다음 이자일' : item.date}</Text>}
                              description={!item.upcoming ? <Text type="supporting" color="secondary" hasTabularNumbers>잔액 {wonFmt(item.balance)}</Text> : undefined}
                              endContent={<Text type="supporting" weight="bold" color={item.upcoming ? 'accent' : 'primary'} hasTabularNumbers>{item.upcoming ? item.date : `+${wonFmt(item.interest)}`}</Text>}/>
                          ))}
                        </List>
                      </>}
                    </VStack>
                  </Card>
                )}
                {inv_cfg.startDate && (
                  <VStack gap={0}>
                    <Text type="supporting" color="secondary">투자 이자: {inv_cfg.startDate}부터 연 5% 단리</Text>
                    {uid==='hyung' && (inv_cfg.loanStartDate
                      ? <Text type="supporting" color="secondary">대출금 이자: {inv_cfg.loanStartDate}부터 연 10% 단리</Text>
                      : <Text type="supporting" color="accent">대출 시작일 미입력 (설정 필요)</Text>)}
                  </VStack>
                )}
              </LedgerCard>
            )
          })}
        </Grid>

        {/* 회수 내역 */}
        <LedgerCard title={`회수 내역 · 총 ${records.length}건 · ${wonFmt(totalRecovered)}`} right={
          <SegmentedControl label="투자자" size="sm" value={filterInv} onChange={v=>v && setFilterInv(v)}>
            <SegmentedControlItem value="all" label="전체"/>
            <SegmentedControlItem value="terry" label="테리"/>
            <SegmentedControlItem value="hyung" label="형"/>
          </SegmentedControl>}>
          {filtered.length === 0 ? <Text color="secondary">{records.length === 0 ? '회수 내역이 없습니다' : '해당 내역이 없습니다'}</Text> : (
            Object.entries(grouped).map(([ym, rows]) => {
              const [y, m] = ym.split('-')
              return (
                <VStack key={ym} gap={1}>
                  <HStack hAlign="between" vAlign="center">
                    <HStack gap={2} vAlign="center"><Heading level={5}>{y}년 {+m}월</Heading><Text type="supporting" color="secondary">{rows.length}건</Text></HStack>
                    <Text weight="bold" color="accent" hasTabularNumbers>{wonFmt(rows.reduce((a,r)=>a+r.amount,0))}</Text>
                  </HStack>
                  <List hasDividers edge="flush">
                    {rows.map(r => (
                      <ListItem key={r.id}
                        startContent={<Text type="supporting" color="secondary" hasTabularNumbers>{r.date.slice(5)}</Text>}
                        label={<HStack gap={2} vAlign="center" wrap="wrap"><Badge label={INVESTORS[r.investor]?.name || r.investor}/><Text type="supporting">{catLabel(r.investor, r.category) || r.category}</Text></HStack>}
                        description={r.memo || undefined}
                        endContent={<HStack gap={1} vAlign="center"><Text weight="bold" hasTabularNumbers>{wonFmt(r.amount)}</Text>{!isInvestor && <Button size="sm" variant="ghost" label="삭제" onClick={()=>deleteRecord(r.id)}/>}</HStack>}/>
                    ))}
                  </List>
                </VStack>
              )
            })
          )}
        </LedgerCard>
      </>}
    </VStack>
    </AstryxPage>
  )
}
