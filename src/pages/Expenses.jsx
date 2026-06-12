import { useEffect, useState, useRef } from 'react'
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

async function extractFromImage(base64, mediaType) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
          { type: 'text', text: `이 이미지는 국민은행 또는 다른 은행의 계좌 거래내역입니다.
출금 거래내역만 추출해서 아래 JSON 형식으로만 응답하세요. 다른 텍스트는 절대 포함하지 마세요.
{"transactions":[{"date":"MM-DD","description":"적요/내용","amount":숫자}]}
주의: 입금 제외, 출금만, amount는 숫자만, 없으면 {"transactions":[]}` }
        ]
      }]
    })
  })
  const data = await response.json()
  const text = data.content?.[0]?.text || ''
  try { return JSON.parse(text.replace(/```json|```/g,'').trim()) }
  catch { return { transactions: [] } }
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
  const [newFixed, setNewFixed]           = useState({label:'',dueDay:'',amount:'',categoryId:''})
  const [editFixedId, setEditFixedId]     = useState(null)
  const [editFixed, setEditFixed]         = useState({})

  // 입력 모드
  const [inputMode, setInputMode] = useState('manual')

  // 이미지
  const fileRef = useRef()
  const [imageFile, setImageFile]       = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [extracting, setExtracting]     = useState(false)
  const [extracted, setExtracted]       = useState([])

  const days = daysIn(curMonth)
  const monthOpts = []
  for(let y=2022;y<=2026;y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}
  const now = new Date()
  const curYM = `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  const isThisMonth = curMonth === curYM
  const secs = ['재료비','관리비','인건비']
  const secIcons = {'재료비':'📦','관리비':'🏢','인건비':'💼'}

  async function load() {
    setLoading(true)
    try {
      const [expSnap, catSnap, fixedCfgSnap, fixedPaySnap] = await Promise.all([
        getDoc(doc(db,'expenses',curMonth)),
        getDoc(doc(db,'expenseCategories','default')),
        getDoc(doc(db,'fixedExpenses','config')),
        getDoc(doc(db,'fixedExpenses',curMonth)),
      ])
      if(expSnap.exists()) { setData(expSnap.data()); setCarryover(expSnap.data().carryover||'') }
      else { setData({}); setCarryover('') }
      if(catSnap.exists()) setCategories(catSnap.data().list || DEFAULT_CATEGORIES)
      if(fixedCfgSnap.exists()) setFixedItems(fixedCfgSnap.data().list || [])
      if(fixedPaySnap.exists()) setFixedPayments(fixedPaySnap.data() || {})
      else setFixedPayments({})
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(()=>{ load() },[curMonth])

  useEffect(()=>{
    const existing = data[day]
    if(existing) {
      const newForm = {}
      categories.forEach(f=>{ newForm[f.id] = existing[f.id]||'' })
      setForm(newForm); setDeposit(existing.deposit||'')
    } else { setForm({}); setDeposit('') }
  },[day, data, categories])

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
  async function payFixed(item) {
    const todayDD = getNowDD()
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
    const newPayments = { ...fixedPayments }
    delete newPayments[itemId]
    await setDoc(doc(db,'fixedExpenses',curMonth), newPayments)
    setFixedPayments(newPayments)
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
      const newData = { ...data, carryover: +carryover||0 }
      await setDoc(doc(db,'expenses',curMonth), newData)
      setData(newData)
      alert('이월 잔액이 저장됐습니다!')
    } catch(e) { console.error(e) }
  }

  async function del_row(dd) {
    if(!window.confirm(`${+dd}일 지출 내역을 삭제하시겠습니까?`)) return
    const newData = { ...data }
    delete newData[dd]
    await setDoc(doc(db,'expenses',curMonth), newData)
    setData(newData)
  }

  // ── 이미지 ──
  function handleImageChange(e) {
    const file = e.target.files[0]
    if(!file) return
    setImageFile(file)
    const reader = new FileReader()
    reader.onload = ev => setImagePreview(ev.target.result)
    reader.readAsDataURL(file)
    setExtracted([])
  }

  async function handleExtract() {
    if(!imageFile) return
    setExtracting(true)
    try {
      const base64 = await new Promise((res,rej)=>{
        const r = new FileReader()
        r.onload = ()=>res(r.result.split(',')[1])
        r.onerror = rej
        r.readAsDataURL(imageFile)
      })
      const result = await extractFromImage(base64, imageFile.type)
      setExtracted((result.transactions||[]).map(t=>({...t, category:categories[0]?.id||'', checked:true})))
    } catch(e) { console.error(e); alert('이미지 분석 중 오류가 발생했습니다.') }
    setExtracting(false)
  }

  async function saveExtracted() {
    const checked = extracted.filter(t=>t.checked && t.amount > 0)
    if(!checked.length) return alert('저장할 항목을 선택해주세요')
    setSaving(true)
    try {
      const newData = { ...data }
      for(const t of checked) {
        const dd = t.date ? pad(+t.date.split('-')[1]) : day
        const existing = newData[dd] || {}
        const entry = { ...existing }
        categories.forEach(f=>{ if(!entry[f.id]) entry[f.id]=0 })
        if(t.category && entry[t.category] !== undefined) entry[t.category] = (entry[t.category]||0)+t.amount
        else entry['omg'] = (entry['omg']||0)+t.amount
        newData[dd] = entry
      }
      await setDoc(doc(db,'expenses',curMonth), newData)
      setData(newData)
      setExtracted([]); setImageFile(null); setImagePreview(null)
      if(fileRef.current) fileRef.current.value = ''
      alert(`${checked.length}건 저장됐습니다!`)
    } catch(e) { console.error(e) }
    setSaving(false)
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

  const unpaidFixed = fixedItems.filter(i=>!fixedPayments[i.id]?.paid)
  const totalFixedAmt = fixedItems.reduce((a,i)=>a+i.amount,0)
  const paidFixedAmt  = fixedItems.filter(i=>fixedPayments[i.id]?.paid).reduce((a,i)=>a+i.amount,0)

  const getDow      = dd => { const[y,m]=curMonth.split('-').map(Number); return DAYS_KR[new Date(y,m-1,+dd).getDay()] }
  const getDowColor = dd => { const[y,m]=curMonth.split('-').map(Number); const dow=new Date(y,m-1,+dd).getDay(); return dow===0?'#f87171':dow===6?'#93c5fd':'#dde1f2' }
  const inp = id => (
    <input type="number" value={form[id]||''} onChange={e=>setForm(p=>({...p,[id]:e.target.value}))}
      placeholder="0" min="0"
      style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
        padding:'8px 10px',fontSize:12,outline:'none',width:'100%'}}/>
  )

  return (
    <div>
      {/* 헤더 */}
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>📋 지출관리</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>{mLabel(curMonth)}</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <button onClick={()=>setShowCatMgr(v=>!v)}
            style={{background:'#191c2b',border:'1px solid #272a3d',color:'#dde1f2',borderRadius:8,
              padding:'7px 12px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
            ⚙️ 카테고리
          </button>
          <div style={{fontSize:18,fontWeight:700,color:'#f87171',fontFamily:'DM Mono, monospace'}}>{grand.toLocaleString()}원</div>
          <select value={curMonth} onChange={e=>setCurMonth(e.target.value)}
            style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,color:'#dde1f2',
              padding:'8px 12px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
            {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
          </select>
        </div>
      </div>

      {/* 카테고리 관리 */}
      {showCatMgr && (
        <div style={{background:'#12141f',border:'1px solid #f9b934',borderRadius:12,marginBottom:18,padding:18}}>
          <div style={{fontSize:13,fontWeight:600,color:'#f9b934',marginBottom:14}}>⚙️ 카테고리 관리</div>
          <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:14}}>
            {secs.map(sec=>(
              <div key={sec}>
                <div style={{fontSize:10,color:'#5e6585',fontWeight:600,marginBottom:6}}>{secIcons[sec]} {sec}</div>
                <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                  {categories.filter(c=>c.sec===sec).map(cat=>(
                    <div key={cat.id} style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,
                      padding:'6px 10px',display:'flex',alignItems:'center',gap:8}}>
                      {editCatId===cat.id ? (
                        <>
                          <input value={editCatLabel} onChange={e=>setEditCatLabel(e.target.value)}
                            style={{background:'#12141f',border:'1px solid #f9b934',borderRadius:5,color:'#dde1f2',
                              padding:'3px 7px',fontSize:11,outline:'none',width:80}}/>
                          <select value={editCatSec} onChange={e=>setEditCatSec(e.target.value)}
                            style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:5,color:'#dde1f2',padding:'3px',fontSize:10,outline:'none'}}>
                            {secs.map(s=><option key={s} value={s}>{s}</option>)}
                          </select>
                          <button onClick={saveEditCat} style={{background:'#f9b934',color:'#000',border:'none',borderRadius:4,padding:'3px 8px',fontSize:10,cursor:'pointer',fontFamily:'inherit'}}>✓</button>
                          <button onClick={()=>setEditCatId(null)} style={{background:'transparent',border:'none',color:'#5e6585',fontSize:12,cursor:'pointer'}}>✕</button>
                        </>
                      ) : (
                        <>
                          <span style={{fontSize:11,color:'#dde1f2'}}>{cat.label}</span>
                          <button onClick={()=>{setEditCatId(cat.id);setEditCatLabel(cat.label);setEditCatSec(cat.sec)}} style={{background:'transparent',border:'none',color:'#5e6585',fontSize:11,cursor:'pointer',padding:0}}>✏️</button>
                          <button onClick={()=>deleteCategory(cat.id)} style={{background:'transparent',border:'none',color:'#f87171',fontSize:11,cursor:'pointer',padding:0}}>🗑</button>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center',paddingTop:12,borderTop:'1px solid #272a3d'}}>
            <input value={newCatLabel} onChange={e=>setNewCatLabel(e.target.value)} placeholder="카테고리 이름"
              style={{flex:1,background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',padding:'7px 10px',fontSize:12,outline:'none',fontFamily:'inherit'}}/>
            <select value={newCatSec} onChange={e=>setNewCatSec(e.target.value)}
              style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',padding:'7px 10px',fontSize:12,outline:'none',fontFamily:'inherit'}}>
              {secs.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <button onClick={addCategory} style={{background:'#f9b934',color:'#000',border:'none',borderRadius:7,padding:'7px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>+ 추가</button>
          </div>
        </div>
      )}

      {/* 월별 요약 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        {[
          {label:'전월 이월 잔액', val:carryoverAmt,    color:'#93c5fd'},
          {label:'총 실입금액',   val:totalDeposit,      color:'#34d399'},
          {label:'총 지출',       val:grand,             color:'#f87171'},
          {label:'현재 잔액',     val:currentBalance,    color:currentBalance>=0?'#f9b934':'#f87171'},
        ].map(k=>(
          <div key={k.label} style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'14px 16px',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:k.color}}/>
            <div style={{fontSize:10,fontWeight:600,color:'#5e6585',marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:18,fontWeight:700,color:k.color,fontFamily:'DM Mono,monospace'}}>{k.val.toLocaleString()}원</div>
          </div>
        ))}
      </div>

      {/* ── 고정지출 체크리스트 ── */}
      <div style={{background:'#12141f',border:`1px solid ${unpaidFixed.length>0?'rgba(248,113,113,0.4)':'rgba(52,211,153,0.3)'}`,borderRadius:12,marginBottom:18,overflow:'hidden'}}>
        {/* 헤더 */}
        <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',
          display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <span style={{fontSize:13,fontWeight:600}}>📌 이번달 고정지출</span>
            {unpaidFixed.length > 0
              ? <span style={{fontSize:11,fontWeight:700,color:'#f87171',background:'rgba(248,113,113,0.15)',
                  padding:'2px 8px',borderRadius:4}}>미납 {unpaidFixed.length}건</span>
              : fixedItems.length > 0
                ? <span style={{fontSize:11,fontWeight:700,color:'#34d399',background:'rgba(52,211,153,0.15)',
                    padding:'2px 8px',borderRadius:4}}>✅ 전부 납부완료</span>
                : null
            }
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            {fixedItems.length > 0 && (
              <span style={{fontSize:11,color:'#5e6585',fontFamily:'DM Mono,monospace'}}>
                {paidFixedAmt.toLocaleString()} / {totalFixedAmt.toLocaleString()}원
              </span>
            )}
            <button onClick={()=>setShowFixedMgr(v=>!v)}
              style={{background:'#191c2b',border:'1px solid #272a3d',color:'#dde1f2',borderRadius:7,
                padding:'5px 10px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
              {showFixedMgr ? '▲ 접기' : '⚙️ 항목 관리'}
            </button>
          </div>
        </div>

        {/* 항목 관리 패널 */}
        {showFixedMgr && (
          <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',background:'rgba(249,185,52,0.04)'}}>
            <div style={{fontSize:11,fontWeight:600,color:'#f9b934',marginBottom:12}}>고정지출 항목 설정</div>
            {/* 기존 항목 목록 */}
            {fixedItems.length > 0 && (
              <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:12}}>
                {fixedItems.map(item=>(
                  <div key={item.id} style={{background:'#191c2b',borderRadius:8,padding:'8px 12px',
                    display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                    {editFixedId===item.id ? (
                      <>
                        <input value={editFixed.label||''} onChange={e=>setEditFixed(f=>({...f,label:e.target.value}))}
                          placeholder="항목명" style={{background:'#12141f',border:'1px solid #f9b934',borderRadius:5,
                            color:'#dde1f2',padding:'4px 8px',fontSize:11,outline:'none',width:100,fontFamily:'inherit'}}/>
                        <input type="number" value={editFixed.dueDay||''} onChange={e=>setEditFixed(f=>({...f,dueDay:e.target.value}))}
                          placeholder="예정일" style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:5,
                            color:'#dde1f2',padding:'4px 8px',fontSize:11,outline:'none',width:60,fontFamily:'inherit'}}/>
                        <input type="number" value={editFixed.amount||''} onChange={e=>setEditFixed(f=>({...f,amount:e.target.value}))}
                          placeholder="금액" style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:5,
                            color:'#dde1f2',padding:'4px 8px',fontSize:11,outline:'none',width:90,fontFamily:'DM Mono,monospace'}}/>
                        <select value={editFixed.categoryId||''} onChange={e=>setEditFixed(f=>({...f,categoryId:e.target.value}))}
                          style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:5,color:'#dde1f2',
                            padding:'4px 8px',fontSize:11,outline:'none',fontFamily:'inherit'}}>
                          {categories.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                        <button onClick={saveEditFixed} style={{background:'#f9b934',color:'#000',border:'none',borderRadius:5,padding:'4px 10px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>저장</button>
                        <button onClick={()=>setEditFixedId(null)} style={{background:'transparent',border:'none',color:'#5e6585',fontSize:12,cursor:'pointer'}}>✕</button>
                      </>
                    ) : (
                      <>
                        <span style={{fontSize:12,fontWeight:600,color:'#dde1f2',flex:1}}>{item.label}</span>
                        <span style={{fontSize:11,color:'#5e6585'}}>매월 {item.dueDay}일</span>
                        <span style={{fontSize:12,color:'#f87171',fontFamily:'DM Mono,monospace',fontWeight:700}}>
                          {item.amount.toLocaleString()}원
                        </span>
                        <span style={{fontSize:10,color:'#5e6585'}}>
                          {categories.find(c=>c.id===item.categoryId)?.label||'—'}
                        </span>
                        <button onClick={()=>{setEditFixedId(item.id);setEditFixed({...item})}}
                          style={{background:'transparent',border:'none',color:'#5e6585',fontSize:11,cursor:'pointer',padding:0}}>✏️</button>
                        <button onClick={()=>deleteFixedItem(item.id)}
                          style={{background:'transparent',border:'none',color:'#f87171',fontSize:11,cursor:'pointer',padding:0}}>🗑</button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            {/* 새 항목 추가 */}
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',paddingTop:10,borderTop:'1px solid #272a3d'}}>
              <input value={newFixed.label} onChange={e=>setNewFixed(f=>({...f,label:e.target.value}))}
                placeholder="항목명 (예: 임대료)"
                style={{flex:1,minWidth:100,background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,
                  color:'#dde1f2',padding:'7px 10px',fontSize:12,outline:'none',fontFamily:'inherit'}}/>
              <div style={{display:'flex',alignItems:'center',gap:4}}>
                <span style={{fontSize:11,color:'#5e6585',whiteSpace:'nowrap'}}>매월</span>
                <input type="number" value={newFixed.dueDay} onChange={e=>setNewFixed(f=>({...f,dueDay:e.target.value}))}
                  placeholder="1" min="1" max="31"
                  style={{width:50,background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,
                    color:'#dde1f2',padding:'7px 8px',fontSize:12,outline:'none',fontFamily:'inherit'}}/>
                <span style={{fontSize:11,color:'#5e6585'}}>일</span>
              </div>
              <input type="number" value={newFixed.amount} onChange={e=>setNewFixed(f=>({...f,amount:e.target.value}))}
                placeholder="금액"
                style={{width:100,background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,
                  color:'#dde1f2',padding:'7px 10px',fontSize:12,outline:'none',fontFamily:'DM Mono,monospace'}}/>
              <select value={newFixed.categoryId} onChange={e=>setNewFixed(f=>({...f,categoryId:e.target.value}))}
                style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                  padding:'7px 10px',fontSize:12,outline:'none',fontFamily:'inherit'}}>
                <option value="">카테고리</option>
                {categories.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
              <button onClick={addFixedItem}
                style={{background:'#f9b934',color:'#000',border:'none',borderRadius:7,padding:'7px 14px',
                  fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>
                + 추가
              </button>
            </div>
          </div>
        )}

        {/* 체크리스트 */}
        {fixedItems.length === 0 ? (
          <div style={{padding:'20px',textAlign:'center',color:'#5e6585',fontSize:12}}>
            ⚙️ 항목 관리에서 고정지출 항목을 추가하세요
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
                  borderBottom:'1px solid #191c2b',
                  background: isPaid ? 'rgba(52,211,153,0.04)' : 'transparent'
                }}>
                  {/* 상태 아이콘 */}
                  <div style={{fontSize:18,flexShrink:0}}>
                    {isPaid ? '✅' : '⏳'}
                  </div>
                  {/* 항목 정보 */}
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:600,
                      color:isPaid?'#5e6585':'#dde1f2',
                      textDecoration:isPaid?'line-through':'none'}}>
                      {item.label}
                    </div>
                    <div style={{fontSize:10,color:'#5e6585',marginTop:2}}>
                      매월 {item.dueDay}일 예정 · {cat?.label||'미분류'}
                      {isPaid && <span style={{color:'#34d399',marginLeft:6}}>→ {+payment.paidDate}일 납부완료</span>}
                    </div>
                  </div>
                  {/* 금액 */}
                  <div style={{fontSize:13,fontWeight:700,
                    color:isPaid?'#5e6585':'#f87171',
                    fontFamily:'DM Mono,monospace',flexShrink:0,
                    textDecoration:isPaid?'line-through':'none'}}>
                    {item.amount.toLocaleString()}원
                  </div>
                  {/* 납부 버튼 */}
                  {isThisMonth && (
                    isPaid ? (
                      <button onClick={()=>unpayFixed(item.id)}
                        style={{background:'transparent',border:'1px solid #272a3d',color:'#5e6585',
                          borderRadius:6,padding:'5px 10px',fontSize:10,cursor:'pointer',
                          fontFamily:'inherit',flexShrink:0,whiteSpace:'nowrap'}}>
                        취소
                      </button>
                    ) : (
                      <button onClick={()=>payFixed(item)}
                        style={{background:'#34d399',color:'#000',border:'none',
                          borderRadius:6,padding:'5px 12px',fontSize:11,fontWeight:700,
                          cursor:'pointer',fontFamily:'inherit',flexShrink:0,whiteSpace:'nowrap'}}>
                        납부 ✓
                      </button>
                    )
                  )}
                </div>
              )
            })}
            {/* 고정지출 합계 */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',
              padding:'10px 18px',background:'rgba(255,255,255,0.02)'}}>
              <span style={{fontSize:11,color:'#5e6585'}}>고정지출 합계</span>
              <span style={{fontSize:13,fontWeight:700,color:'#f87171',fontFamily:'DM Mono,monospace'}}>
                {paidFixedAmt.toLocaleString()}원 납부 / {totalFixedAmt.toLocaleString()}원
              </span>
            </div>
          </div>
        )}
      </div>

      {/* 입력 영역 */}
      <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,marginBottom:18}}>
        <div style={{display:'flex',borderBottom:'1px solid #272a3d'}}>
          {[['image','📷 이미지로 입력'],['manual','✏️ 직접 입력']].map(([mode,label])=>(
            <button key={mode} onClick={()=>setInputMode(mode)}
              style={{flex:1,padding:'12px',fontSize:12,fontWeight:600,border:'none',cursor:'pointer',
                fontFamily:'inherit',borderRadius:mode==='image'?'12px 0 0 0':'0 12px 0 0',
                background:inputMode===mode?'rgba(249,185,52,0.1)':'transparent',
                color:inputMode===mode?'#f9b934':'#5e6585',
                borderBottom:inputMode===mode?'2px solid #f9b934':'2px solid transparent'}}>
              {label}
            </button>
          ))}
        </div>

        {/* 📷 이미지 입력 */}
        {inputMode === 'image' && (
          <div style={{padding:18}}>
            <div style={{fontSize:12,color:'#5e6585',marginBottom:14}}>
              국민은행 계좌 거래내역 스크린샷을 업로드하면 자동으로 지출 항목을 추출해드려요.
            </div>
            <div onClick={()=>fileRef.current?.click()}
              style={{border:'2px dashed #272a3d',borderRadius:10,padding:'28px',textAlign:'center',
                cursor:'pointer',marginBottom:14,background:imagePreview?'rgba(249,185,52,0.04)':'transparent'}}>
              {imagePreview ? (
                <img src={imagePreview} alt="preview" style={{maxWidth:'100%',maxHeight:300,borderRadius:8,objectFit:'contain'}}/>
              ) : (
                <>
                  <div style={{fontSize:32,marginBottom:8}}>📷</div>
                  <div style={{fontSize:13,color:'#dde1f2',marginBottom:4}}>클릭하여 이미지 업로드</div>
                  <div style={{fontSize:11,color:'#5e6585'}}>국민은행 거래내역 스크린샷 (PNG, JPG)</div>
                </>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleImageChange} style={{display:'none'}}/>
            {imageFile && !extracted.length && (
              <button onClick={handleExtract} disabled={extracting}
                style={{width:'100%',background:'#f9b934',color:'#000',border:'none',borderRadius:8,
                  padding:'12px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit',marginBottom:14}}>
                {extracting ? '🔍 분석 중...' : '🔍 거래내역 추출'}
              </button>
            )}
            {extracted.length > 0 && (
              <div>
                <div style={{fontSize:12,fontWeight:600,color:'#34d399',marginBottom:10}}>
                  ✅ {extracted.length}건 추출됨 — 카테고리를 선택하고 저장하세요
                </div>
                {imagePreview && (
                  <a href={imagePreview} download={`지출내역_${curMonth}_${day}.png`}
                    style={{display:'inline-block',marginBottom:12,background:'#191c2b',
                      border:'1px solid rgba(52,211,153,0.3)',color:'#34d399',borderRadius:7,
                      padding:'7px 14px',fontSize:11,fontWeight:600,textDecoration:'none',fontFamily:'inherit'}}>
                    💾 이미지 PC 저장
                  </a>
                )}
                <div style={{display:'flex',flexDirection:'column',gap:8,marginBottom:14}}>
                  {extracted.map((t,i)=>(
                    <div key={i} style={{background:'#191c2b',borderRadius:8,padding:'10px 14px',
                      display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',opacity:t.checked?1:0.5}}>
                      <input type="checkbox" checked={t.checked}
                        onChange={e=>setExtracted(prev=>prev.map((x,j)=>j===i?{...x,checked:e.target.checked}:x))}
                        style={{width:16,height:16,cursor:'pointer',flexShrink:0}}/>
                      <div style={{fontSize:11,color:'#5e6585',fontFamily:'DM Mono,monospace',minWidth:40}}>{t.date||'—'}</div>
                      <div style={{flex:1,fontSize:12,color:'#dde1f2',minWidth:100}}>{t.description}</div>
                      <div style={{fontSize:13,fontWeight:700,color:'#f87171',fontFamily:'DM Mono,monospace',minWidth:90,textAlign:'right'}}>
                        {t.amount.toLocaleString()}원
                      </div>
                      <select value={t.category}
                        onChange={e=>setExtracted(prev=>prev.map((x,j)=>j===i?{...x,category:e.target.value}:x))}
                        style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:6,color:'#dde1f2',
                          padding:'5px 8px',fontSize:11,outline:'none',fontFamily:'inherit'}}>
                        {categories.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <div style={{display:'flex',gap:8}}>
                  <button onClick={saveExtracted} disabled={saving}
                    style={{flex:1,background:'#34d399',color:'#000',border:'none',borderRadius:8,
                      padding:'11px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                    {saving?'저장 중...':'💾 선택 항목 저장'}
                  </button>
                  <button onClick={()=>{setExtracted([]);setImageFile(null);setImagePreview(null);if(fileRef.current)fileRef.current.value=''}}
                    style={{background:'#191c2b',color:'#5e6585',border:'1px solid #272a3d',borderRadius:8,
                      padding:'11px 16px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
                    다시 업로드
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ✏️ 직접 입력 */}
        {inputMode === 'manual' && (
          <div style={{padding:18}}>
            <div style={{background:'rgba(147,197,253,0.08)',border:'1px solid rgba(147,197,253,0.2)',
              borderRadius:10,padding:'14px 16px',marginBottom:16}}>
              <label style={{fontSize:11,fontWeight:700,color:'#93c5fd',display:'block',marginBottom:8}}>💳 전월 이월 잔액</label>
              <div style={{display:'flex',gap:10,alignItems:'center'}}>
                <input type="number" value={carryover} onChange={e=>setCarryover(e.target.value)}
                  placeholder="전달에서 이월된 계좌 잔액"
                  style={{flex:1,background:'#191c2b',border:'1px solid rgba(147,197,253,0.3)',borderRadius:7,
                    color:'#93c5fd',padding:'10px 12px',fontSize:14,outline:'none',fontFamily:'DM Mono,monospace',fontWeight:700}}/>
                <button onClick={saveCarryover}
                  style={{background:'#93c5fd',color:'#000',border:'none',borderRadius:7,
                    padding:'10px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>
                  저장
                </button>
              </div>
            </div>
            <div style={{marginBottom:16}}>
              <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:8}}>날짜</label>
              <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
                {isThisMonth && (
                  <>
                    <button onClick={()=>setDay(getNowDD())}
                      style={{padding:'7px 14px',borderRadius:7,border:'none',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                        background:day===getNowDD()?'#f9b934':'#191c2b',color:day===getNowDD()?'#000':'#5e6585'}}>
                      오늘 ({+getNowDD()}일)
                    </button>
                    <button onClick={()=>setDay(getYestDD())}
                      style={{padding:'7px 14px',borderRadius:7,border:'none',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                        background:day===getYestDD()?'#f9b934':'#191c2b',color:day===getYestDD()?'#000':'#5e6585'}}>
                      어제 ({+getYestDD()}일)
                    </button>
                  </>
                )}
                <select value={day} onChange={e=>setDay(e.target.value)}
                  style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                    padding:'7px 10px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
                  {Array.from({length:days},(_,i)=><option key={i} value={pad(i+1)}>{i+1}일 ({getDow(pad(i+1))})</option>)}
                </select>
              </div>
            </div>
            <div style={{background:'rgba(52,211,153,0.08)',border:'1px solid rgba(52,211,153,0.2)',
              borderRadius:10,padding:'14px 16px',marginBottom:16}}>
              <label style={{fontSize:11,fontWeight:700,color:'#34d399',display:'block',marginBottom:8}}>💳 실입금액</label>
              <input type="number" value={deposit} onChange={e=>setDeposit(e.target.value)}
                placeholder="수수료 제외 실제 입금된 금액"
                style={{background:'#191c2b',border:'1px solid rgba(52,211,153,0.3)',borderRadius:7,color:'#34d399',
                  padding:'10px 12px',fontSize:14,outline:'none',width:'100%',fontFamily:'DM Mono,monospace',fontWeight:700}}/>
            </div>
            {secs.map(sec=>{
              const secCats = categories.filter(f=>f.sec===sec)
              if(!secCats.length) return null
              return (
                <div key={sec}>
                  <div style={{fontSize:10,fontWeight:600,color:'#5e6585',textTransform:'uppercase',letterSpacing:.8,
                    margin:'14px 0 8px',paddingBottom:6,borderBottom:'1px solid #272a3d'}}>
                    {secIcons[sec]} {sec}
                  </div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:10}}>
                    {secCats.map(f=>(
                      <div key={f.id} style={{display:'flex',flexDirection:'column',gap:4}}>
                        <label style={{fontSize:10,color:'#5e6585',fontWeight:600}}>{f.label}</label>
                        {inp(f.id)}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
            {(+deposit>0 || categories.some(f=>+form[f.id]>0)) && (
              <div style={{marginTop:16,background:'#191c2b',borderRadius:10,padding:'12px 14px',display:'flex',flexDirection:'column',gap:6}}>
                <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}>
                  <span style={{color:'#5e6585'}}>당일 지출 합계</span>
                  <span style={{color:'#f87171',fontFamily:'DM Mono,monospace',fontWeight:700}}>
                    -{categories.reduce((a,f)=>a+(+form[f.id]||0),0).toLocaleString()}원
                  </span>
                </div>
                {+deposit>0 && (
                  <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}>
                    <span style={{color:'#5e6585'}}>당일 실입금</span>
                    <span style={{color:'#34d399',fontFamily:'DM Mono,monospace',fontWeight:700}}>
                      +{(+deposit).toLocaleString()}원
                    </span>
                  </div>
                )}
              </div>
            )}
            <div style={{marginTop:14}}>
              <button onClick={save} disabled={saving}
                style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'9px 20px',
                  fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                {saving?'저장 중...':'저 장'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 내역 테이블 */}
      <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden'}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,
          display:'flex',justifyContent:'space-between'}}>
          <span>{mLabel(curMonth)} 지출 내역</span>
          <span style={{color:'#f87171',fontFamily:'DM Mono, monospace'}}>{grand.toLocaleString()}원</span>
        </div>
        {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:40}}>로딩 중...</div> : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead>
                <tr style={{background:'#191c2b'}}>
                  {['날짜','실입금','지출합계','실수익',...categories.map(f=>f.label),''].map(h=>(
                    <th key={h} style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#5e6585',
                      textAlign:h==='날짜'?'left':'right',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.keys(data).filter(dd=>dd!=='carryover').sort().map(dd=>{
                  const e = data[dd]
                  if(typeof e !== 'object' || !e) return null
                  const expSum = categories.reduce((a,f)=>a+(e[f.id]||0),0)
                  const dep = e.deposit||0
                  const profit = dep - expSum
                  if(!expSum && !dep) return null
                  return (
                    <tr key={dd}>
                      <td style={{padding:'8px 10px',borderBottom:'1px solid #272a3d',color:getDowColor(dd),fontWeight:600}}>
                        {+dd}일 ({getDow(dd)})
                      </td>
                      <td style={{padding:'8px 10px',borderBottom:'1px solid #272a3d',textAlign:'right',color:'#34d399',fontFamily:'DM Mono,monospace',fontWeight:700}}>
                        {dep>0?dep.toLocaleString():'—'}
                      </td>
                      <td style={{padding:'8px 10px',borderBottom:'1px solid #272a3d',textAlign:'right',color:'#f87171',fontFamily:'DM Mono,monospace',fontWeight:700}}>
                        {expSum>0?expSum.toLocaleString():'—'}
                      </td>
                      <td style={{padding:'8px 10px',borderBottom:'1px solid #272a3d',textAlign:'right',color:profit>=0?'#f9b934':'#f87171',fontFamily:'DM Mono,monospace',fontWeight:700}}>
                        {dep>0?profit.toLocaleString():'—'}
                      </td>
                      {categories.map(f=>(
                        <td key={f.id} style={{padding:'8px 10px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace',color:'#dde1f2'}}>
                          {wonCell(e[f.id])}
                        </td>
                      ))}
                      <td style={{padding:'8px 10px',borderBottom:'1px solid #272a3d',textAlign:'right'}}>
                        <button onClick={()=>del_row(dd)}
                          style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',
                            padding:'3px 8px',fontSize:10,borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>
                          삭제
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {Object.keys(data).filter(dd=>dd!=='carryover').length===0 && (
                  <tr><td colSpan={categories.length+5} style={{padding:28,textAlign:'center',color:'#5e6585'}}>입력된 데이터가 없습니다</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr style={{background:'#1f2236'}}>
                  <td style={{padding:'10px',fontWeight:700,color:'#f9b934'}}>합 계</td>
                  <td style={{padding:'10px',textAlign:'right',fontWeight:700,color:'#34d399',fontFamily:'DM Mono,monospace'}}>{totalDeposit.toLocaleString()}</td>
                  <td style={{padding:'10px',textAlign:'right',fontWeight:700,color:'#f87171',fontFamily:'DM Mono,monospace'}}>{grand.toLocaleString()}</td>
                  <td style={{padding:'10px',textAlign:'right',fontWeight:700,color:realProfit>=0?'#f9b934':'#f87171',fontFamily:'DM Mono,monospace'}}>{realProfit.toLocaleString()}</td>
                  {categories.map(f=>(
                    <td key={f.id} style={{padding:'10px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{wonCell(tot[f.id])}</td>
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
