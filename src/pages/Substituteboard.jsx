import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')
const DAYS_KR = ['일','월','화','수','목','금','토']

const HOURS = Array.from({length:24},(_,i)=>pad(i))
const MINUTES = ['00','30']

function todayStr() {
  const n = new Date()
  return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}`
}

function dateLabel(dateStr) {
  if(!dateStr) return ''
  const d = new Date(dateStr)
  return `${d.getMonth()+1}/${d.getDate()}(${DAYS_KR[d.getDay()]})`
}

function isPast(dateStr) {
  if(!dateStr) return false
  const today = todayStr()
  return dateStr < today
}

export default function SubstituteBoard() {
  const [employees, setEmployees] = useState([])
  const [requests, setRequests]   = useState([]) // [{id, requesterUid, date, startH, startM, endH, endM, reason, applicants:[uid], confirmedUid, createdAt}]
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({
    requesterUid:'', date: todayStr(), startH:'09', startM:'00', endH:'18', endM:'00', reason:'',
  })

  async function load() {
    setLoading(true)
    try {
      const usersSnap = await getDocs(collection(db,'users'))
      const emps = []
      usersSnap.forEach(d=>{
        const data = d.data()
        if(data.status==='approved' && !['owner','store','investor'].includes(data.role))
          emps.push({ uid:d.id, name:data.name })
      })
      setEmployees(emps)

      const reqSnap = await getDoc(doc(db,'substitutes','requests'))
      setRequests(reqSnap.exists() ? (reqSnap.data().list||[]) : [])
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(()=>{ load() },[])

  const nameOf = uid => employees.find(e=>e.uid===uid)?.name || '—'

  async function saveRequests(newList) {
    await setDoc(doc(db,'substitutes','requests'), { list:newList })
    setRequests(newList)
  }

  async function addRequest() {
    if(!form.requesterUid) return alert('대타가 필요한 직원을 선택해주세요')
    if(!form.date) return alert('날짜를 선택해주세요')
    setSaving(true)
    try {
      const newReq = {
        id: Date.now().toString(),
        requesterUid: form.requesterUid,
        date: form.date,
        startH: form.startH, startM: form.startM,
        endH: form.endH, endM: form.endM,
        reason: form.reason || '',
        applicants: [],
        confirmedUid: null,
        createdAt: new Date().toISOString(),
      }
      await saveRequests([...requests, newReq])
      setForm({ requesterUid:'', date: todayStr(), startH:'09', startM:'00', endH:'18', endM:'00', reason:'' })
      setShowForm(false)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  async function toggleApplicant(reqId, uid) {
    const newList = requests.map(r=>{
      if(r.id !== reqId) return r
      const applicants = r.applicants.includes(uid)
        ? r.applicants.filter(a=>a!==uid)
        : [...r.applicants, uid]
      return { ...r, applicants }
    })
    await saveRequests(newList)
  }

  async function confirmApplicant(reqId, uid) {
    const newList = requests.map(r=>
      r.id === reqId ? { ...r, confirmedUid: uid } : r
    )
    await saveRequests(newList)
  }

  async function cancelConfirm(reqId) {
    const newList = requests.map(r=>
      r.id === reqId ? { ...r, confirmedUid: null } : r
    )
    await saveRequests(newList)
  }

  async function deleteRequest(reqId) {
    if(!window.confirm('이 대타 요청을 삭제하시겠습니까?')) return
    await saveRequests(requests.filter(r=>r.id!==reqId))
  }

  // 지난 날짜는 자동으로 목록에서 숨김 (완전 삭제는 안 함, 필터만)
  const visibleRequests = requests
    .filter(r=>!isPast(r.date))
    .sort((a,b)=> a.date===b.date ? 0 : (a.date>b.date?1:-1))

  const unconfirmed = visibleRequests.filter(r=>!r.confirmedUid)
  const confirmed   = visibleRequests.filter(r=>r.confirmedUid)

  const timeLabel = r => `${r.startH}:${r.startM}~${r.endH}:${r.endM}`

  const selectStyle = {
    background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
    padding:'8px 10px',fontSize:12,outline:'none',fontFamily:'inherit'
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>🔄 대타 구함</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>대타 요청 및 지원 현황</div>
        </div>
        <button onClick={()=>setShowForm(v=>!v)}
          style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,
            padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
          + 대타 요청
        </button>
      </div>

      {/* 요청 등록 폼 */}
      {showForm && (
        <div style={{background:'#12141f',border:'1px solid #f9b934',borderRadius:12,marginBottom:18,padding:18}}>
          <div style={{fontSize:13,fontWeight:600,color:'#f9b934',marginBottom:14}}>+ 대타 요청 등록</div>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {/* 요청자 토글 */}
            <div>
              <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>대타가 필요한 직원</label>
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {employees.map(e=>(
                  <button key={e.uid} onClick={()=>setForm(f=>({...f,requesterUid:e.uid}))}
                    style={{padding:'7px 14px',borderRadius:7,border:'none',fontSize:12,fontWeight:600,
                      cursor:'pointer',fontFamily:'inherit',
                      background:form.requesterUid===e.uid?'#f9b934':'#191c2b',
                      color:form.requesterUid===e.uid?'#000':'#5e6585'}}>
                    {e.name}
                  </button>
                ))}
              </div>
            </div>

            {/* 날짜 */}
            <div>
              <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>날짜</label>
              <input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}
                style={{...selectStyle,width:180}}/>
            </div>

            {/* 시간 드롭다운 */}
            <div>
              <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>시간대</label>
              <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                <select value={form.startH} onChange={e=>setForm(f=>({...f,startH:e.target.value}))} style={selectStyle}>
                  {HOURS.map(h=><option key={h} value={h}>{h}시</option>)}
                </select>
                <select value={form.startM} onChange={e=>setForm(f=>({...f,startM:e.target.value}))} style={selectStyle}>
                  {MINUTES.map(m=><option key={m} value={m}>{m}분</option>)}
                </select>
                <span style={{color:'#5e6585',fontSize:12}}>~</span>
                <select value={form.endH} onChange={e=>setForm(f=>({...f,endH:e.target.value}))} style={selectStyle}>
                  {HOURS.map(h=><option key={h} value={h}>{h}시</option>)}
                </select>
                <select value={form.endM} onChange={e=>setForm(f=>({...f,endM:e.target.value}))} style={selectStyle}>
                  {MINUTES.map(m=><option key={m} value={m}>{m}분</option>)}
                </select>
              </div>
            </div>

            {/* 사유 */}
            <div>
              <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>사유 (선택)</label>
              <input value={form.reason} onChange={e=>setForm(f=>({...f,reason:e.target.value}))}
                placeholder="개인사정 등"
                style={{...selectStyle,width:'100%'}}/>
            </div>
          </div>
          <div style={{display:'flex',gap:8,marginTop:16}}>
            <button onClick={addRequest} disabled={saving}
              style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'9px 20px',
                fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              {saving?'등록 중...':'등록'}
            </button>
            <button onClick={()=>setShowForm(false)}
              style={{background:'#191c2b',color:'#5e6585',border:'1px solid #272a3d',borderRadius:8,
                padding:'9px 20px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
              취소
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{textAlign:'center',color:'#5e6585',padding:60}}>로딩 중...</div>
      ) : (
        <>
          {/* 미확정 목록 */}
          <div style={{background:'#12141f',border:'1px solid rgba(248,113,113,0.3)',borderRadius:12,
            overflow:'hidden',marginBottom:18}}>
            <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,
              color:'#f87171',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span>🔴 미확정 ({unconfirmed.length}건)</span>
            </div>
            {unconfirmed.length === 0 ? (
              <div style={{padding:24,textAlign:'center',color:'#5e6585',fontSize:12}}>미확정 대타 요청이 없습니다</div>
            ) : (
              <div style={{padding:'8px 0'}}>
                {unconfirmed.map(r=>(
                  <div key={r.id} style={{padding:'14px 18px',borderBottom:'1px solid #1a1d2e'}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:8}}>
                      <div>
                        <div style={{fontSize:14,fontWeight:700,color:'#dde1f2'}}>
                          {nameOf(r.requesterUid)} <span style={{color:'#5e6585',fontWeight:400}}>대타 구함</span>
                        </div>
                        <div style={{fontSize:11,color:'#f9b934',marginTop:3,fontWeight:600}}>
                          📅 {dateLabel(r.date)} · ⏰ {timeLabel(r)}
                        </div>
                        {r.reason && <div style={{fontSize:10,color:'#5e6585',marginTop:3}}>사유: {r.reason}</div>}
                      </div>
                      <button onClick={()=>deleteRequest(r.id)}
                        style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',
                          padding:'4px 10px',fontSize:10,borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>
                        삭제
                      </button>
                    </div>

                    {/* 지원자 토글 */}
                    <div style={{marginTop:12}}>
                      <div style={{fontSize:10,color:'#5e6585',fontWeight:600,marginBottom:6}}>
                        지원자 선택 (여러 명 지원 가능)
                      </div>
                      <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                        {employees.filter(e=>e.uid!==r.requesterUid).map(e=>{
                          const applied = r.applicants.includes(e.uid)
                          return (
                            <button key={e.uid} onClick={()=>toggleApplicant(r.id, e.uid)}
                              style={{padding:'6px 12px',borderRadius:7,border:'none',fontSize:11,fontWeight:600,
                                cursor:'pointer',fontFamily:'inherit',
                                background:applied?'rgba(52,211,153,0.15)':'#191c2b',
                                color:applied?'#34d399':'#5e6585',
                                outline:applied?'1px solid rgba(52,211,153,0.4)':'1px solid #272a3d'}}>
                              {applied && '✓ '}{e.name}
                            </button>
                          )
                        })}
                      </div>
                    </div>

                    {/* 확정 버튼들 */}
                    {r.applicants.length > 0 && (
                      <div style={{marginTop:10,display:'flex',flexWrap:'wrap',gap:6,alignItems:'center'}}>
                        <span style={{fontSize:10,color:'#5e6585'}}>확정:</span>
                        {r.applicants.map(uid=>(
                          <button key={uid} onClick={()=>confirmApplicant(r.id, uid)}
                            style={{background:'#34d399',color:'#000',border:'none',borderRadius:6,
                              padding:'5px 12px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                            {nameOf(uid)} 확정 ✓
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 확정 목록 */}
          <div style={{background:'#12141f',border:'1px solid rgba(52,211,153,0.3)',borderRadius:12,overflow:'hidden'}}>
            <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,
              color:'#34d399'}}>
              🟢 확정됨 ({confirmed.length}건)
            </div>
            {confirmed.length === 0 ? (
              <div style={{padding:24,textAlign:'center',color:'#5e6585',fontSize:12}}>확정된 대타가 없습니다</div>
            ) : (
              <div style={{padding:'8px 0'}}>
                {confirmed.map(r=>(
                  <div key={r.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                    padding:'12px 18px',borderBottom:'1px solid #1a1d2e',flexWrap:'wrap',gap:8}}>
                    <div>
                      <div style={{fontSize:13,fontWeight:700}}>
                        <span style={{color:'#5e6585'}}>{nameOf(r.requesterUid)}</span>
                        <span style={{color:'#5e6585',fontWeight:400}}> → </span>
                        <span style={{color:'#34d399'}}>{nameOf(r.confirmedUid)}</span>
                        <span style={{color:'#5e6585',fontWeight:400}}> 대타 확정</span>
                      </div>
                      <div style={{fontSize:11,color:'#f9b934',marginTop:3,fontWeight:600}}>
                        📅 {dateLabel(r.date)} · ⏰ {timeLabel(r)}
                      </div>
                    </div>
                    <div style={{display:'flex',gap:6}}>
                      <button onClick={()=>cancelConfirm(r.id)}
                        style={{background:'transparent',border:'1px solid #272a3d',color:'#5e6585',
                          padding:'5px 12px',fontSize:10,borderRadius:5,cursor:'pointer',fontFamily:'inherit'}}>
                        확정 취소
                      </button>
                      <button onClick={()=>deleteRequest(r.id)}
                        style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',
                          padding:'5px 12px',fontSize:10,borderRadius:5,cursor:'pointer',fontFamily:'inherit'}}>
                        삭제
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
