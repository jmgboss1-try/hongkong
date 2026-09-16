import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, orderBy, query } from 'firebase/firestore'
import { useAuth, GradeBadge } from '../AuthContext'

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
    if(!newNotice.trim()) return
    await addDoc(collection(db,'notices'), {
      content: newNotice.trim(),
      authorName: userData?.name || '사장',
      authorUid: user.uid,
      createdAt: new Date().toISOString(),
      isOwner: true,
      checklistAlert: noticeAlertOn,
      alertStart: noticeAlertOn ? noticeAlertStart : null,
      alertEnd:   noticeAlertOn ? noticeAlertEnd   : null,
    })
    setNewNotice('')
    setNoticeAlertOn(false)
    setNoticeAlertStart(todayStr())
    setNoticeAlertEnd(plusDaysStr(7))
    await load()
  }

  async function addMemo() {
    if(!newMemo.trim()) return
    await addDoc(collection(db,'memos'), {
      content: newMemo.trim(),
      authorName: userData?.name || '직원',
      authorUid: user.uid,
      joinDate: userData?.joinDate || '',
      createdAt: new Date().toISOString(),
      checklistAlert: memoAlertOn,
      alertStart: memoAlertOn ? memoAlertStart : null,
      alertEnd:   memoAlertOn ? memoAlertEnd   : null,
    })
    setNewMemo('')
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

  const alertToggleBtn = (label, on, setOn) => (
    <button onClick={()=>setOn(v=>!v)}
      style={{background: on ? 'rgba(167,139,250,0.15)' : '#191c2b',
        border: on ? '1px solid rgba(167,139,250,0.4)' : '1px solid #272a3d',
        color: on ? '#a78bfa' : '#5e6585', borderRadius:7,
        padding:'7px 12px',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>
      {on ? '✓ ' : ''}{label}
    </button>
  )

  const dateInputStyle = {
    background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
    padding:'6px 10px',fontSize:11,outline:'none',fontFamily:'inherit'
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>📋 공지 · 메모</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>공지사항 및 직원 메모</div>
        </div>
      </div>

      {/* 탭 */}
      <div style={{display:'flex',gap:8,marginBottom:18}}>
        {[
          {key:'notice', label:'📢 공지사항', count:newNoticeCount},
          {key:'memo', label:'💬 직원 메모', count:newMemoCount},
        ].map(t=>(
          <button key={t.key} onClick={()=>{setActiveTab(t.key);markRead(t.key)}}
            style={{padding:'9px 18px',borderRadius:8,border:'none',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
              position:'relative',
              background:activeTab===t.key?'#f9b934':'#191c2b',
              color:activeTab===t.key?'#000':'#5e6585'}}>
            {t.label}
            {t.count>0 && (
              <span style={{position:'absolute',top:-6,right:-6,background:'#f87171',color:'#fff',
                borderRadius:999,fontSize:10,fontWeight:700,padding:'2px 6px',minWidth:18,textAlign:'center'}}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* 공지사항 탭 */}
      {activeTab==='notice' && (
        <div>
          {/* 사장만 작성 가능 */}
          {isOwner && (
            <div style={{background:'#12141f',border:'1px solid #f9b934',borderRadius:12,padding:'18px',marginBottom:18}}>
              <div style={{fontSize:13,fontWeight:600,color:'#f9b934',marginBottom:12}}>📢 공지 작성</div>
              <textarea value={newNotice} onChange={e=>setNewNotice(e.target.value)}
                placeholder="공지사항을 입력하세요..."
                rows={3}
                style={{width:'100%',background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,
                  color:'#dde1f2',padding:'10px 12px',fontSize:12,outline:'none',resize:'vertical',
                  fontFamily:'inherit',marginBottom:10}}/>
              <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:10}}>
                {alertToggleBtn('📌 체크리스트 상단에도 노출', noticeAlertOn, setNoticeAlertOn)}
                {noticeAlertOn && (
                  <>
                    <span style={{fontSize:10,color:'#5e6585'}}>노출기간</span>
                    <input type="date" value={noticeAlertStart} onChange={e=>setNoticeAlertStart(e.target.value)} style={dateInputStyle}/>
                    <span style={{fontSize:10,color:'#5e6585'}}>~</span>
                    <input type="date" value={noticeAlertEnd} onChange={e=>setNoticeAlertEnd(e.target.value)} style={dateInputStyle}/>
                  </>
                )}
              </div>
              <button onClick={addNotice}
                style={{background:'#f9b934',color:'#000',border:'none',borderRadius:7,
                  padding:'8px 20px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                공지 등록
              </button>
            </div>
          )}

          {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:40}}>로딩 중...</div> : (
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              {notices.length===0 && (
                <div style={{textAlign:'center',color:'#5e6585',padding:40}}>등록된 공지가 없습니다</div>
              )}
              {notices.map(n=>{
                const editing = editAlertId === 'notice_'+n.id
                return (
                <div key={n.id} style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'18px',
                  borderLeft: n.createdAt>lastRead?'4px solid #f9b934':'4px solid #272a3d'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                      <span style={{fontSize:11,fontWeight:700,color:'#f9b934'}}>👑 사장</span>
                      {n.createdAt>lastRead && (
                        <span style={{background:'#f87171',color:'#fff',fontSize:9,fontWeight:700,
                          padding:'2px 6px',borderRadius:999}}>NEW</span>
                      )}
                      {n.checklistAlert && (
                        <span style={{background:'rgba(167,139,250,0.15)',color:'#a78bfa',fontSize:9,fontWeight:700,
                          padding:'2px 6px',borderRadius:999}}>
                          📌 {n.alertStart}~{n.alertEnd}
                        </span>
                      )}
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontSize:10,color:'#5e6585'}}>{timeAgo(n.createdAt)}</span>
                      {isOwner && (
                        <button onClick={()=>deleteNotice(n.id)}
                          style={{background:'transparent',border:'none',color:'#f87171',cursor:'pointer',fontSize:12}}>
                          🗑
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{fontSize:13,color:'#dde1f2',lineHeight:1.8,whiteSpace:'pre-wrap',marginBottom:isOwner?10:0}}>{n.content}</div>

                  {isOwner && (
                    editing ? (
                      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',
                        background:'rgba(167,139,250,0.06)',borderRadius:8,padding:'10px 12px'}}>
                        <span style={{fontSize:10,color:'#a78bfa',fontWeight:600}}>노출기간</span>
                        <input type="date" value={alertForm.start} onChange={e=>setAlertForm(f=>({...f,start:e.target.value}))} style={dateInputStyle}/>
                        <span style={{fontSize:10,color:'#5e6585'}}>~</span>
                        <input type="date" value={alertForm.end} onChange={e=>setAlertForm(f=>({...f,end:e.target.value}))} style={dateInputStyle}/>
                        <button onClick={()=>saveAlert('notice', n.id)}
                          style={{background:'#a78bfa',color:'#000',border:'none',borderRadius:6,padding:'5px 12px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                          저장
                        </button>
                        <button onClick={()=>setEditAlertId(null)}
                          style={{background:'transparent',border:'1px solid #272a3d',color:'#5e6585',borderRadius:6,padding:'5px 12px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
                          취소
                        </button>
                      </div>
                    ) : (
                      <button onClick={()=>n.checklistAlert ? removeAlert('notice', n.id) : startEditAlert('notice', n)}
                        style={{background:'transparent',border:'1px solid #272a3d',color: n.checklistAlert?'#f87171':'#5e6585',
                          borderRadius:6,padding:'5px 12px',fontSize:10,cursor:'pointer',fontFamily:'inherit'}}>
                        {n.checklistAlert ? '📌 체크리스트 알림 해제' : '+ 체크리스트 알림 설정'}
                      </button>
                    )
                  )}
                </div>
              )})}
            </div>
          )}
        </div>
      )}

      {/* 직원 메모 탭 */}
      {activeTab==='memo' && (
        <div>
          {/* 메모 작성 */}
          <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'18px',marginBottom:18}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:12}}>💬 메모 작성</div>
            <textarea value={newMemo} onChange={e=>setNewMemo(e.target.value)}
              placeholder="인수인계, 대타 요청, 전달사항 등을 입력하세요..."
              rows={3}
              style={{width:'100%',background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,
                color:'#dde1f2',padding:'10px 12px',fontSize:12,outline:'none',resize:'vertical',
                fontFamily:'inherit',marginBottom:10}}/>
            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:10}}>
              {alertToggleBtn('📌 체크리스트 상단에도 노출', memoAlertOn, setMemoAlertOn)}
              {memoAlertOn && (
                <>
                  <span style={{fontSize:10,color:'#5e6585'}}>노출기간</span>
                  <input type="date" value={memoAlertStart} onChange={e=>setMemoAlertStart(e.target.value)} style={dateInputStyle}/>
                  <span style={{fontSize:10,color:'#5e6585'}}>~</span>
                  <input type="date" value={memoAlertEnd} onChange={e=>setMemoAlertEnd(e.target.value)} style={dateInputStyle}/>
                </>
              )}
            </div>
            <button onClick={addMemo}
              style={{background:'#f9b934',color:'#000',border:'none',borderRadius:7,
                padding:'8px 20px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              메모 등록
            </button>
          </div>

          {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:40}}>로딩 중...</div> : (
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              {memos.length===0 && (
                <div style={{textAlign:'center',color:'#5e6585',padding:40}}>등록된 메모가 없습니다</div>
              )}
              {memos.map(m=>{
                const canManage = isOwner || m.authorUid===user.uid
                const editing = editAlertId === 'memo_'+m.id
                return (
                <div key={m.id} style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'18px',
                  borderLeft: m.createdAt>lastReadMemo?'4px solid #93c5fd':'4px solid #272a3d'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                      <span style={{fontSize:12,fontWeight:700,color:'#dde1f2'}}>{m.authorName}</span>
                      <GradeBadge joinDate={m.joinDate} size={10}/>
                      {m.createdAt>lastReadMemo && (
                        <span style={{background:'#93c5fd',color:'#000',fontSize:9,fontWeight:700,
                          padding:'2px 6px',borderRadius:999}}>NEW</span>
                      )}
                      {m.checklistAlert && (
                        <span style={{background:'rgba(167,139,250,0.15)',color:'#a78bfa',fontSize:9,fontWeight:700,
                          padding:'2px 6px',borderRadius:999}}>
                          📌 {m.alertStart}~{m.alertEnd}
                        </span>
                      )}
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontSize:10,color:'#5e6585'}}>{timeAgo(m.createdAt)}</span>
                      {canManage && (
                        <button onClick={()=>deleteMemo(m.id)}
                          style={{background:'transparent',border:'none',color:'#f87171',cursor:'pointer',fontSize:12}}>
                          🗑
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{fontSize:13,color:'#dde1f2',lineHeight:1.8,whiteSpace:'pre-wrap',marginBottom:canManage?10:0}}>{m.content}</div>

                  {canManage && (
                    editing ? (
                      <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',
                        background:'rgba(167,139,250,0.06)',borderRadius:8,padding:'10px 12px'}}>
                        <span style={{fontSize:10,color:'#a78bfa',fontWeight:600}}>노출기간</span>
                        <input type="date" value={alertForm.start} onChange={e=>setAlertForm(f=>({...f,start:e.target.value}))} style={dateInputStyle}/>
                        <span style={{fontSize:10,color:'#5e6585'}}>~</span>
                        <input type="date" value={alertForm.end} onChange={e=>setAlertForm(f=>({...f,end:e.target.value}))} style={dateInputStyle}/>
                        <button onClick={()=>saveAlert('memo', m.id)}
                          style={{background:'#a78bfa',color:'#000',border:'none',borderRadius:6,padding:'5px 12px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                          저장
                        </button>
                        <button onClick={()=>setEditAlertId(null)}
                          style={{background:'transparent',border:'1px solid #272a3d',color:'#5e6585',borderRadius:6,padding:'5px 12px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
                          취소
                        </button>
                      </div>
                    ) : (
                      <button onClick={()=>m.checklistAlert ? removeAlert('memo', m.id) : startEditAlert('memo', m)}
                        style={{background:'transparent',border:'1px solid #272a3d',color: m.checklistAlert?'#f87171':'#5e6585',
                          borderRadius:6,padding:'5px 12px',fontSize:10,cursor:'pointer',fontFamily:'inherit'}}>
                        {m.checklistAlert ? '📌 체크리스트 알림 해제' : '+ 체크리스트 알림 설정'}
                      </button>
                    )
                  )}
                </div>
              )})}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
