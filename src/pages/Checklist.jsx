import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')
const DAYS_KR = ['일','월','화','수','목','금','토']
const CLOSED_DOW = 0 // 일요일 휴무

function todayStr() {
  const n = new Date()
  return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}`
}
function dateStrOffset(offsetDays) {
  const d = new Date()
  d.setDate(d.getDate()+offsetDays)
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
}
function dowOfDate(dateStr) {
  return new Date(dateStr).getDay()
}
function dateOfDow(dow) {
  const today = new Date()
  const sunday = new Date(today)
  sunday.setDate(today.getDate() - today.getDay())
  const d = new Date(sunday)
  d.setDate(sunday.getDate() + dow)
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
}
// 오늘 기준 가장 최근 "영업일"(휴무일 제외) 하루 전 날짜 찾기
function lastBusinessDayBefore(dateStr) {
  let d = new Date(dateStr)
  for(let i=0;i<7;i++){
    d.setDate(d.getDate()-1)
    if(d.getDay() !== CLOSED_DOW) {
      return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
    }
  }
  return null
}

// interval='biweekly'인 항목이 특정 날짜에 노출되는지 판단 (baseDate 기준 14일 간격)
function isBiweeklyActive(item, dateStr) {
  if(item.interval !== 'biweekly' || !item.baseDate) return true
  const base = new Date(item.baseDate)
  const target = new Date(dateStr)
  const diffDays = Math.round((target - base) / (1000*60*60*24))
  if(diffDays < 0) return false
  return (diffDays % 14) === 0
}

// 오늘부터 daysAhead일 후까지(당일 포함) 그 항목이 실제로 발생하는 날짜를 찾아서 반환. 없으면 null.
function findUpcomingDate(item, daysAhead) {
  for(let i=0; i<=daysAhead; i++){
    const d = new Date()
    d.setDate(d.getDate()+i)
    if(d.getDay() === CLOSED_DOW) continue // 휴무일은 건너뜀
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
    if(d.getDay() === item.dow && isBiweeklyActive(item, dateStr)) {
      return { dateStr, offset:i, dow:d.getDay() }
    }
  }
  return null
}

const DEFAULT_DAILY = [
  { id:'d1',  label:'배달 용기 만들기' },
  { id:'d2',  label:'뚜껑 채우기' },
  { id:'d3',  label:'만두박스 만들기' },
  { id:'d4',  label:'테이블 비닐 만들기' },
  { id:'d5',  label:'배달 단무지 채우기' },
  { id:'d6',  label:'1인 단무지·소스류 여분 만들기' },
  { id:'d7',  label:'음료 채우기' },
  { id:'d8',  label:'셀프바 및 앞치마 정리' },
  { id:'d9',  label:'퇴식대 및 주변 정리' },
  { id:'d10', label:'조리대 정리' },
]
const DEFAULT_WEEKLY = [
  { id:'w1', label:'고춧가루 세척', dow:6, time:'오후' },
  { id:'w2', label:'고춧가루 채움', dow:1, time:'오전' },
  { id:'w3', label:'간장 세척',     dow:5, time:'오후' },
  { id:'w4', label:'간장 채움',     dow:6, time:'오전' },
  { id:'w5', label:'식초 세척',     dow:6, time:'오전' },
  { id:'w6', label:'식초 채움',     dow:6, time:'오전' },
  { id:'w7', label:'고체 세정제',   dow:6, time:'오후' },
  { id:'w8', label:'춘장',          dow:2, time:'오전' },
  { id:'w9', label:'물병',          dow:1, time:'오후' },
  { id:'w9b',label:'물병',          dow:3, time:'오후' },
  { id:'w9c',label:'물병',          dow:5, time:'오후' },
]

const DOW_LABELS = ['일','월','화','수','목','금','토']

export default function Checklist() {
  const [dailyItems, setDailyItems]   = useState(DEFAULT_DAILY)
  const [weeklyItems, setWeeklyItems] = useState(DEFAULT_WEEKLY)
  const [checks, setChecks]   = useState({}) // {date: {itemId: true}} — 매일항목은 itemId_am / itemId_pm 로 저장
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)

  const [showHistory, setShowHistory] = useState(false)
  const [historyDate, setHistoryDate] = useState(todayStr())

  const [showManage, setShowManage] = useState(false)
  const [newDaily, setNewDaily]   = useState('')
  const [newWeekly, setNewWeekly] = useState({ label:'', dow:1, time:'오전', interval:'weekly', baseDate: todayStr(), alertUid:'', alertMsg:'' })
  const [editItemId, setEditItemId] = useState(null)
  const [editItemForm, setEditItemForm] = useState(null)

  const [expandedDow, setExpandedDow] = useState(null)
  const [employees, setEmployees] = useState([]) // [{uid,name}]

  const today = todayStr()
  const todayDow = new Date().getDay()
  const historyDow = new Date(historyDate).getDay()

  // 일요일(휴무) 다음 영업일 기준 "어제" = 가장 최근 휴무 아닌 전날
  const prevBusinessDate = lastBusinessDayBefore(today)
  const prevBusinessDow  = prevBusinessDate ? dowOfDate(prevBusinessDate) : null

  async function load() {
    setLoading(true)
    try {
      const [cfgSnap, recSnap, usersSnap] = await Promise.all([
        getDoc(doc(db,'checklist','config')),
        getDoc(doc(db,'checklist','records')),
        getDocs(collection(db,'users')),
      ])
      if(cfgSnap.exists()) {
        const cfg = cfgSnap.data()
        setDailyItems(cfg.daily || DEFAULT_DAILY)
        setWeeklyItems((cfg.weekly || DEFAULT_WEEKLY).map(w=>({ interval:'weekly', ...w })))
      } else {
        await setDoc(doc(db,'checklist','config'), { daily: DEFAULT_DAILY, weekly: DEFAULT_WEEKLY })
      }
      setChecks(recSnap.exists() ? (recSnap.data().byDate||{}) : {})
      const emps = []
      usersSnap.forEach(d=>{
        const data = d.data()
        if(data.status==='approved' && !['owner','store','investor'].includes(data.role))
          emps.push({ uid:d.id, name:data.name })
      })
      setEmployees(emps)
    } catch(e) { console.error(e) }
    setLoading(false)
  }
  useEffect(()=>{ load() },[])

  async function saveConfig(nd, nw) {
    await setDoc(doc(db,'checklist','config'), { daily:nd, weekly:nw })
    setDailyItems(nd)
    setWeeklyItems(nw)
  }

  async function toggleCheck(date, checkKey) {
    const dayChecks = { ...(checks[date]||{}) }
    if(dayChecks[checkKey]) delete dayChecks[checkKey]
    else dayChecks[checkKey] = true
    const newChecks = { ...checks, [date]: dayChecks }
    await setDoc(doc(db,'checklist','records'), { byDate: newChecks })
    setChecks(newChecks)
  }

  const isChecked = (date, checkKey) => !!(checks[date]?.[checkKey])

  // dow만 필터 (2주주기 필터는 날짜가 필요하므로 별도 함수)
  function getWeeklyForDow(dow) {
    return weeklyItems.filter(w=>w.dow===dow)
  }
  // 특정 날짜에 실제로 노출돼야 할 요일별 항목 (2주주기 반영)
  function getWeeklyForDate(dateStr) {
    const dow = dowOfDate(dateStr)
    return weeklyItems.filter(w=>w.dow===dow && isBiweeklyActive(w, dateStr))
  }

  // ── 항목 관리 ──
  async function addDailyItem() {
    if(!newDaily.trim()) return
    setSaving(true)
    const item = { id:'d_'+Date.now(), label:newDaily.trim() }
    await saveConfig([...dailyItems, item], weeklyItems)
    setNewDaily('')
    setSaving(false)
  }
  async function addWeeklyItem() {
    if(!newWeekly.label.trim()) return
    setSaving(true)
    const item = {
      id:'w_'+Date.now(), label:newWeekly.label.trim(), dow:+newWeekly.dow, time:newWeekly.time,
      interval: newWeekly.interval,
      baseDate: newWeekly.interval==='biweekly' ? newWeekly.baseDate : null,
      alertUid: newWeekly.alertUid || '',
      alertMsg: newWeekly.alertMsg || '',
    }
    await saveConfig(dailyItems, [...weeklyItems, item])
    setNewWeekly({ label:'', dow:1, time:'오전', interval:'weekly', baseDate: todayStr(), alertUid:'', alertMsg:'' })
    setSaving(false)
  }
  function startEditItem(item, type) {
    setEditItemId(item.id)
    setEditItemForm({
      interval:'weekly', baseDate:todayStr(), alertUid:'', alertMsg:'',
      ...item, type
    })
  }
  async function saveEditItem() {
    setSaving(true)
    if(editItemForm.type === 'daily') {
      const nd = dailyItems.map(it=>it.id===editItemId ? { id:it.id, label:editItemForm.label } : it)
      await saveConfig(nd, weeklyItems)
    } else {
      const nw = weeklyItems.map(it=>it.id===editItemId
        ? { id:it.id, label:editItemForm.label, dow:+editItemForm.dow, time:editItemForm.time,
            interval: editItemForm.interval || 'weekly',
            baseDate: editItemForm.interval==='biweekly' ? (editItemForm.baseDate||todayStr()) : null,
            alertUid: editItemForm.alertUid || '',
            alertMsg: editItemForm.alertMsg || '' } : it)
      await saveConfig(dailyItems, nw)
    }
    setEditItemId(null); setEditItemForm(null)
    setSaving(false)
  }
  async function deleteItem(id, type) {
    if(!window.confirm('이 항목을 삭제하시겠습니까?')) return
    if(type === 'daily') await saveConfig(dailyItems.filter(it=>it.id!==id), weeklyItems)
    else await saveConfig(dailyItems, weeklyItems.filter(it=>it.id!==id))
  }

  // 매일 항목: 오전/오후 카운트
  function dailyDoneCount(date) {
    let c = 0
    dailyItems.forEach(it=>{
      if(isChecked(date, it.id+'_am')) c++
      if(isChecked(date, it.id+'_pm')) c++
    })
    return c
  }
  const dailyTotalSlots = dailyItems.length * 2

  // 오늘 요약
  const todayWeekly = getWeeklyForDate(today)
  const todayDailyDone = dailyDoneCount(today)
  const todayWeeklyDone = todayWeekly.filter(it=>isChecked(today, it.id)).length
  const todayTotalCount = dailyTotalSlots + todayWeekly.length
  const todayDoneCount = todayDailyDone + todayWeeklyDone

  // 2~3일 이내(오늘 포함) 다가오는 알림 항목 (오늘 것은 제외 — 오늘은 아래 별도 배너로 표시)
  const upcomingAlerts = weeklyItems
    .filter(it=>it.alertUid||it.alertMsg)
    .map(it=>({ item:it, found: findUpcomingDate(it, 3) }))
    .filter(x=>x.found && x.found.offset>0) // 0=오늘은 제외, 1~3일 후만

  // 직전 영업일 미완료 항목 (일요일 휴무는 건너뛰고 계산됨)
  const prevWeekly = prevBusinessDate ? getWeeklyForDate(prevBusinessDate) : []
  const prevDailyUnfinished = prevBusinessDate ? dailyItems.filter(it=>
    !isChecked(prevBusinessDate, it.id+'_am') || !isChecked(prevBusinessDate, it.id+'_pm')
  ) : []
  const prevWeeklyUnfinished = prevBusinessDate ? prevWeekly.filter(it=>!isChecked(prevBusinessDate, it.id)) : []
  const hasPrevUnfinished = prevDailyUnfinished.length>0 || prevWeeklyUnfinished.length>0

  // 지난 기록 조회용
  const historyWeekly = getWeeklyForDate(historyDate)
  const historyDailyDone = dailyDoneCount(historyDate)
  const historyWeeklyDone = historyWeekly.filter(it=>isChecked(historyDate, it.id)).length

  const inputStyle = {
    background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
    padding:'8px 10px',fontSize:12,outline:'none',fontFamily:'inherit'
  }

  // 매일 항목 1개 = 오전/오후 체크박스 2개 나란히
  function DailyRow(item, date, big=false) {
    const amDone = isChecked(date, item.id+'_am')
    const pmDone = isChecked(date, item.id+'_pm')
    const bothDone = amDone && pmDone
    return (
      <div key={item.id+date} style={{
        display:'flex',alignItems:'center',gap:8,
        padding: big ? '10px 12px' : '7px 10px',
        borderRadius:8,
        background: bothDone ? 'rgba(52,211,153,0.08)' : '#191c2b',
        border: bothDone ? '1px solid rgba(52,211,153,0.3)' : '1px solid #272a3d',
      }}>
        <span style={{
          flex:1,fontSize: big?14:12, fontWeight: bothDone?400:600,
          color: bothDone ? '#5e6585' : '#dde1f2',
          textDecoration: bothDone ? 'line-through' : 'none',
        }}>
          {item.label}
        </span>
        <button onClick={()=>toggleCheck(date, item.id+'_am')}
          style={{
            display:'flex',alignItems:'center',gap:4,border:'none',cursor:'pointer',
            background: amDone ? 'rgba(249,185,52,0.18)' : '#0b0d16',
            color: amDone ? '#f9b934' : '#5e6585',
            borderRadius:6,padding:'4px 8px',fontSize:10,fontWeight:700,fontFamily:'inherit'
          }}>
          {amDone ? '✓' : '○'} 오전
        </button>
        <button onClick={()=>toggleCheck(date, item.id+'_pm')}
          style={{
            display:'flex',alignItems:'center',gap:4,border:'none',cursor:'pointer',
            background: pmDone ? 'rgba(147,197,253,0.18)' : '#0b0d16',
            color: pmDone ? '#93c5fd' : '#5e6585',
            borderRadius:6,padding:'4px 8px',fontSize:10,fontWeight:700,fontFamily:'inherit'
          }}>
          {pmDone ? '✓' : '○'} 오후
        </button>
      </div>
    )
  }

  // 요일별 항목 1개 = 체크박스 1개 (기존과 동일)
  function alertNameOf(uid) {
    return employees.find(e=>e.uid===uid)?.name || ''
  }

  function WeeklyRow(item, date, big=false) {
    const done = isChecked(date, item.id)
    const hasAlert = item.alertUid || item.alertMsg
    return (
      <div key={item.id+date}>
        <div onClick={()=>toggleCheck(date, item.id)}
          style={{
            display:'flex',alignItems:'center',gap:8,
            padding: big ? '10px 12px' : '7px 10px',
            borderRadius: hasAlert ? '8px 8px 0 0' : 8,cursor:'pointer',
            background: done ? 'rgba(52,211,153,0.08)' : '#191c2b',
            border: done ? '1px solid rgba(52,211,153,0.3)' : '1px solid #272a3d',
            borderBottom: hasAlert ? 'none' : undefined,
          }}>
          <div style={{
            width: big?22:18, height: big?22:18, borderRadius:6,flexShrink:0,
            display:'flex',alignItems:'center',justifyContent:'center',
            background: done ? '#34d399' : 'transparent',
            border: done ? 'none' : '1.5px solid #3d4060',
            fontSize: big?13:11, color:'#000',fontWeight:900,
          }}>
            {done && '✓'}
          </div>
          <span style={{
            fontSize: big?14:12, fontWeight: done?400:600,
            color: done ? '#5e6585' : '#dde1f2',
            textDecoration: done ? 'line-through' : 'none',
          }}>
            {item.label}
            <span style={{fontSize:big?11:10,color:'#f9b934',marginLeft:6,fontWeight:700}}>({item.time})</span>
            {item.interval==='biweekly' && (
              <span style={{fontSize:big?10:9,color:'#a78bfa',marginLeft:5,fontWeight:700}}>2주마다</span>
            )}
          </span>
        </div>
        {hasAlert && (
          <div style={{
            padding: big ? '7px 12px' : '5px 10px',
            borderRadius:'0 0 8px 8px',
            background:'rgba(248,113,113,0.12)',
            border:'1px solid rgba(248,113,113,0.3)',borderTop:'none',
            fontSize: big?11:10, color:'#f87171', fontWeight:700,
            display:'flex',alignItems:'center',gap:5,
          }}>
            ⏰ {item.alertUid && alertNameOf(item.alertUid) ? `${alertNameOf(item.alertUid)}님 ` : ''}
            {item.alertMsg || '일찍 출근 필요'}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22,flexWrap:'wrap',gap:10}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>✅ 오늘의 체크리스트</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>매일(오전·오후)·요일별 필수 업무</div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={()=>setShowManage(v=>!v)}
            style={{background: showManage ? '#f9b934' : '#191c2b',border:'1px solid #272a3d',
              color: showManage ? '#000' : '#dde1f2',borderRadius:8,
              padding:'8px 14px',fontSize:12,fontWeight:showManage?700:400,cursor:'pointer',fontFamily:'inherit'}}>
            ⚙️ 항목 관리
          </button>
          <button onClick={()=>{ setShowHistory(v=>!v); setHistoryDate(today) }}
            style={{background:'#191c2b',border:'1px solid #272a3d',color:'#dde1f2',borderRadius:8,
              padding:'8px 14px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
            📖 지난 기록 보기
          </button>
        </div>
      </div>

      {/* 항목 관리 패널 */}
      {showManage && (
        <div style={{background:'#12141f',border:'1px solid #f9b934',borderRadius:12,padding:18,marginBottom:18}}>
          <div style={{fontSize:13,fontWeight:600,color:'#f9b934',marginBottom:16}}>⚙️ 체크리스트 항목 관리</div>

          <div style={{marginBottom:20}}>
            <div style={{fontSize:11,color:'#5e6585',fontWeight:600,marginBottom:8}}>
              📌 매일 필수 항목 <span style={{color:'#3d4060'}}>(오전·오후 각각 체크)</span>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:10}}>
              {dailyItems.map(item=>(
                <div key={item.id} style={{background:'#191c2b',borderRadius:7,padding:'7px 10px',
                  display:'flex',alignItems:'center',gap:8}}>
                  {editItemId===item.id ? (
                    <>
                      <input value={editItemForm.label} onChange={e=>setEditItemForm(f=>({...f,label:e.target.value}))}
                        style={{...inputStyle,flex:1}}/>
                      <button onClick={saveEditItem} disabled={saving}
                        style={{background:'#f9b934',color:'#000',border:'none',borderRadius:5,padding:'5px 10px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>저장</button>
                      <button onClick={()=>{setEditItemId(null);setEditItemForm(null)}}
                        style={{background:'transparent',border:'none',color:'#5e6585',fontSize:12,cursor:'pointer'}}>✕</button>
                    </>
                  ) : (
                    <>
                      <span style={{flex:1,fontSize:12,color:'#dde1f2'}}>{item.label}</span>
                      <button onClick={()=>startEditItem(item,'daily')}
                        style={{background:'transparent',border:'none',color:'#5e6585',fontSize:12,cursor:'pointer',padding:0}}>✏️</button>
                      <button onClick={()=>deleteItem(item.id,'daily')}
                        style={{background:'transparent',border:'none',color:'#f87171',fontSize:12,cursor:'pointer',padding:0}}>🗑</button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:8}}>
              <input value={newDaily} onChange={e=>setNewDaily(e.target.value)}
                placeholder="새 항목 이름 (예: 물수건 채우기)"
                style={{...inputStyle,flex:1}}/>
              <button onClick={addDailyItem} disabled={saving}
                style={{background:'#34d399',color:'#000',border:'none',borderRadius:7,
                  padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>
                + 추가
              </button>
            </div>
          </div>

          <div>
            <div style={{fontSize:11,color:'#5e6585',fontWeight:600,marginBottom:8}}>📅 요일별 필수 항목</div>
            <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:10}}>
              {weeklyItems.map(item=>(
                <div key={item.id} style={{background:'#191c2b',borderRadius:7,padding:'7px 10px',
                  display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                  {editItemId===item.id ? (
                    <div style={{display:'flex',flexDirection:'column',gap:8,width:'100%'}}>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                        <input value={editItemForm.label} onChange={e=>setEditItemForm(f=>({...f,label:e.target.value}))}
                          style={{...inputStyle,width:140}}/>
                        <select value={editItemForm.dow} onChange={e=>setEditItemForm(f=>({...f,dow:e.target.value}))} style={inputStyle}>
                          {DOW_LABELS.map((d,i)=><option key={i} value={i}>{d}요일</option>)}
                        </select>
                        <select value={editItemForm.time} onChange={e=>setEditItemForm(f=>({...f,time:e.target.value}))} style={inputStyle}>
                          <option value="오전">오전</option>
                          <option value="오후">오후</option>
                        </select>
                        <select value={editItemForm.interval||'weekly'} onChange={e=>setEditItemForm(f=>({...f,interval:e.target.value}))} style={inputStyle}>
                          <option value="weekly">매주</option>
                          <option value="biweekly">2주마다</option>
                        </select>
                        {editItemForm.interval==='biweekly' && (
                          <input type="date" value={editItemForm.baseDate||todayStr()}
                            onChange={e=>setEditItemForm(f=>({...f,baseDate:e.target.value}))} style={inputStyle}/>
                        )}
                      </div>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                        <span style={{fontSize:10,color:'#5e6585'}}>⏰ 알림(선택):</span>
                        <select value={editItemForm.alertUid||''} onChange={e=>setEditItemForm(f=>({...f,alertUid:e.target.value}))} style={inputStyle}>
                          <option value="">담당자 없음</option>
                          {employees.map(e=><option key={e.uid} value={e.uid}>{e.name}</option>)}
                        </select>
                        <input value={editItemForm.alertMsg||''} onChange={e=>setEditItemForm(f=>({...f,alertMsg:e.target.value}))}
                          placeholder="알림 문구 (예: 1시간 일찍 출근)" style={{...inputStyle,flex:1,minWidth:140}}/>
                      </div>
                      <div style={{display:'flex',gap:8}}>
                        <button onClick={saveEditItem} disabled={saving}
                          style={{background:'#f9b934',color:'#000',border:'none',borderRadius:5,padding:'6px 14px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>저장</button>
                        <button onClick={()=>{setEditItemId(null);setEditItemForm(null)}}
                          style={{background:'transparent',border:'1px solid #272a3d',color:'#5e6585',borderRadius:5,padding:'6px 14px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>취소</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{flex:1}}>
                        <div style={{fontSize:12,color:'#dde1f2'}}>
                          {item.label}
                          {item.interval==='biweekly' && <span style={{fontSize:10,color:'#a78bfa',marginLeft:6,fontWeight:700}}>2주마다</span>}
                        </div>
                        {(item.alertUid||item.alertMsg) && (
                          <div style={{fontSize:10,color:'#f87171',marginTop:2}}>
                            ⏰ {item.alertUid && alertNameOf(item.alertUid) ? `${alertNameOf(item.alertUid)}님 ` : ''}{item.alertMsg||'일찍 출근 필요'}
                          </div>
                        )}
                      </div>
                      <span style={{fontSize:11,color:'#93c5fd',fontWeight:600}}>{DOW_LABELS[item.dow]}요일</span>
                      <span style={{fontSize:11,color:'#f9b934',fontWeight:600}}>{item.time}</span>
                      <button onClick={()=>startEditItem(item,'weekly')}
                        style={{background:'transparent',border:'none',color:'#5e6585',fontSize:12,cursor:'pointer',padding:0}}>✏️</button>
                      <button onClick={()=>deleteItem(item.id,'weekly')}
                        style={{background:'transparent',border:'none',color:'#f87171',fontSize:12,cursor:'pointer',padding:0}}>🗑</button>
                    </>
                  )}
                </div>
              ))}
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                <input value={newWeekly.label} onChange={e=>setNewWeekly(f=>({...f,label:e.target.value}))}
                  placeholder="새 항목 이름 (예: 냉장고 성애제거)"
                  style={{...inputStyle,flex:1,minWidth:120}}/>
                <select value={newWeekly.dow} onChange={e=>setNewWeekly(f=>({...f,dow:e.target.value}))} style={inputStyle}>
                  {DOW_LABELS.map((d,i)=><option key={i} value={i}>{d}요일</option>)}
                </select>
                <select value={newWeekly.time} onChange={e=>setNewWeekly(f=>({...f,time:e.target.value}))} style={inputStyle}>
                  <option value="오전">오전</option>
                  <option value="오후">오후</option>
                </select>
                <select value={newWeekly.interval} onChange={e=>setNewWeekly(f=>({...f,interval:e.target.value}))} style={inputStyle}>
                  <option value="weekly">매주</option>
                  <option value="biweekly">2주마다</option>
                </select>
                {newWeekly.interval==='biweekly' && (
                  <div style={{display:'flex',alignItems:'center',gap:6}}>
                    <span style={{fontSize:10,color:'#5e6585'}}>기준일</span>
                    <input type="date" value={newWeekly.baseDate}
                      onChange={e=>setNewWeekly(f=>({...f,baseDate:e.target.value}))} style={inputStyle}/>
                  </div>
                )}
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                <span style={{fontSize:10,color:'#5e6585'}}>⏰ 알림(선택):</span>
                <select value={newWeekly.alertUid} onChange={e=>setNewWeekly(f=>({...f,alertUid:e.target.value}))} style={inputStyle}>
                  <option value="">담당자 없음</option>
                  {employees.map(e=><option key={e.uid} value={e.uid}>{e.name}</option>)}
                </select>
                <input value={newWeekly.alertMsg} onChange={e=>setNewWeekly(f=>({...f,alertMsg:e.target.value}))}
                  placeholder="알림 문구 (예: 1시간 일찍 출근 필요)" style={{...inputStyle,flex:1,minWidth:160}}/>
                <button onClick={addWeeklyItem} disabled={saving}
                  style={{background:'#34d399',color:'#000',border:'none',borderRadius:7,
                    padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>
                  + 추가
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 지난 기록 조회 */}
      {showHistory && (
        <div style={{background:'#12141f',border:'1px solid rgba(147,197,253,0.3)',borderRadius:12,
          padding:16,marginBottom:18}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap'}}>
            <span style={{fontSize:12,fontWeight:700,color:'#93c5fd'}}>📖 지난 기록 조회</span>
            <input type="date" value={historyDate} max={today}
              onChange={e=>setHistoryDate(e.target.value)}
              style={{...inputStyle}}/>
            <button onClick={()=>setShowHistory(false)}
              style={{background:'transparent',border:'1px solid #272a3d',color:'#5e6585',borderRadius:6,
                padding:'5px 10px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
              닫기
            </button>
          </div>
          {historyDow === CLOSED_DOW ? (
            <div style={{fontSize:12,color:'#5e6585',padding:'12px 0'}}>😴 일요일은 휴무일입니다</div>
          ) : (
            <>
              <div style={{fontSize:11,color:'#5e6585',marginBottom:10}}>
                {historyDate} ({DAYS_KR[historyDow]}) — 매일 {historyDailyDone}/{dailyTotalSlots} · 요일 {historyWeeklyDone}/{historyWeekly.length}
              </div>
              <div style={{fontSize:10,color:'#5e6585',fontWeight:600,marginBottom:6}}>매일 항목</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:8,marginBottom:14}}>
                {dailyItems.map(it=>DailyRow(it, historyDate))}
              </div>
              {historyWeekly.length>0 && (
                <>
                  <div style={{fontSize:10,color:'#5e6585',fontWeight:600,marginBottom:6}}>요일별 항목</div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:8}}>
                    {historyWeekly.map(it=>WeeklyRow(it, historyDate))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {loading ? (
        <div style={{textAlign:'center',color:'#5e6585',padding:60}}>로딩 중...</div>
      ) : todayDow === CLOSED_DOW ? (
        <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:40,textAlign:'center'}}>
          <div style={{fontSize:24,marginBottom:8}}>😴</div>
          <div style={{fontSize:14,color:'#5e6585',fontWeight:600}}>오늘은 일요일 휴무일입니다</div>
        </div>
      ) : (
        <>
          {/* 직전 영업일 못한 일 (일요일 건너뜀) */}
          {hasPrevUnfinished && (
            <div style={{background:'#12141f',border:'1px solid rgba(248,113,113,0.4)',borderRadius:12,
              padding:16,marginBottom:18}}>
              <div style={{fontSize:12,fontWeight:700,color:'#f87171',marginBottom:10}}>
                ⚠ {+prevBusinessDate.split('-')[2]}일({DAYS_KR[prevBusinessDow]}) 못한 일 {prevDailyUnfinished.length+prevWeeklyUnfinished.length}건
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:8}}>
                {prevDailyUnfinished.map(it=>DailyRow(it, prevBusinessDate))}
                {prevWeeklyUnfinished.map(it=>WeeklyRow(it, prevBusinessDate))}
              </div>
            </div>
          )}

          {/* 다가오는 특별 항목 미리 알림 (2~3일 전) */}
          {upcomingAlerts.length > 0 && (
            <div style={{marginBottom:18,display:'flex',flexDirection:'column',gap:8}}>
              {upcomingAlerts.map(({item,found})=>{
                const dLabel = found.offset===1 ? '내일' : `${found.offset}일 후`
                return (
                  <div key={item.id} style={{
                    background:'rgba(167,139,250,0.10)',border:'1.5px solid rgba(167,139,250,0.35)',
                    borderRadius:10,padding:'12px 16px',display:'flex',alignItems:'center',gap:10,
                  }}>
                    <span style={{fontSize:18}}>📌</span>
                    <div>
                      <div style={{fontSize:13,fontWeight:800,color:'#a78bfa'}}>
                        {dLabel}({DAYS_KR[found.dow]}) {item.label} 있는 날!
                      </div>
                      <div style={{fontSize:11,color:'#a78bfa',marginTop:2,fontWeight:600}}>
                        {item.alertUid && alertNameOf(item.alertUid) && `👤 ${alertNameOf(item.alertUid)}님 — `}
                        {item.alertMsg || '일찍 출근 필요'} <span style={{color:'#5e6585',fontWeight:400}}>({found.dateStr})</span>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* 오늘 할 일 (강조) */}
          <div style={{background:'linear-gradient(135deg,rgba(249,185,52,0.10),rgba(249,185,52,0.02))',
            border:'2px solid #f9b934',borderRadius:14,padding:20,marginBottom:24,
            boxShadow:'0 0 30px rgba(249,185,52,0.08)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
              <div>
                <div style={{fontSize:16,fontWeight:800,color:'#f9b934'}}>
                  🔥 오늘 ({DAYS_KR[todayDow]}) 할 일
                </div>
                <div style={{fontSize:11,color:'#5e6585',marginTop:2}}>{today}</div>
              </div>
              <div style={{background:'#191c2b',borderRadius:8,padding:'8px 14px'}}>
                <span style={{fontSize:16,fontWeight:800,color: todayDoneCount===todayTotalCount ? '#34d399' : '#f9b934'}}>
                  {todayDoneCount}
                </span>
                <span style={{fontSize:13,color:'#5e6585'}}> / {todayTotalCount}</span>
              </div>
            </div>

            {/* 오늘 조기출근/특별 알림 배너 */}
            {todayWeekly.filter(it=>it.alertUid||it.alertMsg).length > 0 && (
              <div style={{marginBottom:16,display:'flex',flexDirection:'column',gap:8}}>
                {todayWeekly.filter(it=>it.alertUid||it.alertMsg).map(it=>(
                  <div key={it.id} style={{
                    background:'rgba(248,113,113,0.12)',border:'1.5px solid rgba(248,113,113,0.4)',
                    borderRadius:10,padding:'12px 16px',display:'flex',alignItems:'center',gap:10,
                  }}>
                    <span style={{fontSize:18}}>🔔</span>
                    <div>
                      <div style={{fontSize:13,fontWeight:800,color:'#f87171'}}>
                        오늘은 {it.label} 있는 날!
                      </div>
                      <div style={{fontSize:11,color:'#f87171',marginTop:2,fontWeight:600}}>
                        {it.alertUid && alertNameOf(it.alertUid) && `👤 ${alertNameOf(it.alertUid)}님 — `}
                        {it.alertMsg || '일찍 출근 필요'}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div style={{fontSize:11,color:'#5e6585',fontWeight:600,marginBottom:8}}>
              📌 매일 항목 <span style={{color:'#3d4060'}}>({todayDailyDone}/{dailyTotalSlots})</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:8,marginBottom: todayWeekly.length>0?16:0}}>
              {dailyItems.map(it=>DailyRow(it, today, true))}
            </div>

            {todayWeekly.length > 0 && (
              <>
                <div style={{fontSize:11,color:'#5e6585',fontWeight:600,marginBottom:8}}>
                  📅 오늘의 요일별 항목 <span style={{color:'#3d4060'}}>({todayWeeklyDone}/{todayWeekly.length})</span>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:8}}>
                  {todayWeekly.map(it=>WeeklyRow(it, today, true))}
                </div>
              </>
            )}
          </div>

          {/* 이번주 전체 보기 */}
          <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden'}}>
            <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>
              📅 이번주 전체 보기 <span style={{fontSize:10,color:'#5e6585',fontWeight:400}}>— 요일을 클릭하면 전체 목록이 보여요</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:0}}>
              {DAYS_KR.map((dayName, dow)=>{
                const date = dateOfDow(dow)
                const isClosed = dow === CLOSED_DOW
                const weekly = getWeeklyForDate(date)
                const isToday = dow === todayDow
                const dDone = isClosed ? 0 : dailyDoneCount(date)
                const wDone = isClosed ? 0 : weekly.filter(it=>isChecked(date, it.id)).length
                const total = isClosed ? 0 : dailyTotalSlots + weekly.length
                const done  = dDone + wDone
                return (
                  <div key={dow} onClick={()=>!isClosed && setExpandedDow(v=>v===dow?null:dow)}
                    style={{
                    padding:'12px 8px',cursor: isClosed?'default':'pointer',
                    borderRight: dow<6 ? '1px solid #191c2b' : 'none',
                    background: isClosed ? 'rgba(94,101,133,0.04)' : expandedDow===dow ? 'rgba(249,185,52,0.12)' : isToday ? 'rgba(249,185,52,0.06)' : 'transparent',
                    outline: expandedDow===dow ? '1px solid rgba(249,185,52,0.5)' : 'none',
                    opacity: isClosed ? 0.5 : 1,
                  }}>
                    <div style={{textAlign:'center',marginBottom:8}}>
                      <div style={{fontSize:11,fontWeight:800,
                        color: isToday ? '#f9b934' : dow===0?'#f87171':dow===6?'#93c5fd':'#dde1f2'}}>
                        {dayName}
                      </div>
                      <div style={{fontSize:9,color:'#5e6585',marginTop:2}}>{+date.split('-')[2]}일</div>
                      {isClosed ? (
                        <div style={{fontSize:9,color:'#5e6585',marginTop:3,fontWeight:600}}>휴무</div>
                      ) : (
                        <div style={{fontSize:9,color: done===total && total>0 ?'#34d399':'#5e6585',
                          marginTop:3,fontWeight:600}}>
                          {done}/{total}
                        </div>
                      )}
                    </div>
                    {!isClosed && (
                      <div style={{display:'flex',flexDirection:'column',gap:3}}>
                        {weekly.map(it=>{
                          const wdone = isChecked(date, it.id)
                          return (
                            <div key={it.id} style={{
                              fontSize:8.5,padding:'3px 4px',borderRadius:4,textAlign:'center',
                              background: wdone?'rgba(52,211,153,0.15)':'rgba(94,101,133,0.1)',
                              color: wdone?'#34d399':'#5e6585',
                              textDecoration: wdone?'line-through':'none',
                              lineHeight:1.3,
                            }}>
                              {it.label}
                            </div>
                          )
                        })}
                        <div style={{fontSize:8,color:'#3d4060',textAlign:'center',marginTop:2}}>
                          +매일 {dailyItems.length}개
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {expandedDow !== null && (
              <div style={{borderTop:'1px solid #272a3d',padding:16,background:'rgba(249,185,52,0.03)'}}>
                <div style={{fontSize:12,fontWeight:700,color:'#f9b934',marginBottom:10}}>
                  {DAYS_KR[expandedDow]}요일 ({+dateOfDow(expandedDow).split('-')[2]}일) 전체 할 일
                </div>
                <div style={{fontSize:10,color:'#5e6585',fontWeight:600,marginBottom:6}}>매일 항목</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:8,marginBottom:14}}>
                  {dailyItems.map(it=>DailyRow(it, dateOfDow(expandedDow)))}
                </div>
                {getWeeklyForDate(dateOfDow(expandedDow)).length>0 && (
                  <>
                    <div style={{fontSize:10,color:'#5e6585',fontWeight:600,marginBottom:6}}>요일별 항목</div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:8}}>
                      {getWeeklyForDate(dateOfDow(expandedDow)).map(it=>WeeklyRow(it, dateOfDow(expandedDow)))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
