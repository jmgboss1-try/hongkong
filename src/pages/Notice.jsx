import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, orderBy, query } from 'firebase/firestore'
import { useAuth, GradeBadge } from '../AuthContext'
import { PhotoPicker, PhotoGrid } from '../components/PhotoAttach'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { TextArea } from '@astryxdesign/core/TextArea'
import { DateInput } from '@astryxdesign/core/DateInput'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { TabList, Tab } from '@astryxdesign/core/TabList'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { AstryxPage, Legacy, PageHeader, LedgerCard } from '../astryx/AstryxPage'

const pad = n => String(n).padStart(2,'0')
const todayStr = () => { const n=new Date(); return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}` }
const plusDaysStr = days => { const n=new Date(); n.setDate(n.getDate()+days); return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}` }

export default function Notice() {
  const { user, userData, isOwner } = useAuth()
  const [notices, setNotices] = useState([])
  const [memos, setMemos] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('notice')
  const [newNotice, setNewNotice] = useState('')
  const [newMemo, setNewMemo] = useState('')
  const [newNoticeImages, setNewNoticeImages] = useState([])
  const [newMemoImages, setNewMemoImages] = useState([])
  const [lastRead, setLastRead] = useState(() => {
    return localStorage.getItem('lastRead_notice') || '0'
  })
  const [lastReadMemo, setLastReadMemo] = useState(() => {
    return localStorage.getItem('lastRead_memo') || '0'
  })

  // 체크리스트 알림 설정 (작성 시)
  const [noticeAlertOn, setNoticeAlertOn] = useState(false)
  const [noticeAlertStart, setNoticeAlertStart] = useState(todayStr())
  const [noticeAlertEnd, setNoticeAlertEnd]     = useState(plusDaysStr(7))
  const [memoAlertOn, setMemoAlertOn]     = useState(false)
  const [memoAlertStart, setMemoAlertStart] = useState(todayStr())
  const [memoAlertEnd, setMemoAlertEnd]     = useState(plusDaysStr(7))

  // 기존 항목 알림 설정 편집
  const [editAlertId, setEditAlertId] = useState(null) // "notice_id" or "memo_id"
  const [alertForm, setAlertForm]     = useState({ start: todayStr(), end: plusDaysStr(7) })

  // 글 내용 수정 ("notice_id" or "memo_id")
  const [editTextId, setEditTextId] = useState(null)
  const [editForm, setEditForm]     = useState({ content:'', images:[] })
  const [editSaving, setEditSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const noticeSnap = await getDocs(query(collection(db,'notices'), orderBy('createdAt','desc')))
      const noticeList = []
      noticeSnap.forEach(d => noticeList.push({id:d.id, ...d.data()}))
      setNotices(noticeList)

      const memoSnap = await getDocs(query(collection(db,'memos'), orderBy('createdAt','desc')))
      const memoList = []
      memoSnap.forEach(d => memoList.push({id:d.id, ...d.data()}))
      setMemos(memoList)
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  function markRead(type) {
    const now = new Date().toISOString()
    if(type==='notice') {
      localStorage.setItem('lastRead_notice', now)
      setLastRead(now)
    } else {
      localStorage.setItem('lastRead_memo', now)
      setLastReadMemo(now)
    }
  }

  const newNoticeCount = notices.filter(n => n.createdAt > lastRead).length
  const newMemoCount = memos.filter(m => m.createdAt > lastReadMemo).length

  async function addNotice() {
    if(!newNotice.trim() && newNoticeImages.length===0) return
    await addDoc(collection(db,'notices'), {
      content: newNotice.trim(),
      authorName: userData?.name || '사장',
      authorUid: user.uid,
      createdAt: new Date().toISOString(),
      isOwner: true,
      images: newNoticeImages,
      checklistAlert: noticeAlertOn,
      alertStart: noticeAlertOn ? noticeAlertStart : null,
      alertEnd:   noticeAlertOn ? noticeAlertEnd   : null,
    })
    setNewNotice('')
    setNewNoticeImages([])
    setNoticeAlertOn(false)
    setNoticeAlertStart(todayStr())
    setNoticeAlertEnd(plusDaysStr(7))
    await load()
  }

  async function addMemo() {
    if(!newMemo.trim() && newMemoImages.length===0) return
    await addDoc(collection(db,'memos'), {
      content: newMemo.trim(),
      authorName: userData?.name || '직원',
      authorUid: user.uid,
      joinDate: userData?.joinDate || '',
      createdAt: new Date().toISOString(),
      images: newMemoImages,
      checklistAlert: memoAlertOn,
      alertStart: memoAlertOn ? memoAlertStart : null,
      alertEnd:   memoAlertOn ? memoAlertEnd   : null,
    })
    setNewMemo('')
    setNewMemoImages([])
    setMemoAlertOn(false)
    setMemoAlertStart(todayStr())
    setMemoAlertEnd(plusDaysStr(7))
    await load()
  }

  async function deleteNotice(id) {
    if(!window.confirm('공지를 삭제하시겠습니까?')) return
    await deleteDoc(doc(db,'notices',id))
    await load()
  }

  async function deleteMemo(id) {
    if(!window.confirm('메모를 삭제하시겠습니까?')) return
    await deleteDoc(doc(db,'memos',id))
    await load()
  }

  function startEditText(type, item) {
    setEditTextId(type+'_'+item.id)
    setEditForm({ content: item.content || '', images: item.images || [] })
  }
  async function saveText(type, id) {
    if(!editForm.content.trim() && editForm.images.length===0) return alert('내용을 입력해주세요')
    setEditSaving(true)
    try {
      await updateDoc(doc(db, type==='notice' ? 'notices' : 'memos', id), {
        content: editForm.content.trim(), images: editForm.images, editedAt: new Date().toISOString(),
      })
      setEditTextId(null)
      await load()
    } catch(e) { console.error(e); alert('수정하지 못했어요. 다시 시도해 주세요.') }
    setEditSaving(false)
  }
  // 수정 중일 때 본문 자리에 보여줄 입력칸
  const textEditor = (type, id) => (
    <VStack gap={2}>
      <TextArea label="내용" isLabelHidden rows={4} value={editForm.content} onChange={v=>setEditForm(f=>({...f, content:v}))}/>
      <Legacy><PhotoPicker images={editForm.images} onChange={v=>setEditForm(f=>({...f, images:v}))}/></Legacy>
      <HStack gap={2}>
        <Button variant="primary" label={editSaving ? '저장 중...' : '수정 저장'} isDisabled={editSaving} onClick={()=>saveText(type, id)}/>
        <Button label="취소" onClick={()=>setEditTextId(null)}/>
      </HStack>
    </VStack>
  )

  function startEditAlert(type, item) {
    setEditAlertId(type+'_'+item.id)
    setAlertForm({
      start: item.alertStart || todayStr(),
      end:   item.alertEnd   || plusDaysStr(7),
    })
  }

  async function saveAlert(type, id) {
    const collName = type==='notice' ? 'notices' : 'memos'
    await updateDoc(doc(db,collName,id), {
      checklistAlert: true,
      alertStart: alertForm.start,
      alertEnd: alertForm.end,
    })
    setEditAlertId(null)
    await load()
  }

  async function removeAlert(type, id) {
    const collName = type==='notice' ? 'notices' : 'memos'
    await updateDoc(doc(db,collName,id), { checklistAlert:false })
    setEditAlertId(null)
    await load()
  }

  function timeAgo(iso) {
    const diff = (new Date() - new Date(iso)) / 1000
    if(diff < 60) return '방금 전'
    if(diff < 3600) return `${Math.floor(diff/60)}분 전`
    if(diff < 86400) return `${Math.floor(diff/3600)}시간 전`
    return `${Math.floor(diff/86400)}일 전`
  }

  // 작성 칸 (공지·메모 같이 씀)
  const composer = ({ title, placeholder, text, setText, images, setImages, alertOn, setAlertOn, start, setStart, end, setEnd, submit, submitLabel }) => (
    <LedgerCard title={title}>
      <TextArea label="내용" isLabelHidden rows={3} placeholder={placeholder} value={text} onChange={v=>setText(v)}/>
      <Legacy><PhotoPicker images={images} onChange={setImages}/></Legacy>
      <HStack gap={2} vAlign="end" wrap="wrap">
        <CheckboxInput label="체크리스트 상단에도 노출" value={alertOn} onChange={v=>setAlertOn(v)}/>
        {alertOn && <>
          <DateInput label="노출 시작" size="sm" value={start} onChange={v=>v && setStart(v)}/>
          <DateInput label="노출 끝" size="sm" value={end} onChange={v=>v && setEnd(v)}/>
        </>}
      </HStack>
      <HStack><Button variant="primary" label={submitLabel} onClick={submit}/></HStack>
    </LedgerCard>
  )
  // 글 하나 (공지·메모 같이 씀)
  const post = (type, it, { canManage, isNew, author }) => {
    const key = type + '_' + it.id
    return (
      <Card key={it.id} padding={4}>
        <VStack gap={2}>
          <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
            <HStack gap={2} vAlign="center" wrap="wrap">
              {author}
              {isNew && <Badge variant="error" label="NEW"/>}
              {it.checklistAlert && <Badge variant="purple" label={`${it.alertStart}~${it.alertEnd}`}/>}
            </HStack>
            <HStack gap={1} vAlign="center">
              <Text type="supporting" color="secondary">{timeAgo(it.createdAt)}{it.editedAt && ' · 수정됨'}</Text>
              {canManage && editTextId !== key && <Button size="sm" variant="ghost" label="수정" onClick={()=>startEditText(type, it)}/>}
              {canManage && <Button size="sm" variant="ghost" label="삭제" onClick={()=>type==='notice' ? deleteNotice(it.id) : deleteMemo(it.id)}/>}
            </HStack>
          </HStack>
          {editTextId === key ? textEditor(type, it.id) : <>
            <VStack gap={0}>{(it.content || '').split('\n').map((l, i) => <Text key={i} display="block">{l || '\u00a0'}</Text>)}</VStack>
            {it.images?.length > 0 && <Legacy><PhotoGrid images={it.images} label={type==='notice' ? '공지 사진' : '메모 사진'}/></Legacy>}
          </>}
          {canManage && (editAlertId === key ? (
            <Card variant="muted" padding={3}>
              <HStack gap={2} vAlign="end" wrap="wrap">
                <DateInput label="노출 시작" size="sm" value={alertForm.start} onChange={v=>v && setAlertForm(f=>({...f,start:v}))}/>
                <DateInput label="노출 끝" size="sm" value={alertForm.end} onChange={v=>v && setAlertForm(f=>({...f,end:v}))}/>
                <Button size="sm" variant="primary" label="저장" onClick={()=>saveAlert(type, it.id)}/>
                <Button size="sm" label="취소" onClick={()=>setEditAlertId(null)}/>
              </HStack>
            </Card>
          ) : (
            <HStack><Button size="sm" variant="ghost" label={it.checklistAlert ? '체크리스트 알림 해제' : '+ 체크리스트 알림 설정'}
              onClick={()=>it.checklistAlert ? removeAlert(type, it.id) : startEditAlert(type, it)}/></HStack>
          ))}
        </VStack>
      </Card>
    )
  }

  return (
    <AstryxPage>
    <VStack gap={4}>
      <PageHeader title="공지 · 메모" sub="공지사항 및 직원 메모"/>
      <TabList value={activeTab} onChange={v=>{ if (!v) return; setActiveTab(v); markRead(v) }}>
        <Tab value="notice" label={newNoticeCount > 0 ? `공지사항 (새 글 ${newNoticeCount})` : '공지사항'}/>
        <Tab value="memo" label={newMemoCount > 0 ? `직원 메모 (새 글 ${newMemoCount})` : '직원 메모'}/>
      </TabList>

      {activeTab==='notice' && <>
        {isOwner && composer({ title:'공지 작성', placeholder:'공지사항을 입력하세요...', text:newNotice, setText:setNewNotice, images:newNoticeImages, setImages:setNewNoticeImages,
          alertOn:noticeAlertOn, setAlertOn:setNoticeAlertOn, start:noticeAlertStart, setStart:setNoticeAlertStart, end:noticeAlertEnd, setEnd:setNoticeAlertEnd, submit:addNotice, submitLabel:'공지 등록' })}
        {loading ? <Text color="secondary">불러오는 중...</Text> : notices.length===0 ? <EmptyState title="등록된 공지가 없습니다" isCompact/> : (
          <VStack gap={3}>
            {notices.map(n => post('notice', n, { canManage:isOwner, isNew:n.createdAt>lastRead, author:<Text weight="bold" color="accent">사장</Text> }))}
          </VStack>
        )}
      </>}

      {activeTab==='memo' && <>
        {composer({ title:'메모 작성', placeholder:'인수인계, 대타 요청, 전달사항 등을 입력하세요...', text:newMemo, setText:setNewMemo, images:newMemoImages, setImages:setNewMemoImages,
          alertOn:memoAlertOn, setAlertOn:setMemoAlertOn, start:memoAlertStart, setStart:setMemoAlertStart, end:memoAlertEnd, setEnd:setMemoAlertEnd, submit:addMemo, submitLabel:'메모 등록' })}
        {loading ? <Text color="secondary">불러오는 중...</Text> : memos.length===0 ? <EmptyState title="등록된 메모가 없습니다" isCompact/> : (
          <VStack gap={3}>
            {memos.map(m => post('memo', m, { canManage:isOwner || m.authorUid===user.uid, isNew:m.createdAt>lastReadMemo,
              author:<><Text weight="bold">{m.authorName}</Text><Legacy><GradeBadge joinDate={m.joinDate} size={10}/></Legacy></> }))}
          </VStack>
        )}
      </>}
    </VStack>
    </AstryxPage>
  )
}
