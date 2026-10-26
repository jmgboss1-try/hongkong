import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useAuth } from '../AuthContext'

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
]

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

function ProgressBar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div style={{width:'100%'}}>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'#6E6A63',marginBottom:4}}>
        <span>{wonFmt(value)} 회수</span>
        <span style={{color: pct>=100 ? '#2E7D45' : color, fontWeight:700}}>{pct}%</span>
      </div>
      <div style={{background:'#DCD7CE',borderRadius:99,height:7,overflow:'hidden'}}>
        <div style={{width:`${pct}%`,height:'100%',borderRadius:99,
          background: pct>=100 ? '#2E7D45' : color,
          transition:'width .6s cubic-bezier(.4,0,.2,1)'}}/>
      </div>
      <div style={{fontSize:10,color:'#6E6A63',marginTop:3}}>
        목표 {wonFmt(max)}
      </div>
    </div>
  )
}

export default function Investment() {
  const { isInvestor } = useAuth()
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

  async function load() {
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
  }

  useEffect(()=>{ load() },[])

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
    const totalTarget = principal + interest + loanTarget + lossTarget + severanceTarget

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
      severanceTarget }
  }

  const totalPrincipal  = Object.values(summary).reduce((a,s)=>a+s.principal,0)
  const totalInterest   = Object.values(summary).reduce((a,s)=>a+s.interest,0)
  const totalTarget     = Object.values(summary).reduce((a,s)=>a+s.totalTarget,0)
  const totalRecovered  = Object.values(summary).reduce((a,s)=>a+s.recovered,0)
  const totalRemaining  = Object.values(summary).reduce((a,s)=>a+s.remaining,0)
  const overallPct      = totalTarget > 0 ? Math.min(100, Math.round(totalRecovered/totalTarget*100)) : 0

  const cell  = {fontFamily:'inherit',fontVariantNumeric:'tabular-nums', textAlign:'right'}
  const bdBot = {borderBottom:'1px solid #DCD7CE'}

  // 회수 내역 타임라인 렌더링
  const filtered = filterInv === 'all' ? records : records.filter(r=>r.investor===filterInv)
  const grouped = {}
  ;[...filtered].sort((a,b)=>b.date.localeCompare(a.date)).forEach(r=>{
    const ym = r.date.slice(0,7)
    if(!grouped[ym]) grouped[ym] = []
    grouped[ym].push(r)
  })
  const timelineContent = filtered.length === 0 ? (
    <div style={{textAlign:'center',color:'#6E6A63',padding:30,fontSize:12}}>해당 내역이 없습니다</div>
  ) : (
    <div style={{padding:'8px 0 4px'}}>
      {Object.entries(grouped).map(([ym, rows])=>{
        const [y,m] = ym.split('-')
        const monthTotal = rows.reduce((a,r)=>a+r.amount,0)
        return (
          <div key={ym} style={{marginBottom:4}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',
              padding:'8px 18px',background:'rgba(0,0,0,0.02)'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <div style={{width:6,height:6,borderRadius:'50%',background:'#C3261C'}}/>
                <span style={{fontSize:12,fontWeight:700,color:'#1D1B18'}}>{y}년 {+m}월</span>
                <span style={{fontSize:10,color:'#6E6A63'}}>{rows.length}건</span>
              </div>
              <span style={{fontSize:12,fontWeight:700,color:'#C3261C',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>
                {wonFmt(monthTotal)}
              </span>
            </div>
            {rows.map((r,i)=>{
              const inv = INVESTORS[r.investor]
              const cat = { label: catLabel(r.investor, r.category) }
              return (
                <div key={r.id} style={{display:'flex',alignItems:'center',gap:12,
                  padding:'10px 18px 10px 30px',position:'relative',
                  borderBottom: i<rows.length-1 ? '1px solid #F3F1EC' : '1px solid #ECE8E1'}}>
                  <div style={{position:'absolute',left:18,top:'50%',transform:'translateY(-50%)',
                    width:3,height:28,borderRadius:99,background:inv?.color||'#6E6A63',opacity:.7}}/>
                  <div style={{fontSize:11,color:'#6E6A63',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',minWidth:42,flexShrink:0}}>
                    {r.date.slice(5)}
                  </div>
                  <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:4,
                    background:`${inv?.color}18`,color:inv?.color,whiteSpace:'nowrap',flexShrink:0}}>
                    {inv?.emoji} {inv?.name}
                  </span>
                  <span style={{fontSize:11,color:'#6E6A63',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {cat?.label||r.category}
                  </span>
                  {r.memo && (
                    <span style={{fontSize:10,color:'#A8A39A',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:120}}>
                      {r.memo}
                    </span>
                  )}
                  <span style={{fontSize:13,fontWeight:700,color:'#C3261C',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',flexShrink:0}}>
                    {wonFmt(r.amount)}
                  </span>
                  {!isInvestor && (
                    <button onClick={()=>deleteRecord(r.id)}
                      style={{background:'transparent',border:'1px solid #E8C4BF',color:'#B42318',
                        padding:'3px 8px',fontSize:10,borderRadius:4,cursor:'pointer',
                        fontFamily:'inherit',flexShrink:0}}>
                      삭제
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )

  return (
    <div>
      {/* 헤더 */}
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>투자관리</div>
          <div style={{fontSize:12,color:'#6E6A63',marginTop:2}}>사장 전용 — 투자금 회수 현황</div>
        </div>
        {!isInvestor && (
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>{ setEditConfig(JSON.parse(JSON.stringify(config))); setShowConfig(v=>!v) }}
              style={{background:'#F3F1EC',border:'1px solid #DCD7CE',color:'#1D1B18',borderRadius:4,
                padding:'8px 14px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
              투자금 설정
            </button>
            <button onClick={()=>{setShowForm(v=>!v); setForm(f=>({...f, date:todayStr()}))}}
              style={{background:'#C3261C',color:'#FFFFFF',border:'none',borderRadius:4,
                padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              + 회수 입력
            </button>
          </div>
        )}
      </div>

      {/* 투자금 설정 패널 */}
      {showConfig && (
        <div style={{background:'#FFFFFF',border:'1px solid #C3261C',borderRadius:6,marginBottom:18,padding:18}}>
          <div style={{fontSize:13,fontWeight:600,color:'#C3261C',marginBottom:16}}>투자금 설정</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            {Object.entries(INVESTORS).map(([uid,inv])=>(
              <div key={uid} style={{background:'#F3F1EC',borderRadius:6,padding:14,
                border:`1px solid ${inv.color}33`}}>
                <div style={{fontSize:12,fontWeight:700,color:inv.color,marginBottom:10}}>
                  {inv.emoji} {inv.name} ({(inv.ratio*100).toFixed(0)}%)
                </div>
                {[
                  ['투자 원금 (원)','amount','amount'],
                  ['투자 시작일','date','startDate'],
                  ...(uid==='terry' ? [
                    ['운영 손해분 목표 (원)','amount','lossAmount'],
                    ['퇴직금 대납 목표 (원)','amount','severanceAmount'],
                  ] : []),
                  ...(uid==='hyung' ? [['대출 시작일 (연10%)','date','loanStartDate']] : []),
                ].map(([label,type,key])=>{
                  const isAmount = type === 'amount'
                  const rawVal   = editConfig[uid]?.[key] || ''
                  const dispVal  = isAmount && rawVal
                    ? Number(rawVal).toLocaleString('ko-KR') : rawVal
                  return (
                  <div key={key} style={{marginBottom:10}}>
                    <label style={{fontSize:10,color:'#6E6A63',display:'block',marginBottom:4}}>{label}</label>
                    <input
                      type={isAmount ? 'text' : 'date'}
                      inputMode={isAmount ? 'numeric' : undefined}
                      value={dispVal}
                      onChange={e=>{
                        const val = isAmount
                          ? (+e.target.value.replace(/[^0-9]/g,'') || 0)
                          : e.target.value
                        setEditConfig(prev=>({
                          ...prev,
                          [uid]: {...(prev[uid]||{}), [key]: val}
                        }))
                      }}
                      style={{background:'#FFFFFF',
                        border:`1px solid ${
                          key==='loanStartDate'   ? 'rgba(43,92,158,0.3)' :
                          key==='lossAmount'      ? 'rgba(180,35,24,0.3)' :
                          key==='severanceAmount' ? 'rgba(195,38,28,0.3)'  : '#DCD7CE'}`,
                        borderRadius:4,color:'#1D1B18',padding:'8px 10px',fontSize:12,outline:'none',
                        width:'100%',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',
                        textAlign: isAmount ? 'right' : 'left'}}/>
                  </div>
                )})}
                {/* 추가 투입 (투자금·운영자금) */}
                <div style={{borderTop:'1px solid #DCD7CE',marginTop:6,paddingTop:10,marginBottom:8}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                    <span style={{fontSize:11,fontWeight:600,color:'#1D1B18'}}>추가 투입</span>
                    <button type="button" onClick={()=>setEditConfig(prev=>({ ...prev, [uid]: { ...(prev[uid]||{}),
                        additions: [...(prev[uid]?.additions||[]), { id: newId(), month: todayStr().slice(0,7), date:'', amount:0, kind:'investment', noInterest:false, memo:'' }] } }))}
                      style={{background:'transparent',border:`1px solid ${inv.color}66`,color:inv.color,borderRadius:6,
                        padding:'4px 10px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
                      + 추가
                    </button>
                  </div>
                  {!(editConfig[uid]?.additions||[]).length && (
                    <div style={{fontSize:10,color:'#6E6A63'}}>최초 투자 뒤에 더 넣은 투자금·운영자금을 기록해요. 항목마다 따로 회수 현황이 생기고, 투자금 회수는 추가 투입분(먼저 넣은 것부터)을 먼저 채워요</div>
                  )}
                  {(editConfig[uid]?.additions||[]).map(a=>{
                    const setA = patch => setEditConfig(prev=>({ ...prev, [uid]: { ...(prev[uid]||{}),
                      additions: (prev[uid]?.additions||[]).map(x => x.id===a.id ? { ...x, ...patch } : x) } }))
                    const inp = {background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:4,color:'#1D1B18',
                      padding:'7px 8px',fontSize:12,outline:'none',fontFamily:'inherit',minWidth:0}
                    return (
                      <div key={a.id} style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:4,padding:8,marginBottom:6,
                        display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                        <div>
                          <label style={{fontSize:9,color:'#6E6A63',display:'block',marginBottom:3}}>투입 연월 *</label>
                          <input type="month" value={a.month||''} onChange={e=>setA({ month:e.target.value, date: a.date && !a.date.startsWith(e.target.value) ? '' : a.date })}
                            style={{...inp,width:'100%',borderColor: a.month ? '#DCD7CE' : '#B42318'}}/>
                        </div>
                        <div>
                          <label style={{fontSize:9,color:'#6E6A63',display:'block',marginBottom:3}}>정확한 날짜 (선택)</label>
                          <input type="date" value={a.date||''} min={a.month ? `${a.month}-01` : undefined} max={a.month ? `${a.month}-31` : undefined}
                            onChange={e=>setA({ date:e.target.value, month: e.target.value ? e.target.value.slice(0,7) : a.month })}
                            style={{...inp,width:'100%'}}/>
                        </div>
                        <div>
                          <label style={{fontSize:9,color:'#6E6A63',display:'block',marginBottom:3}}>금액 (원) *</label>
                          <input type="text" inputMode="numeric" value={a.amount ? Number(a.amount).toLocaleString('ko-KR') : ''}
                            onChange={e=>setA({ amount: +e.target.value.replace(/[^0-9]/g,'') || 0 })} placeholder="0"
                            style={{...inp,width:'100%',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',textAlign:'right'}}/>
                        </div>
                        <div>
                          <label style={{fontSize:9,color:'#6E6A63',display:'block',marginBottom:3}}>종류</label>
                          <select value={a.kind||'investment'} onChange={e=>setA({ kind:e.target.value })} style={{...inp,width:'100%'}}>
                            <option value="investment">투자금</option>
                            <option value="operating">운영자금</option>
                          </select>
                        </div>
                        <input type="text" value={a.memo||''} onChange={e=>setA({ memo:e.target.value })} placeholder="메모 (예: 냉장고 교체)"
                          style={{...inp,gridColumn:'1/-1'}}/>
                        <div style={{gridColumn:'1/-1',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                          <label style={{fontSize:10,color:'#6E6A63',display:'flex',alignItems:'center',gap:4,cursor:'pointer'}}>
                            <input type="checkbox" checked={!a.noInterest} onChange={e=>setA({ noInterest: !e.target.checked })}/>
                            연 5% 이자 붙이기
                          </label>
                          <button type="button" onClick={()=>setEditConfig(prev=>({ ...prev, [uid]: { ...(prev[uid]||{}),
                              additions: (prev[uid]?.additions||[]).filter(x=>x.id!==a.id) } }))}
                            style={{background:'transparent',border:'1px solid #E8C4BF',color:'#B42318',borderRadius:5,
                              padding:'3px 8px',fontSize:10,cursor:'pointer',fontFamily:'inherit'}}>
                            삭제
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
                <div style={{fontSize:10,color:'#6E6A63',marginTop:4}}>
                  투자 이자: 연 5% 단리
                  {uid==='hyung' && <span style={{color:'#2B5C9E'}}> / 대출금 1,200만원 연 10% 단리</span>}
                </div>
              </div>
            ))}
          </div>
          <div style={{display:'flex',gap:8,marginTop:14}}>
            <button onClick={saveConfig} disabled={saving}
              style={{background:'#C3261C',color:'#FFFFFF',border:'none',borderRadius:4,
                padding:'9px 20px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              {saving?'저장 중...':'저 장'}
            </button>
            <button onClick={()=>setShowConfig(false)}
              style={{background:'transparent',border:'1px solid #DCD7CE',color:'#6E6A63',
                borderRadius:4,padding:'9px 16px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
              취소
            </button>
          </div>
        </div>
      )}

      {/* 회수 입력 폼 */}
      {showForm && (
        <div style={{background:'#FFFFFF',border:'1px solid #2E7D45',borderRadius:6,marginBottom:18,padding:18}}>
          <div style={{fontSize:13,fontWeight:600,color:'#2E7D45',marginBottom:16}}>+ 회수 입력</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:12}}>
            <div>
              <label style={{fontSize:10,color:'#6E6A63',display:'block',marginBottom:4}}>날짜</label>
              <input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}
                style={{background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,color:'#1D1B18',
                  padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
            </div>
            <div>
              <label style={{fontSize:10,color:'#6E6A63',display:'block',marginBottom:4}}>회수 금액 (원)</label>
              <input type="text" inputMode="numeric" value={form.amount}
                onChange={e=>setForm(f=>({...f, amount:fmtAmount(e.target.value)}))}
                placeholder="0"
                style={{background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,color:'#1D1B18',
                  padding:'8px 10px',fontSize:12,outline:'none',width:'100%',
                  fontFamily:'inherit',fontVariantNumeric:'tabular-nums',textAlign:'right'}}/>
            </div>
            {/* 투자자 선택 - 변경 시 카테고리 자동 초기화 */}
            <div>
              <label style={{fontSize:10,color:'#6E6A63',display:'block',marginBottom:4}}>대상 투자자</label>
              <select value={form.investor}
                onChange={e=>{
                  const newInvestor = e.target.value
                  setForm(f=>({...f, investor:newInvestor, category:'investment'}))
                }}
                style={{background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,color:'#1D1B18',
                  padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}>
                {Object.entries(INVESTORS).map(([uid,inv])=>(
                  <option key={uid} value={uid}>{inv.emoji} {inv.name}</option>
                ))}
              </select>
            </div>
            {/* 카테고리 - 선택된 투자자 기준으로만 표시 */}
            <div>
              <label style={{fontSize:10,color:'#6E6A63',display:'block',marginBottom:4}}>카테고리</label>
              <select value={form.category}
                onChange={e=>setForm(f=>({...f,category:e.target.value}))}
                style={{background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,color:'#1D1B18',
                  padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}>
                {categoriesFor(form.investor, config[form.investor]).map(c=>(
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>
            <div style={{gridColumn:'1/-1'}}>
              <label style={{fontSize:10,color:'#6E6A63',display:'block',marginBottom:4}}>메모 (선택)</label>
              <input type="text" value={form.memo} onChange={e=>setForm(f=>({...f,memo:e.target.value}))}
                placeholder="비고 사항"
                style={{background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,color:'#1D1B18',
                  padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
            </div>
          </div>
          <div style={{display:'flex',gap:8,marginTop:14}}>
            <button onClick={saveRecord} disabled={saving}
              style={{background:'#2E7D45',color:'#FFFFFF',border:'none',borderRadius:4,
                padding:'9px 20px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              {saving?'저장 중...':'저 장'}
            </button>
            <button onClick={()=>setShowForm(false)}
              style={{background:'transparent',border:'1px solid #DCD7CE',color:'#6E6A63',
                borderRadius:4,padding:'9px 16px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
              취소
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{textAlign:'center',color:'#6E6A63',padding:60}}>로딩 중...</div>
      ) : (
        <>
          {/* 전체 요약 */}
          <div style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,
            padding:'18px 20px',marginBottom:18,position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:3,
              background:`linear-gradient(90deg,#C3261C ${overallPct*0.7}%,#93c5fd ${overallPct}%)`,opacity:.8}}/>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12,marginBottom:16}}>
              <div>
                <div style={{fontSize:11,color:'#6E6A63',marginBottom:4}}>전체 회수 현황</div>
                <div style={{fontSize:22,fontWeight:700,color:'#C3261C',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>
                  {wonFmt(totalRecovered)}
                  <span style={{fontSize:13,color:'#6E6A63',fontWeight:400,marginLeft:8}}>/ {wonFmt(totalTarget)}</span>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,minWidth:300}}>
                {[
                  {label:'총 원금',   val:totalPrincipal, color:'#1D1B18'},
                  {label:'누적 이자', val:totalInterest,  color:'#B42318'},
                  {label:'잔여 회수', val:totalRemaining,  color:'#2B5C9E'},
                ].map(k=>(
                  <div key={k.label} style={{background:'#F3F1EC',borderRadius:4,padding:'10px 12px'}}>
                    <div style={{fontSize:10,color:'#6E6A63',marginBottom:3}}>{k.label}</div>
                    <div style={{fontSize:13,fontWeight:700,color:k.color,fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>
                      {wonFmt(k.val)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <ProgressBar value={totalRecovered} max={totalTarget} color="#C3261C"/>
          </div>

          {/* 투자자별 카드 */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:18}}>
            {Object.entries(INVESTORS).map(([uid,inv])=>{
              const s   = summary[uid]
              const inv_cfg = config[uid] || {}
              const pct = s.totalTarget > 0
                ? Math.min(100, Math.round(s.recovered/s.totalTarget*100)) : 0
              const isDone = pct >= 100

              return (
                <div key={uid} style={{background:'#FFFFFF',
                  border:`1px solid ${isDone?'rgba(46,125,69,0.4)':inv.color+'44'}`,
                  borderRadius:6,overflow:'hidden'}}>
                  <div style={{padding:'14px 16px',borderBottom:'1px solid #DCD7CE',
                    display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{fontSize:20}}>{inv.emoji}</div>
                      <div>
                        <div style={{fontSize:14,fontWeight:700,color:inv.color}}>{inv.name}</div>
                        <div style={{fontSize:10,color:'#6E6A63'}}>투자 비율 {(inv.ratio*100).toFixed(0)}%</div>
                      </div>
                    </div>
                    {isDone && (
                      <span style={{fontSize:11,fontWeight:700,padding:'4px 10px',borderRadius:5,
                        background:'rgba(46,125,69,0.15)',color:'#2E7D45'}}>완료</span>
                    )}
                  </div>

                  <div style={{padding:'14px 16px'}}>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:14}}>
                      {[
                        {label:'투자 원금',    val:s.principal,   color:'#1D1B18'},
                        {label:'누적 이자(5%)', val:s.interest, color:'#B42318'},
                        {label:'총 회수 목표',  val:s.totalTarget, color:inv.color},
                        {label:'회수 완료',     val:s.recovered,   color:'#2E7D45'},
                      ].map(k=>(
                        <div key={k.label} style={{background:'#F3F1EC',borderRadius:4,padding:'8px 10px'}}>
                          <div style={{fontSize:9,color:'#6E6A63',marginBottom:2}}>{k.label}</div>
                          <div style={{fontSize:12,fontWeight:700,color:k.color,fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>
                            {wonFmt(k.val)}
                          </div>
                        </div>
                      ))}
                    </div>

                    <ProgressBar value={s.recovered} max={s.totalTarget} color={inv.color}/>

                    {/* 카테고리별 회수 — 투자자별로 해당 카테고리만 표시 */}
                    <div style={{marginTop:14,display:'flex',flexDirection:'column',gap:8}}>
                      <div style={{fontSize:10,color:'#6E6A63',fontWeight:600,marginBottom:2}}>카테고리별 회수 현황</div>
                      {categoriesFor(uid, inv_cfg).map(cat=>{
                        const val = s.byCategory[cat.key] || 0
                        const target = s.targetOf[cat.key] !== undefined ? s.targetOf[cat.key]
                          : cat.key==='loss'       ? s.lossTarget
                          : cat.key==='severance'  ? s.severanceTarget
                          : cat.key==='loan'       ? s.loanTarget
                          : 0
                        const pct = target > 0 ? Math.min(100, Math.round(val/target*100)) : 0
                        const notSet = target === 0 && cat.key !== 'investment' && !cat.addition
                        const excess = target > 0 ? val - target : 0
                        const tKey = `${uid}:${cat.key}`
                        const others = categoriesFor(uid, inv_cfg).filter(c=>c.key!==cat.key)
                        return (
                          <div key={cat.key} style={{background:'#F3F1EC',borderRadius:4,padding:'8px 10px'}}>
                            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:target>0?6:0}}>
                              <span style={{fontSize:11,color:'#6E6A63'}}>{cat.key==='investment' && (inv_cfg.additions||[]).length ? '최초 투자금 회수' : cat.label}</span>
                              <span style={{fontSize:11,color:val>0?inv.color:'#A8A39A',
                                fontFamily:'inherit',fontVariantNumeric:'tabular-nums',fontWeight:val>0?700:400}}>
                                {val>0 ? wonFmt(val) : '—'}
                                {target>0 && <span style={{color:'#A8A39A',fontWeight:400}}> / {wonFmt(target)}</span>}
                              </span>
                            </div>
                            {target > 0 && (
                              <div style={{background:'#DCD7CE',borderRadius:99,height:4,overflow:'hidden'}}>
                                <div style={{width:`${pct}%`,height:'100%',borderRadius:99,
                                  background:pct>=100?'#2E7D45':inv.color,transition:'width .5s'}}/>
                              </div>
                            )}
                            {notSet && (
                              <div style={{fontSize:9,color:'#B42318',marginTop:2}}>
                                목표 금액 미설정 (투자금 설정에서 입력)
                              </div>
                            )}
                            {s.doneAt[cat.key] && (
                              <div style={{fontSize:9,color:'#2E7D45',marginTop:4}}>
                                {s.doneAt[cat.key]}에 다 회수{cat.addition?.noInterest ? '됐어요' : '돼서 이자 계산을 멈췄어요'}
                              </div>
                            )}
                            {cat.addition && !s.doneAt[cat.key] && (
                              <div style={{fontSize:9,color:'#6E6A63',marginTop:4}}>
                                {cat.addition.noInterest ? '이자 없음' : `${additionStart(cat.addition)}부터 연 5% 단리`} · 투자금 회수는 이 항목부터 먼저 채워져요
                              </div>
                            )}
                            {excess > 0 && (
                              <div style={{marginTop:6,fontSize:10,color:'#C3261C'}}>
                                초과 회수 {wonFmt(excess)}
                                {!isInvestor && others.length > 0 && transferForm.key !== tKey && (
                                  <button type="button" onClick={()=>setTransferForm({ key:tKey, to: others[0].key, amount: excess.toLocaleString('ko-KR') })}
                                    style={{marginLeft:8,background:'transparent',border:'1px solid rgba(195,38,28,0.5)',color:'#C3261C',
                                      borderRadius:5,padding:'2px 8px',fontSize:10,cursor:'pointer',fontFamily:'inherit'}}>
                                    ↪ 다른 항목으로 넘기기
                                  </button>
                                )}
                              </div>
                            )}
                            {transferForm.key === tKey && (
                              <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginTop:6}}>
                                <input type="text" inputMode="numeric" value={transferForm.amount||''}
                                  onChange={e=>setTransferForm(f=>({ ...f, amount: fmtAmount(e.target.value) }))}
                                  style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,color:'#1D1B18',padding:'5px 8px',
                                    fontSize:11,outline:'none',width:110,fontFamily:'inherit',fontVariantNumeric:'tabular-nums',textAlign:'right'}}/>
                                <span style={{fontSize:10,color:'#6E6A63'}}>원 →</span>
                                <select value={transferForm.to} onChange={e=>setTransferForm(f=>({ ...f, to:e.target.value }))}
                                  style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,color:'#1D1B18',padding:'5px 8px',
                                    fontSize:11,outline:'none',fontFamily:'inherit'}}>
                                  {others.map(c=><option key={c.key} value={c.key}>{c.label}</option>)}
                                </select>
                                <button type="button" disabled={saving} onClick={()=>saveTransfer(uid, cat.key)}
                                  style={{background:'#C3261C',color:'#FFFFFF',border:'none',borderRadius:6,padding:'5px 10px',
                                    fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                                  넘기기
                                </button>
                                <button type="button" onClick={()=>setTransferForm({})}
                                  style={{background:'transparent',border:'1px solid #DCD7CE',color:'#6E6A63',borderRadius:6,padding:'5px 8px',
                                    fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
                                  취소
                                </button>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>

                    {/* 추가 투입 · 넘기기 기록 */}
                    {transfers.some(t=>t.investor===uid) && (
                      <div style={{marginTop:12,background:'#F3F1EC',borderRadius:4,padding:'8px 10px'}}>
                        <div style={{fontSize:10,color:'#6E6A63',fontWeight:600,marginBottom:6}}>↪ 넘기기 기록</div>
                        {transfers.filter(t=>t.investor===uid).map(t=>(
                          <div key={t.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,fontSize:10,color:'#6E6A63',padding:'2px 0'}}>
                            <span>{t.date} {catLabel(uid, t.from)} → {catLabel(uid, t.to)}</span>
                            <span style={{display:'flex',alignItems:'center',gap:6}}>
                              <span style={{fontFamily:'inherit',fontVariantNumeric:'tabular-nums',color:'#C3261C'}}>{wonFmt(t.amount)}</span>
                              {!isInvestor && (
                                <button type="button" onClick={()=>deleteTransfer(t.id)}
                                  style={{background:'transparent',border:'1px solid #E8C4BF',color:'#B42318',borderRadius:4,
                                    padding:'1px 6px',fontSize:9,cursor:'pointer',fontFamily:'inherit'}}>취소</button>
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 형 전용: 대출금 상환 정보 */}
                    {uid === 'hyung' && (
                      <div style={{marginTop:12,background:'rgba(43,92,158,0.06)',
                        border:'1px solid rgba(43,92,158,0.2)',borderRadius:4,padding:'10px 12px'}}>
                        <div style={{fontSize:10,color:'#2B5C9E',fontWeight:600,marginBottom:8}}>
                          대출금 상환 현황
                        </div>
                        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,marginBottom:10}}>
                          {[
                            {label:'대출 원금',        val:HYUNG_LOAN.amount,               color:'#1D1B18'},
                            {label:'누적 이자(연10%)', val:s.loanInterest,                  color:'#B42318'},
                            {label:'상환 목표',        val:HYUNG_LOAN.amount+s.loanInterest,color:'#2B5C9E'},
                            {label:'상환 완료',        val:s.byCategory['loan']||0,         color:'#2E7D45'},
                          ].map(k=>(
                            <div key={k.label} style={{background:'#F3F1EC',borderRadius:6,padding:'6px 8px'}}>
                              <div style={{fontSize:9,color:'#6E6A63',marginBottom:2}}>{k.label}</div>
                              <div style={{fontSize:11,fontWeight:700,color:k.color,fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>
                                {wonFmt(k.val)}
                              </div>
                            </div>
                          ))}
                        </div>
                        {/* 이자 부과 일정 */}
                        {s.loanSchedule.length > 0 && (
                          <div>
                            <div style={{fontSize:9,color:'#6E6A63',fontWeight:600,marginBottom:6}}>이자 부과 일정</div>
                            <div style={{display:'flex',flexDirection:'column',gap:4}}>
                              {s.loanSchedule.map((item,i)=>(
                                <div key={i} style={{display:'flex',justifyContent:'space-between',
                                  alignItems:'center',fontSize:10,padding:'5px 8px',borderRadius:5,
                                  background: item.upcoming ? 'rgba(195,38,28,0.06)' : 'rgba(46,125,69,0.06)',
                                  border: `1px solid ${item.upcoming?'rgba(195,38,28,0.2)':'rgba(46,125,69,0.15)'}`,
                                }}>
                                  <span style={{color: item.upcoming?'#C3261C':'#6E6A63'}}>
                                    {item.upcoming ? '다음 이자일' : `${item.date}`}
                                    {!item.upcoming && <span style={{marginLeft:4,color:'#A8A39A'}}>잔액 {wonFmt(item.balance)}</span>}
                                  </span>
                                  <span style={{fontFamily:'inherit',fontVariantNumeric:'tabular-nums',fontWeight:700,
                                    color: item.upcoming?'#C3261C':'#B42318'}}>
                                    {item.upcoming ? item.date : `+${wonFmt(item.interest)}`}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    {inv_cfg.startDate && (
                      <div style={{marginTop:10,fontSize:10,color:'#6E6A63',textAlign:'right',lineHeight:1.8}}>
                        투자 이자: {inv_cfg.startDate}부터 연 5% 단리
                        {uid==='hyung' && inv_cfg.loanStartDate && (
                          <><br/><span style={{color:'#2B5C9E'}}>대출금 이자: {inv_cfg.loanStartDate}부터 연 10% 단리</span></>
                        )}
                        {uid==='hyung' && !inv_cfg.loanStartDate && (
                          <><br/><span style={{color:'#B42318'}}>대출 시작일 미입력 (설정 필요)</span></>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 회수 내역 — 타임라인 */}
          <div style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,overflow:'hidden'}}>
            {/* 헤더 + 필터 */}
            <div style={{padding:'14px 18px',borderBottom:'1px solid #DCD7CE',
              display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10}}>
              <div>
                <span style={{fontSize:13,fontWeight:600}}>회수 내역</span>
                <span style={{fontSize:11,color:'#6E6A63',marginLeft:10}}>
                  총 {records.length}건 · {wonFmt(totalRecovered)}
                </span>
              </div>
              <div style={{display:'flex',gap:4}}>
                {[['all','전체'],['terry','테리'],['hyung','형']].map(([key,label])=>(
                  <button key={key} onClick={()=>setFilterInv(key)}
                    style={{padding:'5px 12px',borderRadius:6,border:'none',fontSize:11,fontWeight:600,
                      cursor:'pointer',fontFamily:'inherit',
                      background: filterInv===key ? '#C3261C' : '#F3F1EC',
                      color:       filterInv===key ? '#FFFFFF'     : '#6E6A63',
                      outline:     filterInv===key ? 'none'     : '1px solid #DCD7CE'}}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {records.length === 0 ? (
              <div style={{textAlign:'center',color:'#6E6A63',padding:40}}>회수 내역이 없습니다</div>
            ) : timelineContent}
          </div>
        </>
      )}
    </div>
  )
}
