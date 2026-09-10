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
  // 이번주(일~토) 기준 해당 요일 날짜 계산
  const today = new Date()
  const sunday = new Date(today)
  sunday.setDate(today.getDate() - today.getDay())
  const d = new Date(sunday)
  d.setDate(sunday.getDate() + dow)
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
}

// 매일 필수 항목
const DAILY_ITEMS = [
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

// 요일별 필수 항목 (dow: 0=일 ~ 6=토)
const WEEKLY_ITEMS = [
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

export default function Checklist() {
  const [checks, setChecks]   = useState({}) // {date: {itemId: true}}
  const [loading, setLoading] = useState(true)
  const today = todayStr()
  const yesterday = yesterdayStr()
  const todayDow = new Date().getDay()

  async function load() {
    setLoading(true)
    try {
      const snap = await getDoc(doc(db,'checklist','records'))
      setChecks(snap.exists() ? (snap.data().byDate||{}) : {})
    } catch(e) { console.error(e) }
    setLoading(false)
  }
  useEffect(()=>{ load() },[])

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
    return [...DAILY_ITEMS, ...WEEKLY_ITEMS.filter(w=>w.dow===dow)]
  }

  // 오늘 할 일
  const todayItems = getItemsForDow(todayDow)
  const todayDoneCount = todayItems.filter(it=>isChecked(today, it.id)).length

  // 어제 못한 일 (매일 필수만 대상으로 이월 표시 — 요일항목은 그날만 유효하므로 매일항목 위주로 체크)
  const yestItems = getItemsForDow(new Date(new Date().setDate(new Date().getDate()-1)).getDay())
  const yestUnfinished = yestItems.filter(it => !isChecked(yesterday, it.id))

  const itemRow = (item, date, big=false) => {
    const done = isChecked(date, item.id)
    return (
      <div key={item.id+date} onClick={()=>toggleCheck(date, item.id)}
        style={{
          display:'flex',alignItems:'center',gap:10,
          padding: big ? '12px 14px' : '8px 12px',
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

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22,flexWrap:'wrap',gap:10}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>✅ 오늘의 체크리스트</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>매일·요일별 필수 업무</div>
        </div>
      </div>

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
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
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
              📅 이번주 전체 보기
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:0}}>
              {DAYS_KR.map((dayName, dow)=>{
                const date = dateOfDow(dow)
                const items = getItemsForDow(dow)
                const isToday = dow === todayDow
                const isPast = date < today
                const doneCount = items.filter(it=>isChecked(date, it.id)).length
                return (
                  <div key={dow} style={{
                    padding:'12px 8px',
                    borderRight: dow<6 ? '1px solid #191c2b' : 'none',
                    background: isToday ? 'rgba(249,185,52,0.06)' : 'transparent',
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
          </div>
        </>
      )}
    </div>
  )
}
