import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')
const DAYS_KR = ['일','월','화','수','목','금','토']

// 지출관리(Expenses.jsx)의 기본 카테고리와 동일 — 저장된 카테고리가 없을 때 사용
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

const yesterdayStr = () => { const d=new Date(); d.setDate(d.getDate()-1); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}` }
// 선택한 달의 기본 입력 날짜 — 이번 달이면 어제(1일이면 1일), 지난 달이면 그 달 1일
const defaultDateFor = month => {
  const n = new Date()
  if(month !== `${n.getFullYear()}-${pad(n.getMonth()+1)}`) return `${month}-01`
  const y = yesterdayStr()
  return y.slice(0,7)===month ? y : `${month}-01`
}

// 대시보드용 "못 적은 지출 입력" — 지출관리와 같은 expenses/{YYYY-MM} 문서에 기록
export default function MissedExpenseInput({ curMonth, onSaved }) {
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES)
  const [monthData, setMonthData]   = useState({})
  const [date, setDate]             = useState(()=>defaultDateFor(curMonth))
  const [catId, setCatId]           = useState('hq')
  const [amount, setAmount]         = useState('')
  const [saving, setSaving]         = useState(false)

  const ym = date.slice(0,7)
  const dd = date.slice(8,10)

  useEffect(()=>{
    getDoc(doc(db,'expenseCategories','default'))
      .then(s=>{ if(s.exists() && s.data().list?.length) setCategories(s.data().list) })
      .catch(e=>console.error(e))
  },[])

  useEffect(()=>{
    let ignore = false
    getDoc(doc(db,'expenses',ym))
      .then(snap=>{ if(!ignore) setMonthData(snap.exists() ? snap.data() : {}) })
      .catch(e=>console.error(e))
    return ()=>{ ignore = true }
  },[ym])

  // 대시보드에서 다른 달을 고르면 입력 날짜도 그 달로 이동
  const [prevCurMonth, setPrevCurMonth] = useState(curMonth)
  if(prevCurMonth !== curMonth) {
    setPrevCurMonth(curMonth)
    if(ym !== curMonth) setDate(defaultDateFor(curMonth))
  }

  const dayEntry = (monthData[dd] && typeof monthData[dd]==='object') ? monthData[dd] : {}
  const dayItems = categories.filter(c=>(dayEntry[c.id]||0)>0)
  const dayTotal = dayItems.reduce((a,c)=>a+dayEntry[c.id],0)

  // 이번 달(선택 월)에서 지출이 하나도 없는 날짜 — 오늘 이전까지만
  const [y,m] = ym.split('-').map(Number)
  const now = new Date()
  const thisYm = `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  const lastDay = ym===thisYm ? now.getDate()-1 : (ym<thisYm ? new Date(y,m,0).getDate() : 0)
  const emptyDays = []
  for(let d=1; d<=lastDay; d++) {
    const e = monthData[pad(d)]
    const sum = (e && typeof e==='object') ? categories.reduce((a,c)=>a+(e[c.id]||0),0) : 0
    if(sum===0) emptyDays.push(pad(d))
  }

  async function save() {
    const amt = +String(amount).replace(/[^0-9]/g,'') || 0
    if(amt<=0) return alert('금액을 입력해주세요')
    if(!date) return alert('날짜를 선택해주세요')
    setSaving(true)
    try {
      // 저장 직전 최신 데이터를 다시 읽어 다른 화면에서 입력한 내용을 덮어쓰지 않도록 함
      const snap = await getDoc(doc(db,'expenses',ym))
      const latest = snap.exists() ? snap.data() : {}
      const entry = { ...(latest[dd]||{}) }
      categories.forEach(c=>{ if(entry[c.id]===undefined) entry[c.id]=0 })
      entry[catId] = (entry[catId]||0) + amt
      const newData = { ...latest, [dd]: entry }
      await setDoc(doc(db,'expenses',ym), newData)
      setMonthData(newData)
      setAmount('')
      onSaved?.()
    } catch(e){ console.error(e); alert('저장 중 오류가 발생했습니다.') }
    setSaving(false)
  }

  async function removeItem(id) {
    const label = categories.find(c=>c.id===id)?.label || id
    if(!window.confirm(`${+m}월 ${+dd}일 ${label} 지출을 삭제하시겠습니까?`)) return
    setSaving(true)
    try {
      const snap = await getDoc(doc(db,'expenses',ym))
      const latest = snap.exists() ? snap.data() : {}
      const newData = { ...latest, [dd]: { ...(latest[dd]||{}), [id]: 0 } }
      await setDoc(doc(db,'expenses',ym), newData)
      setMonthData(newData)
      onSaved?.()
    } catch(e){ console.error(e) }
    setSaving(false)
  }

  const inputStyle = {background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,color:'#1D1B18',
    padding:'8px 10px',fontSize:12,outline:'none',fontFamily:'inherit'}
  const secs = ['재료비','관리비','인건비']

  return (
    <div style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,overflow:'hidden'}}>
      <div style={{padding:'14px 18px',borderBottom:'1px solid #DCD7CE',display:'flex',
        justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
        <div style={{fontSize:13,fontWeight:600}}>못 적은 지출 입력</div>
        <div style={{fontSize:10,color:'#6E6A63'}}>지출관리 탭과 같은 내역에 바로 반영돼요</div>
      </div>

      <div style={{padding:18,display:'flex',flexDirection:'column',gap:14}}>
        {/* 입력 폼 */}
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <input type="date" value={date} onChange={e=>e.target.value && setDate(e.target.value)} style={inputStyle}/>
          <select value={catId} onChange={e=>setCatId(e.target.value)} style={inputStyle}>
            {secs.map(sec=>(
              <optgroup key={sec} label={sec}>
                {categories.filter(c=>c.sec===sec).map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
              </optgroup>
            ))}
          </select>
          <input type="number" placeholder="금액" min="0" value={amount}
            onChange={e=>setAmount(e.target.value)}
            onKeyDown={e=>e.key==='Enter' && save()}
            style={{...inputStyle,width:140,fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}/>
          <button onClick={save} disabled={saving}
            style={{background:'#C3261C',color:'#FFFFFF',border:'none',borderRadius:4,padding:'8px 18px',
              fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
            {saving ? '저장 중...' : '+ 추가'}
          </button>
        </div>

        {/* 선택한 날짜의 현재 지출 */}
        <div style={{background:'#F3F1EC',borderRadius:4,padding:'10px 14px'}}>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:11,color:'#6E6A63',marginBottom:dayItems.length?8:0}}>
            <span>{+m}월 {+dd}일 ({DAYS_KR[new Date(y,m-1,+dd).getDay()]}) 기록된 지출</span>
            <span style={{color:'#B42318',fontWeight:700,fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>
              {dayTotal>0 ? `${dayTotal.toLocaleString()}원` : '없음'}
            </span>
          </div>
          {dayItems.map(c=>(
            <div key={c.id} style={{display:'flex',alignItems:'center',gap:10,padding:'5px 0',
              borderTop:'1px solid #DCD7CE',fontSize:12}}>
              <span style={{flex:1,color:'#1D1B18'}}>{c.label}</span>
              <span style={{color:'#B42318',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{dayEntry[c.id].toLocaleString()}</span>
              <button onClick={()=>removeItem(c.id)} disabled={saving}
                style={{background:'transparent',border:'1px solid #E8C4BF',color:'#B42318',
                  padding:'2px 8px',fontSize:10,borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>
                삭제
              </button>
            </div>
          ))}
        </div>

        {/* 지출이 없는 날짜 */}
        {lastDay>0 && (
          <div>
            <div style={{fontSize:11,color:'#6E6A63',marginBottom:6}}>
              {+m}월 지출이 하나도 없는 날 {emptyDays.length>0 ? `${emptyDays.length}일` : '— 모두 입력됨'}
            </div>
            <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
              {emptyDays.map(d=>{
                const dow = new Date(y,m-1,+d).getDay()
                const active = d===dd
                return (
                  <button key={d} onClick={()=>setDate(`${ym}-${d}`)}
                    style={{padding:'4px 8px',borderRadius:5,fontSize:11,fontWeight:600,cursor:'pointer',
                      fontFamily:'inherit',fontVariantNumeric:'tabular-nums',border:'none',
                      background:active?'#C3261C':'#F3F1EC',
                      color:active?'#FFFFFF':dow===0?'#B42318':dow===6?'#2B5C9E':'#1D1B18',
                      outline:active?'none':'1px solid #DCD7CE'}}>
                    {+d}일
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
