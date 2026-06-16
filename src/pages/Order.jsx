import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { collection, addDoc, getDocs, doc, updateDoc, deleteDoc, orderBy, query } from 'firebase/firestore'
import { useAuth } from '../AuthContext'

const URGENCY = {
  normal: { label:'일반', color:'#5e6585', bg:'rgba(94,101,133,0.15)' },
  urgent: { label:'긴급', color:'#f87171', bg:'rgba(248,113,113,0.15)' },
}

const STATUS = {
  pending:  { label:'대기중',   color:'#f9b934', bg:'rgba(249,185,52,0.15)'  },
  checked:  { label:'확인완료', color:'#93c5fd', bg:'rgba(147,197,253,0.15)' },
  done:     { label:'완료',     color:'#34d399', bg:'rgba(52,211,153,0.15)'  },
}

export default function Order() {
  const { user, userData, isOwner } = useAuth()
  const [orders, setOrders] = useState([])
  const [presets, setPresets] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('list')
  const [filterStatus, setFilterStatus] = useState('all')

  // 새 요청 폼
  const [selPreset, setSelPreset] = useState('')
  const [customItem, setCustomItem] = useState('')
  const [qty, setQty] = useState('')
  const [urgency, setUrgency] = useState('normal')
  const [memo, setMemo] = useState('')

  // 품목 관리 (사장)
  const [newPreset, setNewPreset] = useState('')
  const [newPresetUnit, setNewPresetUnit] = useState('')

  async function load() {
    setLoading(true)
    try {
      const orderSnap = await getDocs(query(collection(db,'orders'), orderBy('createdAt','desc')))
      const list = []
      orderSnap.forEach(d => list.push({id:d.id, ...d.data()}))
      setOrders(list)

      const presetSnap = await getDocs(collection(db,'orderPresets'))
      const pList = []
      presetSnap.forEach(d => pList.push({id:d.id, ...d.data()}))
      setPresets(pList.sort((a,b)=>a.name>b.name?1:-1))
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  async function addOrder() {
    const itemName = selPreset || customItem.trim()
    if(!itemName) return alert('품목을 선택하거나 입력해주세요')
    if(!qty) return alert('수량을 입력해주세요')

    const preset = presets.find(p=>p.name===selPreset)
    await addDoc(collection(db,'orders'), {
      itemName,
      unit: preset?.unit || '',
      qty: +qty,
      urgency,
      memo: memo.trim(),
      status: 'pending',
      authorName: userData?.name || '직원',
      authorUid: user.uid,
      createdAt: new Date().toISOString(),
    })
    setSelPreset(''); setCustomItem(''); setQty(''); setUrgency('normal'); setMemo('')
    await load()
    setActiveTab('list')
  }

  async function updateStatus(id, status) {
    await updateDoc(doc(db,'orders',id), { status, checkedAt: new Date().toISOString() })
    await load()
  }

  async function deleteOrder(id) {
    if(!window.confirm('삭제하시겠습니까?')) return
    await deleteDoc(doc(db,'orders',id))
    await load()
  }

  async function addPreset() {
    if(!newPreset.trim()) return alert('품목명을 입력해주세요')
    await addDoc(collection(db,'orderPresets'), {
      name: newPreset.trim(),
      unit: newPresetUnit.trim() || '개'
    })
    setNewPreset(''); setNewPresetUnit('')
    await load()
  }

  async function deletePreset(id) {
    if(!window.confirm('품목을 삭제하시겠습니까?')) return
    await deleteDoc(doc(db,'orderPresets',id))
    await load()
  }

  function timeAgo(iso) {
    const diff = (new Date() - new Date(iso)) / 1000
    if(diff < 60) return '방금 전'
    if(diff < 3600) return `${Math.floor(diff/60)}분 전`
    if(diff < 86400) return `${Math.floor(diff/3600)}시간 전`
    return `${Math.floor(diff/86400)}일 전`
  }

  const filtered = filterStatus==='all' ? orders : orders.filter(o=>o.status===filterStatus)
  const pendingCount = orders.filter(o=>o.status==='pending').length
  const urgentCount = orders.filter(o=>o.status==='pending'&&o.urgency==='urgent').length

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>📦 발주 요청</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>재고 부족 및 주문 요청 관리</div>
        </div>
      </div>

      {/* 요약 카드 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:20}}>
        {[
          {label:'대기중 요청', val:pendingCount, color:'#f9b934'},
          {label:'긴급 요청', val:urgentCount, color:'#f87171'},
          {label:'전체 요청', val:orders.length, color:'#93c5fd'},
        ].map(k=>(
          <div key={k.label} style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'16px 20px',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:k.color}}></div>
            <div style={{fontSize:10,fontWeight:600,color:'#5e6585',textTransform:'uppercase',letterSpacing:.8,marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:22,fontWeight:700,color:k.color,fontFamily:'DM Mono,monospace'}}>{k.val}건</div>
          </div>
        ))}
      </div>

      {/* 탭 */}
      <div style={{display:'flex',gap:8,marginBottom:18,flexWrap:'wrap'}}>
        {[
          {key:'list', label:'📋 요청 목록'},
          {key:'add', label:'➕ 요청 등록'},
          ...(isOwner ? [{key:'preset', label:'⚙️ 품목 관리'}] : []),
        ].map(t=>(
          <button key={t.key} onClick={()=>setActiveTab(t.key)}
            style={{padding:'9px 18px',borderRadius:8,border:'none',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
              background:activeTab===t.key?'#f9b934':'#191c2b',
              color:activeTab===t.key?'#000':'#5e6585'}}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 요청 목록 */}
      {activeTab==='list' && (
        <div>
          {/* 상태 필터 */}
          <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
            {[['all','전체'],['pending','대기중'],['checked','확인완료'],['done','완료']].map(([key,label])=>(
              <button key={key} onClick={()=>setFilterStatus(key)}
                style={{padding:'5px 12px',borderRadius:6,border:'none',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                  background:filterStatus===key?'#f9b934':'#191c2b',color:filterStatus===key?'#000':'#5e6585'}}>
                {label}
              </button>
            ))}
          </div>

          {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:40}}>로딩 중...</div> : (
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              {filtered.length===0 && (
                <div style={{textAlign:'center',color:'#5e6585',padding:40}}>요청이 없습니다</div>
              )}
              {filtered.map(o=>(
                <div key={o.id} style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'16px 18px',
                  borderLeft:`4px solid ${o.urgency==='urgent'?'#f87171':'#272a3d'}`}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:8}}>
                    <div style={{flex:1}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'}}>
                        {/* 긴급도 */}
                        <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:999,
                          background:URGENCY[o.urgency]?.bg,color:URGENCY[o.urgency]?.color}}>
                          {URGENCY[o.urgency]?.label}
                        </span>
                        {/* 상태 */}
                        <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:999,
                          background:STATUS[o.status]?.bg,color:STATUS[o.status]?.color}}>
                          {STATUS[o.status]?.label}
                        </span>
                        <span style={{fontSize:10,color:'#5e6585'}}>{timeAgo(o.createdAt)}</span>
                      </div>
                      <div style={{fontSize:15,fontWeight:700,color:'#dde1f2',marginBottom:4}}>
                        {o.itemName} <span style={{fontSize:13,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>{o.qty}{o.unit}</span>
                      </div>
                      {o.memo && <div style={{fontSize:12,color:'#5e6585',marginBottom:4}}>💬 {o.memo}</div>}
                      <div style={{fontSize:11,color:'#5e6585'}}>요청자: {o.authorName}</div>
                    </div>

                    {/* 사장 액션 버튼 */}
                    <div style={{display:'flex',flexDirection:'column',gap:6,alignItems:'flex-end'}}>
                      {isOwner && (
                        <>
                          {o.status==='pending' && (
                            <button onClick={()=>updateStatus(o.id,'checked')}
                              style={{background:'rgba(147,197,253,0.15)',border:'1px solid #93c5fd',color:'#93c5fd',
                                borderRadius:6,padding:'5px 12px',fontSize:11,cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>
                              ✅ 확인
                            </button>
                          )}
                          {o.status==='checked' && (
                            <button onClick={()=>updateStatus(o.id,'done')}
                              style={{background:'rgba(52,211,153,0.15)',border:'1px solid #34d399',color:'#34d399',
                                borderRadius:6,padding:'5px 12px',fontSize:11,cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>
                              📦 완료
                            </button>
                          )}
                          <button onClick={()=>deleteOrder(o.id)}
                            style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',
                              borderRadius:6,padding:'5px 12px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
                            🗑 삭제
                          </button>
                        </>
                      )}
                      {!isOwner && o.authorUid===user.uid && o.status==='pending' && (
                        <button onClick={()=>deleteOrder(o.id)}
                          style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',
                            borderRadius:6,padding:'5px 12px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
                          취소
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 요청 등록 */}
      {activeTab==='add' && (
        <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'20px'}}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:16}}>➕ 발주 요청 등록</div>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>

            {/* 품목 선택 */}
            <div>
              <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>품목 선택</label>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
                {presets.map(p=>(
                  <button key={p.id} onClick={()=>{setSelPreset(p.name);setCustomItem('')}}
                    style={{padding:'6px 12px',borderRadius:6,border:'none',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                      background:selPreset===p.name?'#f9b934':'#191c2b',color:selPreset===p.name?'#000':'#5e6585'}}>
                    {p.name}
                  </button>
                ))}
              </div>
              <input type="text" value={customItem} onChange={e=>{setCustomItem(e.target.value);setSelPreset('')}}
                placeholder="목록에 없으면 직접 입력..."
                style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                  padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
            </div>

            {/* 수량 */}
            <div>
              <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>수량</label>
              <input type="number" value={qty} onChange={e=>setQty(e.target.value)} placeholder="0" min="1"
                style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                  padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
            </div>

            {/* 긴급도 */}
            <div>
              <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>긴급도</label>
              <div style={{display:'flex',gap:8}}>
                {Object.entries(URGENCY).map(([key,v])=>(
                  <button key={key} onClick={()=>setUrgency(key)}
                    style={{flex:1,padding:'8px',borderRadius:7,border:'none',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                      background:urgency===key?v.bg:'#191c2b',
                      color:urgency===key?v.color:'#5e6585',
                      outline:urgency===key?`1px solid ${v.color}`:'none'}}>
                    {key==='urgent'?'🚨':''} {v.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 메모 */}
            <div>
              <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>메모 (선택)</label>
              <input type="text" value={memo} onChange={e=>setMemo(e.target.value)}
                placeholder="추가 설명..."
                style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                  padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
            </div>

            <button onClick={addOrder}
              style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,
                padding:'12px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              요청 등록
            </button>
          </div>
        </div>
      )}

      {/* 품목 관리 (사장만) */}
      {activeTab==='preset' && isOwner && (
        <div>
          <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'20px',marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:600,marginBottom:14}}>⚙️ 품목 추가</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr auto',gap:10,alignItems:'flex-end'}}>
              <div>
                <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>품목명</label>
                <input type="text" value={newPreset} onChange={e=>setNewPreset(e.target.value)}
                  placeholder="예: 춘장, 양파, 식용유"
                  style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                    padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
              </div>
              <div>
                <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>단위</label>
                <input type="text" value={newPresetUnit} onChange={e=>setNewPresetUnit(e.target.value)}
                  placeholder="예: 개, kg, 박스"
                  style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                    padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
              </div>
              <button onClick={addPreset}
                style={{background:'#f9b934',color:'#000',border:'none',borderRadius:7,
                  padding:'9px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>
                추가
              </button>
            </div>
          </div>

          <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden'}}>
            <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>
              등록된 품목 ({presets.length}개)
            </div>
            {presets.length===0 ? (
              <div style={{textAlign:'center',color:'#5e6585',padding:30}}>등록된 품목이 없습니다</div>
            ) : (
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:10,padding:16}}>
                {presets.map(p=>(
                  <div key={p.id} style={{background:'#191c2b',borderRadius:8,padding:'10px 12px',
                    display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div>
                      <div style={{fontSize:12,fontWeight:600,color:'#dde1f2'}}>{p.name}</div>
                      <div style={{fontSize:10,color:'#5e6585'}}>{p.unit}</div>
                    </div>
                    <button onClick={()=>deletePreset(p.id)}
                      style={{background:'transparent',border:'none',color:'#f87171',cursor:'pointer',fontSize:14}}>
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
