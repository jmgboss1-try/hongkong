import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../AuthContext'

const pad = n => String(n).padStart(2,'0')
const todayStr = () => { const n=new Date(); return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}` }
const wonFmt = n => (n||0).toLocaleString('ko-KR')

// 업체 1곳의 장부를 날짜순으로 정렬하고 누적 잔액을 계산
function buildLedger(vendor) {
  const sorted = [...(vendor.entries||[])].sort((a,b)=>
    a.date===b.date ? String(a.id).localeCompare(String(b.id)) : a.date.localeCompare(b.date))
  let bal = 0
  return sorted.map(e=>{
    bal += e.kind==='charge' ? e.amount : -e.amount
    return { ...e, balance: bal }
  })
}
function balanceOf(vendor) {
  return (vendor.entries||[]).reduce((s,e)=> s + (e.kind==='charge' ? e.amount : -e.amount), 0)
}
function totalCharged(vendor) {
  return (vendor.entries||[]).filter(e=>e.kind==='charge').reduce((s,e)=>s+e.amount,0)
}
function totalUsed(vendor) {
  return (vendor.entries||[]).filter(e=>e.kind==='use').reduce((s,e)=>s+e.amount,0)
}

const inputStyle = {
  background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
  padding:'8px 10px',fontSize:12,outline:'none',fontFamily:'inherit'
}

export default function Prepaid() {
  const { isOwner, isStore } = useAuth()
  const canEdit = isOwner || isStore // 사장·매장 계정 동일 권한
  const [vendors, setVendors] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)

  const [selectedId, setSelectedId] = useState(null)
  const [showArchived, setShowArchived] = useState(false)

  // 업체 추가/수정 폼
  const [showVendorForm, setShowVendorForm] = useState(false)
  const [vendorEditId, setVendorEditId] = useState(null) // null이면 신규
  const [vendorForm, setVendorForm] = useState({ name:'', contact:'', memo:'', lowAlert:'' })

  // 장부 항목 추가 폼
  const [entryForm, setEntryForm] = useState({ date: todayStr(), kind:'use', amount:'', memo:'' })
  // 장부 항목 수정
  const [editEntryId, setEditEntryId] = useState(null)
  const [editEntryForm, setEditEntryForm] = useState(null)

  async function load() {
    setLoading(true)
    try {
      const snap = await getDoc(doc(db,'prepaid','vendors'))
      setVendors(snap.exists() ? (snap.data().list||[]) : [])
    } catch(e) { console.error(e) }
    setLoading(false)
  }
  useEffect(()=>{ load() },[])

  async function saveVendors(list) {
    await setDoc(doc(db,'prepaid','vendors'), { list })
    setVendors(list)
  }

  // ── 업체 관리 ──
  function openNewVendor() {
    setVendorEditId(null)
    setVendorForm({ name:'', contact:'', memo:'', lowAlert:'' })
    setShowVendorForm(true)
  }
  function openEditVendor(v) {
    setVendorEditId(v.id)
    setVendorForm({ name:v.name, contact:v.contact||'', memo:v.memo||'', lowAlert: v.lowAlert ? String(v.lowAlert) : '' })
    setShowVendorForm(true)
  }
  async function submitVendor() {
    if(!vendorForm.name.trim()) { alert('업체명을 입력하세요'); return }
    setSaving(true)
    const base = {
      name: vendorForm.name.trim(),
      contact: vendorForm.contact.trim(),
      memo: vendorForm.memo.trim(),
      lowAlert: +vendorForm.lowAlert || 0,
    }
    if(vendorEditId) {
      await saveVendors(vendors.map(v=>v.id===vendorEditId ? { ...v, ...base } : v))
    } else {
      const nv = { id:'v_'+Date.now(), ...base, archived:false, entries:[] }
      await saveVendors([...vendors, nv])
      setSelectedId(nv.id)
    }
    setShowVendorForm(false); setVendorEditId(null)
    setSaving(false)
  }
  async function toggleArchive(v) {
    await saveVendors(vendors.map(x=>x.id===v.id ? { ...x, archived: !x.archived } : x))
    if(!v.archived && selectedId===v.id) setSelectedId(null)
  }
  async function deleteVendor(v) {
    if(!window.confirm(`'${v.name}' 업체와 모든 장부 기록을 삭제합니다. 되돌릴 수 없어요. 삭제할까요?`)) return
    await saveVendors(vendors.filter(x=>x.id!==v.id))
    if(selectedId===v.id) setSelectedId(null)
  }

  // ── 장부 항목 ──
  async function addEntry() {
    const amount = +String(entryForm.amount).replace(/,/g,'')
    if(!selectedId || !amount || amount<=0) { alert('금액을 입력하세요'); return }
    setSaving(true)
    const entry = {
      id:'e_'+Date.now(), date:entryForm.date, kind:entryForm.kind,
      amount, memo:entryForm.memo.trim(),
    }
    await saveVendors(vendors.map(v=>v.id===selectedId ? { ...v, entries:[...(v.entries||[]), entry] } : v))
    setEntryForm(f=>({ ...f, amount:'', memo:'' }))
    setSaving(false)
  }
  function startEditEntry(e) {
    setEditEntryId(e.id)
    setEditEntryForm({ date:e.date, kind:e.kind, amount:String(e.amount), memo:e.memo||'' })
  }
  async function saveEditEntry() {
    const amount = +String(editEntryForm.amount).replace(/,/g,'')
    if(!amount || amount<=0) { alert('금액을 입력하세요'); return }
    setSaving(true)
    await saveVendors(vendors.map(v=>v.id!==selectedId ? v : {
      ...v,
      entries:(v.entries||[]).map(e=>e.id===editEntryId
        ? { ...e, date:editEntryForm.date, kind:editEntryForm.kind, amount, memo:editEntryForm.memo.trim() } : e)
    }))
    setEditEntryId(null); setEditEntryForm(null)
    setSaving(false)
  }
  async function deleteEntry(id) {
    if(!window.confirm('이 기록을 삭제할까요?')) return
    await saveVendors(vendors.map(v=>v.id!==selectedId ? v : {
      ...v, entries:(v.entries||[]).filter(e=>e.id!==id)
    }))
  }

  const activeVendors = vendors.filter(v=>!v.archived)
  const archivedVendors = vendors.filter(v=>v.archived)
  const totalBalance = activeVendors.reduce((s,v)=>s+balanceOf(v),0)
  const lowVendors = activeVendors.filter(v=>v.lowAlert>0 && balanceOf(v)<=v.lowAlert)

  const selected = vendors.find(v=>v.id===selectedId) || null
  const ledger = selected ? buildLedger(selected) : []
  const ledgerShown = [...ledger].reverse() // 최신이 위로

  function VendorCard(v) {
    const bal = balanceOf(v)
    const low = v.lowAlert>0 && bal<=v.lowAlert
    const isSel = v.id===selectedId
    return (
      <div key={v.id} onClick={()=>setSelectedId(isSel ? null : v.id)}
        style={{
          background: isSel ? 'rgba(249,185,52,0.10)' : '#191c2b',
          border: isSel ? '1.5px solid #f9b934' : low ? '1px solid rgba(248,113,113,0.5)' : '1px solid #272a3d',
          borderRadius:10,padding:'12px 14px',cursor:'pointer',opacity: v.archived ? 0.6 : 1,
        }}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8}}>
          <span style={{fontSize:13,fontWeight:700,color:'#dde1f2'}}>{v.name}</span>
          {low && <span style={{fontSize:10,color:'#f87171',fontWeight:700}}>⚠ 잔액 부족</span>}
        </div>
        <div style={{fontSize:20,fontWeight:800,marginTop:6,
          color: bal<=0 ? '#5e6585' : low ? '#f87171' : '#34d399'}}>
          {wonFmt(bal)}<span style={{fontSize:11,fontWeight:400,color:'#5e6585'}}> 원</span>
        </div>
        <div style={{fontSize:10,color:'#5e6585',marginTop:4}}>
          충전 {wonFmt(totalCharged(v))} · 사용 {wonFmt(totalUsed(v))}
        </div>
      </div>
    )
  }

  // 직원 계정은 접근 불가 (사장·매장 계정만)
  if(!isOwner && !isStore) return <Navigate to="/my-schedule" />

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22,flexWrap:'wrap',gap:10}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>💳 선결제 관리</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>업체·개인별 선결제 충전 / 차감 장부</div>
        </div>
        {canEdit && (
          <button onClick={openNewVendor}
            style={{background:'#34d399',color:'#000',border:'none',borderRadius:8,
              padding:'9px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
            + 업체 추가
          </button>
        )}
      </div>

      {/* 업체 추가/수정 폼 */}
      {showVendorForm && (
        <div style={{background:'#12141f',border:'1px solid #f9b934',borderRadius:12,padding:18,marginBottom:18}}>
          <div style={{fontSize:13,fontWeight:600,color:'#f9b934',marginBottom:12}}>
            {vendorEditId ? '✏️ 업체 정보 수정' : '➕ 새 업체 추가'}
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
            <input value={vendorForm.name} onChange={e=>setVendorForm(f=>({...f,name:e.target.value}))}
              placeholder="업체명 (예: 소망 이비인후과)" style={{...inputStyle,flex:2,minWidth:180}}/>
            <input value={vendorForm.contact} onChange={e=>setVendorForm(f=>({...f,contact:e.target.value}))}
              placeholder="연락처/담당자 (선택)" style={{...inputStyle,flex:1,minWidth:140}}/>
          </div>
          <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center',marginBottom:12}}>
            <input value={vendorForm.memo} onChange={e=>setVendorForm(f=>({...f,memo:e.target.value}))}
              placeholder="메모 (할인 조건, 유효기간 등)" style={{...inputStyle,flex:2,minWidth:180}}/>
            <span style={{fontSize:10,color:'#5e6585'}}>잔액 알림 기준</span>
            <input type="number" value={vendorForm.lowAlert} onChange={e=>setVendorForm(f=>({...f,lowAlert:e.target.value}))}
              placeholder="예: 30000" style={{...inputStyle,width:100}}/>
            <span style={{fontSize:10,color:'#5e6585'}}>원 이하</span>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={submitVendor} disabled={saving}
              style={{background:'#f9b934',color:'#000',border:'none',borderRadius:7,padding:'8px 18px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              저장
            </button>
            <button onClick={()=>{setShowVendorForm(false);setVendorEditId(null)}}
              style={{background:'transparent',border:'1px solid #272a3d',color:'#5e6585',borderRadius:7,padding:'8px 18px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
              취소
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{textAlign:'center',color:'#5e6585',padding:60}}>로딩 중...</div>
      ) : (
        <>
          {/* 요약 */}
          <div style={{display:'flex',gap:10,flexWrap:'wrap',marginBottom:18}}>
            <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:10,padding:'12px 18px'}}>
              <div style={{fontSize:10,color:'#5e6585',marginBottom:2}}>전체 선결제 잔액</div>
              <div style={{fontSize:20,fontWeight:800,color:'#f9b934'}}>{wonFmt(totalBalance)}<span style={{fontSize:11,fontWeight:400,color:'#5e6585'}}> 원</span></div>
            </div>
            <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:10,padding:'12px 18px'}}>
              <div style={{fontSize:10,color:'#5e6585',marginBottom:2}}>관리 중인 업체</div>
              <div style={{fontSize:20,fontWeight:800,color:'#dde1f2'}}>{activeVendors.length}<span style={{fontSize:11,fontWeight:400,color:'#5e6585'}}> 곳</span></div>
            </div>
          </div>

          {lowVendors.length>0 && (
            <div style={{background:'rgba(248,113,113,0.10)',border:'1.5px solid rgba(248,113,113,0.35)',
              borderRadius:10,padding:'12px 16px',marginBottom:18,fontSize:12,color:'#f87171',fontWeight:700}}>
              ⚠ 잔액이 기준 이하인 업체: {lowVendors.map(v=>`${v.name}(${wonFmt(balanceOf(v))}원)`).join(', ')}
            </div>
          )}

          {activeVendors.length===0 ? (
            <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:40,textAlign:'center',color:'#5e6585',fontSize:13}}>
              등록된 업체가 없습니다. {canEdit ? '오른쪽 위 "+ 업체 추가"로 시작하세요.' : ''}
            </div>
          ) : (
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:10,marginBottom:18}}>
              {activeVendors.map(v=>VendorCard(v))}
            </div>
          )}

          {/* 선택한 업체 장부 */}
          {selected && (
            <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:18,marginBottom:18}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10,flexWrap:'wrap',marginBottom:14}}>
                <div>
                  <div style={{fontSize:15,fontWeight:800,color:'#f9b934'}}>{selected.name}</div>
                  {(selected.contact||selected.memo) && (
                    <div style={{fontSize:11,color:'#5e6585',marginTop:3,lineHeight:1.6}}>
                      {selected.contact && <span>📞 {selected.contact}</span>}
                      {selected.contact && selected.memo && <span> · </span>}
                      {selected.memo && <span>📝 {selected.memo}</span>}
                    </div>
                  )}
                  {selected.lowAlert>0 && (
                    <div style={{fontSize:10,color:'#5e6585',marginTop:2}}>잔액 {wonFmt(selected.lowAlert)}원 이하일 때 알림</div>
                  )}
                </div>
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:10,color:'#5e6585'}}>현재 잔액</div>
                  <div style={{fontSize:22,fontWeight:800,color:'#34d399'}}>{wonFmt(balanceOf(selected))}<span style={{fontSize:11,fontWeight:400,color:'#5e6585'}}> 원</span></div>
                </div>
              </div>

              {canEdit && (
                <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
                  <button onClick={()=>openEditVendor(selected)}
                    style={{background:'#191c2b',border:'1px solid #272a3d',color:'#dde1f2',borderRadius:6,padding:'5px 12px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>✏️ 업체 정보 수정</button>
                  <button onClick={()=>toggleArchive(selected)}
                    style={{background:'#191c2b',border:'1px solid #272a3d',color:'#93c5fd',borderRadius:6,padding:'5px 12px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>📦 보관 처리</button>
                  <button onClick={()=>deleteVendor(selected)}
                    style={{background:'#191c2b',border:'1px solid #272a3d',color:'#f87171',borderRadius:6,padding:'5px 12px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>🗑 업체 삭제</button>
                </div>
              )}

              {/* 기록 추가 */}
              <div style={{background:'#191c2b',borderRadius:10,padding:12,marginBottom:14}}>
                <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                  <input type="date" value={entryForm.date} onChange={e=>setEntryForm(f=>({...f,date:e.target.value}))} style={inputStyle}/>
                  <div style={{display:'flex',gap:0}}>
                    <button onClick={()=>setEntryForm(f=>({...f,kind:'charge'}))}
                      style={{border:'none',cursor:'pointer',fontFamily:'inherit',fontSize:12,fontWeight:700,padding:'8px 14px',
                        borderRadius:'7px 0 0 7px',
                        background: entryForm.kind==='charge' ? '#34d399' : '#0b0d16',
                        color: entryForm.kind==='charge' ? '#000' : '#5e6585'}}>＋ 충전</button>
                    <button onClick={()=>setEntryForm(f=>({...f,kind:'use'}))}
                      style={{border:'none',cursor:'pointer',fontFamily:'inherit',fontSize:12,fontWeight:700,padding:'8px 14px',
                        borderRadius:'0 7px 7px 0',
                        background: entryForm.kind==='use' ? '#f87171' : '#0b0d16',
                        color: entryForm.kind==='use' ? '#000' : '#5e6585'}}>－ 차감</button>
                  </div>
                  <input type="number" value={entryForm.amount} onChange={e=>setEntryForm(f=>({...f,amount:e.target.value}))}
                    placeholder="금액" style={{...inputStyle,width:110}}/>
                  <input value={entryForm.memo} onChange={e=>setEntryForm(f=>({...f,memo:e.target.value}))}
                    placeholder="메모 (선택)" style={{...inputStyle,flex:1,minWidth:120}}/>
                  <button onClick={addEntry} disabled={saving}
                    style={{background:'#f9b934',color:'#000',border:'none',borderRadius:7,padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>
                    기록
                  </button>
                </div>
              </div>

              {/* 장부 표 */}
              {ledgerShown.length===0 ? (
                <div style={{fontSize:12,color:'#5e6585',padding:'10px 0'}}>아직 기록이 없습니다. 기존 잔액이 있으면 "충전"으로 이월 금액을 먼저 기록하세요.</div>
              ) : (
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,minWidth:420}}>
                    <thead>
                      <tr style={{color:'#5e6585',fontSize:10,textAlign:'right'}}>
                        <th style={{textAlign:'left',padding:'6px 8px',fontWeight:600}}>일자</th>
                        <th style={{padding:'6px 8px',fontWeight:600}}>충전</th>
                        <th style={{padding:'6px 8px',fontWeight:600}}>차감</th>
                        <th style={{padding:'6px 8px',fontWeight:600}}>잔액</th>
                        <th style={{textAlign:'left',padding:'6px 8px',fontWeight:600}}>메모</th>
                        {canEdit && <th style={{width:56}}></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerShown.map(e=>{
                        if(editEntryId===e.id) {
                          return (
                            <tr key={e.id} style={{borderTop:'1px solid #191c2b'}}>
                              <td colSpan={canEdit?6:5} style={{padding:'8px'}}>
                                <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
                                  <input type="date" value={editEntryForm.date} onChange={ev=>setEditEntryForm(f=>({...f,date:ev.target.value}))} style={inputStyle}/>
                                  <select value={editEntryForm.kind} onChange={ev=>setEditEntryForm(f=>({...f,kind:ev.target.value}))} style={inputStyle}>
                                    <option value="charge">충전</option>
                                    <option value="use">차감</option>
                                  </select>
                                  <input type="number" value={editEntryForm.amount} onChange={ev=>setEditEntryForm(f=>({...f,amount:ev.target.value}))} style={{...inputStyle,width:100}}/>
                                  <input value={editEntryForm.memo} onChange={ev=>setEditEntryForm(f=>({...f,memo:ev.target.value}))} placeholder="메모" style={{...inputStyle,flex:1,minWidth:100}}/>
                                  <button onClick={saveEditEntry} disabled={saving}
                                    style={{background:'#f9b934',color:'#000',border:'none',borderRadius:5,padding:'6px 12px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>저장</button>
                                  <button onClick={()=>{setEditEntryId(null);setEditEntryForm(null)}}
                                    style={{background:'transparent',border:'1px solid #272a3d',color:'#5e6585',borderRadius:5,padding:'6px 12px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>취소</button>
                                </div>
                              </td>
                            </tr>
                          )
                        }
                        return (
                          <tr key={e.id} style={{borderTop:'1px solid #191c2b',textAlign:'right'}}>
                            <td style={{textAlign:'left',padding:'8px',color:'#dde1f2'}}>{e.date}</td>
                            <td style={{padding:'8px',color:'#34d399',fontWeight:700}}>{e.kind==='charge' ? wonFmt(e.amount) : ''}</td>
                            <td style={{padding:'8px',color:'#f87171',fontWeight:700}}>{e.kind==='use' ? wonFmt(e.amount) : ''}</td>
                            <td style={{padding:'8px',color:'#dde1f2',fontWeight:700}}>{wonFmt(e.balance)}</td>
                            <td style={{textAlign:'left',padding:'8px',color:'#5e6585'}}>{e.memo}</td>
                            {canEdit && (
                              <td style={{padding:'8px',whiteSpace:'nowrap'}}>
                                <button onClick={()=>startEditEntry(e)}
                                  style={{background:'transparent',border:'none',color:'#5e6585',fontSize:12,cursor:'pointer',padding:'0 4px'}}>✏️</button>
                                <button onClick={()=>deleteEntry(e.id)}
                                  style={{background:'transparent',border:'none',color:'#f87171',fontSize:12,cursor:'pointer',padding:'0 4px'}}>🗑</button>
                              </td>
                            )}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 보관된 업체 */}
          {archivedVendors.length>0 && (
            <div style={{marginTop:8}}>
              <button onClick={()=>setShowArchived(v=>!v)}
                style={{background:'transparent',border:'none',color:'#5e6585',fontSize:12,cursor:'pointer',fontFamily:'inherit',padding:0,marginBottom:10}}>
                {showArchived ? '▾' : '▸'} 보관된 업체 ({archivedVendors.length})
              </button>
              {showArchived && (
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:10}}>
                  {archivedVendors.map(v=>(
                    <div key={v.id}>
                      {VendorCard(v)}
                      {canEdit && (
                        <button onClick={()=>toggleArchive(v)}
                          style={{marginTop:6,background:'#191c2b',border:'1px solid #272a3d',color:'#93c5fd',borderRadius:6,padding:'4px 10px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
                          보관 해제
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
