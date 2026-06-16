import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, orderBy, query } from 'firebase/firestore'
import { useAuth, GradeBadge } from '../AuthContext'

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
      isOwner: true
    })
    setNewNotice('')
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
    })
    setNewMemo('')
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

  function timeAgo(iso) {
    const diff = (new Date() - new Date(iso)) / 1000
    if(diff < 60) return '방금 전'
    if(diff < 3600) return `${Math.floor(diff/60)}분 전`
    if(diff < 86400) return `${Math.floor(diff/3600)}시간 전`
    return `${Math.floor(diff/86400)}일 전`
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
              {notices.map(n=>(
                <div key={n.id} style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'18px',
                  borderLeft: n.createdAt>lastRead?'4px solid #f9b934':'4px solid #272a3d'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:10}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontSize:11,fontWeight:700,color:'#f9b934'}}>👑 사장</span>
                      {n.createdAt>lastRead && (
                        <span style={{background:'#f87171',color:'#fff',fontSize:9,fontWeight:700,
                          padding:'2px 6px',borderRadius:999}}>NEW</span>
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
                  <div style={{fontSize:13,color:'#dde1f2',lineHeight:1.8,whiteSpace:'pre-wrap'}}>{n.content}</div>
                </div>
              ))}
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
              {memos.map(m=>(
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
                    </div>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{fontSize:10,color:'#5e6585'}}>{timeAgo(m.createdAt)}</span>
                      {(isOwner || m.authorUid===user.uid) && (
                        <button onClick={()=>deleteMemo(m.id)}
                          style={{background:'transparent',border:'none',color:'#f87171',cursor:'pointer',fontSize:12}}>
                          🗑
                        </button>
                      )}
                    </div>
                  </div>
                  <div style={{fontSize:13,color:'#dde1f2',lineHeight:1.8,whiteSpace:'pre-wrap'}}>{m.content}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
