import { useEffect, useState } from 'react'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { ClickableCard } from '@astryxdesign/core/ClickableCard'
import { Button } from '@astryxdesign/core/Button'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { Grid } from '@astryxdesign/core/Grid'
import { List, ListItem } from '@astryxdesign/core/List'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { TabList, Tab } from '@astryxdesign/core/TabList'
import { TextInput } from '@astryxdesign/core/TextInput'
import { DateInput } from '@astryxdesign/core/DateInput'
import { Selector } from '@astryxdesign/core/Selector'
import { AstryxPage, Legacy, PageHeader, LedgerCard } from '../astryx/AstryxPage'
import { prevYmOf, monthNum, rewardResults } from '../lib/rewards'
import { db } from '../firebase'
import { doc, getDoc, setDoc, deleteDoc, collection, getDocs, deleteField } from 'firebase/firestore'
import { Lightbox } from '../components/PhotoAttach'
import { PhotoField } from '../astryx/PhotoField'
import { PhotoThumbs } from '../astryx/PhotoField'

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
  return <Text type="supporting" color="secondary">다음: {out.join(', ') || '—'}</Text>
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
  // 날아갈 곳: '완료' 탭 (Astryx TabList 안이라 ref 대신 화면에서 찾음)
  const doneTabRef = { get current() { return [...document.querySelectorAll('.astryx-tab, [role="tab"]')].find(el => el.textContent.trim().startsWith('완료')) || null } }
  function completeTask(key, el) {
    const btn = el?.closest('[data-task]')
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
      <Card variant="muted" padding={3}>
        <VStack gap={2}>
          <Text type="label" weight="bold">{item.label} — 참고 사진 (완성 기준·위치 등)</Text>
          <PhotoField images={photoEditImages} onChange={setPhotoEditImages} max={3}/>
          <HStack gap={2}>
            <Button size="sm" variant="primary" label="사진 저장" isDisabled={saving} onClick={saveItemPhotos}/>
            <Button size="sm" label="취소" onClick={()=>{setPhotoEditId(null);setPhotoEditImages([])}}/>
          </HStack>
        </VStack>
      </Card>
    )
  }
  function PhotoBadge(item) {
    if(!(item.photoCount>0)) return null
    return <Button size="sm" variant="ghost" label={`사진 ${item.photoCount}`} onClick={e=>{ e?.stopPropagation?.(); openItemPhotos(item) }}/>
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


  // 매일 항목 1개 = 오전/오후 체크박스 2개 나란히
  function DailyRow(item, date) {
    const amDone = isChecked(date, item.id+'_am')
    const pmDone = isChecked(date, item.id+'_pm')
    const bothDone = amDone && pmDone
    return (
      <Card key={item.id+date} variant={bothDone ? 'muted' : 'default'} padding={2}>
        <HStack gap={1} vAlign="center" hAlign="between">
          <Text weight={bothDone ? 'normal' : 'semibold'} color={bothDone ? 'secondary' : 'primary'} hasStrikethrough={bothDone}>{item.label}</Text>
          <HStack gap={1} vAlign="center">
            {PhotoBadge(item)}
            <Button size="sm" variant={amDone ? 'primary' : 'secondary'} label={amDone ? '오전 완료' : '오전'} onClick={()=>toggleCheck(date, item.id+'_am')}/>
            <Button size="sm" variant={pmDone ? 'primary' : 'secondary'} label={pmDone ? '오후 완료' : '오후'} onClick={()=>toggleCheck(date, item.id+'_pm')}/>
          </HStack>
        </HStack>
      </Card>
    )
  }


  // 요일별 항목 1개 = 체크박스 1개 (기존과 동일)
  function alertNameOf(uid) {
    return employees.find(e=>e.uid===uid)?.name || ''
  }

  function WeeklyRow(item, date) {
    const done = isChecked(date, item.id)
    const hasAlert = item.alertUid || item.alertMsg
    return (
      <Card key={item.id+date} variant={done ? 'muted' : 'default'} padding={2}>
        <VStack gap={1}>
          <HStack gap={1} vAlign="center" hAlign="between">
            <HStack gap={1} vAlign="center" wrap="wrap">
              <Text weight={done ? 'normal' : 'semibold'} color={done ? 'secondary' : 'primary'} hasStrikethrough={done}>{item.label}</Text>
              <Badge label={item.time}/>
              {intervalLabel(item.interval) && <Badge variant="purple" label={intervalLabel(item.interval)}/>}
            </HStack>
            <HStack gap={1} vAlign="center">
              {PhotoBadge(item)}
              <Button size="sm" variant={done ? 'primary' : 'secondary'} label={done ? '완료' : '체크'} onClick={()=>toggleCheck(date, item.id)}/>
            </HStack>
          </HStack>
          {hasAlert && <Text type="supporting" color="accent">{item.alertUid && alertNameOf(item.alertUid) ? `${alertNameOf(item.alertUid)}님 ` : ''}{item.alertMsg || '일찍 출근 필요'}</Text>}
        </VStack>
      </Card>
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
  // 할 일 한 줄 (누르면 끝냄 → 완료 탭으로 날아감). data-task 상자는 날아가는 움직임용 (모양 없음)
  const taskRow = x => {
    const done = isChecked(today, x.key)
    const it = x.item
    const alert = x.weekly && (it.alertUid || it.alertMsg)
    return (
      <div key={x.key} data-task={x.key} className="ck-in">
        <HStack gap={2} vAlign="center">
          <ClickableCard label={`${it.label} ${x.time} 끝내기`} isDisabled={done} padding={3} width="100%"
            onClick={e => completeTask(x.key, e.currentTarget)}>
            <HStack gap={3} vAlign="center">
              <StatusDot variant={done ? 'success' : 'neutral'} label={done ? '끝냄' : '아직'}/>
              <VStack gap={0}>
                <Text type="large" weight="semibold" hasStrikethrough={done}>{it.label}</Text>
                {x.weekly && <Text type="supporting" color="secondary">{intervalLabel(it.interval) || '요일별'}</Text>}
                {alert && <Text type="supporting" color="accent">{it.alertUid && alertNameOf(it.alertUid) ? `${alertNameOf(it.alertUid)}님 ` : ''}{it.alertMsg || '일찍 출근 필요'}</Text>}
              </VStack>
            </HStack>
          </ClickableCard>
          {it.photoCount > 0 && <Button size="sm" label={`사진 ${it.photoCount}`} onClick={() => openItemPhotos(it)}/>}
        </HStack>
      </div>
    )
  }

  const photoPanel = item => ItemPhotoPanel(item)
  const itemButtons = (item, kind) => (
    <HStack gap={1}>
      <Button size="sm" variant="ghost" label={`사진${item.photoCount>0 ? ` ${item.photoCount}` : ''}`} onClick={()=>startEditPhotos(item)}/>
      <Button size="sm" variant="ghost" label="수정" onClick={()=>startEditItem(item, kind)}/>
      <Button size="sm" variant="ghost" label="삭제" onClick={()=>deleteItem(item.id, kind)}/>
    </HStack>
  )
  // 요일 항목 입력칸 (추가·수정 같이 씀)
  const weeklyFields = (f, setF, baseDate, isNew) => <>
    <HStack gap={2} vAlign="end" wrap="wrap">
      <TextInput label="항목 이름" placeholder={isNew ? '예: 냉장고 성애제거' : undefined} value={f.label} onChange={v=>setF(x=>({...x,label:v}))}/>
      <Selector label="요일" value={String(f.dow)} onChange={v=>v != null && setF(x=>({...x,dow:v}))} options={DOW_LABELS.map((d,i)=>({ value:String(i), label:`${d}요일` }))}/>
      <Selector label="때" value={f.time} onChange={v=>v && setF(x=>({...x,time:v}))} options={[{ value:'오전', label:'오전' }, { value:'오후', label:'오후' }]}/>
      <Selector label="주기" value={f.interval||'weekly'} onChange={v=>v && setF(x=>({...x,interval:v}))} options={INTERVALS.map(o=>({ value:o.v, label:o.label }))}/>
      {weeksOf(f.interval) > 1 && <DateInput label="기준일" value={baseDate} onChange={v=>v && setF(x=>({...x,baseDate:v}))}/>}
    </HStack>
    {weeksOf(f.interval) > 1 && <NextDates item={{...f, dow:+f.dow, baseDate}}/>}
    <HStack gap={2} vAlign="end" wrap="wrap">
      <Selector label="알림 받을 사람" isOptional value={f.alertUid||''} onChange={v=>setF(x=>({...x,alertUid:v||''}))}
        options={[{ value:'', label:'담당자 없음' }, ...employees.map(e=>({ value:e.uid, label:e.name }))]}/>
      <TextInput label="알림 문구" isOptional placeholder="예: 1시간 일찍 출근" value={f.alertMsg||''} onChange={v=>setF(x=>({...x,alertMsg:v}))}/>
    </HStack>
  </>

  return (
    <AstryxPage>
    <VStack gap={5}>
      <PageHeader title="오늘의 체크리스트" sub="매일(오전·오후)·요일별 필수 업무" right={<>
        <Button label="항목 관리" variant={showManage ? 'primary' : 'secondary'} onClick={()=>setShowManage(v=>!v)}/>
        <Button label="임시휴무 설정" variant={showHolidayManage ? 'primary' : 'secondary'} onClick={()=>setShowHolidayManage(v=>!v)}/>
        <Button label="지난 기록 보기" onClick={()=>{ setShowHistory(v=>!v); setHistoryDate(today) }}/>
      </>}/>

      {/* 임시휴무 설정 */}
      {showHolidayManage && (
        <LedgerCard title="임시휴무 설정">
          <Text type="supporting" color="secondary">추석·설 연휴처럼 매장 문을 닫는 기간을 등록하면, 그 기간엔 일요일과 동일하게 체크리스트가 쉬어요.</Text>
          {holidays.length===0 ? <Text color="secondary">등록된 임시휴무가 없습니다</Text> : (
            <List hasDividers edge="flush">
              {holidays.slice().sort((a,b)=>a.startDate.localeCompare(b.startDate)).map(h=>(
                <ListItem key={h.id} label={<Text hasTabularNumbers>{h.startDate} ~ {h.endDate}</Text>} description={h.reason}
                  endContent={<Button size="sm" variant="ghost" label="삭제" onClick={()=>deleteHoliday(h.id)}/>}/>
              ))}
            </List>
          )}
          <HStack gap={2} vAlign="end" wrap="wrap">
            <DateInput label="시작일" value={newHoliday.startDate} onChange={v=>setNewHoliday(f=>({...f,startDate:v||''}))}/>
            <DateInput label="종료일" value={newHoliday.endDate} onChange={v=>setNewHoliday(f=>({...f,endDate:v||''}))}/>
            <TextInput label="사유" placeholder="예: 추석 연휴" value={newHoliday.reason} onChange={v=>setNewHoliday(f=>({...f,reason:v}))}/>
            <Button variant="primary" label="+ 등록" isDisabled={saving} onClick={addHoliday}/>
          </HStack>
        </LedgerCard>
      )}

      {/* 항목 관리 */}
      {showManage && (
        <LedgerCard title="체크리스트 항목 관리">
          <VStack gap={2}>
            <Heading level={5}>매일 필수 항목</Heading>
            <Text type="supporting" color="secondary">오전·오후 각각 체크</Text>
            <List hasDividers edge="flush">
              {dailyItems.map(item=>(
                <ListItem key={item.id} align="start"
                  label={editItemId===item.id ? (
                    <HStack gap={2} vAlign="end" wrap="wrap">
                      <TextInput label="항목 이름" isLabelHidden value={editItemForm.label} onChange={v=>setEditItemForm(f=>({...f,label:v}))}/>
                      <Button size="sm" variant="primary" label="저장" isDisabled={saving} onClick={saveEditItem}/>
                      <Button size="sm" label="취소" onClick={()=>{setEditItemId(null);setEditItemForm(null)}}/>
                    </HStack>
                  ) : <Text>{item.label}</Text>}
                  description={photoPanel(item)}
                  endContent={editItemId!==item.id && itemButtons(item, 'daily')}/>
              ))}
            </List>
            <HStack gap={2} vAlign="end">
              <TextInput label="새 항목" isLabelHidden placeholder="새 항목 이름 (예: 물수건 채우기)" value={newDaily} onChange={v=>setNewDaily(v)}/>
              <Button variant="primary" label="+ 추가" isDisabled={saving} onClick={addDailyItem}/>
            </HStack>
          </VStack>

          <VStack gap={2}>
            <Heading level={5}>요일별 필수 항목</Heading>
            <List hasDividers edge="flush">
              {weeklyItems.map(item=>(
                <ListItem key={item.id} align="start"
                  label={editItemId===item.id ? (
                    <VStack gap={2}>
                      {weeklyFields(editItemForm, setEditItemForm, editItemForm.baseDate||todayStr())}
                      <HStack gap={2}>
                        <Button size="sm" variant="primary" label="저장" isDisabled={saving} onClick={saveEditItem}/>
                        <Button size="sm" label="취소" onClick={()=>{setEditItemId(null);setEditItemForm(null)}}/>
                      </HStack>
                    </VStack>
                  ) : (
                    <HStack gap={2} vAlign="center" wrap="wrap">
                      <Text>{item.label}</Text>
                      {intervalLabel(item.interval) && <Badge variant="purple" label={intervalLabel(item.interval)}/>}
                      <Badge variant="blue" label={`${DOW_LABELS[item.dow]}요일`}/>
                      <Badge label={item.time}/>
                    </HStack>
                  )}
                  description={<>
                    {editItemId!==item.id && (item.alertUid||item.alertMsg) && (
                      <Text type="supporting" color="accent">{item.alertUid && alertNameOf(item.alertUid) ? `${alertNameOf(item.alertUid)}님 ` : ''}{item.alertMsg||'일찍 출근 필요'}</Text>
                    )}
                    {photoPanel(item)}
                  </>}
                  endContent={editItemId!==item.id && itemButtons(item, 'weekly')}/>
              ))}
            </List>
            <Card variant="muted" padding={3}>
              <VStack gap={2}>
                {weeklyFields(newWeekly, setNewWeekly, newWeekly.baseDate, true)}
                <HStack><Button variant="primary" label="+ 추가" isDisabled={saving} onClick={addWeeklyItem}/></HStack>
              </VStack>
            </Card>
          </VStack>
        </LedgerCard>
      )}

      {/* 지난 기록 조회 (체크 줄은 아직 예전 모양) */}
      {showHistory && (
        <LedgerCard title="지난 기록 조회" right={<Button size="sm" label="닫기" onClick={()=>setShowHistory(false)}/>}>
          <HStack><DateInput label="날짜" isLabelHidden value={historyDate} onChange={v=>v && v <= today && setHistoryDate(v)}/></HStack>
          {historyClosed ? (
            <Text color="secondary">{historyDow===CLOSED_DOW ? '일요일은 휴무일입니다' : `임시휴무일입니다 (${historyHolidayInfo?.reason||'임시휴무'})`}</Text>
          ) : (
            <VStack gap={2}>
              <Text type="supporting" color="secondary" hasTabularNumbers>{historyDate} ({DAYS_KR[historyDow]}) — 매일 {historyDailyDone}/{dailyTotalSlots} · 요일 {historyWeeklyDone}/{historyWeekly.length}</Text>
              <Heading level={5}>매일 항목</Heading>
              <Grid columns={{ minWidth: 260, repeat: 'fill' }} gap={2}>{dailyItems.map(it=>DailyRow(it, historyDate))}</Grid>
              {historyWeekly.length>0 && <>
                <Heading level={5}>요일별 항목</Heading>
                <Grid columns={{ minWidth: 260, repeat: 'fill' }} gap={2}>{historyWeekly.map(it=>WeeklyRow(it, historyDate))}</Grid>
              </>}
            </VStack>
          )}
        </LedgerCard>
      )}

      {/* 지난달 개근 직원과 포상 결과 */}
      {reward?.eligible?.length > 0 && (
        <Banner status="success" title={`${monthNum(prevYmOf())}월 개근 — 지각·조퇴·결근 없이 한 달! 축하해요`}
          description={reward.eligible.map(e => {
            const r = rewardResults(reward).find(x => x.uid === e.uid)
            return r ? `${e.name} ${r.prize}` : reward.status === 'open' ? `${e.name} (룰렛 전)` : e.name
          }).join(' · ')}/>
      )}

      {/* 공지·메모 알림 — 휴무일에도 항상 표시 */}
      {!loading && pinnedNotices.map(n => (
        <Banner key={n.type+n.id} status={n.type==='notice' ? 'warning' : 'info'} title={`${n.type==='notice' ? '공지' : '메모'}${n.authorName ? ` · ${n.authorName}` : ''}`}
          description={<Text textWrap="pretty">{n.content}</Text>}>
          <PhotoThumbs images={n.images} label={n.type==='notice' ? '공지 사진' : '메모 사진'}/>
        </Banner>
      ))}

      {loading ? (
        <Text color="secondary">불러오는 중...</Text>
      ) : todayClosed ? (
        <Card><EmptyState title={todayDow===CLOSED_DOW ? '오늘은 일요일 휴무일입니다' : `오늘은 임시휴무일입니다 (${todayHolidayInfo?.reason||'임시휴무'})`}/></Card>
      ) : (
        <>
          {/* 직전 영업일 못한 일 (일요일+임시휴무 건너뜀) */}
          {hasPrevUnfinished && (
            <LedgerCard title={`${+prevBusinessDate.split('-')[2]}일(${DAYS_KR[prevBusinessDow]}) 못한 일 ${prevDailyUnfinished.length+prevWeeklyUnfinished.length}건`}>
              <Grid columns={{ minWidth: 260, repeat: 'fill' }} gap={2}>
                {prevDailyUnfinished.map(it=>DailyRow(it, prevBusinessDate))}
                {prevWeeklyUnfinished.map(it=>WeeklyRow(it, prevBusinessDate))}
              </Grid>
            </LedgerCard>
          )}

          {/* 미확정 대타 구함 알림 (D-30 이내) */}
          {openSubs.map(r => {
            const dLabel = r.diffDays===0 ? '오늘' : r.diffDays===1 ? '내일' : `D-${r.diffDays}`
            return <Banner key={r.id} status="error" title={`대타 구함 · ${dLabel}(${DAYS_KR[dowOfDate(r.date)]}) ${nameOf(r.requesterUid)} ${r.startH}:${r.startM}~${r.endH}:${r.endM}`}
              description={`${r.date.slice(5).replace('-','/')} · 지원 가능해요`}/>
          })}

          {/* 다가오는 특별 항목 미리 알림 (2~3일 전) */}
          {upcomingAlerts.map(({item,found}) => (
            <Banner key={item.id} status="info" title={`${found.offset===1 ? '내일' : `${found.offset}일 후`} · ${DAYS_KR[found.dow]}요일 ${item.label}`}
              description={`${item.alertUid && alertNameOf(item.alertUid) ? `${alertNameOf(item.alertUid)}님 — ` : ''}${item.alertMsg || '일찍 출근 필요'}`}/>
          ))}

          {/* 오늘 할 일: 오전 · 오후 · 완료 탭. 누르면 그 줄이 완료 탭으로 날아감 */}
          <Card>
            <VStack gap={4}>
              <HStack hAlign="between" vAlign="center" gap={2} wrap="wrap">
                <VStack gap={0}>
                  <Heading level={3}>오늘 ({DAYS_KR[todayDow]}) 할 일</Heading>
                  <Text type="supporting" color="secondary">{today}</Text>
                </VStack>
                <Text type="display-3" hasTabularNumbers color={todayDoneCount===todayTotalCount ? 'primary' : 'accent'}>
                  {todayDoneCount}<Text type="large" color="secondary"> / {todayTotalCount}</Text>
                </Text>
              </HStack>

              {todayWeekly.filter(it=>it.alertUid||it.alertMsg).map(it => (
                <Banner key={it.id} status="warning" title={`오늘 ${it.label} 있는 날`}
                  description={`${it.alertUid && alertNameOf(it.alertUid) ? `${alertNameOf(it.alertUid)}님 — ` : ''}${it.alertMsg || '일찍 출근 필요'}`}/>
              ))}

              <TabList value={taskTab} onChange={setTaskTab} layout="fill" hasDivider size="lg">
                {[['오전', todayLeft('오전')], ['오후', todayLeft('오후')], ['완료', todayDoneSlots.length]].map(([k, n]) => (
                  <Tab key={k} value={k} label={k} endContent={<Badge variant={k==='완료' ? 'success' : 'neutral'} label={String(n)}/>}/>
                ))}
              </TabList>

              {taskTab !== '완료' ? (() => {
                const list = todaySlots.filter(x => x.time===taskTab && (!isChecked(today, x.key) || leaving[x.key]))
                if (!list.length) return (
                  <EmptyState key={'empty'+taskTab} title={`${taskTab} 할 일을 다 했어요`} isCompact
                    description={taskTab==='오전' && todayLeft('오후') ? `오후 할 일이 ${todayLeft('오후')}개 남았어요` : '수고했어요!'}/>
                )
                return <VStack gap={2}>{list.map(x => taskRow(x))}</VStack>
              })() : (
                !todayDoneSlots.length
                  ? <EmptyState title="아직 끝낸 일이 없어요" isCompact/>
                  : <Grid columns={{ minWidth: 260, max: 2, repeat: 'fit' }} gap={4}>
                      {['오전','오후'].map(t => {
                        const list = todayDoneSlots.filter(x => x.time===t)
                        return (
                          <VStack key={t} gap={2}>
                            <HStack gap={2} vAlign="center">
                              <Heading level={5}>{t}</Heading>
                              <Text type="supporting" color="secondary" hasTabularNumbers>{list.length} / {todaySlots.filter(x=>x.time===t).length} 끝</Text>
                            </HStack>
                            {!list.length ? <Text type="supporting" color="secondary">아직 없어요</Text> : (
                              <List hasDividers density="compact" edge="flush">
                                {list.map(x => (
                                  <ListItem key={x.key} label={<Text hasStrikethrough color="secondary">{x.item.label}</Text>}
                                    startContent={<StatusDot variant="success" label="끝냄"/>}
                                    endContent={<Button size="sm" variant="ghost" label="되돌리기" onClick={()=>toggleCheck(today, x.key, false)}/>}/>
                                ))}
                              </List>
                            )}
                          </VStack>
                        )
                      })}
                    </Grid>
              )}
            </VStack>
          </Card>

          {/* 이번주 전체 보기: 요일 카드를 누르면 그날 전체 목록 */}
          <LedgerCard title="이번주 전체 보기" right={<Text type="supporting" color="secondary">요일을 누르면 전체 목록이 보여요</Text>}>
            <Grid columns={{ minWidth: 92, max: 7, repeat: 'fit' }} gap={2}>
              {DAYS_KR.map((dayName, dow) => {
                const date = dateOfDow(dow)
                const isClosed = isClosedDate(date, holidays)
                const weekly = getWeeklyForDate(date)
                const isToday = dow === todayDow
                const total = isClosed ? 0 : dailyTotalSlots + weekly.length
                const done = isClosed ? 0 : dailyDoneCount(date) + weekly.filter(it=>isChecked(date, it.id)).length
                const body = (
                  <VStack gap={1} hAlign="center">
                    <Text weight="bold" color={isToday ? 'accent' : 'primary'}>{dayName}{isToday ? ' 오늘' : ''}</Text>
                    <Text type="supporting" color="secondary">{+date.split('-')[2]}일</Text>
                    {isClosed ? <Badge label="휴무"/> : <Badge variant={done===total && total>0 ? 'success' : 'neutral'} label={`${done}/${total}`}/>}
                    {!isClosed && weekly.map(it => <Text key={it.id} type="supporting" color={isChecked(date, it.id) ? 'secondary' : 'primary'} hasStrikethrough={isChecked(date, it.id)} justify="center">{it.label}</Text>)}
                  </VStack>
                )
                return isClosed
                  ? <Card key={dow} variant="muted" padding={2}>{body}</Card>
                  : <ClickableCard key={dow} label={`${dayName}요일 전체 목록`} padding={2} variant={expandedDow===dow ? 'muted' : 'default'}
                      onClick={() => setExpandedDow(v => v===dow ? null : dow)}>{body}</ClickableCard>
              })}
            </Grid>
            {expandedDow !== null && (
              <VStack gap={2}>
                <Heading level={5}>{DAYS_KR[expandedDow]}요일 ({+dateOfDow(expandedDow).split('-')[2]}일) 전체 할 일</Heading>
                <Text type="label" color="secondary">매일 항목</Text>
                <Grid columns={{ minWidth: 260, repeat: 'fill' }} gap={2}>{dailyItems.map(it=>DailyRow(it, dateOfDow(expandedDow)))}</Grid>
                {getWeeklyForDate(dateOfDow(expandedDow)).length>0 && <>
                  <Text type="label" color="secondary">요일별 항목</Text>
                  <Grid columns={{ minWidth: 260, repeat: 'fill' }} gap={2}>{getWeeklyForDate(dateOfDow(expandedDow)).map(it=>WeeklyRow(it, dateOfDow(expandedDow)))}</Grid>
                </>}
              </VStack>
            )}
          </LedgerCard>
        </>
      )}
      <Legacy>
        <style>{CK_CSS}</style>
        {photoViewer && (
          <Lightbox images={photoViewer.images} label={photoViewer.label} onClose={()=>setPhotoViewer(null)}/>
        )}
      </Legacy>
    </VStack>
    </AstryxPage>
  )
}
