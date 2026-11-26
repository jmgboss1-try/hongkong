import { Fragment, useEffect, useState } from 'react'
import { VStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Grid } from '@astryxdesign/core/Grid'
import { Button } from '@astryxdesign/core/Button'
import { HStack } from '@astryxdesign/core/Layout'
import { Badge } from '@astryxdesign/core/Badge'
import { Divider } from '@astryxdesign/core/Divider'
import { DateInput } from '@astryxdesign/core/DateInput'
import { Card } from '@astryxdesign/core/Card'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Table, useTableRowExpansion } from '@astryxdesign/core/Table'
import { TabList, Tab } from '@astryxdesign/core/TabList'
import { Selector } from '@astryxdesign/core/Selector'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { List, ListItem } from '@astryxdesign/core/List'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { AstryxPage, Legacy, PageHeader, MonthNav, LedgerCard, Ledger, LedgerRow } from '../astryx/AstryxPage'
import CountUp from '../components/CountUp'
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
// type 'reset'(0으로 정리): 그날까지의 잔액을 0으로 만들고 남은 기록을 모두 닫음. 예전 기록은 지우지 않음
// (계좌내역 가져오기가 같은 거래를 다시 넣지 않도록 기록이 남아 있어야 함). 정리 기록을 삭제하면 되돌려짐
const LOAN_TYPE_LABEL = { lent:'빌려줌', received:'받음', converted:'투자전환', reset:'0으로 정리' }
const loanSorted = records => [...records].sort((a,b)=>a.date.localeCompare(b.date) || String(a.id).localeCompare(String(b.id)))
function loanFifo(records) {
  const sorted = loanSorted(records)
  const open = []     // 아직 덜 갚은 기록 [{rec, dir, left, paid:[{date,amount,type}]}] (모두 같은 방향)
  const after = {}    // 기록 id → 그 기록까지의 잔액
  let bal = 0
  let lastReset = null
  for (const r of sorted) {
    if (r.type==='reset') {
      for (const o of open) o.paid.push({ date:r.date, amount:o.left, type:'reset' })
      open.length = 0; bal = 0; after[r.id] = 0; lastReset = r
      continue
    }
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
  return { open, after, balance: bal, lastReset }
}
const daysSince = date => Math.max(0, Math.round((new Date(todayFullStr()) - new Date(date)) / 86400000))
const mdDot = date => `${+date.slice(5,7)}.${+date.slice(8,10)}`


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
  const [showReset, setShowReset]       = useState(false)
  const [resetForm, setResetForm]       = useState({ date:'', memo:'' })
  const [showOldLoans, setShowOldLoans] = useState(false)
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
  function deleteLoanRecord(id, isReset) {
    if(!window.confirm(isReset ? '이 정리를 되돌릴까요? 정리 전 남은 대여금이 다시 계산돼요.' : '이 기록을 삭제하시겠습니까?')) return
    saveLoanRecords(loanRecords.filter(r=>r.id!==id))
  }
  async function resetLoans() {
    const date = resetForm.date || todayFullStr()
    // 저장 직전 다시 읽기 (계좌내역 가져오기가 같은 장부에 쓸 수 있음)
    const snap = await getDoc(doc(db,'loans','hyung'))
    const list = snap.exists() ? (snap.data().list||[]) : []
    const before = loanFifo(list.filter(r=>r.date<=date)).balance
    if(!window.confirm(`${mdDot(date)}까지의 남은 대여금 ${before.toLocaleString()}원을 0으로 정리할까요?\n예전 기록은 지우지 않고 접어 둬요. 이 정리 기록을 삭제하면 되돌릴 수 있어요.`)) return
    setSaving(true)
    try {
      const rec = { id:Date.now().toString(), date, type:'reset', amount:Math.abs(before), before, memo: resetForm.memo || '' }
      await saveLoanRecords([...list, rec])
      setResetForm({ date:'', memo:'' }); setShowReset(false); setShowOldLoans(false)
    } catch(e) { console.error(e); alert('저장 중 오류가 발생했어요. 다시 시도해 주세요.') }
    setSaving(false)
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

  const loanFlow = loanFifo(loanRecords)
  const loanBalance = loanFlow.balance
  // 마지막 '0으로 정리'까지의 기록은 접어 둠
  const loanSortedDesc = loanSorted(loanRecords).reverse()
  const resetIdx = loanFlow.lastReset ? loanSortedDesc.findIndex(r=>r.id===loanFlow.lastReset.id) : -1
  const loanShown = resetIdx < 0 || showOldLoans ? loanSortedDesc : loanSortedDesc.slice(0, resetIdx+1)
  const loanHidden = resetIdx < 0 ? 0 : loanSortedDesc.length - resetIdx - 1

  const unpaidFixed = fixedItems.filter(i=>!fixedPayments[i.id]?.paid)
  const totalFixedAmt = fixedItems.reduce((a,i)=>a+i.amount,0)
  const paidFixedAmt  = fixedItems.filter(i=>fixedPayments[i.id]?.paid).reduce((a,i)=>a+i.amount,0)

  const won = n => (n||0).toLocaleString('ko-KR')
  const pctOf = (a,b) => b>0 ? Math.round(a/b*100) : 0
  const secTotal = sec => categories.filter(c=>c.sec===sec).reduce((a,c)=>a+(tot[c.id]||0),0)
  const carryNote = data.carryoverSource==='bank' ? '이 달 통장 시작 잔액'
    : data.carryoverSource==='bank-prev' ? '지난달 통장 말일 잔액'
    : data.carryoverSource==='manual' ? '직접 입력' : undefined
  const dayRows = Object.keys(data).filter(dd=>/^\d{2}$/.test(dd)).sort()
  const formExp = categories.reduce((a,f)=>a+(+form[f.id]||0),0)

  // 일별 표 줄 (+ 맨 아래 합계 줄)
  const dayTableRows = (() => {
    const [y, m] = curMonth.split('-').map(Number)
    const rows = dayRows.map(dd => {
      const e = data[dd]
      if (typeof e !== 'object' || !e) return null
      const exp = categories.reduce((a,f)=>a+(e[f.id]||0),0), dep = e.deposit||0
      if (!exp && !dep) return null
      return { dd, e, exp, dep, profit: dep - exp, dow: new Date(y, m-1, +dd).getDay(), txCount: (data.bankSeen||[]).filter(k=>k.startsWith(`${curMonth}-${dd}|`)).length }
    }).filter(Boolean)
    return rows.length ? [...rows, { dd:'_total', e:tot, exp:grand, dep:totalDeposit, profit:realProfit }] : []
  })()
  const dayExpansion = useTableRowExpansion({
    expandedKeys: new Set([editRow, openDay].filter(Boolean)),
    onToggle: key => { if (key === editRow) setEditRow(null); else if (key === openDay) setOpenDay(null); else if ((data.bankSeen||[]).some(k=>k.startsWith(`${curMonth}-${key}|`))) setOpenDay(key); else editDay(key) },
    getRowKey: r => r.dd,
    getRowLabel: r => `${+r.dd}일`,
    getIsItemExpandable: r => r.dd !== '_total',
    panelVariant: 'muted',
    renderExpanded: r => editRow === r.dd ? (
      <VStack gap={3} maxWidth={820}>
        <Heading level={5}>{+r.dd}일 ({DAYS_KR[r.dow]}) 고치기</Heading>
        <Grid columns={{ minWidth: 150, repeat: 'fill' }} gap={2}>
          {moneyField('실입금', deposit, setDeposit, { width:'100%' })}
          {categories.map(f => <Fragment key={f.id}>{moneyField(f.label, form[f.id] ?? '', v=>setForm(p=>({...p,[f.id]:v})), { width:'100%' })}</Fragment>)}
        </Grid>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Button variant="primary" label={saving ? '저장 중...' : '저장'} isDisabled={saving} onClick={save}/>
          <Button label="취소" onClick={()=>setEditRow(null)}/>
          <Text type="supporting" color="secondary" hasTabularNumbers>지출 {won(formExp)}원</Text>
          {r.txCount > 0 && <Text type="supporting" color="secondary">통장에서 가져온 금액은 '거래 보기'에서 한 건씩 옮기는 게 더 정확해요</Text>}
        </HStack>
      </VStack>
    ) : openDay === r.dd ? <Legacy><BankTxList ym={curMonth} data={data} categories={categories} day={r.dd} onChanged={refreshData}/></Legacy> : null,
  })

  // 금액 입력 (쉼표 찍어 보여주고 숫자만 받음)
  const moneyField = (label, val, set, o = {}) => (
    <TextInput label={label} isLabelHidden={o.hideLabel} value={val === '' || val == null ? '' : val === '-' ? '-' : (+val).toLocaleString('ko-KR')}
      onChange={v => { const d = v.replace(/[^0-9]/g, ''); set(o.neg && v.trim().startsWith('-') ? '-' + d : d) }} inputMode={o.neg ? 'text' : 'numeric'} placeholder="0" width={o.width || 150}/>
  )
  const catOptions = categories.map(c=>({ value:c.id, label:c.label }))
  const secOptions = secs.map(x=>({ value:x, label:x }))
  // Astryx 장부 줄 (금액이 굴러가며 바뀜)
  const row = (label, value, o = {}) => <LedgerRow key={o.key || label} label={label} value={value} note={o.note} sub={o.sub} strong={o.strong} minus={o.minus} plus={o.plus} tone={o.tone}/>

  return (
    <AstryxPage>
    <VStack gap={5} maxWidth={1100}>
      <PageHeader title={`${mLabel(curMonth)} 지출`} right={<MonthNav value={curMonth} options={monthOpts} onChange={setCurMonth} label={mLabel}/>}/>

      {/* 요약: 통장 흐름 · 지출 구분 */}
      <Grid columns={{ minWidth: 340, max: 2, repeat: 'fit' }} gap={4}>
        <LedgerCard title="이 달 돈의 흐름">
          <Ledger rows={<>
            {row('전월 이월', carryoverAmt, { note: carryNote })}
            {row('실입금', totalDeposit, { plus:true, note:'수수료 빼고 들어온 돈' })}
            {row('지출', grand, { minus:true })}
          </>} total={row('영업 잔액', currentBalance, { strong:true, tone: currentBalance<0 ? 'bad' : undefined })}/>
          <HStack gap={2} vAlign="end" wrap="wrap">
            {editCarry ? (
              <>
                {moneyField('전월 이월 잔액', carryover, setCarryover, { neg:true })}
                <Button variant="primary" label="저장" onClick={async()=>{ await saveCarryover(); setEditCarry(false) }}/>
                <Button label="취소" onClick={()=>{ setCarryover(data.carryover||''); setEditCarry(false) }}/>
              </>
            ) : (
              <>
                <Button size="sm" label="이월 고치기" onClick={()=>setEditCarry(true)}/>
                {data.carryoverSource==='manual'
                  ? <Button size="sm" label="통장 잔액 기준으로 되돌리기" onClick={resetCarryoverAuto}/>
                  : !data.carryoverSource && <Text type="supporting" color="secondary">통장 PDF를 올리면 이월이 자동으로 채워져요</Text>}
              </>
            )}
          </HStack>
        </LedgerCard>

        <LedgerCard title="지출 구분" right={<Button size="sm" label={showCatMgr ? '카테고리 닫기' : '카테고리 관리'} onClick={()=>setShowCatMgr(v=>!v)}/>}>
          {grand === 0 ? <Text color="secondary">이 달 지출이 아직 없어요</Text> : (
            <Ledger rows={secs.map(sec => {
              const st = secTotal(sec)
              if(!st) return null
              return (
                <Fragment key={sec}>
                  {row(sec, st, { note:`${pctOf(st,grand)}%` })}
                  {categories.filter(c=>c.sec===sec && tot[c.id]).map(c => row(c.label, tot[c.id], { sub:true, key:c.id }))}
                </Fragment>
              )
            })} total={row('지출 합계', grand, { strong:true })}/>
          )}
        </LedgerCard>
      </Grid>

      {/* 카테고리 관리 */}
      {showCatMgr && (
        <LedgerCard title="카테고리 관리">
          {secs.map(sec=>(
            <VStack key={sec} gap={1}>
              <Heading level={5}>{sec}</Heading>
              <List hasDividers edge="flush">
                {categories.filter(c=>c.sec===sec).map(cat=>(
                  <ListItem key={cat.id}
                    label={editCatId===cat.id ? (
                      <HStack gap={2} vAlign="end" wrap="wrap">
                        <TextInput label="카테고리 이름" isLabelHidden value={editCatLabel} onChange={v=>setEditCatLabel(v)} width={160}/>
                        <Selector label="구분" isLabelHidden value={editCatSec} onChange={v=>v && setEditCatSec(v)} options={secOptions}/>
                        <Button size="sm" variant="primary" label="저장" onClick={saveEditCat}/>
                        <Button size="sm" label="취소" onClick={()=>setEditCatId(null)}/>
                      </HStack>
                    ) : <Text>{cat.label}</Text>}
                    endContent={editCatId!==cat.id && <HStack gap={1}>
                      <Button size="sm" variant="ghost" label="수정" onClick={()=>{setEditCatId(cat.id);setEditCatLabel(cat.label);setEditCatSec(cat.sec)}}/>
                      <Button size="sm" variant="ghost" label="삭제" onClick={()=>deleteCategory(cat.id)}/>
                    </HStack>}/>
                ))}
              </List>
            </VStack>
          ))}
          <HStack gap={2} vAlign="end" wrap="wrap">
            <TextInput label="새 카테고리 이름" value={newCatLabel} onChange={v=>setNewCatLabel(v)}/>
            <Selector label="구분" value={newCatSec} onChange={v=>v && setNewCatSec(v)} options={secOptions}/>
            <Button variant="primary" label="추가" onClick={addCategory}/>
          </HStack>
        </LedgerCard>
      )}

      {/* 통장 잔액 맞추기 (영업 잔액 vs 실제 통장) */}
      <BankReconCard ym={curMonth} data={data} categories={categories} onChanged={refreshData}/>

      <Grid columns={{ minWidth: 420, max: 2, repeat: 'fit' }} gap={4}>
        {/* 고정지출: 납부/미납, 냈어요 → 날짜 고르고 확인, 항목 관리 */}
        <LedgerCard title="고정지출" right={<>
          {fixedItems.length > 0 && <Badge variant={unpaidFixed.length > 0 ? 'error' : 'success'} label={unpaidFixed.length > 0 ? `미납 ${unpaidFixed.length}건` : '모두 납부'}/>}
          <Button size="sm" label={showFixedMgr ? '관리 닫기' : '항목 관리'} onClick={()=>setShowFixedMgr(v=>!v)}/>
        </>}>
          {showFixedMgr && (
            <Card variant="muted" padding={3}>
              <VStack gap={2}>
                <List hasDividers edge="flush">
                  {fixedItems.map(item=>(
                    <ListItem key={item.id} align="start"
                      label={editFixedId===item.id ? (
                        <HStack gap={2} vAlign="end" wrap="wrap">
                          <TextInput label="항목명" value={editFixed.label||''} onChange={v=>setEditFixed(f=>({...f,label:v}))} width={130}/>
                          <TextInput label="매월 며칠" inputMode="numeric" value={String(editFixed.dueDay||'')} onChange={v=>setEditFixed(f=>({...f,dueDay:v.replace(/[^0-9]/g,'').slice(0,2)}))} width={90}/>
                          {moneyField('금액', editFixed.amount ?? '', v=>setEditFixed(f=>({...f,amount:v})), { width:130 })}
                          <Selector label="카테고리" value={editFixed.categoryId||undefined} onChange={v=>v && setEditFixed(f=>({...f,categoryId:v}))} options={catOptions}/>
                          <Button size="sm" variant="primary" label="저장" onClick={saveEditFixed}/>
                          <Button size="sm" label="취소" onClick={()=>setEditFixedId(null)}/>
                        </HStack>
                      ) : <Text weight="bold">{item.label}</Text>}
                      description={editFixedId!==item.id && `매월 ${item.dueDay}일 · ${categories.find(c=>c.id===item.categoryId)?.label||'미분류'}`}
                      endContent={editFixedId!==item.id && <HStack gap={1} vAlign="center">
                        <Text hasTabularNumbers>{won(item.amount)}</Text>
                        <Button size="sm" variant="ghost" label="수정" onClick={()=>{setEditFixedId(item.id);setEditFixed({...item})}}/>
                        <Button size="sm" variant="ghost" label="삭제" onClick={()=>deleteFixedItem(item.id)}/>
                      </HStack>}/>
                  ))}
                </List>
                <HStack gap={2} vAlign="end" wrap="wrap">
                  <TextInput label="새 항목" placeholder="예: 임대료" value={newFixed.label} onChange={v=>setNewFixed(f=>({...f,label:v}))} width={150}/>
                  <TextInput label="매월 며칠" inputMode="numeric" placeholder="1" value={String(newFixed.dueDay||'')} onChange={v=>setNewFixed(f=>({...f,dueDay:v.replace(/[^0-9]/g,'').slice(0,2)}))} width={90}/>
                  {moneyField('금액', newFixed.amount, v=>setNewFixed(f=>({...f,amount:v})), { width:130 })}
                  <Selector label="카테고리" placeholder="카테고리" value={newFixed.categoryId||undefined} onChange={v=>setNewFixed(f=>({...f,categoryId:v||''}))} options={catOptions}/>
                  <Button variant="primary" label="추가" onClick={addFixedItem}/>
                </HStack>
              </VStack>
            </Card>
          )}
          {fixedItems.length === 0 ? <Text color="secondary">항목 관리에서 매달 나가는 돈(임대료 등)을 추가하세요</Text> : (
            <VStack gap={2}>
              <List hasDividers edge="flush">
                {fixedItems.map(item => {
                  const payment = fixedPayments[item.id]
                  const isPaid = payment?.paid
                  const cat = categories.find(c=>c.id===item.categoryId)
                  return (
                    <ListItem key={item.id}
                      startContent={<Badge variant={isPaid ? 'success' : 'error'} label={isPaid ? '납부' : '미납'}/>}
                      label={<HStack hAlign="between" gap={2}><Text weight="semibold" color={isPaid ? 'secondary' : 'primary'}>{item.label}</Text><Text hasTabularNumbers color={isPaid ? 'secondary' : 'primary'}>{won(item.amount)}</Text></HStack>}
                      description={`매월 ${item.dueDay}일 · ${cat?.label||'미분류'}${isPaid ? ` · ${+payment.paidDate}일에 냄` : ''}`}
                      endContent={isThisMonth ? (isPaid
                        ? <Button size="sm" variant="ghost" label="취소" onClick={()=>unpayFixed(item.id)}/>
                        : payingItemId === item.id
                          ? <HStack gap={1} vAlign="center">
                              <DateInput label="낸 날짜" isLabelHidden size="sm" value={payingDate} onChange={v=>setPayingDate(v || '')}/>
                              <Button size="sm" variant="primary" label="확인" onClick={async()=>{ await payFixed(item, payingDate); setPayingItemId(null); setPayingDate('') }}/>
                              <Button size="sm" variant="ghost" label="취소" onClick={()=>{ setPayingItemId(null); setPayingDate('') }}/>
                            </HStack>
                          : <Button size="sm" label="냈어요" onClick={()=>{ setPayingItemId(item.id); setPayingDate(`${curMonth}-${getNowDD()}`) }}/>) : undefined}/>
                  )
                })}
              </List>
              <Divider variant="strong"/>
              <LedgerRow label="낸 돈" note={`전체 ${won(totalFixedAmt)}원 중`} value={paidFixedAmt} strong/>
            </VStack>
          )}
        </LedgerCard>

        {/* 형과의 단기 대여금 (Astryx) */}
        <LedgerCard title="형과의 단기 대여금" right={<>
          {!loanOpen && <Text type="supporting" color={loanBalance>0 ? 'accent' : 'secondary'} hasTabularNumbers>남은 대여금 {won(loanBalance)}원{loanFlow.open.length > 0 ? ` · ${mdDot(loanFlow.open[0].rec.date)} 빌려준 돈부터 남음` : ''}</Text>}
          {loanOpen && loanBalance > 0 && <Button size="sm" label="투자금 회수로 전환" onClick={()=>{ setShowConvert(v=>!v); setConvertAmount(String(loanBalance)) }}/>}
          {loanOpen && loanBalance !== 0 && <Button size="sm" label="0으로 정리" onClick={()=>{ setShowReset(v=>!v); setResetForm({ date:todayFullStr(), memo:'' }) }}/>}
          {loanOpen && <Button size="sm" label={showLoanMgr ? '입력 닫기' : '기록 추가'} onClick={()=>setShowLoanMgr(v=>!v)}/>}
          <Button size="sm" variant="ghost" label={loanOpen ? '접기' : `펼치기 (${loanRecords.length}건)`} onClick={toggleLoanOpen}/>
        </>}>
          {loanOpen && <>
            {showConvert && (
              <Card variant="muted" padding={3}>
                <VStack gap={2}>
                  <Text weight="bold">잔액 중 일부(또는 전체)를 투자금 회수로 전환</Text>
                  <HStack gap={2} vAlign="end" wrap="wrap">
                    {moneyField('전환할 금액', convertAmount, setConvertAmount)}
                    <Text type="supporting" color="secondary">/ 잔액 {won(loanBalance)}원</Text>
                    <Button variant="primary" label={saving ? '처리 중...' : '전환'} isLoading={saving} onClick={convertToInvestment}/>
                    <Button label="취소" onClick={()=>setShowConvert(false)}/>
                  </HStack>
                  <Text type="supporting" color="secondary">전환하면 대여금 잔액이 줄고, 투자관리의 형 "대출금 상환 회수"에 자동으로 적혀요.</Text>
                </VStack>
              </Card>
            )}

            {showReset && (
              <Card variant="muted" padding={3}>
                <VStack gap={2}>
                  <Text weight="bold">남은 대여금을 0으로 정리하고 새로 시작</Text>
                  <HStack gap={2} vAlign="end" wrap="wrap">
                    <DateInput label="정리 날짜 (까지)" value={resetForm.date} onChange={v=>setResetForm(f=>({...f,date:v || ''}))}/>
                    <TextInput label="메모" placeholder="예: 형과 정산 끝" value={resetForm.memo} onChange={v=>setResetForm(f=>({...f,memo:v}))}/>
                    <Button variant="primary" label={saving ? '처리 중...' : '0으로 정리'} isLoading={saving} onClick={resetLoans}/>
                    <Button label="취소" onClick={()=>setShowReset(false)}/>
                  </HStack>
                  <Text type="supporting" color="secondary">그 날짜까지 남은 돈은 모두 정리된 걸로 보고, 그 뒤 거래부터 새로 계산해요. 예전 기록은 지우지 않고 접어 두기만 해요 (지우면 계좌내역을 다시 올릴 때 같은 거래가 또 들어가요). 정리 기록을 삭제하면 원래대로 돌아가요.</Text>
                </VStack>
              </Card>
            )}

            {showLoanMgr && (
              <Card variant="muted" padding={3}>
                <HStack gap={2} vAlign="end" wrap="wrap">
                  <DateInput label="날짜" value={loanForm.date} onChange={v=>setLoanForm(f=>({...f,date:v || ''}))}/>
                  <SegmentedControl label="빌려줌·받음" value={loanForm.type} onChange={v=>setLoanForm(f=>({...f,type:v}))}>
                    <SegmentedControlItem value="lent" label="빌려줌"/>
                    <SegmentedControlItem value="received" label="받음"/>
                  </SegmentedControl>
                  {moneyField('금액', loanForm.amount, v=>setLoanForm(f=>({...f,amount:v})))}
                  <TextInput label="메모" isOptional value={loanForm.memo} onChange={v=>setLoanForm(f=>({...f,memo:v}))}/>
                  <Button variant="primary" label="추가" onClick={addLoanRecord}/>
                </HStack>
              </Card>
            )}

            {loanRecords.length === 0 ? <Text color="secondary">기록 추가에서 빌려준 돈, 받은 돈을 적으세요</Text> : <>
              {/* 아직 남은 돈: 언제 빌려준 돈인지 (받은 돈은 먼저 빌려준 것부터 갚은 걸로 계산) */}
              {loanFlow.open.length > 0 && (
                <VStack gap={1}>
                  <Text type="supporting" weight="bold" color="secondary">{loanFlow.open[0].dir > 0 ? '아직 못 받은 돈' : '내가 더 받은 돈'} · 받은 돈은 먼저 빌려준 것부터 갚은 걸로 계산</Text>
                  <List hasDividers edge="flush">
                    {loanFlow.open.map(o => (
                      <ListItem key={o.rec.id}
                        startContent={<Badge variant={o.dir>0 ? 'error' : 'success'} label={`${daysSince(o.rec.date)}일째`}/>}
                        label={`${mdDot(o.rec.date)} ${o.dir>0 ? '빌려준 돈' : '받은 돈'}`}
                        description={`원금 ${won(o.rec.amount)}${o.paid.map(p => ` · ${mdDot(p.date)} ${won(p.amount)} ${p.type==='converted' ? '투자전환' : p.type==='lent' ? '빌려줌' : '받음'}`).join('')}${o.rec.memo ? ` · ${o.rec.memo}` : ''}`}
                        endContent={<Text weight="bold" color={o.dir>0 ? 'accent' : 'primary'} hasTabularNumbers>남은 돈 {won(o.left)}</Text>}/>
                    ))}
                  </List>
                </VStack>
              )}

              {/* 전체 기록: 최근 것부터, 그때의 잔액과 함께 */}
              <Table data={loanShown} idKey="id" density="compact" columns={[
                { key:'d', header:'날짜', renderCell: r => <Text type="supporting" color="secondary" hasTabularNumbers>{mdDot(r.date)}</Text> },
                { key:'t', header:'구분', renderCell: r => <Badge variant={r.type==='lent' ? 'error' : r.type==='reset' ? 'neutral' : r.type==='converted' ? 'info' : 'success'} label={LOAN_TYPE_LABEL[r.type]||'받음'}/> },
                { key:'m', header:'메모', renderCell: r => <Text type="supporting" color="secondary" maxLines={1}>{r.memo||''}</Text> },
                { key:'a', header:'금액', align:'end', renderCell: r => <Text weight="semibold" hasTabularNumbers>{r.type==='reset' ? `${won(r.before ?? r.amount)} → 0` : `${r.type==='lent'?'+ ':'− '}${won(r.amount)}`}</Text> },
                { key:'b', header:'그때 잔액', align:'end', renderCell: r => <Text color="secondary" hasTabularNumbers>{won(loanFlow.after[r.id])}</Text> },
                { key:'x', header:'', align:'end', renderCell: r => <Button size="sm" variant="ghost" label={r.type==='reset' ? '취소' : '삭제'} onClick={()=>deleteLoanRecord(r.id, r.type==='reset')}/> },
              ]}/>
              {loanHidden > 0 && <Button size="sm" variant="ghost" label={showOldLoans ? '정리 전 기록 접기' : `정리 전 기록 ${loanHidden}건 보기`} onClick={()=>setShowOldLoans(v=>!v)}/>}
              <Divider variant="strong"/>
              <LedgerRow label="남은 대여금" note={loanBalance>0 ? '형이 갚을 돈' : loanBalance<0 ? '내가 갚을 돈' : '없음'} value={loanBalance} strong tone={loanBalance>0 ? 'bad' : undefined}/>
            </>}
          </>}
        </LedgerCard>
      </Grid>

      {/* 지출 입력 */}
      <LedgerCard title="지출 입력" right={
        <TabList value={inputMode} onChange={v=>v && setInputMode(v)}>
          <Tab value="bank" label="계좌내역 엑셀·PDF"/>
          <Tab value="manual" label="직접 입력"/>
        </TabList>}>
        <div id="expense-input" style={{scrollMarginTop:70}}/>
        {inputMode === 'bank' && (
          <Legacy>
            <BankImport categories={categories} onSaved={months=>{
              // 반영한 달로 이동해서 바로 확인할 수 있게
              const last = months?.[months.length-1]
              if(last && last!==curMonth) setCurMonth(last); else load()
              // 대여금 장부도 바뀌었을 수 있으니 다시 불러옴
              getDoc(doc(db,'loans','hyung')).then(s=>setLoanRecords(s.exists() ? (s.data().list||[]) : [])).catch(e=>console.error(e))
            }}/>
          </Legacy>
        )}
        {inputMode === 'manual' && <>
          <Text type="supporting" color="secondary">현금으로 낸 것처럼 통장에 안 찍히는 지출만 여기서 적으세요. 이미 적힌 날을 고치려면 아래 일별 표의 수정을 누르세요.</Text>
          <Legacy><MissedExpenseInput curMonth={curMonth} onSaved={refreshData}/></Legacy>
        </>}
      </LedgerCard>

      {/* 일별 지출 내역: 수정·거래 보기는 그 줄 밑에 펼쳐짐 */}
      <LedgerCard title="일별 지출 내역" right={<Text hasTabularNumbers>합계 <b>{won(grand)}</b>원</Text>}>
        {loading ? <Text color="secondary">불러오는 중...</Text> : (
          <HStack isScrollable>
          <Table data={dayTableRows} idKey="dd" density="compact" plugins={{ expansion: dayExpansion }}
            emptyState={<EmptyState title="입력된 내역이 없어요" isCompact/>}
            columns={[
              { key:'dd', header:'날짜', width:110, renderCell: r => r.dd === '_total' ? <Text textWrap="nowrap" weight="bold">합계</Text> : (
                <VStack gap={0}>
                  <Text textWrap="nowrap" weight="bold" color={r.dow === 0 ? 'accent' : 'primary'}>{+r.dd}일 ({DAYS_KR[r.dow]})</Text>
                  {r.txCount > 0 && <Button size="sm" variant="ghost" label={`거래 ${r.txCount}건 ${openDay===r.dd ? '접기' : '보기'}`} onClick={()=>{ setEditRow(null); setOpenDay(openDay===r.dd?null:r.dd) }}/>}
                </VStack>) },
              { key:'dep', width:112, header:'실입금', align:'end', renderCell: r => <Text textWrap="nowrap" hasTabularNumbers weight={r.dd==='_total' ? 'bold' : undefined}>{r.dep>0 ? won(r.dep) : '—'}</Text> },
              { key:'exp', width:112, header:'지출', align:'end', renderCell: r => <Text textWrap="nowrap" hasTabularNumbers weight="bold">{r.exp>0 ? won(r.exp) : '—'}</Text> },
              { key:'profit', width:112, header:'남은 돈', align:'end', renderCell: r => <Text textWrap="nowrap" hasTabularNumbers color={r.profit<0 ? 'accent' : 'primary'} weight={r.dd==='_total' ? 'bold' : undefined}>{r.dep>0 || r.dd==='_total' ? won(r.profit) : '—'}</Text> },
              ...categories.map(f=>({ key:'c_'+f.id, width:100, header:f.label, align:'end', renderCell: r => <Text textWrap="nowrap" hasTabularNumbers color={r.e[f.id] ? 'primary' : 'secondary'}>{wonCell(r.e[f.id])}</Text> })),
              { key:'act', width:150, header:'', align:'end', renderCell: r => r.dd === '_total' ? null : (
                <HStack gap={0} wrap="nowrap">
                  <Button size="sm" variant={editRow===r.dd ? 'primary' : 'ghost'} label={editRow===r.dd ? '닫기' : '수정'} onClick={()=>editDay(r.dd)}/>
                  <Button size="sm" variant="ghost" label="삭제" onClick={()=>del_row(r.dd)}/>
                </HStack>) },
            ]}/>
          </HStack>
        )}
      </LedgerCard>
    </VStack>
    </AstryxPage>
  )
}
