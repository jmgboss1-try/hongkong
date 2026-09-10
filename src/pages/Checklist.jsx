import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')
const DAYS_KR = ['일','월','화','수','목','금','토']

function todayStr() {
  const n = new Date()
  return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}`
}
function yesterdayStr() {
  const d = new Date()
  d.setDate(d.getDate()-1)
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
}
function dateOfDow(dow) {
  const today = new Date()
  const sunday = new Date(today)
  sunday.setDate(today.getDate() - today.getDay())
  const d = new Date(sunday)
  d.setDate(sunday.getDate() + dow)
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
}

// 기본값 (Firebase에 저장된 게 없을 때 최초 1회 사용)
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
  const [checks, setChecks]   = useState({}) // {date: {itemId: true}}
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)

  const [showHistory, setShowHistory] = useState(false)
  const [historyDate, setHistoryDate] = useState(todayStr())

    const [showManage, setShowManage] = useState(false)
  const [expandedDow, setExpandedDow] = useState(null) // 클릭해서 펼친 요일
  const [newDaily, setNewDaily]   = useState('')
  const [newWeekly, setNewWeekly] = useState({ label:'', dow:1, time:'오전' })
  const [editItemId, setEditItemId] = useState(null)
  const [editItemForm, setEditItemForm] = useState(null)

  const today = todayStr()
  const yesterday = yesterdayStr()
  const todayDow = new Date().getDay()
  const historyDow = new Date(historyDate).getDay()

  async function load() {
    setLoading(true)
    try {
      const [cfgSnap, recSnap] = await Promise.all([
        getDoc(doc(db,'checklist','config')),
        getDoc(doc(db,'checklist','records')),
      ])
      if(cfgSnap.exists()) {
        const cfg = cfgSnap.data()
        setDailyItems(cfg.daily || DEFAULT_DAILY)
        setWeeklyItems(cfg.weekly || DEFAULT_WEEKLY)
      } else {
        // 최초 진입 시 기본값을 Firebase에 저장
        await setDoc(doc(db,'checklist','config'), { daily: DEFAULT_DAILY, weekly: DEFAULT_WEEKLY })
      }
      setChecks(recSnap.exists() ? (recSnap.data().byDate||{}) : {})
    } catch(e) { console.error(e) }
    setLoading(false)
  }
  useEffect(()=>{ load() },[])

  async function saveConfig(newDaily, newWeekly) {
    await setDoc(doc(db,'checklist','config'), { daily:newDaily, weekly:newWeekly })
    setDailyItems(newDaily)
    setWeeklyItems(newWeekly)
  }

  async function toggleCheck(date, itemId) {
    const dayChecks = { ...(checks[date]||{}) }
    if(dayChecks[itemId]) delete dayChecks[itemId]
    else dayChecks[itemId] = true
    const newChecks = { ...checks, [date]: dayChecks }
    await setDoc(doc(db,'checklist','records'), { byDate: newChecks })
    setChecks(newChecks)
  }

  const isChecked = (date, itemId) => !!(checks[date]?.[itemId])

  function getItemsForDow(dow) {
    return [...dailyItems, ...weeklyItems.filter(w=>w.dow===dow)]
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
    const item = { id:'w_'+Date.now(), label:newWeekly.label.trim(), dow:+newWeekly.dow, time:newWeekly.time }
    await saveConfig(dailyItems, [...weeklyItems, item])
    setNewWeekly({ label:'', dow:1, time:'오전' })
    setSaving(false)
  }
  function startEditItem(item, type) {
    setEditItemId(item.id)
    setEditItemForm({ ...item, type })
  }
  async function saveEditItem() {
    setSaving(true)
    if(editItemForm.type === 'daily') {
      const newDailyList = dailyItems.map(it=>it.id===editItemId ? { id:it.id, label:editItemForm.label } : it)
      await saveConfig(newDailyList, weeklyItems)
    } else {
      const newWeeklyList = weeklyItems.map(it=>it.id===editItemId
        ? { id:it.id, label:editItemForm.label, dow:+editItemForm.dow, time:editItemForm.time } : it)
      await saveConfig(dailyItems, newWeeklyList)
    }
    setEditItemId(null); setEditItemForm(null)
    setSaving(false)
  }
  async function deleteItem(id, type) {
    if(!window.confirm('이 항목을 삭제하시겠습니까?')) return
    if(type === 'daily') await saveConfig(dailyItems.filter(it=>it.id!==id), weeklyItems)
    else await saveConfig(dailyItems, weeklyItems.filter(it=>it.id!==id))
  }

  // 어제 못한 일
  const yestDow = new Date(new Date().setDate(new Date().getDate()-1)).getDay()
  const yestItems = getItemsForDow(yestDow)
  const yestUnfinished = yestItems.filter(it => !isChecked(yesterday, it.id))

  const todayItems = getItemsForDow(todayDow)
  const todayDoneCount = todayItems.filter(it=>isChecked(today, it.id)).length

  const historyItems = getItemsForDow(historyDow)
  const historyDoneCount = historyItems.filter(it=>isChecked(historyDate, it.id)).length

  const itemRow = (item, date, big=false) => {
    const done = isChecked(date, item.id)
    return (
      <div key={item.id+date} onClick={()=>toggleCheck(date, item.id)}
        style={{
          display:'flex',alignItems:'center',gap:8,
          padding: big ? '10px 12px' : '7px 10px',
          borderRadius:8,cursor:'pointer',
          background: done ? 'rgba(52,211,153,0.08)' : '#191c2b',
          border: done ? '1px solid rgba(52,211,153,0.3)' : '1px solid #272a3d',
          transition:'.15s'
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
          {item.time && <span style={{fontSize:big?11:10,color:'#f9b934',marginLeft:6,fontWeight:700}}>({item.time})</span>}
        </span>
      </div>
    )
  }

  const inputStyle = {
    background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
    padding:'8px 10px',fontSize:12,outline:'none',fontFamily:'inherit'
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22,flexWrap:'wrap',gap:10}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>✅ 오늘의 체크리스트</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>매일·요일별 필수 업무</div>
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

          {/* 매일 항목 */}
          <div style={{marginBottom:20}}>
            <div style={{fontSize:11,color:'#5e6585',fontWeight:600,marginBottom:8}}>📌 매일 필수 항목</div>
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

          {/* 요일별 항목 */}
          <div>
            <div style={{fontSize:11,color:'#5e6585',fontWeight:600,marginBottom:8}}>📅 요일별 필수 항목</div>
            <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:10}}>
              {weeklyItems.map(item=>(
                <div key={item.id} style={{background:'#191c2b',borderRadius:7,padding:'7px 10px',
                  display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                  {editItemId===item.id ? (
                    <>
                      <input value={editItemForm.label} onChange={e=>setEditItemForm(f=>({...f,label:e.target.value}))}
                        style={{...inputStyle,width:140}}/>
                      <select value={editItemForm.dow} onChange={e=>setEditItemForm(f=>({...f,dow:e.target.value}))} style={inputStyle}>
                        {DOW_LABELS.map((d,i)=><option key={i} value={i}>{d}요일</option>)}
                      </select>
                      <select value={editItemForm.time} onChange={e=>setEditItemForm(f=>({...f,time:e.target.value}))} style={inputStyle}>
                        <option value="오전">오전</option>
                        <option value="오후">오후</option>
                      </select>
                      <button onClick={saveEditItem} disabled={saving}
                        style={{background:'#f9b934',color:'#000',border:'none',borderRadius:5,padding:'5px 10px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>저장</button>
                      <button onClick={()=>{setEditItemId(null);setEditItemForm(null)}}
                        style={{background:'transparent',border:'none',color:'#5e6585',fontSize:12,cursor:'pointer'}}>✕</button>
                    </>
                  ) : (
                    <>
                      <span style={{flex:1,fontSize:12,color:'#dde1f2'}}>{item.label}</span>
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
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              <input value={newWeekly.label} onChange={e=>setNewWeekly(f=>({...f,label:e.target.value}))}
                placeholder="새 항목 이름"
                style={{...inputStyle,flex:1,minWidth:120}}/>
              <select value={newWeekly.dow} onChange={e=>setNewWeekly(f=>({...f,dow:e.target.value}))} style={inputStyle}>
                {DOW_LABELS.map((d,i)=><option key={i} value={i}>{d}요일</option>)}
              </select>
              <select value={newWeekly.time} onChange={e=>setNewWeekly(f=>({...f,time:e.target.value}))} style={inputStyle}>
                <option value="오전">오전</option>
                <option value="오후">오후</option>
              </select>
              <button onClick={addWeeklyItem} disabled={saving}
                style={{background:'#34d399',color:'#000',border:'none',borderRadius:7,
                  padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>
                + 추가
              </button>
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
          <div style={{fontSize:11,color:'#5e6585',marginBottom:10}}>
            {historyDate} ({DAYS_KR[historyDow]}) — 완료 {historyDoneCount} / {historyItems.length}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:8}}>
            {historyItems.map(it=>{
              const done = isChecked(historyDate, it.id)
              return (
                <div key={it.id} style={{
                  display:'flex',alignItems:'center',gap:8,padding:'7px 10px',borderRadius:7,
                  background: done ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.06)',
                  border: done ? '1px solid rgba(52,211,153,0.25)' : '1px solid rgba(248,113,113,0.2)',
                }}>
                  <span style={{fontSize:13}}>{done ? '✅' : '❌'}</span>
                  <span style={{fontSize:12,color: done?'#dde1f2':'#f87171'}}>
                    {it.label}
                    {it.time && <span style={{fontSize:10,color:'#5e6585',marginLeft:5}}>({it.time})</span>}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {loading ? (
        <div style={{textAlign:'center',color:'#5e6585',padding:60}}>로딩 중...</div>
      ) : (
        <>
          {/* 어제 못한 일 */}
          {yestUnfinished.length > 0 && (
            <div style={{background:'#12141f',border:'1px solid rgba(248,113,113,0.4)',borderRadius:12,
              padding:16,marginBottom:18}}>
              <div style={{fontSize:12,fontWeight:700,color:'#f87171',marginBottom:10}}>
                ⚠ 어제({+yesterday.split('-')[2]}일) 못한 일 {yestUnfinished.length}건
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:8}}>
                {yestUnfinished.map(it=>itemRow(it, yesterday))}
              </div>
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
                <span style={{fontSize:16,fontWeight:800,color: todayDoneCount===todayItems.length ? '#34d399' : '#f9b934'}}>
                  {todayDoneCount}
                </span>
                <span style={{fontSize:13,color:'#5e6585'}}> / {todayItems.length}</span>
              </div>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:8}}>
              {todayItems.map(it=>itemRow(it, today, true))}
            </div>
          </div>

                    {/* 이번주 전체 보기 */}
          <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden'}}>
            <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>
              📅 이번주 전체 보기 <span style={{fontSize:10,color:'#5e6585',fontWeight:400}}>— 요일을 클릭하면 전체 목록이 보여요</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:0}}>
              {DAYS_KR.map((dayName, dow)=>{
                const date = dateOfDow(dow)
                const items = getItemsForDow(dow)
                const isToday = dow === todayDow
                const doneCount = items.filter(it=>isChecked(date, it.id)).length
                return (
                  <div key={dow} onClick={()=>setExpandedDow(v=>v===dow?null:dow)}
                    style={{
                    padding:'12px 8px',cursor:'pointer',
                    borderRight: dow<6 ? '1px solid #191c2b' : 'none',
                    background: expandedDow===dow ? 'rgba(249,185,52,0.12)' : isToday ? 'rgba(249,185,52,0.06)' : 'transparent',
                    outline: expandedDow===dow ? '1px solid rgba(249,185,52,0.5)' : 'none',
                  }}>
                    <div style={{textAlign:'center',marginBottom:8}}>
                      <div style={{fontSize:11,fontWeight:800,
                        color: isToday ? '#f9b934' : dow===0?'#f87171':dow===6?'#93c5fd':'#dde1f2'}}>
                        {dayName}
                      </div>
                      <div style={{fontSize:9,color:'#5e6585',marginTop:2}}>{+date.split('-')[2]}일</div>
                      <div style={{fontSize:9,color: doneCount===items.length && items.length>0 ?'#34d399':'#5e6585',
                        marginTop:3,fontWeight:600}}>
                        {doneCount}/{items.length}
                      </div>
                    </div>
                    <div style={{display:'flex',flexDirection:'column',gap:3}}>
                      {items.filter(it=>it.dow!==undefined).map(it=>{
                        const done = isChecked(date, it.id)
                        return (
                          <div key={it.id} style={{
                            fontSize:8.5,padding:'3px 4px',borderRadius:4,textAlign:'center',
                            background: done?'rgba(52,211,153,0.15)':'rgba(94,101,133,0.1)',
                            color: done?'#34d399':'#5e6585',
                            textDecoration: done?'line-through':'none',
                            lineHeight:1.3,
                          }}>
                            {it.label}
                          </div>
                        )
                      })}
                      {items.filter(it=>it.dow===undefined).length > 0 && (
                        <div style={{fontSize:8,color:'#3d4060',textAlign:'center',marginTop:2}}>
                          +매일 {items.filter(it=>it.dow===undefined).length}개
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {/* 펼쳐진 요일 전체 목록 */}
            {expandedDow !== null && (
              <div style={{borderTop:'1px solid #272a3d',padding:16,background:'rgba(249,185,52,0.03)'}}>
                <div style={{fontSize:12,fontWeight:700,color:'#f9b934',marginBottom:10}}>
                  {DAYS_KR[expandedDow]}요일 ({+dateOfDow(expandedDow).split('-')[2]}일) 전체 할 일
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:8}}>
                  {getItemsForDow(expandedDow).map(it=>itemRow(it, dateOfDow(expandedDow)))}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
