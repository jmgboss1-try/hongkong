import { Fragment, useEffect, useState } from 'react'
import BankImport from '../components/BankImport'
import BankReconCard from '../components/BankReconCard'
import BankTxList from '../components/BankTxList'
import MissedExpenseInput from '../components/MissedExpenseInput'
import { bankSummary } from '../lib/bankRecon'
import { inferLegacyCls } from '../lib/bankReclass'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const wonCell = n => (n&&n!==0) ? n.toLocaleString('ko-KR') : '—'
const DAYS_KR = ['일','월','화','수','목','금','토']

const DEFAULT_CATEGORIES = [
  { id:'hq',    label:'본사발주',   sec:'재료비' },
  { id:'veg',   label:'야채',       sec:'재료비' },
  { id:'oil',   label:'기름',       sec:'재료비' },
  { id:'box',   label:'용기&기타',  sec:'재료비' },
  { id:'gas',   label:'가스비',     sec:'관리비' },
  { id:'elec',  label:'전기',       sec:'관리비' },
  { id:'omg',   label:'기타관리',   sec:'관리비' },
  { id:'rent',  label:'임대료',     sec:'관리비' },
  { id:'dfee',  label:'배달대행비', sec:'관리비' },
  { id:'meal',  label:'식대',       sec:'인건비' },
  { id:'sal',   label:'급여',       sec:'인건비' },
]

const getNowDD  = () => pad(new Date().getDate())
const todayFullStr = () => { const n=new Date(); return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}` }

// 형 대여금: 받은 돈(받음·투자전환)은 가장 오래된 빌려준 돈부터 갚은 것으로 맞춤
// → 지금 남은 대여금이 언제 빌려준 돈인지, 그동안 얼마씩 받았는지 보여줌
function loanFifo(records) {
  const sorted = [...records].sort((a,b)=>a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)))
  const open = []     // 아직 덜 갚은 기록 [{rec, dir, left, paid:[{date,amount,type}]}] (모두 같은 방향)
  const after = {}    // 기록 id → 그 기록까지의 잔액
  let bal = 0
  for (const r of sorted) {
    const dir = r.type==='lent' ? 1 : -1
    bal += dir * r.amount
    after[r.id] = bal
    let left = r.amount
    while (left > 0 && open.length && open[0].dir !== dir) {
      const o = open[0], take = Math.min(o.left, left)
      o.left -= take; left -= take
      o.paid.push({ date:r.date, amount:take, type:r.type })
      if (o.left === 0) open.shift()
    }
    if (left > 0) open.push({ rec:r, dir, left, paid:[] })
  }
  return { open, after }
}
const daysSince = date => Math.max(0, Math.round((new Date(todayFullStr()) - new Date(date)) / 86400000))
const mdDot = date => `${+date.slice(5,7)}.${+date.slice(8,10)}`

// 장부 화면의 작은 버튼 (primary: 빨강, ok: 초록, danger: 빨간 글씨)
function Btn({ children, onClick, kind = 'plain', disabled, small }) {
  const solid = kind==='primary' || kind==='ok'
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{fontFamily:'inherit', cursor:'pointer', borderRadius:4, whiteSpace:'nowrap',
        fontSize: small ? 11 : 12, padding: small ? '3px 8px' : '6px 12px', fontWeight: kind==='primary' ? 700 : 500,
        background: kind==='primary' ? '#C3261C' : kind==='ok' ? '#2E7D45' : '#FFFFFF',
        color: solid ? '#FFFFFF' : kind==='danger' ? '#B42318' : '#1D1B18',
        border: solid ? 'none' : `1px solid ${kind==='danger' ? '#E8C4BF' : '#DCD7CE'}`,
        opacity: disabled ? 0.6 : 1}}>
      {children}
    </button>
  )
}

export default function Expenses() {
  const [curMonth, setCurMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [data, setData]           = useState({})
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [day, setDay]             = useState(getNowDD)
  const [form, setForm]           = useState({})
  const [deposit, setDeposit]     = useState('')
  const [carryover, setCarryover] = useState('')

  // 카테고리
  const [categories, setCategories]       = useState(DEFAULT_CATEGORIES)
  const [showCatMgr, setShowCatMgr]       = useState(false)
  const [newCatLabel, setNewCatLabel]     = useState('')
  const [newCatSec, setNewCatSec]         = useState('재료비')
  const [editCatId, setEditCatId]         = useState(null)
  const [editCatLabel, setEditCatLabel]   = useState('')
  const [editCatSec, setEditCatSec]       = useState('')

  // 고정지출
  const [fixedItems, setFixedItems]       = useState([]) // [{id,label,dueDay,amount,categoryId}]
  const [fixedPayments, setFixedPayments] = useState({}) // {itemId:{paid,paidDate,amount}}
  const [showFixedMgr, setShowFixedMgr]  = useState(false)
  const [payingItemId, setPayingItemId] = useState(null)
const [payingDate, setPayingDate]     = useState('')
  const [newFixed, setNewFixed]           = useState({label:'',dueDay:'',amount:'',categoryId:''})
  const [editFixedId, setEditFixedId]     = useState(null)
  const [editFixed, setEditFixed]         = useState({})

  // 단기 대여금 (형)
  const [loanRecords, setLoanRecords]   = useState([])
  const [showLoanMgr, setShowLoanMgr]   = useState(false)
  const [loanForm, setLoanForm]         = useState({ date:'', type:'lent', amount:'', memo:'' })
  const [showConvert, setShowConvert]   = useState(false)
  const [convertAmount, setConvertAmount] = useState('')

  // 입력 모드
  const [inputMode, setInputMode] = useState('bank') // 지출은 대부분 통장 PDF·엑셀로 들어오니 기본은 계좌내역
  const [editRow, setEditRow] = useState(null) // 일별 표에서 펼쳐 고치는 날짜
  const [editCarry, setEditCarry] = useState(false) // 요약의 '이월 고치기'
  // 형 대여금은 기록이 길어서 기본은 접어 둠 (펼친 상태는 이 기기에 기억)
  const [loanOpen, setLoanOpen] = useState(()=>{ try { return localStorage.getItem('expenses.loanOpen')==='1' } catch { return false } })
  const toggleLoanOpen = () => setLoanOpen(v=>{ try { localStorage.setItem('expenses.loanOpen', v ? '0' : '1') } catch { /* 저장 못 해도 됨 */ } return !v })
  const [openDay, setOpenDay] = useState(null) // 지출 내역 표에서 통장 거래를 펼친 날짜


  const monthOpts = []
  for(let y=2022;y<=Math.max(2026,new Date().getFullYear());y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}
  const now = new Date()
  const curYM = `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  const isThisMonth = curMonth === curYM
  const secs = ['재료비','관리비','인건비']

  async function load() {
    setLoading(true)
    try {
      const [expSnap, catSnap, fixedCfgSnap, fixedPaySnap] = await Promise.all([
        getDoc(doc(db,'expenses',curMonth)),
        getDoc(doc(db,'expenseCategories','default')),
        getDoc(doc(db,'fixedExpenses','config')),
        getDoc(doc(db,'fixedExpenses',curMonth)),
      ])
      let d = expSnap.exists() ? expSnap.data() : {}
      // 전월 이월 자동: 이 달 통장 시작 잔액(PDF) → 없으면 지난달 말일 통장 잔액. 직접 고친 값(manual)은 그대로
      if(d.carryoverSource !== 'manual') {
        let auto = bankSummary(d).bank?.opening, src = 'bank'
        if(auto == null) {
          const [y,m] = curMonth.split('-').map(Number)
          const prev = m===1 ? `${y-1}-12` : `${y}-${pad(m-1)}`
          const ps = await getDoc(doc(db,'expenses',prev))
          auto = ps.exists() ? bankSummary(ps.data()).bank?.closing : null
          src = 'bank-prev'
        }
        if(auto != null && (d.carryover !== auto || d.carryoverSource !== src)) {
          await setDoc(doc(db,'expenses',curMonth), { carryover: auto, carryoverSource: src }, { merge:true })
          d = { ...d, carryover: auto, carryoverSource: src }
        }
      }
      // 카테고리 기록(bankCls) 전에 가져온 출금: 어느 칸인지 추정해서 기록만 채움 (금액은 그대로)
      const cats = catSnap.exists() ? (catSnap.data().list || DEFAULT_CATEGORIES) : DEFAULT_CATEGORIES
      if((d.importedKeys||[]).some(k=>!(d.bankCls||{})[k])) {
        const rules = await getDoc(doc(db,'expenseImportRules','default')).then(s=>s.exists() ? (s.data().list||[]) : []).catch(()=>[])
        const guessed = inferLegacyCls(d, cats, rules)
        if(Object.keys(guessed).length) {
          d = { ...d, bankCls: { ...(d.bankCls||{}), ...guessed } }
          await setDoc(doc(db,'expenses',curMonth), { bankCls: d.bankCls }, { merge:true })
        }
      }
      setData(d); setCarryover(d.carryover||'')
      if(catSnap.exists()) setCategories(catSnap.data().list || DEFAULT_CATEGORIES)
      if(fixedCfgSnap.exists()) setFixedItems(fixedCfgSnap.data().list || [])
      if(fixedPaySnap.exists()) setFixedPayments(fixedPaySnap.data() || {})
      else setFixedPayments({})
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(()=>{ load() },[curMonth])

  useEffect(()=>{
    async function loadLoans() {
      try {
        // 예전에 따로 두던 '상암점 대여금'(loans/sangam)은 형 대여금과 같은 돈이라 형 장부로 합침 (한 번만, 중복 없이)
        const sg = await getDoc(doc(db,'loans','sangam'))
        const sangam = sg.exists() ? (sg.data().list || []) : []
        if(sangam.length) {
          const hs = await getDoc(doc(db,'loans','hyung'))
          const list = hs.exists() ? (hs.data().list || []) : []
          const has = r => list.some(x => (r.bankKey && x.bankKey===r.bankKey) || (x.type===r.type && x.date===r.date && x.amount===r.amount))
          for(const r of sangam) if(!has(r)) list.push({ ...r, memo: `[상암점 계좌] ${r.memo||''}`.trim() })
          list.sort((a,b)=>a.date.localeCompare(b.date))
          await setDoc(doc(db,'loans','hyung'), { list })
          await setDoc(doc(db,'loans','sangam'), { list: [], mergedInto: 'hyung' })
        }
        const snap = await getDoc(doc(db,'loans','hyung'))
        if(snap.exists()) setLoanRecords(snap.data().list || [])
      } catch(e) { console.error(e) }
    }
    loadLoans()
  },[])

  useEffect(()=>{
    const existing = data[day]
    if(existing) {
      const newForm = {}
      categories.forEach(f=>{ newForm[f.id] = existing[f.id]||'' })
      setForm(newForm); setDeposit(existing.deposit||'')
    } else { setForm({}); setDeposit('') }
  },[day, data, categories])

  // ── 단기 대여금 (형) ──
  async function saveLoanRecords(newList) {
    await setDoc(doc(db,'loans','hyung'), { list: newList })
    setLoanRecords(newList)
  }
  function addLoanRecord() {
    if(!loanForm.date || !loanForm.amount) return alert('날짜와 금액을 입력해주세요')
    const newRec = {
      id: Date.now().toString(),
      date: loanForm.date,
      type: loanForm.type,
      amount: +String(loanForm.amount).replace(/[^0-9]/g,'') || 0,
      memo: loanForm.memo || '',
    }
    saveLoanRecords([...loanRecords, newRec])
    setLoanForm({ date:'', type:'lent', amount:'', memo:'' })
  }
  function deleteLoanRecord(id) {
    if(!window.confirm('이 기록을 삭제하시겠습니까?')) return
    saveLoanRecords(loanRecords.filter(r=>r.id!==id))
  }
  async function convertToInvestment() {
    const amt = +String(convertAmount).replace(/[^0-9]/g,'') || 0
    if(amt<=0) return alert('전환할 금액을 입력해주세요')
    if(amt>loanBalance) return alert(`잔액(${loanBalance.toLocaleString()}원)보다 큰 금액은 전환할 수 없습니다`)
    setSaving(true)
    try {
      const today = todayFullStr()
      // 1. 대여금 기록에 전환 항목 추가 (잔액 차감)
      const loanRec = { id:Date.now().toString(), date:today, type:'converted', amount:amt, memo:'투자금 회수로 전환' }
      const newLoanList = [...loanRecords, loanRec]
      await setDoc(doc(db,'loans','hyung'), { list:newLoanList })
      setLoanRecords(newLoanList)

      // 2. 투자관리 회수내역에 형 "대출금 상환 회수"로 자동 기록
      const invSnap = await getDoc(doc(db,'investment','records'))
      const invList = invSnap.exists() ? (invSnap.data().list||[]) : []
      const invRec = {
        id: (Date.now()+1).toString(),
        date: today,
        amount: amt,
        investor: 'hyung',
        category: 'loan',
        memo: '단기 대여금 전환',
        createdAt: new Date().toISOString(),
      }
      const newInvList = [...invList, invRec].sort((a,b)=>a.date>b.date?1:-1)
      await setDoc(doc(db,'investment','records'), { list:newInvList })

      setConvertAmount(''); setShowConvert(false)
      alert('투자금 회수로 전환됐습니다! 투자관리 탭에서 확인하실 수 있어요.')
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  // ── 카테고리 ──
  async function saveCategories(newCats) {
    await setDoc(doc(db,'expenseCategories','default'), { list: newCats })
    setCategories(newCats)
  }
  function addCategory() {
    if(!newCatLabel.trim()) return
    const id = 'cat_'+Date.now()
    saveCategories([...categories, { id, label:newCatLabel.trim(), sec:newCatSec }])
    setNewCatLabel(''); setNewCatSec('재료비')
  }
  function deleteCategory(id) {
    if(!window.confirm('카테고리를 삭제하시겠습니까?')) return
    saveCategories(categories.filter(c=>c.id!==id))
  }
  function saveEditCat() {
    saveCategories(categories.map(c=>c.id===editCatId?{...c,label:editCatLabel,sec:editCatSec}:c))
    setEditCatId(null)
  }

  // ── 고정지출 항목 관리 ──
  async function saveFixedItems(newItems) {
    await setDoc(doc(db,'fixedExpenses','config'), { list: newItems })
    setFixedItems(newItems)
  }
  function addFixedItem() {
    if(!newFixed.label.trim()) return alert('항목 이름을 입력해주세요')
    const id = 'fixed_'+Date.now()
    saveFixedItems([...fixedItems, {
      id, label:newFixed.label.trim(),
      dueDay: +newFixed.dueDay||1,
      amount: +newFixed.amount||0,
      categoryId: newFixed.categoryId || categories[0]?.id || ''
    }])
    setNewFixed({label:'',dueDay:'',amount:'',categoryId:''})
  }
  function deleteFixedItem(id) {
    if(!window.confirm('항목을 삭제하시겠습니까?')) return
    saveFixedItems(fixedItems.filter(i=>i.id!==id))
  }
  function saveEditFixed() {
    saveFixedItems(fixedItems.map(i=>i.id===editFixedId?{...i,...editFixed,dueDay:+editFixed.dueDay||1,amount:+editFixed.amount||0}:i))
    setEditFixedId(null)
  }

  // ── 고정지출 납부 처리 ──
  async function payFixed(item, dateStr) {
  const todayDD = dateStr ? pad(+dateStr.split('-')[2]) : getNowDD()
    const newPayments = {
      ...fixedPayments,
      [item.id]: { paid:true, paidDate:todayDD, amount:item.amount }
    }
    await setDoc(doc(db,'fixedExpenses',curMonth), newPayments)
    setFixedPayments(newPayments)

    // 지출 내역에도 자동 반영
    const existing = data[todayDD] || {}
    const entry = { ...existing }
    categories.forEach(f=>{ if(entry[f.id]===undefined) entry[f.id]=0 })
    if(item.categoryId && entry[item.categoryId] !== undefined) {
      entry[item.categoryId] = (entry[item.categoryId]||0) + item.amount
    } else {
      entry['omg'] = (entry['omg']||0) + item.amount
    }
    const newData = { ...data, [todayDD]: entry }
    await setDoc(doc(db,'expenses',curMonth), newData)
    setData(newData)
  }

  async function unpayFixed(itemId) {
  if(!window.confirm('납부 취소하시겠습니까?')) return
  const payment = fixedPayments[itemId]
  const item = fixedItems.find(i=>i.id===itemId)

  // 고정지출 납부 기록 삭제
  const newPayments = { ...fixedPayments }
  delete newPayments[itemId]
  await setDoc(doc(db,'fixedExpenses',curMonth), newPayments)
  setFixedPayments(newPayments)

  // 지출 내역에서도 해당 금액 차감
  if(payment?.paidDate && item) {
    const dd = payment.paidDate
    const existing = data[dd]
    if(existing && item.categoryId && (existing[item.categoryId]||0) >= item.amount) {
      const entry = { ...existing, [item.categoryId]: existing[item.categoryId] - item.amount }
      const newData = { ...data, [dd]: entry }
      await setDoc(doc(db,'expenses',curMonth), newData)
      setData(newData)
    }
  }
}

  // ── 일별 표에서 하루 고치기 저장 ──
  async function save() {
    setSaving(true)
    try {
      // 다른 화면(통장 가져오기·대시보드)에서 바꾼 내용을 덮어쓰지 않도록 저장 직전에 다시 읽음
      const snap = await getDoc(doc(db,'expenses',curMonth))
      const latest = snap.exists() ? snap.data() : {}
      const entry = { ...(latest[day]||{}) }
      categories.forEach(f=>{ entry[f.id] = +form[f.id]||0 })
      entry.deposit = +deposit||0
      const newData = { ...latest, [day]: entry }
      await setDoc(doc(db,'expenses',curMonth), newData)
      setData(newData); setEditRow(null)
    } catch(e) { console.error(e); alert('저장 중 오류가 발생했어요. 다시 시도해 주세요.') }
    setSaving(false)
  }

  async function saveCarryover() {
    try {
      const newData = { ...data, carryover: +carryover||0, carryoverSource:'manual' }
      await setDoc(doc(db,'expenses',curMonth), newData)
      setData(newData)
      alert('이월 잔액이 저장됐습니다!')
    } catch(e) { console.error(e) }
  }

  // 통장 거래 분류를 바꾼 뒤: 화면을 '로딩 중'으로 바꾸지 않고 데이터만 다시 불러옴 (펼친 목록·결과 표시 유지)
  async function refreshData() {
    try {
      const s = await getDoc(doc(db,'expenses',curMonth))
      setData(s.exists() ? s.data() : {})
      const ls = await getDoc(doc(db,'loans','hyung'))
      setLoanRecords(ls.exists() ? (ls.data().list||[]) : [])
    } catch(e) { console.error(e) }
  }

  // 직접 입력한 이월을 다시 통장 잔액 기준(자동)으로
  async function resetCarryoverAuto() {
    await setDoc(doc(db,'expenses',curMonth), { carryoverSource:'auto' }, { merge:true })
    load()
  }

  // 지출 내역 표의 수정: 그 날 줄 아래에 카테고리별 칸을 펼침 (값은 day 효과가 채움)
  function editDay(dd) {
    if(editRow===dd) { setEditRow(null); return }
    setDay(dd); setEditRow(dd); setOpenDay(null)
  }

  async function del_row(dd) {
    if(!window.confirm(`${+dd}일 지출 내역을 삭제하시겠습니까?`)) return
    const newData = { ...data }
    delete newData[dd]
    await setDoc(doc(db,'expenses',curMonth), newData)
    setData(newData)
  }

  // ── 합계 ──
  const tot = categories.reduce((acc,f)=>{
    acc[f.id] = Object.values(data).reduce((s,e)=>s+(typeof e==='object'&&e?e[f.id]||0:0),0)
    return acc
  }, {})
  const grand           = Object.values(tot).reduce((a,b)=>a+b,0)
  const totalDeposit    = Object.values(data).reduce((a,e)=>a+(typeof e==='object'&&e?e.deposit||0:0),0)
  const realProfit      = totalDeposit - grand
  const carryoverAmt    = data.carryover || 0
  const currentBalance  = carryoverAmt + totalDeposit - grand

  const loanBalance = loanRecords.reduce((a,r)=> r.type==='lent' ? a+r.amount : a-r.amount, 0)
  const loanFlow = loanFifo(loanRecords)

  const unpaidFixed = fixedItems.filter(i=>!fixedPayments[i.id]?.paid)
  const totalFixedAmt = fixedItems.reduce((a,i)=>a+i.amount,0)
  const paidFixedAmt  = fixedItems.filter(i=>fixedPayments[i.id]?.paid).reduce((a,i)=>a+i.amount,0)

  const getDow      = dd => { const[y,m]=curMonth.split('-').map(Number); return DAYS_KR[new Date(y,m-1,+dd).getDay()] }
  const getDowColor = dd => { const[y,m]=curMonth.split('-').map(Number); const dow=new Date(y,m-1,+dd).getDay(); return dow===0?'#B42318':dow===6?'#2B5C9E':'#1D1B18' }

  // ── 장부 화면 조각 (대시보드와 같은 모양). 컴포넌트가 아니라 함수로 그려야 입력칸 포커스가 안 빠짐 ──
  const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', soft:'#ECE8E1', accent:'#C3261C',
    red:'#B42318', green:'#2E7D45', blue:'#2B5C9E', chip:'#F3F1EC' }
  const num = { fontVariantNumeric:'tabular-nums' }
  const won = n => (n||0).toLocaleString('ko-KR')
  const monthIdx = monthOpts.indexOf(curMonth)
  const field = extra => ({ background:'#FFFFFF', border:'1px solid #CBC5BA', borderRadius:4, color:T.ink, padding:'8px 10px',
    fontSize:14, outline:'none', fontFamily:'inherit', boxSizing:'border-box', ...extra })
  // 금액 입력: 쉼표로 보여주고 숫자만 저장 (neg: 앞에 − 허용)
  const money = (val, set, { label, width = 150, neg = false, extra } = {}) => (
    <input type="text" inputMode="numeric" placeholder="0" aria-label={label}
      value={val === '' || val == null ? '' : val === '-' ? '-' : (+val).toLocaleString('ko-KR')}
      onChange={e=>{ const s = e.target.value.trim(); const d = s.replace(/[^0-9]/g,''); set((neg && s.startsWith('-') ? '-' : '') + d) }}
      style={field({ width, textAlign:'right', ...num, ...extra })}/>
  )
  const leader = () => <span aria-hidden="true" style={{flex:1, borderBottom:`1px dotted ${T.faint}`, margin:'0 8px', minWidth:12, transform:'translateY(-4px)'}}/>
  const line = (label, value, { strong, sub, minus, plus, color, note, key } = {}) => (
    <div key={key||label} style={{display:'flex', alignItems:'baseline', padding: sub ? '3px 0 3px 14px' : '7px 0',
      fontSize: strong ? 17 : sub ? 13 : 15, fontWeight: strong ? 800 : sub ? 400 : 600, color: sub ? T.sub : T.ink}}>
      <span style={{whiteSpace:'nowrap'}}>{label}</span>
      {note && <span style={{fontSize:12, color:T.sub, marginLeft:6, whiteSpace:'nowrap', fontWeight:400}}>{note}</span>}
      {leader()}
      <span style={{...num, whiteSpace:'nowrap', color: color || 'inherit'}}>{minus && value ? '− ' : plus && value ? '+ ' : ''}{won(value)}</span>
    </div>
  )
  const total = (label, value, opts) => (
    <div style={{borderTop:`3px double ${T.ink}`, marginTop:6, paddingTop:2}}>{line(label, value, { strong:true, ...opts })}</div>
  )
  const sectionTitle = (text, right) => (
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:10, flexWrap:'wrap',
      borderBottom:`2px solid ${T.ink}`, paddingBottom:6, marginBottom:6}}>
      <h2 style={{fontSize:16, fontWeight:800, margin:0, fontFamily:'inherit', color:T.ink}}>{text}</h2>
      {right && <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', fontSize:12, color:T.sub}}>{right}</div>}
    </div>
  )
  const textTab = (on, label, onClick) => (
    <button key={label} type="button" onClick={onClick}
      style={{background:'none', border:'none', padding:'4px 0', cursor:'pointer', fontFamily:'inherit', fontSize:13,
        fontWeight: on ? 800 : 500, color: on ? T.ink : T.sub, borderBottom:`2px solid ${on ? T.accent : 'transparent'}`}}>
      {label}
    </button>
  )
  const empty = text => <div style={{padding:'14px 0', color:T.sub, fontSize:13}}>{text}</div>
  const pctOf = (a,b) => b>0 ? Math.round(a/b*100) : 0
  const secTotal = sec => categories.filter(c=>c.sec===sec).reduce((a,c)=>a+(tot[c.id]||0),0)
  const carryNote = data.carryoverSource==='bank' ? '이 달 통장 시작 잔액'
    : data.carryoverSource==='bank-prev' ? '지난달 통장 말일 잔액'
    : data.carryoverSource==='manual' ? '직접 입력' : undefined
  const dayRows = Object.keys(data).filter(dd=>/^\d{2}$/.test(dd)).sort()
  const formExp = categories.reduce((a,f)=>a+(+form[f.id]||0),0)

  return (
    <div style={{maxWidth:1100}}>
      {/* 머리 */}
      <header style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap',
        paddingBottom:10, borderBottom:`3px double ${T.ink}`, marginBottom:22}}>
        <h1 style={{fontSize:24, fontWeight:800, margin:0, letterSpacing:'-0.01em', fontFamily:'inherit', color:T.ink}}>{mLabel(curMonth)} 지출</h1>
        <div style={{display:'flex', alignItems:'center', gap:6}}>
          <button type="button" aria-label="이전 달" disabled={monthIdx<=0} onClick={()=>setCurMonth(monthOpts[monthIdx-1])}
            style={{background:'none', border:`1px solid ${T.rule}`, borderRadius:4, padding:'6px 10px', cursor:'pointer', fontFamily:'inherit', color:T.ink}}>이전</button>
          <select value={curMonth} onChange={e=>setCurMonth(e.target.value)} aria-label="달 고르기"
            style={{background:'#FFFFFF', border:`1px solid ${T.rule}`, borderRadius:4, color:T.ink, padding:'7px 10px', fontSize:13, fontFamily:'inherit', outline:'none'}}>
            {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
          </select>
          <button type="button" aria-label="다음 달" disabled={monthIdx>=monthOpts.length-1} onClick={()=>setCurMonth(monthOpts[monthIdx+1])}
            style={{background:'none', border:`1px solid ${T.rule}`, borderRadius:4, padding:'6px 10px', cursor:'pointer', fontFamily:'inherit', color:T.ink}}>다음</button>
        </div>
      </header>

      {/* 요약: 통장 흐름 · 지출 구분 */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap:'28px 40px', marginBottom:30}}>
        <section>
          {sectionTitle('이 달 돈의 흐름')}
          {line('전월 이월', carryoverAmt, { note: carryNote })}
          {line('실입금', totalDeposit, { plus:true, note:'수수료 빼고 들어온 돈' })}
          {line('지출', grand, { minus:true })}
          {total('영업 잔액', currentBalance, { color: currentBalance<0 ? T.red : undefined })}
          <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginTop:8, fontSize:12, color:T.sub}}>
            {editCarry ? (
              <>
                <span>전월 이월</span>
                {money(carryover, setCarryover, { label:'전월 이월 잔액', neg:true })}
                <Btn onClick={async()=>{ await saveCarryover(); setEditCarry(false) }} kind="primary">저장</Btn>
                <Btn onClick={()=>{ setCarryover(data.carryover||''); setEditCarry(false) }}>취소</Btn>
              </>
            ) : (
              <>
                <Btn onClick={()=>setEditCarry(true)} small>이월 고치기</Btn>
                {data.carryoverSource==='manual'
                  ? <Btn onClick={resetCarryoverAuto} small>통장 잔액 기준으로 되돌리기</Btn>
                  : !data.carryoverSource && <span>통장 PDF를 올리면 이월이 자동으로 채워져요</span>}
              </>
            )}
          </div>
        </section>

        <section>
          {sectionTitle('지출 구분', <Btn onClick={()=>setShowCatMgr(v=>!v)} small>{showCatMgr ? '카테고리 닫기' : '카테고리 관리'}</Btn>)}
          {grand === 0 && empty('이 달 지출이 아직 없어요')}
          {grand > 0 && secs.map(sec => {
            const st = secTotal(sec)
            if(!st) return null
            return (
              <Fragment key={sec}>
                {line(sec, st, { note:`${pctOf(st,grand)}%` })}
                {categories.filter(c=>c.sec===sec && tot[c.id]).map(c => line(c.label, tot[c.id], { sub:true, key:c.id }))}
              </Fragment>
            )
          })}
          {grand > 0 && total('지출 합계', grand)}
        </section>
      </div>

      {/* 카테고리 관리 */}
      {showCatMgr && (
        <section style={{background:'#FFFFFF', border:`1px solid ${T.rule}`, borderRadius:6, marginBottom:30, padding:18}}>
          <div style={{fontSize:14, fontWeight:800, marginBottom:12}}>카테고리 관리</div>
          <div style={{display:'flex', flexDirection:'column', gap:12, marginBottom:14}}>
            {secs.map(sec=>(
              <div key={sec}>
                <div style={{fontSize:12, color:T.sub, fontWeight:700, marginBottom:6}}>{sec}</div>
                <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
                  {categories.filter(c=>c.sec===sec).map(cat=>(
                    <div key={cat.id} style={{background:T.chip, border:`1px solid ${T.rule}`, borderRadius:4,
                      padding:'6px 10px', display:'flex', alignItems:'center', gap:8}}>
                      {editCatId===cat.id ? (
                        <>
                          <input value={editCatLabel} onChange={e=>setEditCatLabel(e.target.value)} aria-label="카테고리 이름"
                            style={field({ padding:'3px 7px', fontSize:12, width:90 })}/>
                          <select value={editCatSec} onChange={e=>setEditCatSec(e.target.value)} aria-label="구분"
                            style={field({ padding:'3px', fontSize:12 })}>
                            {secs.map(s=><option key={s} value={s}>{s}</option>)}
                          </select>
                          <Btn onClick={saveEditCat} kind="primary" small>저장</Btn>
                          <Btn onClick={()=>setEditCatId(null)} small>취소</Btn>
                        </>
                      ) : (
                        <>
                          <span style={{fontSize:13}}>{cat.label}</span>
                          <button onClick={()=>{setEditCatId(cat.id);setEditCatLabel(cat.label);setEditCatSec(cat.sec)}} style={{background:'transparent',border:'none',color:T.sub,fontSize:11,cursor:'pointer',padding:0,fontFamily:'inherit'}}>수정</button>
                          <button onClick={()=>deleteCategory(cat.id)} style={{background:'transparent',border:'none',color:T.red,fontSize:11,cursor:'pointer',padding:0,fontFamily:'inherit'}}>삭제</button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', paddingTop:12, borderTop:`1px solid ${T.rule}`}}>
            <input value={newCatLabel} onChange={e=>setNewCatLabel(e.target.value)} placeholder="새 카테고리 이름"
              style={field({ flex:1, minWidth:140, fontSize:13 })}/>
            <select value={newCatSec} onChange={e=>setNewCatSec(e.target.value)} aria-label="구분" style={field({ fontSize:13 })}>
              {secs.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <Btn onClick={addCategory} kind="primary">추가</Btn>
          </div>
        </section>
      )}

      {/* 통장 잔액 맞추기 (영업 잔액 vs 실제 통장) */}
      <BankReconCard ym={curMonth} data={data} categories={categories} onChanged={refreshData}/>

      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 460px), 1fr))', gap:'28px 40px', marginBottom:30}}>
        {/* 고정지출 */}
        <section>
          {sectionTitle('고정지출', <>
            {fixedItems.length > 0 && (unpaidFixed.length > 0
              ? <span style={{color:T.red, fontWeight:700}}>미납 {unpaidFixed.length}건</span>
              : <span style={{color:T.green, fontWeight:700}}>모두 납부</span>)}
            <Btn onClick={()=>setShowFixedMgr(v=>!v)} small>{showFixedMgr ? '관리 닫기' : '항목 관리'}</Btn>
          </>)}

          {showFixedMgr && (
            <div style={{background:T.chip, borderRadius:4, padding:'12px 14px', margin:'8px 0'}}>
              {fixedItems.map(item=>(
                <div key={item.id} style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', padding:'6px 0', borderBottom:`1px solid ${T.rule}`}}>
                  {editFixedId===item.id ? (
                    <>
                      <input value={editFixed.label||''} onChange={e=>setEditFixed(f=>({...f,label:e.target.value}))}
                        placeholder="항목명" aria-label="항목명" style={field({ width:110, fontSize:13, padding:'5px 8px' })}/>
                      <span style={{fontSize:12, color:T.sub}}>매월</span>
                      <input type="number" value={editFixed.dueDay||''} onChange={e=>setEditFixed(f=>({...f,dueDay:e.target.value}))}
                        aria-label="예정일" min="1" max="31" style={field({ width:56, fontSize:13, padding:'5px 8px' })}/>
                      <span style={{fontSize:12, color:T.sub}}>일</span>
                      {money(editFixed.amount ?? '', v=>setEditFixed(f=>({...f,amount:v})), { label:'금액', width:110, extra:{ fontSize:13, padding:'5px 8px' } })}
                      <select value={editFixed.categoryId||''} onChange={e=>setEditFixed(f=>({...f,categoryId:e.target.value}))}
                        aria-label="카테고리" style={field({ fontSize:13, padding:'5px 8px' })}>
                        {categories.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                      <Btn onClick={saveEditFixed} kind="primary" small>저장</Btn>
                      <Btn onClick={()=>setEditFixedId(null)} small>취소</Btn>
                    </>
                  ) : (
                    <>
                      <span style={{fontSize:13, fontWeight:600, flex:1}}>{item.label}</span>
                      <span style={{fontSize:12, color:T.sub}}>매월 {item.dueDay}일 · {categories.find(c=>c.id===item.categoryId)?.label||'미분류'}</span>
                      <span style={{fontSize:13, ...num}}>{won(item.amount)}</span>
                      <button onClick={()=>{setEditFixedId(item.id);setEditFixed({...item})}}
                        style={{background:'transparent',border:'none',color:T.sub,fontSize:12,cursor:'pointer',padding:0,fontFamily:'inherit'}}>수정</button>
                      <button onClick={()=>deleteFixedItem(item.id)}
                        style={{background:'transparent',border:'none',color:T.red,fontSize:12,cursor:'pointer',padding:0,fontFamily:'inherit'}}>삭제</button>
                    </>
                  )}
                </div>
              ))}
              <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', paddingTop:10}}>
                <input value={newFixed.label} onChange={e=>setNewFixed(f=>({...f,label:e.target.value}))}
                  placeholder="새 항목 (예: 임대료)" style={field({ flex:1, minWidth:120, fontSize:13 })}/>
                <span style={{fontSize:12, color:T.sub}}>매월</span>
                <input type="number" value={newFixed.dueDay} onChange={e=>setNewFixed(f=>({...f,dueDay:e.target.value}))}
                  placeholder="1" min="1" max="31" aria-label="예정일" style={field({ width:56, fontSize:13 })}/>
                <span style={{fontSize:12, color:T.sub}}>일</span>
                {money(newFixed.amount, v=>setNewFixed(f=>({...f,amount:v})), { label:'금액', width:120, extra:{ fontSize:13 } })}
                <select value={newFixed.categoryId} onChange={e=>setNewFixed(f=>({...f,categoryId:e.target.value}))}
                  aria-label="카테고리" style={field({ fontSize:13 })}>
                  <option value="">카테고리</option>
                  {categories.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <Btn onClick={addFixedItem} kind="primary">추가</Btn>
              </div>
            </div>
          )}

          {fixedItems.length === 0 ? empty('항목 관리에서 매달 나가는 돈(임대료 등)을 추가하세요') : (
            <>
              {fixedItems.map(item=>{
                const payment = fixedPayments[item.id]
                const isPaid = payment?.paid
                const cat = categories.find(c=>c.id===item.categoryId)
                return (
                  <div key={item.id} style={{display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:`1px solid ${T.soft}`}}>
                    <span style={{fontSize:12, fontWeight:700, width:30, flexShrink:0, color: isPaid ? T.green : T.red}}>{isPaid ? '납부' : '미납'}</span>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{display:'flex', alignItems:'baseline'}}>
                        <span style={{fontSize:14, fontWeight:600, color: isPaid ? T.sub : T.ink, whiteSpace:'nowrap'}}>{item.label}</span>
                        {leader()}
                        <span style={{fontSize:14, ...num, color: isPaid ? T.sub : T.ink, whiteSpace:'nowrap'}}>{won(item.amount)}</span>
                      </div>
                      <div style={{fontSize:11, color:T.sub, marginTop:2}}>
                        매월 {item.dueDay}일 · {cat?.label||'미분류'}
                        {isPaid && <span style={{color:T.green}}> · {+payment.paidDate}일에 냄</span>}
                      </div>
                    </div>
                    {isThisMonth && (
                      isPaid ? <Btn onClick={()=>unpayFixed(item.id)} small>취소</Btn>
                      : payingItemId === item.id ? (
                        <div style={{display:'flex', alignItems:'center', gap:6, flexShrink:0}}>
                          <input type="date" value={payingDate} onChange={e=>setPayingDate(e.target.value)} aria-label="낸 날짜"
                            style={field({ fontSize:12, padding:'4px 6px' })}/>
                          <Btn onClick={async()=>{ await payFixed(item, payingDate); setPayingItemId(null); setPayingDate('') }} kind="ok" small>확인</Btn>
                          <Btn onClick={()=>{ setPayingItemId(null); setPayingDate('') }} small>취소</Btn>
                        </div>
                      ) : <Btn onClick={()=>{ setPayingItemId(item.id); setPayingDate(`${curMonth}-${getNowDD()}`) }} kind="ok" small>냈어요</Btn>
                    )}
                  </div>
                )
              })}
              {total('낸 돈', paidFixedAmt, { note:`전체 ${won(totalFixedAmt)}원 중` })}
            </>
          )}
        </section>

        {/* 형과의 단기 대여금 */}
        <section>
          {sectionTitle('형과의 단기 대여금', <>
            {!loanOpen && <span style={{...num}}>남은 대여금 <b style={{color: loanBalance>0 ? T.red : loanBalance<0 ? T.green : T.ink}}>{won(loanBalance)}</b>원{loanFlow.open.length > 0 && ` · ${mdDot(loanFlow.open[0].rec.date)} 빌려준 돈부터 남음`}</span>}
            {loanOpen && loanBalance > 0 && <Btn onClick={()=>{ setShowConvert(v=>!v); setConvertAmount(String(loanBalance)) }} small>투자금 회수로 전환</Btn>}
            {loanOpen && <Btn onClick={()=>setShowLoanMgr(v=>!v)} small>{showLoanMgr ? '입력 닫기' : '기록 추가'}</Btn>}
            <Btn onClick={toggleLoanOpen} small>{loanOpen ? '접기' : `펼치기 (${loanRecords.length}건)`}</Btn>
          </>)}
          {loanOpen && <>

          {showConvert && (
            <div style={{background:T.chip, borderRadius:4, padding:'12px 14px', margin:'8px 0'}}>
              <div style={{fontSize:13, fontWeight:700, marginBottom:8}}>잔액 중 일부(또는 전체)를 투자금 회수로 전환</div>
              <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
                {money(convertAmount, setConvertAmount, { label:'전환할 금액', width:150 })}
                <span style={{fontSize:12, color:T.sub}}>/ 잔액 {won(loanBalance)}원</span>
                <Btn onClick={convertToInvestment} kind="primary" disabled={saving}>{saving ? '처리 중...' : '전환'}</Btn>
                <Btn onClick={()=>setShowConvert(false)}>취소</Btn>
              </div>
              <div style={{fontSize:11, color:T.sub, marginTop:8}}>전환하면 대여금 잔액이 줄고, 투자관리의 형 "대출금 상환 회수"에 자동으로 적혀요.</div>
            </div>
          )}

          {showLoanMgr && (
            <div style={{background:T.chip, borderRadius:4, padding:'12px 14px', margin:'8px 0', display:'flex', gap:8, alignItems:'center', flexWrap:'wrap'}}>
              <input type="date" value={loanForm.date} onChange={e=>setLoanForm(f=>({...f,date:e.target.value}))} aria-label="날짜"
                style={field({ fontSize:13 })}/>
              <div style={{display:'flex', gap:12}}>
                {[['lent','빌려줌'],['received','받음']].map(([k,l])=>textTab(loanForm.type===k, l, ()=>setLoanForm(f=>({...f,type:k}))))}
              </div>
              {money(loanForm.amount, v=>setLoanForm(f=>({...f,amount:v})), { label:'금액', width:120, extra:{ fontSize:13 } })}
              <input value={loanForm.memo} onChange={e=>setLoanForm(f=>({...f,memo:e.target.value}))}
                placeholder="메모 (선택)" style={field({ flex:1, minWidth:100, fontSize:13 })}/>
              <Btn onClick={addLoanRecord} kind="primary">추가</Btn>
            </div>
          )}

          {loanRecords.length === 0 ? empty('기록 추가에서 빌려준 돈, 받은 돈을 적으세요') : (
            <>
              {/* 아직 남은 돈: 언제 빌려준 돈인지 */}
              {loanFlow.open.length > 0 && (
                <div style={{margin:'8px 0 14px'}}>
                  <div style={{fontSize:12, fontWeight:700, color:T.sub, marginBottom:2}}>
                    {loanFlow.open[0].dir > 0 ? '아직 못 받은 돈' : '내가 더 받은 돈'} <span style={{fontWeight:400}}>· 받은 돈은 먼저 빌려준 것부터 갚은 걸로 계산</span>
                  </div>
                  {loanFlow.open.map(o=>(
                    <div key={o.rec.id} style={{borderLeft:`4px solid ${o.dir>0 ? T.red : T.green}`, background: o.dir>0 ? '#B4231810' : '#2E7D4510',
                      borderRadius:'0 4px 4px 0', padding:'7px 12px', marginTop:4}}>
                      <div style={{display:'flex', alignItems:'baseline', fontSize:14}}>
                        <span style={{fontWeight:700, whiteSpace:'nowrap', ...num}}>{mdDot(o.rec.date)} {o.dir>0 ? '빌려준 돈' : '받은 돈'}</span>
                        <span style={{fontSize:12, color:T.sub, marginLeft:6, whiteSpace:'nowrap', ...num}}>{daysSince(o.rec.date)}일째</span>
                        {leader()}
                        <span style={{fontSize:12, color:T.sub, marginRight:6}}>남은 돈</span>
                        <span style={{...num, fontWeight:800, color: o.dir>0 ? T.red : T.green, whiteSpace:'nowrap'}}>{won(o.left)}</span>
                      </div>
                      <div style={{fontSize:12, color:T.sub, marginTop:2, lineHeight:1.6, ...num}}>
                        원금 {won(o.rec.amount)}
                        {o.paid.map((p,i)=><span key={i}> · {mdDot(p.date)} {won(p.amount)} {p.type==='converted' ? '투자전환' : p.type==='lent' ? '빌려줌' : '받음'}</span>)}
                        {o.rec.memo && <span> · {o.rec.memo}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* 전체 기록: 최근 것부터, 그때의 잔액과 함께 */}
              <div style={{fontSize:12, fontWeight:700, color:T.sub, padding:'4px 0', borderBottom:`1px solid ${T.rule}`, display:'flex'}}>
                <span style={{flex:1}}>전체 기록</span><span style={{width:96, textAlign:'right'}}>그때 잔액</span><span style={{width:30}}/>
              </div>
              {[...loanRecords].sort((a,b)=>b.date.localeCompare(a.date) || String(b.id).localeCompare(String(a.id))).map(r=>{
                const c = r.type==='lent' ? T.red : r.type==='converted' ? T.accent : T.green
                return (
                  <div key={r.id} style={{display:'flex', alignItems:'baseline', gap:8, padding:'7px 0', borderBottom:`1px solid ${T.soft}`, fontSize:13}}>
                    <span style={{color:T.sub, ...num, whiteSpace:'nowrap'}}>{mdDot(r.date)}</span>
                    <span style={{fontWeight:700, color:c, whiteSpace:'nowrap'}}>{r.type==='lent'?'빌려줌':r.type==='converted'?'투자전환':'받음'}</span>
                    <span style={{color:T.sub, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', minWidth:0, maxWidth:'35%'}}>{r.memo||''}</span>
                    {leader()}
                    <span style={{...num, fontWeight:600, color:c, whiteSpace:'nowrap'}}>{r.type==='lent'?'+ ':'− '}{won(r.amount)}</span>
                    <span style={{...num, color:T.sub, whiteSpace:'nowrap', width:88, textAlign:'right'}}>{won(loanFlow.after[r.id])}</span>
                    <button onClick={()=>deleteLoanRecord(r.id)} aria-label="삭제"
                      style={{background:'transparent',border:'none',color:T.red,fontSize:11,cursor:'pointer',padding:0,fontFamily:'inherit',width:30,textAlign:'right'}}>삭제</button>
                  </div>
                )
              })}
              {total('남은 대여금', loanBalance, {
                note: loanBalance>0 ? '형이 갚을 돈' : loanBalance<0 ? '내가 갚을 돈' : '없음',
                color: loanBalance>0 ? T.red : loanBalance<0 ? T.green : undefined })}
            </>
          )}
          </>}
        </section>
      </div>

      {/* 지출 입력 */}
      <section id="expense-input" style={{marginBottom:30, scrollMarginTop:70}}>
        {sectionTitle('지출 입력', <div style={{display:'flex', gap:14}}>
          {textTab(inputMode==='bank', '계좌내역 엑셀·PDF', ()=>setInputMode('bank'))}
          {textTab(inputMode==='manual', '직접 입력', ()=>setInputMode('manual'))}
        </div>)}

        {inputMode === 'bank' && (
          <BankImport categories={categories} onSaved={months=>{
            // 반영한 달로 이동해서 바로 확인할 수 있게
            const last = months?.[months.length-1]
            if(last && last!==curMonth) setCurMonth(last); else load()
            // 대여금 장부도 바뀌었을 수 있으니 다시 불러옴
            getDoc(doc(db,'loans','hyung')).then(s=>setLoanRecords(s.exists() ? (s.data().list||[]) : [])).catch(e=>console.error(e))
          }}/>
        )}

        {inputMode === 'manual' && (
          <div style={{paddingTop:6}}>
            <div style={{fontSize:12, color:T.sub, marginBottom:4}}>
              현금으로 낸 것처럼 통장에 안 찍히는 지출만 여기서 적으세요. 이미 적힌 날을 고치려면 아래 일별 표의 수정을 누르세요.
            </div>
            <MissedExpenseInput curMonth={curMonth} onSaved={refreshData}/>
          </div>
        )}
      </section>

      {/* 일별 내역 */}
      <section>
        {sectionTitle('일별 지출 내역', <span style={{...num}}>합계 <b style={{color:T.ink}}>{won(grand)}</b>원</span>)}
        {loading ? <div style={{color:T.sub, padding:'30px 0'}}>불러오는 중...</div> : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:13, ...num}}>
              <thead>
                <tr>
                  {['날짜','실입금','지출','남은 돈',...categories.map(f=>f.label),''].map((h,i)=>(
                    <th key={h+i} style={{padding:'8px 10px', fontSize:12, fontWeight:600, color:T.sub, borderBottom:`1px solid ${T.ink}`,
                      textAlign:i===0?'left':'right', whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dayRows.map(dd=>{
                  const e = data[dd]
                  if(typeof e !== 'object' || !e) return null
                  const expSum = categories.reduce((a,f)=>a+(e[f.id]||0),0)
                  const dep = e.deposit||0
                  const profit = dep - expSum
                  if(!expSum && !dep) return null
                  const txCount = (data.bankSeen||[]).filter(k=>k.startsWith(`${curMonth}-${dd}|`)).length
                  const td = { padding:'8px 10px', borderBottom:`1px solid ${T.soft}`, textAlign:'right', whiteSpace:'nowrap' }
                  return (
                    <Fragment key={dd}>
                    <tr>
                      <td style={{...td, textAlign:'left', color:getDowColor(dd), fontWeight:600}}>
                        {+dd}일 ({getDow(dd)})
                        {txCount>0 && (
                          <button onClick={()=>setOpenDay(openDay===dd?null:dd)}
                            style={{marginLeft:8, background:'none', border:'none', borderBottom:`1px solid ${T.blue}`, color:T.blue,
                              padding:0, fontSize:11, cursor:'pointer', fontFamily:'inherit', fontWeight:500}}>
                            거래 {txCount}건 {openDay===dd ? '접기' : '보기'}
                          </button>
                        )}
                      </td>
                      <td style={{...td, color:T.green}}>{dep>0 ? won(dep) : '—'}</td>
                      <td style={{...td, color:T.red, fontWeight:600}}>{expSum>0 ? won(expSum) : '—'}</td>
                      <td style={{...td, color:profit<0 ? T.red : T.ink}}>{dep>0 ? won(profit) : '—'}</td>
                      {categories.map(f=>(
                        <td key={f.id} style={{...td, color: e[f.id] ? T.ink : T.faint}}>{wonCell(e[f.id])}</td>
                      ))}
                      <td style={{...td}}>
                        <button onClick={()=>editDay(dd)}
                          style={{background:'transparent',border:'none',color: editRow===dd ? T.accent : T.sub,fontSize:12,cursor:'pointer',padding:'0 6px',fontFamily:'inherit',fontWeight: editRow===dd ? 700 : 400}}>{editRow===dd ? '닫기' : '수정'}</button>
                        <button onClick={()=>del_row(dd)}
                          style={{background:'transparent',border:'none',color:T.red,fontSize:12,cursor:'pointer',padding:'0 0 0 6px',fontFamily:'inherit'}}>삭제</button>
                      </td>
                    </tr>
                    {editRow===dd && (
                      <tr>
                        <td colSpan={5+categories.length} style={{padding:'10px 10px 14px', borderBottom:`1px solid ${T.rule}`, background:'#FFFFFF'}}>
                          <div style={{fontSize:13, fontWeight:700, marginBottom:6}}>{+dd}일 ({getDow(dd)}) 고치기</div>
                          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:'2px 24px', width:'min(820px, 78vw)'}}>
                            {[{ id:'__deposit', label:'실입금' }, ...categories].map(f=>(
                              <div key={f.id} style={{display:'flex', alignItems:'center', padding:'3px 0'}}>
                                <span style={{fontSize:13, whiteSpace:'nowrap', color: f.id==='__deposit' ? T.green : T.ink}}>{f.label}</span>
                                {leader()}
                                {f.id==='__deposit'
                                  ? money(deposit, setDeposit, { label:'실입금', width:110, extra:{ fontSize:13, padding:'5px 8px' } })
                                  : money(form[f.id] ?? '', v=>setForm(p=>({...p,[f.id]:v})), { label:f.label, width:110, extra:{ fontSize:13, padding:'5px 8px' } })}
                              </div>
                            ))}
                          </div>
                          <div style={{display:'flex', gap:8, alignItems:'center', marginTop:10, flexWrap:'wrap', width:'min(820px, 78vw)'}}>
                            <Btn onClick={save} kind="primary" disabled={saving}>{saving ? '저장 중...' : '저장'}</Btn>
                            <Btn onClick={()=>setEditRow(null)}>취소</Btn>
                            <span style={{fontSize:12, color:T.sub, ...num}}>지출 {won(formExp)}원</span>
                            {(data.bankSeen||[]).some(k=>k.startsWith(`${curMonth}-${dd}|`)) &&
                              <span style={{fontSize:12, color:T.sub}}>통장에서 가져온 금액은 '거래 보기'에서 한 건씩 옮기는 게 더 정확해요</span>}
                          </div>
                        </td>
                      </tr>
                    )}
                    {openDay===dd && (
                      <tr>
                        <td colSpan={5+categories.length} style={{padding:'8px 10px 12px', borderBottom:`1px solid ${T.rule}`, background:'#FFFFFF'}}>
                          <BankTxList ym={curMonth} data={data} categories={categories} day={dd} onChanged={refreshData}/>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
                {dayRows.length===0 && (
                  <tr><td colSpan={categories.length+5} style={{padding:28, textAlign:'center', color:T.sub}}>입력된 내역이 없어요</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr style={{fontWeight:800}}>
                  {(() => { const tf = { padding:'10px', borderTop:`3px double ${T.ink}`, textAlign:'right', whiteSpace:'nowrap' }; return (<>
                    <td style={{...tf, textAlign:'left'}}>합계</td>
                    <td style={{...tf, color:T.green}}>{won(totalDeposit)}</td>
                    <td style={{...tf, color:T.red}}>{won(grand)}</td>
                    <td style={{...tf, color:realProfit<0 ? T.red : T.ink}}>{won(realProfit)}</td>
                    {categories.map(f=><td key={f.id} style={tf}>{wonCell(tot[f.id])}</td>)}
                    <td style={tf}></td>
                  </>) })()}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
