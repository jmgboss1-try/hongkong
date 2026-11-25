import { useEffect, useRef, useState } from 'react'
import { prevYmOf, monthNum, rewardResults } from '../lib/rewards'
import { db } from '../firebase'
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, deleteField } from 'firebase/firestore'
import { PhotoPicker, PhotoGrid, Lightbox } from '../components/PhotoAttach'

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

// 임시휴무(등록된 날짜구간) 중 해당 날짜를 포함하는 항목 찾기. 없으면 null.
function holidayInfoOf(dateStr, holidays) {
  return (holidays||[]).find(h => h.startDate <= dateStr && dateStr <= h.endDate) || null
}
// 일요일(고정휴무) 이거나 등록된 임시휴무 기간에 포함되면 휴무일
function isClosedDate(dateStr, holidays) {
  return dowOfDate(dateStr) === CLOSED_DOW || !!holidayInfoOf(dateStr, holidays)
}

// 오늘 기준 가장 최근 "영업일"(일요일+임시휴무 제외) 하루 전 날짜 찾기
function lastBusinessDayBefore(dateStr, holidays) {
  let d = new Date(dateStr)
  for(let i=0;i<14;i++){
    d.setDate(d.getDate()-1)
    const ds = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
    if(!isClosedDate(ds, holidays)) {
      return ds
    }
  }
  return null
}

// 요일 항목의 반복 주기: weekly(매주) · biweekly(2주) · w3 · w4 · w6 · w8 (N주마다)
const INTERVALS = [
  { v:'weekly', label:'매주', n:1 }, { v:'biweekly', label:'2주마다', n:2 }, { v:'w3', label:'3주마다', n:3 },
  { v:'w4', label:'4주마다', n:4 }, { v:'w6', label:'6주마다', n:6 }, { v:'w8', label:'8주마다', n:8 },
]
const weeksOf = interval => INTERVALS.find(x=>x.v===interval)?.n || 1
const intervalLabel = interval => weeksOf(interval) > 1 ? INTERVALS.find(x=>x.v===interval).label : ''
// 월요일 시작 주 번호 (1970-01-05 월요일 기준)
const weekNo = dateStr => { const [y,m,d] = dateStr.split('-').map(Number); return Math.floor((Date.UTC(y,m-1,d) - Date.UTC(1970,0,5)) / (7*86400000)) }
// N주마다 항목이 그 날짜가 있는 주에 하는지: 기준일이 있는 주부터 N주 간격 (기준일이 그 요일이 아니어도 됨)
function isBiweeklyActive(item, dateStr) {
  const n = weeksOf(item.interval)
  if(n <= 1 || !item.baseDate) return true
  const diff = weekNo(dateStr) - weekNo(item.baseDate)
  return ((diff % n) + n) % n === 0
}

// N주마다 항목의 다음 세 번 (휴무일 무시, 날짜만 보여 줌)
function NextDates({ item }) {
  const out = []
  const d = new Date()
  for(let i=0; i<=120 && out.length<3; i++){
    const ds = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
    if(d.getDay()===item.dow && isBiweeklyActive(item, ds)) out.push(`${d.getMonth()+1}/${d.getDate()}`)
    d.setDate(d.getDate()+1)
  }
  return <span style={{fontSize:10,color:'#6B4FA0'}}>다음: {out.join(', ') || '—'}</span>
}

// 오늘부터 daysAhead일 후까지(당일 포함) 그 항목이 실제로 발생하는 날짜를 찾아서 반환. 없으면 null.
function findUpcomingDate(item, daysAhead, holidays) {
  for(let i=0; i<=daysAhead; i++){
    const d = new Date()
    d.setDate(d.getDate()+i)
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
    if(isClosedDate(dateStr, holidays)) continue // 휴무일(일요일+임시휴무)은 건너뜀
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

// 오늘 할 일 움직임: 새 줄은 살짝 올라오며 나타나고, 체크 표시는 '톡' 커짐 (움직임 줄이기 설정이면 없음)
const CK_CSS = `@keyframes ckIn { from { opacity:0; transform: translateY(6px) } to { opacity:1; transform:none } }
@keyframes ckPop { 0% { transform: scale(.4) } 60% { transform: scale(1.25) } 100% { transform: scale(1) } }
.ck-in { animation: ckIn .28s ease-out both }
.ck-pop { animation: ckPop .3s cubic-bezier(.3,1.6,.5,1) both }
@media (prefers-reduced-motion: reduce) { .ck-in, .ck-pop { animation: none } }`

export default function Checklist() {
  const [dailyItems, setDailyItems]   = useState(DEFAULT_DAILY)
  const [weeklyItems, setWeeklyItems] = useState(DEFAULT_WEEKLY)
  const [checks, setChecks]   = useState({}) // {date: {itemId: true}} — 매일항목은 itemId_am / itemId_pm 로 저장
  const [holidays, setHolidays] = useState([]) // [{id,startDate,endDate,reason}] 임시휴무 목록
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)

  const [showHistory, setShowHistory] = useState(false)
  const [historyDate, setHistoryDate] = useState(todayStr())

  const [showManage, setShowManage] = useState(false)
  const [newDaily, setNewDaily]   = useState('')
  const [newWeekly, setNewWeekly] = useState({ label:'', dow:1, time:'오전', interval:'weekly', baseDate: todayStr(), alertUid:'', alertMsg:'' })
  const [editItemId, setEditItemId] = useState(null)
  const [editItemForm, setEditItemForm] = useState(null)

  const [photoViewer, setPhotoViewer] = useState(null) // {label, images}
  const [photoEditId, setPhotoEditId] = useState(null)
  const [photoEditImages, setPhotoEditImages] = useState([])
  const [photoLoading, setPhotoLoading] = useState(false)

  const [showHolidayManage, setShowHolidayManage] = useState(false)
  const [newHoliday, setNewHoliday] = useState({ startDate: todayStr(), endDate: todayStr(), reason:'' })

  const [expandedDow, setExpandedDow] = useState(null)
  const [employees, setEmployees] = useState([]) // [{uid,name}]
  const [subRequests, setSubRequests] = useState([]) // 대타 확정 목록
  const [pinnedNotices, setPinnedNotices] = useState([]) // 공지/메모 중 체크리스트 알림 대상
  const [reward, setReward] = useState(null) // 지난달 개근 포상 (rewards/{지난달}) — 매장에 공개
  useEffect(() => {
    getDoc(doc(db,'rewards',prevYmOf())).then(s => setReward(s.exists() ? s.data() : null)).catch(() => {})
  }, [])

  const today = todayStr()
  const todayDow = new Date().getDay()
  const historyDow = new Date(historyDate).getDay()

  const todayHolidayInfo = holidayInfoOf(today, holidays)
  const todayClosed = todayDow === CLOSED_DOW || !!todayHolidayInfo
  const historyHolidayInfo = holidayInfoOf(historyDate, holidays)
  const historyClosed = historyDow === CLOSED_DOW || !!historyHolidayInfo

  // 일요일/임시휴무 다음 영업일 기준 "어제" = 가장 최근 휴무 아닌 전날
  const prevBusinessDate = lastBusinessDayBefore(today, holidays)
  const prevBusinessDow  = prevBusinessDate ? dowOfDate(prevBusinessDate) : null

  async function load() {
    setLoading(true)
    try {
      const [cfgSnap, recSnap, usersSnap, subSnap, noticeSnap, memoSnap, holSnap] = await Promise.all([
        getDoc(doc(db,'checklist','config')),
        getDoc(doc(db,'checklist','records')),
        getDocs(collection(db,'users')),
        getDoc(doc(db,'substitutes','requests')),
        getDocs(collection(db,'notices')),
        getDocs(collection(db,'memos')),
        getDoc(doc(db,'checklist','holidays')),
      ])
      if(cfgSnap.exists()) {
        const cfg = cfgSnap.data()
        setDailyItems(cfg.daily || DEFAULT_DAILY)
        setWeeklyItems((cfg.weekly || DEFAULT_WEEKLY).map(w=>({ interval:'weekly', ...w })))
      } else {
        await setDoc(doc(db,'checklist','config'), { daily: DEFAULT_DAILY, weekly: DEFAULT_WEEKLY })
      }
      setChecks(recSnap.exists() ? (recSnap.data().byDate||{}) : {})
      setHolidays(holSnap.exists() ? (holSnap.data().list||[]) : [])
      const emps = []
      usersSnap.forEach(d=>{
        const data = d.data()
        if(data.status==='approved' && !['owner','store','investor'].includes(data.role))
          emps.push({ uid:d.id, name:data.name })
      })
      setEmployees(emps)
      setSubRequests(subSnap.exists() ? (subSnap.data().list||[]) : [])

      const nowDate = todayStr()
      const pinned = []
      noticeSnap.forEach(d=>{
        const data = d.data()
        if(data.checklistAlert && data.alertStart && data.alertEnd &&
           data.alertStart<=nowDate && nowDate<=data.alertEnd) {
          pinned.push({ type:'notice', id:d.id, content:data.content, authorName:data.authorName, images:data.images||[] })
        }
      })
      memoSnap.forEach(d=>{
        const data = d.data()
        if(data.checklistAlert && data.alertStart && data.alertEnd &&
           data.alertStart<=nowDate && nowDate<=data.alertEnd) {
          pinned.push({ type:'memo', id:d.id, content:data.content, authorName:data.authorName, images:data.images||[] })
        }
      })
      setPinnedNotices(pinned)
    } catch(e) { console.error(e) }
    setLoading(false)
  }
  useEffect(()=>{ load() },[])

  async function saveConfig(nd, nw) {
    await setDoc(doc(db,'checklist','config'), { daily:nd, weekly:nw })
    setDailyItems(nd)
    setWeeklyItems(nw)
  }

  // 체크 하나만 바꿔 씀 (매장 포스·직원 폰이 동시에 체크해도 서로 덮어쓰지 않게, 연달아 빨리 눌러도 앞의 체크가 사라지지 않게)
  async function toggleCheck(date, checkKey, value) {
    const on = value ?? !checks[date]?.[checkKey]
    setChecks(c => {
      const day = { ...(c[date] || {}) }
      if (on) day[checkKey] = true; else delete day[checkKey]
      return { ...c, [date]: day }
    })
    await setDoc(doc(db,'checklist','records'), { byDate: { [date]: { [checkKey]: on ? true : deleteField() } } }, { merge: true })
  }

  // ── 오늘 할 일: 오전 · 오후 · 완료 탭. 체크하면 그 줄이 '완료' 탭으로 날아가며 사라짐 ──
  const [taskTab, setTaskTab] = useState(() => new Date().getHours() < 15 ? '오전' : '오후')
  const [leaving, setLeaving] = useState({})   // 날아가는 중인 칸 {key: true} (그동안은 목록에 체크된 채로 남김)
  const doneTabRef = useRef(null)
  function completeTask(key, btn) {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const wrap = btn?.closest('[data-task]')
    if (reduce || !wrap?.animate || !doneTabRef.current) { toggleCheck(today, key, true); return }
    setLeaving(l => ({ ...l, [key]: true }))
    toggleCheck(today, key, true)
    // 체크 표시가 '톡' 하고 나온 뒤 완료 탭으로 날아감
    setTimeout(() => {
      const r = btn.getBoundingClientRect(), t = doneTabRef.current?.getBoundingClientRect()
      if (t) {
        const ghost = btn.cloneNode(true)
        Object.assign(ghost.style, { position:'fixed', left:`${r.left}px`, top:`${r.top}px`, width:`${r.width}px`, height:`${r.height}px`,
          margin:'0', zIndex:'1000', pointerEvents:'none', boxShadow:'0 10px 30px rgba(29,27,24,.18)', transformOrigin:'center' })
        document.body.appendChild(ghost)
        const dx = t.left + t.width / 2 - (r.left + r.width / 2), dy = t.top + t.height / 2 - (r.top + r.height / 2)
        ghost.animate([
          { transform:'translate(0,0) scale(1)', opacity:1 },
          { transform:`translate(${dx * 0.35}px, ${dy * 0.35 - 30}px) scale(.75)`, opacity:.95, offset:.35 },
          { transform:`translate(${dx}px, ${dy}px) scale(.12)`, opacity:.3 },
        ], { duration:560, easing:'cubic-bezier(.5,0,.6,1)' }).finished.then(() => {
          ghost.remove()
          doneTabRef.current?.animate([{ transform:'scale(1)' }, { transform:'scale(1.18)' }, { transform:'scale(1)' }], { duration:320, easing:'ease-out' })
        })
      }
      wrap.style.overflow = 'hidden'
      wrap.animate([{ height:`${wrap.offsetHeight}px`, opacity:1 }, { height:'0px', opacity:0 }],
        { duration:380, delay:60, easing:'cubic-bezier(.4,0,.2,1)', fill:'forwards' })
        .finished.then(() => setLeaving(l => { const n = { ...l }; delete n[key]; return n }))
    }, 260)
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
      baseDate: weeksOf(newWeekly.interval) > 1 ? newWeekly.baseDate : null,
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
      const nd = dailyItems.map(it=>it.id===editItemId ? { id:it.id, label:editItemForm.label, photoCount: it.photoCount||0 } : it)
      await saveConfig(nd, weeklyItems)
    } else {
      const nw = weeklyItems.map(it=>it.id===editItemId
        ? { id:it.id, label:editItemForm.label, photoCount: it.photoCount||0, dow:+editItemForm.dow, time:editItemForm.time,
            interval: editItemForm.interval || 'weekly',
            baseDate: weeksOf(editItemForm.interval) > 1 ? (editItemForm.baseDate||todayStr()) : null,
            alertUid: editItemForm.alertUid || '',
            alertMsg: editItemForm.alertMsg || '' } : it)
      await saveConfig(dailyItems, nw)
    }
    setEditItemId(null); setEditItemForm(null)
    setSaving(false)
  }
  async function deleteItem(id, type) {
    if(!window.confirm('이 항목을 삭제하시겠습니까?')) return
    try { await deleteDoc(doc(db,'checklistPhotos',id)) } catch(e) { console.error(e) }
    if(type === 'daily') await saveConfig(dailyItems.filter(it=>it.id!==id), weeklyItems)
    else await saveConfig(dailyItems, weeklyItems.filter(it=>it.id!==id))
  }

  // ── 항목별 참고 사진 ──
  async function openItemPhotos(item) {
    setPhotoLoading(true)
    try {
      const snap = await getDoc(doc(db,'checklistPhotos',item.id))
      setPhotoViewer({ label:item.label, images: snap.exists() ? (snap.data().images||[]) : [] })
    } catch(e) { console.error(e) }
    setPhotoLoading(false)
  }
  async function startEditPhotos(item) {
    if(photoEditId===item.id) { setPhotoEditId(null); return }
    setPhotoLoading(true)
    try {
      const snap = await getDoc(doc(db,'checklistPhotos',item.id))
      setPhotoEditImages(snap.exists() ? (snap.data().images||[]) : [])
      setPhotoEditId(item.id)
    } catch(e) { console.error(e) }
    setPhotoLoading(false)
  }
  async function saveItemPhotos() {
    const id = photoEditId
    if(!id) return
    setSaving(true)
    try {
      if(photoEditImages.length===0) await deleteDoc(doc(db,'checklistPhotos',id))
      else await setDoc(doc(db,'checklistPhotos',id), { images: photoEditImages })
      const cnt = photoEditImages.length
      await saveConfig(
        dailyItems.map(it=>it.id===id ? { ...it, photoCount:cnt } : it),
        weeklyItems.map(it=>it.id===id ? { ...it, photoCount:cnt } : it)
      )
      setPhotoEditId(null); setPhotoEditImages([])
    } catch(e) { console.error(e); alert('사진 저장에 실패했어요') }
    setSaving(false)
  }
  function ItemPhotoPanel(item) {
    if(photoEditId!==item.id) return null
    return (
      <div style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:4,padding:10,marginTop:4}}>
        <div style={{fontSize:11,color:'#2B5C9E',fontWeight:700,marginBottom:8}}>{item.label} — 참고 사진 (완성 기준·위치 등)</div>
        <PhotoPicker images={photoEditImages} onChange={setPhotoEditImages} max={3}/>
        <div style={{display:'flex',gap:8}}>
          <button onClick={saveItemPhotos} disabled={saving}
            style={{background:'var(--hk-accent)',color:'#FFFFFF',border:'none',borderRadius:5,padding:'6px 14px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>사진 저장</button>
          <button onClick={()=>{setPhotoEditId(null);setPhotoEditImages([])}}
            style={{background:'transparent',border:'1px solid #DCD7CE',color:'#6E6A63',borderRadius:5,padding:'6px 14px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>취소</button>
        </div>
      </div>
    )
  }
  function PhotoBadge(item) {
    if(!(item.photoCount>0)) return null
    return (
      <button onClick={e=>{ e.stopPropagation(); openItemPhotos(item) }}
        style={{border:'none',cursor:'pointer',background:'rgba(43,92,158,0.15)',color:'#2B5C9E',
          borderRadius:6,padding:'4px 8px',fontSize:10,fontWeight:700,fontFamily:'inherit',flexShrink:0}}>
        {item.photoCount}
      </button>
    )
  }

  // ── 임시휴무 관리 ──
  async function saveHolidays(list) {
    await setDoc(doc(db,'checklist','holidays'), { list })
    setHolidays(list)
  }
  async function addHoliday() {
    if(!newHoliday.startDate || !newHoliday.endDate) return
    if(newHoliday.startDate > newHoliday.endDate) { alert('종료일이 시작일보다 빠릅니다'); return }
    setSaving(true)
    const item = {
      id:'h_'+Date.now(),
      startDate:newHoliday.startDate, endDate:newHoliday.endDate,
      reason: newHoliday.reason.trim() || '임시휴무',
    }
    await saveHolidays([...holidays, item])
    setNewHoliday({ startDate: todayStr(), endDate: todayStr(), reason:'' })
    setSaving(false)
  }
  async function deleteHoliday(id) {
    if(!window.confirm('이 임시휴무 등록을 삭제하시겠습니까?')) return
    await saveHolidays(holidays.filter(h=>h.id!==id))
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
    .map(it=>({ item:it, found: findUpcomingDate(it, 3, holidays) }))
    .filter(x=>x.found && x.found.offset>0) // 0=오늘은 제외, 1~3일 후만

  const nameOf = uid => employees.find(e=>e.uid===uid)?.name || '—'

    // 아직 확정 안 된 대타 요청 (D-30 이내 — 지원자를 빨리 구해야 하니 넉넉하게)
  const openSubs = subRequests
    .filter(r=>!r.confirmedUid)
    .map(r=>{
      const diffDays = Math.round((new Date(r.date) - new Date(today)) / (1000*60*60*24))
      return { ...r, diffDays }
    })
    .filter(r=>r.diffDays>=0 && r.diffDays<=30)
    .sort((a,b)=>a.diffDays-b.diffDays)

  // 알림 한 줄: 왼쪽 색 띠 + 꼬리표 + 내용 (박스를 작게, 색으로 구분)
  const alertRow = (key, color, tag, title, sub, extra) => (
    <div key={key} style={{display:'flex',alignItems:'baseline',gap:10,padding:'7px 12px',
      borderLeft:`4px solid ${color}`,background:`${color}12`,borderRadius:'0 4px 4px 0'}}>
      <span style={{fontSize:12,fontWeight:800,color,whiteSpace:'nowrap',flexShrink:0}}>{tag}</span>
      <div style={{flex:1,minWidth:0,fontSize:13,color:'#1D1B18',lineHeight:1.5}}>
        <span style={{fontWeight:700}}>{title}</span>
        {sub && <span style={{fontSize:12,color:'#6E6A63',marginLeft:8}}>{sub}</span>}
        {extra}
      </div>
    </div>
  )

  // 직전 영업일 미완료 항목 (일요일+임시휴무는 건너뛰고 계산됨)
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
    background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,color:'#1D1B18',
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
        borderRadius:4,
        background: bothDone ? 'rgba(46,125,69,0.08)' : '#F3F1EC',
        border: bothDone ? '1px solid rgba(46,125,69,0.3)' : '1px solid #DCD7CE',
      }}>
        <span style={{
          flex:1,fontSize: big?14:12, fontWeight: bothDone?400:600,
          color: bothDone ? '#6E6A63' : '#1D1B18',
          textDecoration: bothDone ? 'line-through' : 'none',
        }}>
          {item.label}
        </span>
        {PhotoBadge(item)}
        <button onClick={()=>toggleCheck(date, item.id+'_am')}
          style={{
            display:'flex',alignItems:'center',gap:4,border:'none',cursor:'pointer',
            background: amDone ? 'rgba(var(--hk-accent-rgb),0.18)' : '#FAF9F6',
            color: amDone ? 'var(--hk-accent)' : '#6E6A63',
            borderRadius:6,padding:'4px 8px',fontSize:10,fontWeight:700,fontFamily:'inherit'
          }}>
          {amDone ? '✓' : '○'} 오전
        </button>
        <button onClick={()=>toggleCheck(date, item.id+'_pm')}
          style={{
            display:'flex',alignItems:'center',gap:4,border:'none',cursor:'pointer',
            background: pmDone ? 'rgba(43,92,158,0.18)' : '#FAF9F6',
            color: pmDone ? '#2B5C9E' : '#6E6A63',
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
            background: done ? 'rgba(46,125,69,0.08)' : '#F3F1EC',
            border: done ? '1px solid rgba(46,125,69,0.3)' : '1px solid #DCD7CE',
            borderBottom: hasAlert ? 'none' : undefined,
          }}>
          <div style={{
            width: big?22:18, height: big?22:18, borderRadius:6,flexShrink:0,
            display:'flex',alignItems:'center',justifyContent:'center',
            background: done ? '#2E7D45' : 'transparent',
            border: done ? 'none' : '1.5px solid #A8A39A',
            fontSize: big?13:11, color:'#FFFFFF',fontWeight:900,
          }}>
            {done && '✓'}
          </div>
          <span style={{
            fontSize: big?14:12, fontWeight: done?400:600,
            color: done ? '#6E6A63' : '#1D1B18',
            textDecoration: done ? 'line-through' : 'none',
          }}>
            {item.label}
            <span style={{fontSize:big?11:10,color:'var(--hk-accent)',marginLeft:6,fontWeight:700}}>({item.time})</span>
            {intervalLabel(item.interval) && (
              <span style={{fontSize:big?10:9,color:'#6B4FA0',marginLeft:5,fontWeight:700}}>{intervalLabel(item.interval)}</span>
            )}
          </span>
          {PhotoBadge(item)}
        </div>
        {hasAlert && (
          <div style={{
            padding: big ? '7px 12px' : '5px 10px',
            borderRadius:'0 0 8px 8px',
            background:'rgba(180,35,24,0.12)',
            border:'1px solid rgba(180,35,24,0.3)',borderTop:'none',
            fontSize: big?11:10, color:'#B42318', fontWeight:700,
            display:'flex',alignItems:'center',gap:5,
          }}>
            {item.alertUid && alertNameOf(item.alertUid) ? `${alertNameOf(item.alertUid)}님 ` : ''}
            {item.alertMsg || '일찍 출근 필요'}
          </div>
        )}
      </div>
    )
  }

  // 오늘 할 일 칸: 매일 항목은 오전·오후 두 칸, 요일별 항목은 정해진 시간 한 칸 (요일별을 먼저)
  const todaySlots = [
    ...todayWeekly.map(it => ({ key: it.id, item: it, time: it.time==='오후' ? '오후' : '오전', weekly: true })),
    ...dailyItems.map(it => ({ key: it.id+'_am', item: it, time: '오전' })),
    ...dailyItems.map(it => ({ key: it.id+'_pm', item: it, time: '오후' })),
  ]
  const todayLeft = t => todaySlots.filter(x => x.time===t && !isChecked(today, x.key)).length
  const todayDoneSlots = todaySlots.filter(x => isChecked(today, x.key) && !leaving[x.key])
  const taskRow = x => {
    const done = isChecked(today, x.key)
    const it = x.item
    return (
      <div key={x.key} data-task={x.key} className="ck-in" style={{paddingBottom:8}}>
        <div style={{display:'flex',alignItems:'stretch',gap:6}}>
          <button type="button" disabled={done} onClick={e=>completeTask(x.key, e.currentTarget)}
            style={{flex:1,minWidth:0,display:'flex',alignItems:'center',gap:12,padding:'13px 14px',textAlign:'left',fontFamily:'inherit',
              cursor: done ? 'default' : 'pointer',borderRadius:6,color:'#1D1B18',
              background: done ? '#EEF6F0' : '#FFFFFF', border: done ? '1px solid rgba(46,125,69,0.35)' : '1px solid #DCD7CE', transition:'background .2s, border-color .2s'}}>
            <span className={done ? 'ck-pop' : undefined} style={{width:26,height:26,borderRadius:13,flexShrink:0,display:'grid',placeItems:'center',
              background: done ? '#2E7D45' : '#FFFFFF', border: done ? 'none' : '2px solid #A8A39A', color:'#FFFFFF', fontSize:14, fontWeight:900}}>{done ? '✓' : ''}</span>
            <span style={{flex:1,minWidth:0}}>
              <span style={{fontSize:15,fontWeight:700}}>{it.label}</span>
              {x.weekly && <span style={{fontSize:11,color:'#6B4FA0',marginLeft:6,fontWeight:700}}>{intervalLabel(it.interval) || '요일별'}</span>}
              {x.weekly && (it.alertUid || it.alertMsg) && (
                <span style={{display:'block',fontSize:11,color:'#B42318',fontWeight:700,marginTop:3}}>
                  {it.alertUid && alertNameOf(it.alertUid) ? `${alertNameOf(it.alertUid)}님 ` : ''}{it.alertMsg || '일찍 출근 필요'}
                </span>
              )}
            </span>
          </button>
          {PhotoBadge(it)}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22,flexWrap:'wrap',gap:10}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>오늘의 체크리스트</div>
          <div style={{fontSize:12,color:'#6E6A63',marginTop:2}}>매일(오전·오후)·요일별 필수 업무</div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          <button onClick={()=>setShowManage(v=>!v)}
            style={{background: showManage ? 'var(--hk-accent)' : '#F3F1EC',border:'1px solid #DCD7CE',
              color: showManage ? '#FFFFFF' : '#1D1B18',borderRadius:4,
              padding:'8px 14px',fontSize:12,fontWeight:showManage?700:400,cursor:'pointer',fontFamily:'inherit'}}>
            항목 관리
          </button>
          <button onClick={()=>setShowHolidayManage(v=>!v)}
            style={{background: showHolidayManage ? '#B42318' : '#F3F1EC',border:'1px solid #DCD7CE',
              color: showHolidayManage ? '#FFFFFF' : '#1D1B18',borderRadius:4,
              padding:'8px 14px',fontSize:12,fontWeight:showHolidayManage?700:400,cursor:'pointer',fontFamily:'inherit'}}>
            임시휴무 설정
          </button>
          <button onClick={()=>{ setShowHistory(v=>!v); setHistoryDate(today) }}
            style={{background:'#F3F1EC',border:'1px solid #DCD7CE',color:'#1D1B18',borderRadius:4,
              padding:'8px 14px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
            지난 기록 보기
          </button>
        </div>
      </div>

      {/* 임시휴무 설정 패널 */}
      {showHolidayManage && (
        <div style={{background:'#FFFFFF',border:'1px solid rgba(180,35,24,0.4)',borderRadius:6,padding:18,marginBottom:18}}>
          <div style={{fontSize:13,fontWeight:600,color:'#B42318',marginBottom:4}}>임시휴무 설정</div>
          <div style={{fontSize:11,color:'#6E6A63',marginBottom:16}}>추석·설 연휴처럼 매장 문을 닫는 기간을 등록하면, 그 기간엔 일요일과 동일하게 체크리스트가 쉬어요.</div>
          <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:14}}>
            {holidays.length===0 && (
              <div style={{fontSize:11,color:'#6E6A63'}}>등록된 임시휴무가 없습니다</div>
            )}
            {holidays.slice().sort((a,b)=>a.startDate.localeCompare(b.startDate)).map(h=>(
              <div key={h.id} style={{background:'#F3F1EC',borderRadius:4,padding:'8px 10px',
                display:'flex',alignItems:'center',gap:8}}>
                <span style={{flex:1,fontSize:12,color:'#1D1B18'}}>
                  {h.startDate} ~ {h.endDate}
                  <span style={{color:'#B42318',marginLeft:8,fontWeight:600}}>{h.reason}</span>
                </span>
                <button onClick={()=>deleteHoliday(h.id)}
                  style={{background:'transparent',border:'none',color:'#B42318',fontSize:12,cursor:'pointer',padding:0}}>삭제</button>
              </div>
            ))}
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
            <span style={{fontSize:10,color:'#6E6A63'}}>시작일</span>
            <input type="date" value={newHoliday.startDate}
              onChange={e=>setNewHoliday(f=>({...f,startDate:e.target.value}))} style={inputStyle}/>
            <span style={{fontSize:10,color:'#6E6A63'}}>종료일</span>
            <input type="date" value={newHoliday.endDate}
              onChange={e=>setNewHoliday(f=>({...f,endDate:e.target.value}))} style={inputStyle}/>
            <input value={newHoliday.reason} onChange={e=>setNewHoliday(f=>({...f,reason:e.target.value}))}
              placeholder="사유 (예: 추석 연휴)" style={{...inputStyle,flex:1,minWidth:140}}/>
            <button onClick={addHoliday} disabled={saving}
              style={{background:'#B42318',color:'#FFFFFF',border:'none',borderRadius:4,
                padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>
              + 등록
            </button>
          </div>
        </div>
      )}

      {/* 항목 관리 패널 */}
      {showManage && (
        <div style={{background:'#FFFFFF',border:'1px solid var(--hk-accent)',borderRadius:6,padding:18,marginBottom:18}}>
          <div style={{fontSize:13,fontWeight:600,color:'var(--hk-accent)',marginBottom:16}}>체크리스트 항목 관리</div>

          <div style={{marginBottom:20}}>
            <div style={{fontSize:11,color:'#6E6A63',fontWeight:600,marginBottom:8}}>
              매일 필수 항목 <span style={{color:'#A8A39A'}}>(오전·오후 각각 체크)</span>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:10}}>
              {dailyItems.map(item=>(
                <div key={item.id}>
                <div style={{background:'#F3F1EC',borderRadius:4,padding:'7px 10px',
                  display:'flex',alignItems:'center',gap:8}}>
                  {editItemId===item.id ? (
                    <>
                      <input value={editItemForm.label} onChange={e=>setEditItemForm(f=>({...f,label:e.target.value}))}
                        style={{...inputStyle,flex:1}}/>
                      <button onClick={saveEditItem} disabled={saving}
                        style={{background:'var(--hk-accent)',color:'#FFFFFF',border:'none',borderRadius:5,padding:'5px 10px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>저장</button>
                      <button onClick={()=>{setEditItemId(null);setEditItemForm(null)}}
                        style={{background:'transparent',border:'none',color:'#6E6A63',fontSize:12,cursor:'pointer'}}>✕</button>
                    </>
                  ) : (
                    <>
                      <span style={{flex:1,fontSize:12,color:'#1D1B18'}}>{item.label}</span>
                      <button onClick={()=>startEditPhotos(item)}
                        style={{background:'transparent',border:'none',color: item.photoCount>0 ? '#2B5C9E' : '#6E6A63',fontSize:12,cursor:'pointer',padding:0}}>사진{item.photoCount>0 ? ` ${item.photoCount}` : ''}</button>
                      <button onClick={()=>startEditItem(item,'daily')}
                        style={{background:'transparent',border:'none',color:'#6E6A63',fontSize:12,cursor:'pointer',padding:0}}>수정</button>
                      <button onClick={()=>deleteItem(item.id,'daily')}
                        style={{background:'transparent',border:'none',color:'#B42318',fontSize:12,cursor:'pointer',padding:0}}>삭제</button>
                    </>
                  )}
                </div>
                {ItemPhotoPanel(item)}
                </div>
              ))}
            </div>
            <div style={{display:'flex',gap:8}}>
              <input value={newDaily} onChange={e=>setNewDaily(e.target.value)}
                placeholder="새 항목 이름 (예: 물수건 채우기)"
                style={{...inputStyle,flex:1}}/>
              <button onClick={addDailyItem} disabled={saving}
                style={{background:'#2E7D45',color:'#FFFFFF',border:'none',borderRadius:4,
                  padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>
                + 추가
              </button>
            </div>
          </div>

          <div>
            <div style={{fontSize:11,color:'#6E6A63',fontWeight:600,marginBottom:8}}>요일별 필수 항목</div>
            <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:10}}>
              {weeklyItems.map(item=>(
                <div key={item.id}>
                <div style={{background:'#F3F1EC',borderRadius:4,padding:'7px 10px',
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
                          {INTERVALS.map(o=><option key={o.v} value={o.v}>{o.label}</option>)}
                        </select>
                        {weeksOf(editItemForm.interval) > 1 && (<>
                          <span style={{fontSize:10,color:'#6E6A63'}}>기준일</span>
                          <input type="date" value={editItemForm.baseDate||todayStr()}
                            onChange={e=>setEditItemForm(f=>({...f,baseDate:e.target.value}))} style={inputStyle}/>
                          <NextDates item={{...editItemForm, dow:+editItemForm.dow, baseDate:editItemForm.baseDate||todayStr()}}/>
                        </>)}
                      </div>
                      <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                        <span style={{fontSize:10,color:'#6E6A63'}}>알림(선택):</span>
                        <select value={editItemForm.alertUid||''} onChange={e=>setEditItemForm(f=>({...f,alertUid:e.target.value}))} style={inputStyle}>
                          <option value="">담당자 없음</option>
                          {employees.map(e=><option key={e.uid} value={e.uid}>{e.name}</option>)}
                        </select>
                        <input value={editItemForm.alertMsg||''} onChange={e=>setEditItemForm(f=>({...f,alertMsg:e.target.value}))}
                          placeholder="알림 문구 (예: 1시간 일찍 출근)" style={{...inputStyle,flex:1,minWidth:140}}/>
                      </div>
                      <div style={{display:'flex',gap:8}}>
                        <button onClick={saveEditItem} disabled={saving}
                          style={{background:'var(--hk-accent)',color:'#FFFFFF',border:'none',borderRadius:5,padding:'6px 14px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>저장</button>
                        <button onClick={()=>{setEditItemId(null);setEditItemForm(null)}}
                          style={{background:'transparent',border:'1px solid #DCD7CE',color:'#6E6A63',borderRadius:5,padding:'6px 14px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>취소</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{flex:1}}>
                        <div style={{fontSize:12,color:'#1D1B18'}}>
                          {item.label}
                          {intervalLabel(item.interval) && <span style={{fontSize:10,color:'#6B4FA0',marginLeft:6,fontWeight:700}}>{intervalLabel(item.interval)}</span>}
                        </div>
                        {(item.alertUid||item.alertMsg) && (
                          <div style={{fontSize:10,color:'#B42318',marginTop:2}}>
                            {item.alertUid && alertNameOf(item.alertUid) ? `${alertNameOf(item.alertUid)}님 ` : ''}{item.alertMsg||'일찍 출근 필요'}
                          </div>
                        )}
                      </div>
                      <span style={{fontSize:11,color:'#2B5C9E',fontWeight:600}}>{DOW_LABELS[item.dow]}요일</span>
                      <span style={{fontSize:11,color:'var(--hk-accent)',fontWeight:600}}>{item.time}</span>
                      <button onClick={()=>startEditPhotos(item)}
                        style={{background:'transparent',border:'none',color: item.photoCount>0 ? '#2B5C9E' : '#6E6A63',fontSize:12,cursor:'pointer',padding:0}}>사진{item.photoCount>0 ? ` ${item.photoCount}` : ''}</button>
                      <button onClick={()=>startEditItem(item,'weekly')}
                        style={{background:'transparent',border:'none',color:'#6E6A63',fontSize:12,cursor:'pointer',padding:0}}>수정</button>
                      <button onClick={()=>deleteItem(item.id,'weekly')}
                        style={{background:'transparent',border:'none',color:'#B42318',fontSize:12,cursor:'pointer',padding:0}}>삭제</button>
                    </>
                  )}
                </div>
                {ItemPhotoPanel(item)}
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
                  {INTERVALS.map(o=><option key={o.v} value={o.v}>{o.label}</option>)}
                </select>
                {weeksOf(newWeekly.interval) > 1 && (
                  <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                    <span style={{fontSize:10,color:'#6E6A63'}}>기준일</span>
                    <input type="date" value={newWeekly.baseDate}
                      onChange={e=>setNewWeekly(f=>({...f,baseDate:e.target.value}))} style={inputStyle}/>
                    <NextDates item={{...newWeekly, dow:+newWeekly.dow}}/>
                  </div>
                )}
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                <span style={{fontSize:10,color:'#6E6A63'}}>알림(선택):</span>
                <select value={newWeekly.alertUid} onChange={e=>setNewWeekly(f=>({...f,alertUid:e.target.value}))} style={inputStyle}>
                  <option value="">담당자 없음</option>
                  {employees.map(e=><option key={e.uid} value={e.uid}>{e.name}</option>)}
                </select>
                <input value={newWeekly.alertMsg} onChange={e=>setNewWeekly(f=>({...f,alertMsg:e.target.value}))}
                  placeholder="알림 문구 (예: 1시간 일찍 출근 필요)" style={{...inputStyle,flex:1,minWidth:160}}/>
                <button onClick={addWeeklyItem} disabled={saving}
                  style={{background:'#2E7D45',color:'#FFFFFF',border:'none',borderRadius:4,
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
        <div style={{background:'#FFFFFF',border:'1px solid rgba(43,92,158,0.3)',borderRadius:6,
          padding:16,marginBottom:18}}>
          <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:14,flexWrap:'wrap'}}>
            <span style={{fontSize:12,fontWeight:700,color:'#2B5C9E'}}>지난 기록 조회</span>
            <input type="date" value={historyDate} max={today}
              onChange={e=>setHistoryDate(e.target.value)}
              style={{...inputStyle}}/>
            <button onClick={()=>setShowHistory(false)}
              style={{background:'transparent',border:'1px solid #DCD7CE',color:'#6E6A63',borderRadius:6,
                padding:'5px 10px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
              닫기
            </button>
          </div>
          {historyClosed ? (
            <div style={{fontSize:12,color:'#6E6A63',padding:'12px 0'}}>
              {historyDow===CLOSED_DOW ? '일요일은 휴무일입니다' : `임시휴무일입니다 (${historyHolidayInfo?.reason||'임시휴무'})`}
            </div>
          ) : (
            <>
              <div style={{fontSize:11,color:'#6E6A63',marginBottom:10}}>
                {historyDate} ({DAYS_KR[historyDow]}) — 매일 {historyDailyDone}/{dailyTotalSlots} · 요일 {historyWeeklyDone}/{historyWeekly.length}
              </div>
              <div style={{fontSize:10,color:'#6E6A63',fontWeight:600,marginBottom:6}}>매일 항목</div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:8,marginBottom:14}}>
                {dailyItems.map(it=>DailyRow(it, historyDate))}
              </div>
              {historyWeekly.length>0 && (
                <>
                  <div style={{fontSize:10,color:'#6E6A63',fontWeight:600,marginBottom:6}}>요일별 항목</div>
                  <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:8}}>
                    {historyWeekly.map(it=>WeeklyRow(it, historyDate))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* 지난달 개근 직원과 포상 결과 */}
      {reward?.eligible?.length > 0 && (
        <div style={{marginBottom:6}}>
          {alertRow('reward', '#2E7D45', `${monthNum(prevYmOf())}월 개근`,
            reward.eligible.map(e => {
              const r = rewardResults(reward).find(x => x.uid === e.uid)
              return r ? `${e.name} ${r.prize}` : reward.status === 'open' ? `${e.name} (룰렛 전)` : e.name
            }).join(' · '),
            '지각·조퇴·결근 없이 한 달! 축하해요')}
        </div>
      )}

      {/* 공지·메모 알림 — 휴무일에도 항상 표시 */}
      {!loading && pinnedNotices.length > 0 && (
        <div style={{marginBottom:14,display:'flex',flexDirection:'column',gap:4}}>
          {pinnedNotices.map(n=>alertRow(n.type+n.id, n.type==='notice' ? '#C3261C' : '#2B5C9E', n.type==='notice' ? '공지' : '메모',
            <span style={{whiteSpace:'pre-wrap',fontWeight:600}}>{n.content}</span>, n.authorName,
            n.images?.length > 0 && <div style={{marginTop:6}}><PhotoGrid images={n.images} label={n.type==='notice' ? '공지 사진' : '메모 사진'}/></div>))}
        </div>
      )}

      {loading ? (
        <div style={{textAlign:'center',color:'#6E6A63',padding:60}}>로딩 중...</div>
      ) : todayClosed ? (
        <div style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,padding:40,textAlign:'center'}}>
          <div style={{fontSize:24,marginBottom:8}}></div>
          <div style={{fontSize:14,color:'#6E6A63',fontWeight:600}}>
            {todayDow===CLOSED_DOW ? '오늘은 일요일 휴무일입니다' : `오늘은 임시휴무일입니다 (${todayHolidayInfo?.reason||'임시휴무'})`}
          </div>
        </div>
      ) : (
        <>
          {/* 직전 영업일 못한 일 (일요일+임시휴무 건너뜀) */}
          {hasPrevUnfinished && (
            <div style={{background:'#FFFFFF',border:'1px solid rgba(180,35,24,0.4)',borderRadius:6,
              padding:16,marginBottom:18}}>
              <div style={{fontSize:12,fontWeight:700,color:'#B42318',marginBottom:10}}>
                {+prevBusinessDate.split('-')[2]}일({DAYS_KR[prevBusinessDow]}) 못한 일 {prevDailyUnfinished.length+prevWeeklyUnfinished.length}건
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:8}}>
                {prevDailyUnfinished.map(it=>DailyRow(it, prevBusinessDate))}
                {prevWeeklyUnfinished.map(it=>WeeklyRow(it, prevBusinessDate))}
              </div>
            </div>
          )}

          {/* 미확정 대타 구함 알림 (D-30 이내) */}
          {openSubs.length > 0 && (
            <div style={{marginBottom:14,display:'flex',flexDirection:'column',gap:4}}>
              {openSubs.map(r=>{
                const dLabel = r.diffDays===0 ? '오늘' : r.diffDays===1 ? '내일' : `D-${r.diffDays}`
                return alertRow(r.id, '#B42318', '대타 구함',
                  `${dLabel}(${DAYS_KR[dowOfDate(r.date)]}) ${nameOf(r.requesterUid)} ${r.startH}:${r.startM}~${r.endH}:${r.endM}`,
                  `${r.date.slice(5).replace('-','/')} · 지원 가능해요`)
              })}
            </div>
          )}

          {/* 다가오는 특별 항목 미리 알림 (2~3일 전) */}
          {upcomingAlerts.length > 0 && (
            <div style={{marginBottom:14,display:'flex',flexDirection:'column',gap:4}}>
              {upcomingAlerts.map(({item,found})=>alertRow(item.id, '#6B4FA0', found.offset===1 ? '내일' : `${found.offset}일 후`,
                `${DAYS_KR[found.dow]}요일 ${item.label}`,
                `${item.alertUid && alertNameOf(item.alertUid) ? `${alertNameOf(item.alertUid)}님 — ` : ''}${item.alertMsg || '일찍 출근 필요'}`))}
            </div>
          )}

          {/* 오늘 할 일 (강조) */}
          <div style={{background:'linear-gradient(135deg,rgba(var(--hk-accent-rgb),0.10),rgba(var(--hk-accent-rgb),0.02))',
            border:'2px solid var(--hk-accent)',borderRadius:6,padding:20,marginBottom:24,
            boxShadow:'0 0 30px rgba(var(--hk-accent-rgb),0.08)'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16,flexWrap:'wrap',gap:8}}>
              <div>
                <div style={{fontSize:16,fontWeight:800,color:'var(--hk-accent)'}}>
                  오늘 ({DAYS_KR[todayDow]}) 할 일
                </div>
                <div style={{fontSize:11,color:'#6E6A63',marginTop:2}}>{today}</div>
              </div>
              <div style={{background:'#F3F1EC',borderRadius:4,padding:'8px 14px'}}>
                <span style={{fontSize:16,fontWeight:800,color: todayDoneCount===todayTotalCount ? '#2E7D45' : 'var(--hk-accent)'}}>
                  {todayDoneCount}
                </span>
                <span style={{fontSize:13,color:'#6E6A63'}}> / {todayTotalCount}</span>
              </div>
            </div>

            {/* 오늘 조기출근/특별 알림 배너 */}
            {todayWeekly.filter(it=>it.alertUid||it.alertMsg).length > 0 && (
              <div style={{marginBottom:14,display:'flex',flexDirection:'column',gap:4}}>
                {todayWeekly.filter(it=>it.alertUid||it.alertMsg).map(it=>alertRow(it.id, '#B42318', '오늘',
                  `${it.label} 있는 날`,
                  `${it.alertUid && alertNameOf(it.alertUid) ? `${alertNameOf(it.alertUid)}님 — ` : ''}${it.alertMsg || '일찍 출근 필요'}`))}
              </div>
            )}

            {/* 탭: 오전 할 일 · 오후 할 일 · 완료 */}
            <div role="tablist" aria-label="오늘 할 일" style={{display:'grid',gridTemplateColumns:'repeat(3, minmax(0, 1fr))',gap:6,marginBottom:12,maxWidth:460}}>
              {[['오전', todayLeft('오전')], ['오후', todayLeft('오후')], ['완료', todayDoneSlots.length]].map(([k, n]) => (
                <button key={k} type="button" role="tab" aria-selected={taskTab===k} onClick={()=>setTaskTab(k)} ref={k==='완료' ? doneTabRef : undefined}
                  style={{display:'flex',alignItems:'center',justifyContent:'center',gap:6,padding:'9px 6px',borderRadius:999,whiteSpace:'nowrap',cursor:'pointer',fontFamily:'inherit',fontSize:13,fontWeight:700,
                    border: taskTab===k ? '1px solid transparent' : '1px solid #DCD7CE',
                    background: taskTab===k ? (k==='완료' ? '#2E7D45' : 'var(--hk-accent)') : '#FFFFFF',
                    color: taskTab===k ? '#FFFFFF' : '#1D1B18'}}>
                  {k}
                  <span style={{minWidth:20,padding:'1px 6px',borderRadius:999,fontSize:12,fontVariantNumeric:'tabular-nums',
                    background: taskTab===k ? 'rgba(255,255,255,.25)' : k==='완료' ? 'rgba(46,125,69,.14)' : 'rgba(var(--hk-accent-rgb),.12)',
                    color: taskTab===k ? '#FFFFFF' : k==='완료' ? '#2E7D45' : 'var(--hk-accent)'}}>{n}</span>
                </button>
              ))}
            </div>

            {taskTab !== '완료' ? (() => {
              const list = todaySlots.filter(x => x.time===taskTab && (!isChecked(today, x.key) || leaving[x.key]))
              if (!list.length) return (
                <div key={'empty'+taskTab} className="ck-in" style={{textAlign:'center',padding:'28px 12px',background:'#FFFFFF',border:'1px dashed #DCD7CE',borderRadius:6}}>
                  <div style={{fontSize:16,fontWeight:800,color:'#2E7D45'}}>{taskTab} 할 일을 다 했어요</div>
                  <div style={{fontSize:12,color:'#6E6A63',marginTop:4}}>
                    {taskTab==='오전' && todayLeft('오후') ? `오후 할 일이 ${todayLeft('오후')}개 남았어요` : '수고했어요!'}
                  </div>
                </div>
              )
              return <div>{list.map(x => taskRow(x))}</div>
            })() : (
              !todayDoneSlots.length
                ? <div style={{textAlign:'center',padding:'24px 12px',fontSize:13,color:'#6E6A63'}}>아직 끝낸 일이 없어요</div>
                : <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 260px), 1fr))',gap:'14px 16px'}}>
                    {['오전','오후'].map(t => {
                      const list = todayDoneSlots.filter(x => x.time===t)
                      const color = t==='오전' ? 'var(--hk-accent)' : '#2B5C9E'
                      return (
                        <div key={t}>
                          <div style={{display:'flex',alignItems:'baseline',gap:6,padding:'0 2px 6px',marginBottom:6,borderBottom:`2px solid ${color}`}}>
                            <span style={{fontSize:14,fontWeight:800,color}}>{t}</span>
                            <span style={{fontSize:12,color:'#6E6A63',fontVariantNumeric:'tabular-nums'}}>{list.length} / {todaySlots.filter(x=>x.time===t).length} 끝</span>
                          </div>
                          {!list.length ? <div style={{fontSize:12,color:'#A8A39A',padding:'6px 2px'}}>아직 없어요</div>
                            : <div style={{display:'flex',flexDirection:'column',gap:6}}>
                                {list.map(x => (
                                  <div key={x.key} className="ck-in" style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',borderRadius:6,
                                    background:'rgba(46,125,69,0.08)',border:'1px solid rgba(46,125,69,0.25)'}}>
                                    <span style={{width:20,height:20,borderRadius:10,background:'#2E7D45',color:'#FFFFFF',display:'grid',placeItems:'center',fontSize:12,fontWeight:900,flexShrink:0}}>✓</span>
                                    <span style={{flex:1,minWidth:0,fontSize:13,color:'#6E6A63',textDecoration:'line-through'}}>{x.item.label}</span>
                                    <button type="button" onClick={()=>toggleCheck(today, x.key, false)}
                                      style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:4,padding:'4px 9px',fontSize:11,color:'#6E6A63',cursor:'pointer',fontFamily:'inherit',flexShrink:0}}>되돌리기</button>
                                  </div>
                                ))}
                              </div>}
                        </div>
                      )
                    })}
                  </div>
            )}
            <style>{CK_CSS}</style>
          </div>

          {/* 이번주 전체 보기 */}
          <div style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,overflow:'hidden'}}>
            <div style={{padding:'14px 18px',borderBottom:'1px solid #DCD7CE',fontSize:13,fontWeight:600}}>
              이번주 전체 보기 <span style={{fontSize:10,color:'#6E6A63',fontWeight:400}}>— 요일을 클릭하면 전체 목록이 보여요</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:0}}>
              {DAYS_KR.map((dayName, dow)=>{
                const date = dateOfDow(dow)
                const isClosed = isClosedDate(date, holidays)
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
                    borderRight: dow<6 ? '1px solid #F3F1EC' : 'none',
                    background: isClosed ? 'rgba(94,101,133,0.04)' : expandedDow===dow ? 'rgba(var(--hk-accent-rgb),0.12)' : isToday ? 'rgba(var(--hk-accent-rgb),0.06)' : 'transparent',
                    outline: expandedDow===dow ? '1px solid rgba(var(--hk-accent-rgb),0.5)' : 'none',
                    opacity: isClosed ? 0.5 : 1,
                  }}>
                    <div style={{textAlign:'center',marginBottom:8}}>
                      <div style={{fontSize:11,fontWeight:800,
                        color: isToday ? 'var(--hk-accent)' : dow===0?'#B42318':dow===6?'#2B5C9E':'#1D1B18'}}>
                        {dayName}
                      </div>
                      <div style={{fontSize:9,color:'#6E6A63',marginTop:2}}>{+date.split('-')[2]}일</div>
                      {isClosed ? (
                        <div style={{fontSize:9,color:'#6E6A63',marginTop:3,fontWeight:600}}>휴무</div>
                      ) : (
                        <div style={{fontSize:9,color: done===total && total>0 ?'#2E7D45':'#6E6A63',
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
                              background: wdone?'rgba(46,125,69,0.15)':'rgba(94,101,133,0.1)',
                              color: wdone?'#2E7D45':'#6E6A63',
                              textDecoration: wdone?'line-through':'none',
                              lineHeight:1.3,
                            }}>
                              {it.label}
                            </div>
                          )
                        })}
                        <div style={{fontSize:8,color:'#A8A39A',textAlign:'center',marginTop:2}}>
                          +매일 {dailyItems.length}개
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {expandedDow !== null && (
              <div style={{borderTop:'1px solid #DCD7CE',padding:16,background:'rgba(var(--hk-accent-rgb),0.03)'}}>
                <div style={{fontSize:12,fontWeight:700,color:'var(--hk-accent)',marginBottom:10}}>
                  {DAYS_KR[expandedDow]}요일 ({+dateOfDow(expandedDow).split('-')[2]}일) 전체 할 일
                </div>
                <div style={{fontSize:10,color:'#6E6A63',fontWeight:600,marginBottom:6}}>매일 항목</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(240px,1fr))',gap:8,marginBottom:14}}>
                  {dailyItems.map(it=>DailyRow(it, dateOfDow(expandedDow)))}
                </div>
                {getWeeklyForDate(dateOfDow(expandedDow)).length>0 && (
                  <>
                    <div style={{fontSize:10,color:'#6E6A63',fontWeight:600,marginBottom:6}}>요일별 항목</div>
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
      {photoViewer && (
        <Lightbox images={photoViewer.images} label={photoViewer.label} onClose={()=>setPhotoViewer(null)}/>
      )}
    </div>
  )
}
