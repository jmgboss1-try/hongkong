import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Button } from '@astryxdesign/core/Button'
import { Selector } from '@astryxdesign/core/Selector'
import { TextInput } from '@astryxdesign/core/TextInput'
import { DateInput } from '@astryxdesign/core/DateInput'
import { List, ListItem } from '@astryxdesign/core/List'

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

// 지출관리 '직접 입력' 탭: 통장에 안 찍히는 지출을 한 줄로 추가 (expenses/{YYYY-MM} 문서에 기록)
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

  const [y,m] = ym.split('-').map(Number)

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

  const secs = ['재료비','관리비','인건비']
  const catOpts = secs.map(sec => ({ type:'section', title:sec, options: categories.filter(c=>c.sec===sec).map(c => ({ value:c.id, label:c.label })) }))

  return (
    <VStack gap={3}>
      <HStack gap={2} vAlign="end" wrap="wrap">
        <DateInput label="날짜" value={date} onChange={v=>v && setDate(v)}/>
        <Selector label="카테고리" value={catId} onChange={v=>v && setCatId(v)} options={catOpts}/>
        <TextInput label="금액" inputMode="numeric" placeholder="0" width={150} value={amount === '' ? '' : (+amount).toLocaleString('ko-KR')}
          onChange={v=>setAmount(v.replace(/[^0-9]/g,''))} onEnter={save}/>
        <Button variant="primary" label={saving ? '저장 중...' : '지출 추가'} isDisabled={saving} onClick={save}/>
      </HStack>
      <Card variant="muted" padding={3}>
        <VStack gap={1}>
          <HStack hAlign="between">
            <Text type="supporting" color="secondary">{+m}월 {+dd}일 ({DAYS_KR[new Date(y,m-1,+dd).getDay()]}) 기록된 지출</Text>
            <Text weight="bold" hasTabularNumbers>{dayTotal>0 ? `${dayTotal.toLocaleString()}원` : '없음'}</Text>
          </HStack>
          {dayItems.length > 0 && (
            <List hasDividers edge="flush">
              {dayItems.map(c => (
                <ListItem key={c.id} label={c.label} endContent={<HStack gap={1} vAlign="center"><Text hasTabularNumbers>{dayEntry[c.id].toLocaleString()}</Text><Button size="sm" variant="ghost" label="삭제" isDisabled={saving} onClick={()=>removeItem(c.id)}/></HStack>}/>
              ))}
            </List>
          )}
        </VStack>
      </Card>
    </VStack>
  )
}
