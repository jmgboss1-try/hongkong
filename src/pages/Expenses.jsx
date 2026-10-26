import { Fragment, useEffect, useState } from 'react'
import BankImport from '../components/BankImport'
import BankReconCard from '../components/BankReconCard'
import BankTxList from '../components/BankTxList'
import { bankSummary } from '../lib/bankRecon'
import { inferLegacyCls } from '../lib/bankReclass'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')
const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
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
const getYestDD = () => { const d=new Date(); d.setDate(d.getDate()-1); return pad(d.getDate()) }
const todayFullStr = () => { const n=new Date(); return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}` }

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
  const [inputMode, setInputMode] = useState('manual')
  const [openDay, setOpenDay] = useState(null) // 지출 내역 표에서 통장 거래를 펼친 날짜


  const days = daysIn(curMonth)
  const monthOpts = []
  for(let y=2022;y<=2026;y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}
  const now = new Date()
  const curYM = `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  const isThisMonth = curMonth === curYM
  const secs = ['재료비','관리비','인건비']
  const secIcons = {'재료비':'','관리비':'','인건비':''}

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

  // ── 직접 입력 저장 ──
  async function save() {
    setSaving(true)
    try {
      const entry = {}
      categories.forEach(f=>{ entry[f.id] = +form[f.id]||0 })
      entry.deposit = +deposit||0
      const newData = { ...data, [day]: entry }
      await setDoc(doc(db,'expenses',curMonth), newData)
      setData(newData); setForm({}); setDeposit('')
      alert('저장됐습니다!')
    } catch(e) { console.error(e) }
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

  // 지출 내역 표의 수정: 그 날짜를 직접 입력 화면에 불러옴
  function editDay(dd) {
    setInputMode('manual'); setDay(dd)
    document.getElementById('expense-input')?.scrollIntoView({ behavior:'smooth', block:'start' })
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

  const unpaidFixed = fixedItems.filter(i=>!fixedPayments[i.id]?.paid)
  const totalFixedAmt = fixedItems.reduce((a,i)=>a+i.amount,0)
  const paidFixedAmt  = fixedItems.filter(i=>fixedPayments[i.id]?.paid).reduce((a,i)=>a+i.amount,0)

  const getDow      = dd => { const[y,m]=curMonth.split('-').map(Number); return DAYS_KR[new Date(y,m-1,+dd).getDay()] }
  const getDowColor = dd => { const[y,m]=curMonth.split('-').map(Number); const dow=new Date(y,m-1,+dd).getDay(); return dow===0?'#B42318':dow===6?'#2B5C9E':'#1D1B18' }
  const inp = id => (
    <input type="number" value={form[id]||''} onChange={e=>setForm(p=>({...p,[id]:e.target.value}))}
      placeholder="0" min="0"
      style={{background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,color:'#1D1B18',
        padding:'8px 10px',fontSize:12,outline:'none',width:'100%'}}/>
  )

  return (
    <div>
      {/* 헤더 */}
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>지출관리</div>
          <div style={{fontSize:12,color:'#6E6A63',marginTop:2}}>{mLabel(curMonth)}</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <button onClick={()=>setShowCatMgr(v=>!v)}
            style={{background:'#F3F1EC',border:'1px solid #DCD7CE',color:'#1D1B18',borderRadius:4,
              padding:'7px 12px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
            카테고리
          </button>
          <div style={{fontSize:18,fontWeight:700,color:'#B42318',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{grand.toLocaleString()}원</div>
          <select value={curMonth} onChange={e=>setCurMonth(e.target.value)}
            style={{background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,color:'#1D1B18',
              padding:'8px 12px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
            {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
          </select>
        </div>
      </div>

      {/* 카테고리 관리 */}
      {showCatMgr && (
        <div style={{background:'#FFFFFF',border:'1px solid #C3261C',borderRadius:6,marginBottom:18,padding:18}}>
          <div style={{fontSize:13,fontWeight:600,color:'#C3261C',marginBottom:14}}>카테고리 관리</div>
          <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:14}}>
            {secs.map(sec=>(
              <div key={sec}>
                <div style={{fontSize:10,color:'#6E6A63',fontWeight:600,marginBottom:6}}>{secIcons[sec]} {sec}</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                  {categories.filter(c=>c.sec===sec).map(cat=>(
                    <div key={cat.id} style={{background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,
                      padding:'6px 10px',display:'flex',alignItems:'center',gap:8}}>
                      {editCatId===cat.id ? (
                        <>
                          <input value={editCatLabel} onChange={e=>setEditCatLabel(e.target.value)}
                            style={{background:'#FFFFFF',border:'1px solid #C3261C',borderRadius:5,color:'#1D1B18',
                              padding:'3px 7px',fontSize:11,outline:'none',width:80}}/>
                          <select value={editCatSec} onChange={e=>setEditCatSec(e.target.value)}
                            style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:5,color:'#1D1B18',padding:'3px',fontSize:10,outline:'none'}}>
                            {secs.map(s=><option key={s} value={s}>{s}</option>)}
                          </select>
                          <button onClick={saveEditCat} style={{background:'#C3261C',color:'#FFFFFF',border:'none',borderRadius:4,padding:'3px 8px',fontSize:10,cursor:'pointer',fontFamily:'inherit'}}>✓</button>
                          <button onClick={()=>setEditCatId(null)} style={{background:'transparent',border:'none',color:'#6E6A63',fontSize:12,cursor:'pointer'}}>✕</button>
                        </>
                      ) : (
                        <>
                          <span style={{fontSize:11,color:'#1D1B18'}}>{cat.label}</span>
                          <button onClick={()=>{setEditCatId(cat.id);setEditCatLabel(cat.label);setEditCatSec(cat.sec)}} style={{background:'transparent',border:'none',color:'#6E6A63',fontSize:11,cursor:'pointer',padding:0}}>수정</button>
                          <button onClick={()=>deleteCategory(cat.id)} style={{background:'transparent',border:'none',color:'#B42318',fontSize:11,cursor:'pointer',padding:0}}>삭제</button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center',paddingTop:12,borderTop:'1px solid #DCD7CE'}}>
            <input value={newCatLabel} onChange={e=>setNewCatLabel(e.target.value)} placeholder="카테고리 이름"
              style={{flex:1,background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,color:'#1D1B18',padding:'7px 10px',fontSize:12,outline:'none',fontFamily:'inherit'}}/>
            <select value={newCatSec} onChange={e=>setNewCatSec(e.target.value)}
              style={{background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,color:'#1D1B18',padding:'7px 10px',fontSize:12,outline:'none',fontFamily:'inherit'}}>
              {secs.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={addCategory} style={{background:'#C3261C',color:'#FFFFFF',border:'none',borderRadius:4,padding:'7px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>+ 추가</button>
          </div>
        </div>
      )}

      {/* 월별 요약 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        {[
          {label:'전월 이월 잔액', val:carryoverAmt,    color:'#2B5C9E'},
          {label:'총 실입금액',   val:totalDeposit,      color:'#2E7D45'},
          {label:'총 지출',       val:grand,             color:'#B42318'},
          {label:'영업 잔액 (이월+입금−지출)', val:currentBalance,    color:currentBalance>=0?'#C3261C':'#B42318'},
        ].map(k=>(
          <div key={k.label} style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,padding:'14px 16px',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:k.color}}/>
            <div style={{fontSize:10,fontWeight:600,color:'#6E6A63',marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:18,fontWeight:700,color:k.color,fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{k.val.toLocaleString()}원</div>
          </div>
        ))}
      </div>

      {/* ── 통장 잔액 맞추기 (영업 잔액 vs 실제 통장) ── */}
      <BankReconCard ym={curMonth} data={data} categories={categories} onChanged={refreshData}/>

      {/* ── 고정지출 체크리스트 ── */}
      <div style={{background:'#FFFFFF',border:`1px solid ${unpaidFixed.length>0?'rgba(180,35,24,0.4)':'rgba(46,125,69,0.3)'}`,borderRadius:6,marginBottom:18,overflow:'hidden'}}>
        {/* 헤더 */}
        <div style={{padding:'14px 18px',borderBottom:'1px solid #DCD7CE',
          display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:13,fontWeight:600}}>이번달 고정지출</span>
            {unpaidFixed.length > 0
              ? <span style={{fontSize:11,fontWeight:700,color:'#B42318',background:'rgba(180,35,24,0.15)',
                  padding:'2px 8px',borderRadius:4}}>미납 {unpaidFixed.length}건</span>
              : fixedItems.length > 0
                ? <span style={{fontSize:11,fontWeight:700,color:'#2E7D45',background:'rgba(46,125,69,0.15)',
                    padding:'2px 8px',borderRadius:4}}>전부 납부완료</span>
                : null
            }
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            {fixedItems.length > 0 && (
              <span style={{fontSize:11,color:'#6E6A63',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>
                {paidFixedAmt.toLocaleString()} / {totalFixedAmt.toLocaleString()}원
              </span>
            )}
            <button onClick={()=>setShowFixedMgr(v=>!v)}
              style={{background:'#F3F1EC',border:'1px solid #DCD7CE',color:'#1D1B18',borderRadius:4,
                padding:'5px 10px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
              {showFixedMgr ? '▲ 접기' : '항목 관리'}
            </button>
          </div>
        </div>

        {/* 항목 관리 패널 */}
        {showFixedMgr && (
          <div style={{padding:'14px 18px',borderBottom:'1px solid #DCD7CE',background:'rgba(195,38,28,0.04)'}}>
            <div style={{fontSize:11,fontWeight:600,color:'#C3261C',marginBottom:12}}>고정지출 항목 설정</div>
            {/* 기존 항목 목록 */}
            {fixedItems.length > 0 && (
              <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12}}>
                {fixedItems.map(item=>(
                  <div key={item.id} style={{background:'#F3F1EC',borderRadius:4,padding:'8px 12px',
                    display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                    {editFixedId===item.id ? (
                      <>
                        <input value={editFixed.label||''} onChange={e=>setEditFixed(f=>({...f,label:e.target.value}))}
                          placeholder="항목명" style={{background:'#FFFFFF',border:'1px solid #C3261C',borderRadius:5,
                            color:'#1D1B18',padding:'4px 8px',fontSize:11,outline:'none',width:100,fontFamily:'inherit'}}/>
                        <input type="number" value={editFixed.dueDay||''} onChange={e=>setEditFixed(f=>({...f,dueDay:e.target.value}))}
                          placeholder="예정일" style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:5,
                            color:'#1D1B18',padding:'4px 8px',fontSize:11,outline:'none',width:60,fontFamily:'inherit'}}/>
                        <input type="number" value={editFixed.amount||''} onChange={e=>setEditFixed(f=>({...f,amount:e.target.value}))}
                          placeholder="금액" style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:5,
                            color:'#1D1B18',padding:'4px 8px',fontSize:11,outline:'none',width:90,fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}/>
                        <select value={editFixed.categoryId||''} onChange={e=>setEditFixed(f=>({...f,categoryId:e.target.value}))}
                          style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:5,color:'#1D1B18',
                            padding:'4px 8px',fontSize:11,outline:'none',fontFamily:'inherit'}}>
                          {categories.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                        <button onClick={saveEditFixed} style={{background:'#C3261C',color:'#FFFFFF',border:'none',borderRadius:5,padding:'4px 10px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>저장</button>
                        <button onClick={()=>setEditFixedId(null)} style={{background:'transparent',border:'none',color:'#6E6A63',fontSize:12,cursor:'pointer'}}>✕</button>
                      </>
                    ) : (
                      <>
                        <span style={{fontSize:12,fontWeight:600,color:'#1D1B18',flex:1}}>{item.label}</span>
                        <span style={{fontSize:11,color:'#6E6A63'}}>매월 {item.dueDay}일</span>
                        <span style={{fontSize:12,color:'#B42318',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',fontWeight:700}}>
                          {item.amount.toLocaleString()}원
                        </span>
                        <span style={{fontSize:10,color:'#6E6A63'}}>
                          {categories.find(c=>c.id===item.categoryId)?.label||'—'}
                        </span>
                        <button onClick={()=>{setEditFixedId(item.id);setEditFixed({...item})}}
                          style={{background:'transparent',border:'none',color:'#6E6A63',fontSize:11,cursor:'pointer',padding:0}}>수정</button>
                        <button onClick={()=>deleteFixedItem(item.id)}
                          style={{background:'transparent',border:'none',color:'#B42318',fontSize:11,cursor:'pointer',padding:0}}>삭제</button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            {/* 새 항목 추가 */}
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',paddingTop:10,borderTop:'1px solid #DCD7CE'}}>
              <input value={newFixed.label} onChange={e=>setNewFixed(f=>({...f,label:e.target.value}))}
                placeholder="항목명 (예: 임대료)"
                style={{flex:1,minWidth:100,background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,
                  color:'#1D1B18',padding:'7px 10px',fontSize:12,outline:'none',fontFamily:'inherit'}}/>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <span style={{fontSize:11,color:'#6E6A63',whiteSpace:'nowrap'}}>매월</span>
                <input type="number" value={newFixed.dueDay} onChange={e=>setNewFixed(f=>({...f,dueDay:e.target.value}))}
                  placeholder="1" min="1" max="31"
                  style={{width:50,background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,
                    color:'#1D1B18',padding:'7px 8px',fontSize:12,outline:'none',fontFamily:'inherit'}}/>
                <span style={{fontSize:11,color:'#6E6A63'}}>일</span>
              </div>
              <input type="number" value={newFixed.amount} onChange={e=>setNewFixed(f=>({...f,amount:e.target.value}))}
                placeholder="금액"
                style={{width:100,background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,
                  color:'#1D1B18',padding:'7px 10px',fontSize:12,outline:'none',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}/>
              <select value={newFixed.categoryId} onChange={e=>setNewFixed(f=>({...f,categoryId:e.target.value}))}
                style={{background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,color:'#1D1B18',
                  padding:'7px 10px',fontSize:12,outline:'none',fontFamily:'inherit'}}>
                <option value="">카테고리</option>
                {categories.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <button onClick={addFixedItem}
                style={{background:'#C3261C',color:'#FFFFFF',border:'none',borderRadius:4,padding:'7px 14px',
                  fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>
                + 추가
              </button>
            </div>
          </div>
        )}

        {/* 체크리스트 */}
        {fixedItems.length === 0 ? (
          <div style={{padding:'20px',textAlign:'center',color:'#6E6A63',fontSize:12}}>
            항목 관리에서 고정지출 항목을 추가하세요
          </div>
        ) : (
          <div style={{padding:'8px 0'}}>
            {fixedItems.map(item=>{
              const payment = fixedPayments[item.id]
              const isPaid = payment?.paid
              const cat = categories.find(c=>c.id===item.categoryId)
              return (
                <div key={item.id} style={{
                  display:'flex',alignItems:'center',gap:12,padding:'10px 18px',
                  borderBottom:'1px solid #F3F1EC',
                  background: isPaid ? 'rgba(46,125,69,0.04)' : 'transparent'
                }}>
                  {/* 상태 아이콘 */}
                  <div style={{fontSize:18,flexShrink:0}}>
                    {isPaid ? '납부' : '대기'}
                  </div>
                  {/* 항목 정보 */}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,
                      color:isPaid?'#6E6A63':'#1D1B18',
                      textDecoration:isPaid?'line-through':'none'}}>
                      {item.label}
                    </div>
                    <div style={{fontSize:10,color:'#6E6A63',marginTop:2}}>
                      매월 {item.dueDay}일 예정 · {cat?.label||'미분류'}
                      {isPaid && <span style={{color:'#2E7D45',marginLeft:6}}>→ {+payment.paidDate}일 납부완료</span>}
                    </div>
                  </div>
                  {/* 금액 */}
                  <div style={{fontSize:13,fontWeight:700,
                    color:isPaid?'#6E6A63':'#B42318',
                    fontFamily:'inherit',fontVariantNumeric:'tabular-nums',flexShrink:0,
                    textDecoration:isPaid?'line-through':'none'}}>
                    {item.amount.toLocaleString()}원
                  </div>
                  {/* 납부 버튼 */}
                  {isThisMonth && (
  isPaid ? (
    <button onClick={()=>unpayFixed(item.id)}
      style={{background:'transparent',border:'1px solid #DCD7CE',color:'#6E6A63',
        borderRadius:6,padding:'5px 10px',fontSize:10,cursor:'pointer',
        fontFamily:'inherit',flexShrink:0,whiteSpace:'nowrap'}}>
      취소
    </button>
  ) : payingItemId === item.id ? (
    <div style={{display:'flex',alignItems:'center',gap:6,flexShrink:0}}>
      <input type="date" value={payingDate} onChange={e=>setPayingDate(e.target.value)}
        style={{background:'#F3F1EC',border:'1px solid #2E7D45',borderRadius:6,
          color:'#1D1B18',padding:'4px 8px',fontSize:11,outline:'none',fontFamily:'inherit'}}/>
      <button onClick={async()=>{ await payFixed(item, payingDate); setPayingItemId(null); setPayingDate('') }}
        style={{background:'#2E7D45',color:'#FFFFFF',border:'none',borderRadius:6,
          padding:'5px 10px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
        확인
      </button>
      <button onClick={()=>{ setPayingItemId(null); setPayingDate('') }}
        style={{background:'transparent',border:'none',color:'#6E6A63',fontSize:12,cursor:'pointer'}}>
          ✕
        </button>
    </div>
  ) : (
    <button onClick={()=>{ setPayingItemId(item.id); setPayingDate(`${curMonth}-${getNowDD()}`); }}
      style={{background:'#2E7D45',color:'#FFFFFF',border:'none',
        borderRadius:6,padding:'5px 12px',fontSize:11,fontWeight:700,
        cursor:'pointer',fontFamily:'inherit',flexShrink:0,whiteSpace:'nowrap'}}>
      납부 </button>
  )
)}
                </div>
              )
            })}
            {/* 고정지출 합계 */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',
              padding:'10px 18px',background:'rgba(0,0,0,0.02)'}}>
              <span style={{fontSize:11,color:'#6E6A63'}}>고정지출 합계</span>
              <span style={{fontSize:13,fontWeight:700,color:'#B42318',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>
                {paidFixedAmt.toLocaleString()}원 납부 / {totalFixedAmt.toLocaleString()}원
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── 형과의 단기 대여금 ── */}
      <div style={{background:'#FFFFFF',border:'1px solid rgba(43,92,158,0.3)',borderRadius:6,marginBottom:18,overflow:'hidden'}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #DCD7CE',
          display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
          <div>
            <span style={{fontSize:13,fontWeight:600}}>형과의 단기 대여금</span>
            <span style={{fontSize:11,color:'#6E6A63',marginLeft:10}}>
              {loanBalance>0 ? `형이 ${loanBalance.toLocaleString()}원 빚진 상태` :
               loanBalance<0 ? `내가 ${Math.abs(loanBalance).toLocaleString()}원 빚진 상태` : '잔액 없음'}
            </span>
          </div>
          <div style={{display:'flex',gap:8}}>
            {loanBalance > 0 && (
              <button onClick={()=>{ setShowConvert(v=>!v); setConvertAmount(String(loanBalance)) }}
                style={{background:'rgba(195,38,28,0.12)',border:'1px solid rgba(195,38,28,0.3)',color:'#C3261C',
                  borderRadius:4,padding:'6px 12px',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>
                투자금 회수로 전환
              </button>
            )}
            <button onClick={()=>setShowLoanMgr(v=>!v)}
              style={{background:'#F3F1EC',border:'1px solid #DCD7CE',color:'#1D1B18',borderRadius:4,
                padding:'6px 10px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
              {showLoanMgr ? '▲ 접기' : '+ 기록 추가'}
            </button>
          </div>
        </div>

        {/* 전환 폼 */}
        {showConvert && (
          <div style={{padding:'14px 18px',borderBottom:'1px solid #DCD7CE',background:'rgba(195,38,28,0.04)'}}>
            <div style={{fontSize:11,fontWeight:600,color:'#C3261C',marginBottom:10}}>
              잔액 중 일부(또는 전체)를 투자금 회수로 전환
            </div>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              <input type="number" value={convertAmount} onChange={e=>setConvertAmount(e.target.value)}
                placeholder="전환할 금액" max={loanBalance}
                style={{width:160,background:'#F3F1EC',border:'1px solid rgba(195,38,28,0.3)',borderRadius:4,
                  color:'#C3261C',padding:'8px 10px',fontSize:13,outline:'none',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',fontWeight:700}}/>
              <span style={{fontSize:11,color:'#6E6A63'}}>/ 잔액 {loanBalance.toLocaleString()}원</span>
              <button onClick={convertToInvestment} disabled={saving}
                style={{background:'#C3261C',color:'#FFFFFF',border:'none',borderRadius:4,padding:'8px 16px',
                  fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                {saving?'처리 중...':'전환 확정'}
              </button>
              <button onClick={()=>setShowConvert(false)}
                style={{background:'transparent',border:'1px solid #DCD7CE',color:'#6E6A63',borderRadius:4,
                  padding:'8px 14px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
                취소
              </button>
            </div>
            <div style={{fontSize:10,color:'#6E6A63',marginTop:8}}>
              전환하면 대여금 잔액이 줄고, 투자관리 탭의 형 "대출금 상환 회수"에 자동 기록돼요.
            </div>
          </div>
        )}

        {/* 기록 추가 폼 */}
        {showLoanMgr && (
          <div style={{padding:'14px 18px',borderBottom:'1px solid #DCD7CE',background:'rgba(43,92,158,0.04)'}}>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              <input type="date" value={loanForm.date} onChange={e=>setLoanForm(f=>({...f,date:e.target.value}))}
                style={{background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,color:'#1D1B18',
                  padding:'7px 10px',fontSize:12,outline:'none',fontFamily:'inherit'}}/>
              <div style={{display:'flex',gap:4}}>
                {[['lent','빌려줌'],['received','받음']].map(([k,l])=>(
                  <button key={k} onClick={()=>setLoanForm(f=>({...f,type:k}))}
                    style={{padding:'7px 12px',borderRadius:6,border:'none',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                      background:loanForm.type===k?(k==='lent'?'#B42318':'#2E7D45'):'#F3F1EC',
                      color:loanForm.type===k?'#FFFFFF':'#6E6A63'}}>
                    {l}
                  </button>
                ))}
              </div>
              <input type="number" value={loanForm.amount} onChange={e=>setLoanForm(f=>({...f,amount:e.target.value}))}
                placeholder="금액"
                style={{width:120,background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,color:'#1D1B18',
                  padding:'7px 10px',fontSize:12,outline:'none',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}/>
              <input value={loanForm.memo} onChange={e=>setLoanForm(f=>({...f,memo:e.target.value}))}
                placeholder="메모 (선택)"
                style={{flex:1,minWidth:100,background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,color:'#1D1B18',
                  padding:'7px 10px',fontSize:12,outline:'none',fontFamily:'inherit'}}/>
              <button onClick={addLoanRecord}
                style={{background:'#2B5C9E',color:'#FFFFFF',border:'none',borderRadius:4,padding:'7px 16px',
                  fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>
                + 추가
              </button>
            </div>
          </div>
        )}

        {/* 내역 */}
        {loanRecords.length === 0 ? (
          <div style={{padding:'20px',textAlign:'center',color:'#6E6A63',fontSize:12}}>
            + 기록 추가에서 대여/상환 내역을 입력하세요
          </div>
        ) : (
          <div style={{padding:'8px 0'}}>
            {[...loanRecords].sort((a,b)=>b.date.localeCompare(a.date)).map(r=>(
              <div key={r.id} style={{display:'flex',alignItems:'center',gap:12,padding:'9px 18px',
                borderBottom:'1px solid #ECE8E1',flexWrap:'wrap'}}>
                <div style={{fontSize:11,color:'#6E6A63',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',minWidth:75}}>{r.date}</div>
                <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:4,
                  background: r.type==='lent'?'rgba(180,35,24,0.15)':r.type==='converted'?'rgba(195,38,28,0.15)':'rgba(46,125,69,0.15)',
                  color: r.type==='lent'?'#B42318':r.type==='converted'?'#C3261C':'#2E7D45'}}>
                  {r.type==='lent'?'빌려줌':r.type==='converted'?'투자전환':'받음'}
                </span>
                <span style={{flex:1,fontSize:11,color:'#6E6A63'}}>{r.memo||'—'}</span>
                <span style={{fontSize:13,fontWeight:700,fontFamily:'inherit',fontVariantNumeric:'tabular-nums',
                  color:r.type==='lent'?'#B42318':r.type==='converted'?'#C3261C':'#2E7D45'}}>
                  {r.type==='lent'?'+':'-'}{r.amount.toLocaleString()}원
                </span>
                <button onClick={()=>deleteLoanRecord(r.id)}
                  style={{background:'transparent',border:'1px solid #E8C4BF',color:'#B42318',
                    padding:'3px 8px',fontSize:10,borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>
                  삭제
                </button>
              </div>
            ))}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',
              padding:'10px 18px',background:'rgba(0,0,0,0.02)'}}>
              <span style={{fontSize:11,color:'#6E6A63'}}>현재 잔액</span>
              <span style={{fontSize:13,fontWeight:700,fontFamily:'inherit',fontVariantNumeric:'tabular-nums',
                color:loanBalance>0?'#B42318':loanBalance<0?'#2E7D45':'#6E6A63'}}>
                {loanBalance.toLocaleString()}원
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 입력 영역 */}
      <div id="expense-input" style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,marginBottom:18,scrollMarginTop:70}}>
        <div style={{display:'flex',borderBottom:'1px solid #DCD7CE'}}>
          {[['bank','계좌내역 엑셀'],['manual','직접 입력']].map(([mode,label])=>(
            <button key={mode} onClick={()=>setInputMode(mode)}
              style={{flex:1,padding:'12px',fontSize:12,fontWeight:600,border:'none',cursor:'pointer',
                fontFamily:'inherit',borderRadius:mode==='bank'?'12px 0 0 0':'0 12px 0 0',
                background:inputMode===mode?'rgba(195,38,28,0.1)':'transparent',
                color:inputMode===mode?'#C3261C':'#6E6A63',
                borderBottom:inputMode===mode?'2px solid #C3261C':'2px solid transparent'}}>
              {label}
            </button>
          ))}
        </div>

        {/* 계좌내역 엑셀 */}
        {inputMode === 'bank' && (
          <BankImport categories={categories} onSaved={months=>{
            // 반영한 달로 이동해서 바로 확인할 수 있게
            const last = months?.[months.length-1]
            if(last && last!==curMonth) setCurMonth(last); else load()
            // 대여금 장부도 바뀌었을 수 있으니 다시 불러옴
            getDoc(doc(db,'loans','hyung')).then(s=>setLoanRecords(s.exists() ? (s.data().list||[]) : [])).catch(e=>console.error(e))
          }}/>
        )}

        {/* 직접 입력 */}
        {inputMode === 'manual' && (
          <div style={{padding:18}}>
            <div style={{background:'rgba(43,92,158,0.08)',border:'1px solid rgba(43,92,158,0.2)',
              borderRadius:6,padding:'14px 16px',marginBottom:16}}>
              <label style={{fontSize:11,fontWeight:700,color:'#2B5C9E',display:'block',marginBottom:8}}>전월 이월 잔액</label>
              <div style={{display:'flex',gap:10,alignItems:'center'}}>
                <input type="number" value={carryover} onChange={e=>setCarryover(e.target.value)}
                  placeholder="전달에서 이월된 계좌 잔액"
                  style={{flex:1,background:'#F3F1EC',border:'1px solid rgba(43,92,158,0.3)',borderRadius:4,
                    color:'#2B5C9E',padding:'10px 12px',fontSize:14,outline:'none',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',fontWeight:700}}/>
                <button onClick={saveCarryover}
                  style={{background:'#2B5C9E',color:'#FFFFFF',border:'none',borderRadius:4,
                    padding:'10px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>
                  저장
                </button>
              </div>
              <div style={{fontSize:10,color:'#6E6A63',marginTop:6,display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                {data.carryoverSource==='bank' ? '이 달 통장 거래내역(PDF)의 시작 잔액으로 자동 입력됐어요'
                  : data.carryoverSource==='bank-prev' ? '지난달 통장 거래내역(PDF)의 말일 잔액으로 자동 입력됐어요'
                  : data.carryoverSource==='manual' ? '직접 입력한 값이에요 (PDF를 올려도 바뀌지 않아요)'
                  : 'PDF를 올리면 통장 잔액으로 자동 입력돼요'}
                {data.carryoverSource==='manual' && (
                  <button onClick={resetCarryoverAuto}
                    style={{background:'transparent',border:'1px solid rgba(43,92,158,0.3)',color:'#2B5C9E',borderRadius:5,
                      padding:'2px 8px',fontSize:10,cursor:'pointer',fontFamily:'inherit'}}>통장 잔액 기준으로 되돌리기</button>
                )}
              </div>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{fontSize:10,color:'#6E6A63',fontWeight:600,display:'block',marginBottom:8}}>날짜</label>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                {isThisMonth && (
                  <>
                    <button onClick={()=>setDay(getNowDD())}
                      style={{padding:'7px 14px',borderRadius:4,border:'none',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                        background:day===getNowDD()?'#C3261C':'#F3F1EC',color:day===getNowDD()?'#FFFFFF':'#6E6A63'}}>
                      오늘 ({+getNowDD()}일)
                    </button>
                    <button onClick={()=>setDay(getYestDD())}
                      style={{padding:'7px 14px',borderRadius:4,border:'none',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                        background:day===getYestDD()?'#C3261C':'#F3F1EC',color:day===getYestDD()?'#FFFFFF':'#6E6A63'}}>
                      어제 ({+getYestDD()}일)
                    </button>
                  </>
                )}
                <select value={day} onChange={e=>setDay(e.target.value)}
                  style={{background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,color:'#1D1B18',
                    padding:'7px 10px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
                  {Array.from({length:days},(_,i)=><option key={i} value={pad(i+1)}>{i+1}일 ({getDow(pad(i+1))})</option>)}
                </select>
              </div>
            </div>
            <div style={{background:'rgba(46,125,69,0.08)',border:'1px solid rgba(46,125,69,0.2)',
              borderRadius:6,padding:'14px 16px',marginBottom:16}}>
              <label style={{fontSize:11,fontWeight:700,color:'#2E7D45',display:'block',marginBottom:8}}>실입금액</label>
              <input type="number" value={deposit} onChange={e=>setDeposit(e.target.value)}
                placeholder="수수료 제외 실제 입금된 금액"
                style={{background:'#F3F1EC',border:'1px solid rgba(46,125,69,0.3)',borderRadius:4,color:'#2E7D45',
                  padding:'10px 12px',fontSize:14,outline:'none',width:'100%',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',fontWeight:700}}/>
            </div>
            {secs.map(sec=>{
              const secCats = categories.filter(f=>f.sec===sec)
              if(!secCats.length) return null
              return (
                <div key={sec}>
                  <div style={{fontSize:10,fontWeight:600,color:'#6E6A63',textTransform:'uppercase',letterSpacing:.8,
                    margin:'14px 0 8px',paddingBottom:6,borderBottom:'1px solid #DCD7CE'}}>
                    {secIcons[sec]} {sec}
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:10}}>
                    {secCats.map(f=>(
                      <div key={f.id} style={{display:'flex',flexDirection:'column',gap:4}}>
                        <label style={{fontSize:10,color:'#6E6A63',fontWeight:600}}>{f.label}</label>
                        {inp(f.id)}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
            {(+deposit>0 || categories.some(f=>+form[f.id]>0)) && (
              <div style={{marginTop:16,background:'#F3F1EC',borderRadius:6,padding:'12px 14px',display:'flex',flexDirection:'column',gap:6}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}>
                  <span style={{color:'#6E6A63'}}>당일 지출 합계</span>
                  <span style={{color:'#B42318',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',fontWeight:700}}>
                    -{categories.reduce((a,f)=>a+(+form[f.id]||0),0).toLocaleString()}원
                  </span>
                </div>
                {+deposit>0 && (
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}>
                    <span style={{color:'#6E6A63'}}>당일 실입금</span>
                    <span style={{color:'#2E7D45',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',fontWeight:700}}>
                      +{(+deposit).toLocaleString()}원
                    </span>
                  </div>
                )}
              </div>
            )}
            <div style={{marginTop:14}}>
              <button onClick={save} disabled={saving}
                style={{background:'#C3261C',color:'#FFFFFF',border:'none',borderRadius:4,padding:'9px 20px',
                  fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                {saving?'저장 중...':'저 장'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 내역 테이블 */}
      <div style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,overflow:'hidden'}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #DCD7CE',fontSize:13,fontWeight:600,
          display:'flex',justifyContent:'space-between'}}>
          <span>{mLabel(curMonth)} 지출 내역</span>
          <span style={{color:'#B42318',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{grand.toLocaleString()}원</span>
        </div>
        {loading ? <div style={{textAlign:'center',color:'#6E6A63',padding:40}}>로딩 중...</div> : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead>
                <tr style={{background:'#F3F1EC'}}>
                  {['날짜','실입금','지출합계','실수익',...categories.map(f=>f.label),''].map(h=>(
                    <th key={h} style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#6E6A63',
                      textAlign:h==='날짜'?'left':'right',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.keys(data).filter(dd=>/^\d{2}$/.test(dd)).sort().map(dd=>{
                  const e = data[dd]
                  if(typeof e !== 'object' || !e) return null
                  const expSum = categories.reduce((a,f)=>a+(e[f.id]||0),0)
                  const dep = e.deposit||0
                  const profit = dep - expSum
                  if(!expSum && !dep) return null
                  const txCount = (data.bankSeen||[]).filter(k=>k.startsWith(`${curMonth}-${dd}|`)).length
                  return (
                    <Fragment key={dd}>
                    <tr>
                      <td style={{padding:'8px 10px',borderBottom:'1px solid #DCD7CE',color:getDowColor(dd),fontWeight:600,whiteSpace:'nowrap'}}>
                        {+dd}일 ({getDow(dd)})
                        {txCount>0 && (
                          <button onClick={()=>setOpenDay(openDay===dd?null:dd)}
                            style={{marginLeft:6,background:openDay===dd?'rgba(43,92,158,0.15)':'transparent',border:'1px solid rgba(43,92,158,0.3)',
                              color:'#2B5C9E',borderRadius:4,padding:'1px 6px',fontSize:10,cursor:'pointer',fontFamily:'inherit',fontWeight:500}}>
                            {openDay===dd?'▾':'▸'} 거래 {txCount}건
                          </button>
                        )}
                      </td>
                      <td style={{padding:'8px 10px',borderBottom:'1px solid #DCD7CE',textAlign:'right',color:'#2E7D45',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',fontWeight:700}}>
                        {dep>0?dep.toLocaleString():'—'}
                      </td>
                      <td style={{padding:'8px 10px',borderBottom:'1px solid #DCD7CE',textAlign:'right',color:'#B42318',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',fontWeight:700}}>
                        {expSum>0?expSum.toLocaleString():'—'}
                      </td>
                      <td style={{padding:'8px 10px',borderBottom:'1px solid #DCD7CE',textAlign:'right',color:profit>=0?'#C3261C':'#B42318',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',fontWeight:700}}>
                        {dep>0?profit.toLocaleString():'—'}
                      </td>
                      {categories.map(f=>(
                        <td key={f.id} style={{padding:'8px 10px',borderBottom:'1px solid #DCD7CE',textAlign:'right',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',color:'#1D1B18'}}>
                          {wonCell(e[f.id])}
                        </td>
                      ))}
                      <td style={{padding:'8px 10px',borderBottom:'1px solid #DCD7CE',textAlign:'right'}}>
                        <button onClick={()=>editDay(dd)}
                          style={{background:'transparent',border:'1px solid #DCD7CE',color:'#1D1B18',marginRight:4,
                            padding:'3px 8px',fontSize:10,borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>
                          수정
                        </button>
                        <button onClick={()=>del_row(dd)}
                          style={{background:'transparent',border:'1px solid #E8C4BF',color:'#B42318',
                            padding:'3px 8px',fontSize:10,borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>
                          삭제
                        </button>
                      </td>
                    </tr>
                    {openDay===dd && (
                      <tr>
                        <td colSpan={5+categories.length} style={{padding:'8px 10px 12px',borderBottom:'1px solid #DCD7CE',background:'rgba(43,92,158,0.03)'}}>
                          <BankTxList ym={curMonth} data={data} categories={categories} day={dd} onChanged={refreshData}/>
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  )
                })}
                {Object.keys(data).filter(dd=>/^\d{2}$/.test(dd)).length===0 && (
                  <tr><td colSpan={categories.length+5} style={{padding:28,textAlign:'center',color:'#6E6A63'}}>입력된 데이터가 없습니다</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr style={{background:'#ECE8E1'}}>
                  <td style={{padding:'10px',fontWeight:700,color:'#C3261C'}}>합 계</td>
                  <td style={{padding:'10px',textAlign:'right',fontWeight:700,color:'#2E7D45',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{totalDeposit.toLocaleString()}</td>
                  <td style={{padding:'10px',textAlign:'right',fontWeight:700,color:'#B42318',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{grand.toLocaleString()}</td>
                  <td style={{padding:'10px',textAlign:'right',fontWeight:700,color:realProfit>=0?'#C3261C':'#B42318',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{realProfit.toLocaleString()}</td>
                  {categories.map(f=>(
                    <td key={f.id} style={{padding:'10px',textAlign:'right',fontWeight:700,color:'#C3261C',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{wonCell(tot[f.id])}</td>
                  ))}
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
