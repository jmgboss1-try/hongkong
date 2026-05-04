import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { collection, addDoc, getDocs, doc, setDoc, deleteDoc, orderBy, query, where } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')
const today = () => {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`
}

export default function Inventory() {
  const [items, setItems] = useState([])
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('list')

  // 품목 관리
  const [newItemName, setNewItemName] = useState('')
  const [newItemUnit, setNewItemUnit] = useState('')
  const [newItemStock, setNewItemStock] = useState('')

  // 입고/사용 기록
  const [logType, setLogType] = useState('use') // 'in' | 'use'
  const [logItem, setLogItem] = useState('')
  const [logQty, setLogQty] = useState('')
  const [logDate, setLogDate] = useState(today())
  const [logMemo, setLogMemo] = useState('')

  // 기간 조회
  const [startDate, setStartDate] = useState(()=>{
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}-01`
  })
  const [endDate, setEndDate] = useState(today())

  async function load() {
    setLoading(true)
    try {
      const itemSnap = await getDocs(collection(db,'inventoryItems'))
      const itemList = []
      itemSnap.forEach(d => itemList.push({id:d.id, ...d.data()}))
      setItems(itemList.sort((a,b)=>a.name>b.name?1:-1))

      const logSnap = await getDocs(query(collection(db,'inventoryLogs'), orderBy('date','desc')))
      const logList = []
      logSnap.forEach(d => logList.push({id:d.id, ...d.data()}))
      setLogs(logList)
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(()=>{ load() },[])

  async function addItem() {
    if(!newItemName.trim()) return alert('품목명을 입력해주세요')
    await addDoc(collection(db,'inventoryItems'), {
      name: newItemName.trim(),
      unit: newItemUnit.trim() || '개',
      stock: +newItemStock || 0,
      createdAt: new Date().toISOString()
    })
    setNewItemName(''); setNewItemUnit(''); setNewItemStock('')
    await load()
  }

  async function deleteItem(id) {
    if(!window.confirm('품목을 삭제하시겠습니까?\n관련 기록은 유지됩니다.')) return
    await deleteDoc(doc(db,'inventoryItems',id))
    await load()
  }

  async function updateStock(id, stock) {
    await setDoc(doc(db,'inventoryItems',id), {stock:+stock}, {merge:true})
    await load()
  }

  async function addLog() {
    if(!logItem) return alert('품목을 선택해주세요')
    if(!logQty) return alert('수량을 입력해주세요')
    const item = items.find(i=>i.id===logItem)
    if(!item) return

    // 재고 업데이트
    const newStock = logType==='in'
      ? item.stock + (+logQty)
      : item.stock - (+logQty)

    await setDoc(doc(db,'inventoryItems',logItem), {stock: Math.max(0,newStock)}, {merge:true})

    // 기록 저장
    await addDoc(collection(db,'inventoryLogs'), {
      itemId: logItem,
      itemName: item.name,
      unit: item.unit,
      type: logType,
      qty: +logQty,
      date: logDate,
      memo: logMemo.trim(),
      createdAt: new Date().toISOString()
    })

    setLogQty(''); setLogMemo(''); setLogDate(today())
    await load()
    setActiveTab('list')
  }

  async function deleteLog(id, log) {
    if(!window.confirm('기록을 삭제하시겠습니까?\n재고가 복원됩니다.')) return
    const item = items.find(i=>i.id===log.itemId)
    if(item) {
      const restored = log.type==='in'
        ? item.stock - log.qty
        : item.stock + log.qty
      await setDoc(doc(db,'inventoryItems',log.itemId), {stock:Math.max(0,restored)}, {merge:true})
    }
    await deleteDoc(doc(db,'inventoryLogs',id))
    await load()
  }

  // 기간별 통계
  const filteredLogs = logs.filter(l => l.date >= startDate && l.date <= endDate)
  const statsByItem = items.map(item => {
    const itemLogs = filteredLogs.filter(l=>l.itemId===item.id)
    const totalIn = itemLogs.filter(l=>l.type==='in').reduce((a,l)=>a+l.qty,0)
    const totalUse = itemLogs.filter(l=>l.type==='use').reduce((a,l)=>a+l.qty,0)
    return { ...item, totalIn, totalUse, logCount: itemLogs.length }
  }).filter(s=>s.logCount>0)

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>📦 재고관리</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>사장 전용 — 식재료/소스 관리</div>
        </div>
      </div>

      {/* 탭 */}
      <div style={{display:'flex',gap:8,marginBottom:18,flexWrap:'wrap'}}>
        {[
          {key:'list',   label:'📋 품목 목록'},
          {key:'log',    label:'✏️ 입고/사용 기록'},
          {key:'history',label:'📜 기록 내역'},
          {key:'stats',  label:'📊 기간별 통계'},
        ].map(t=>(
          <button key={t.key} onClick={()=>setActiveTab(t.key)}
            style={{padding:'9px 18px',borderRadius:8,border:'none',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
              background:activeTab===t.key?'#f9b934':'#191c2b',
              color:activeTab===t.key?'#000':'#5e6585'}}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:60}}>로딩 중...</div> : (
        <>
          {/* 품목 목록 */}
          {activeTab==='list' && (
            <div>
              {/* 품목 추가 */}
              <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'18px',marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:600,marginBottom:14}}>➕ 품목 추가</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 100px 120px auto',gap:10,alignItems:'flex-end'}}>
                  <div>
                    <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>품목명</label>
                    <input type="text" value={newItemName} onChange={e=>setNewItemName(e.target.value)}
                      placeholder="예: 춘장, 식용유"
                      onKeyDown={e=>e.key==='Enter'&&addItem()}
                      style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                        padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
                  </div>
                  <div>
                    <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>단위</label>
                    <input type="text" value={newItemUnit} onChange={e=>setNewItemUnit(e.target.value)}
                      placeholder="kg, L, 개"
                      style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                        padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
                  </div>
                  <div>
                    <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>초기 재고</label>
                    <input type="number" value={newItemStock} onChange={e=>setNewItemStock(e.target.value)}
                      placeholder="0" min="0" step="0.1"
                      style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                        padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
                  </div>
                  <button onClick={addItem}
                    style={{background:'#f9b934',color:'#000',border:'none',borderRadius:7,
                      padding:'9px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>
                    추가
                  </button>
                </div>
              </div>

              {/* 품목 목록 */}
              <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden'}}>
                <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>
                  등록된 품목 ({items.length}개)
                </div>
                {items.length===0 ? (
                  <div style={{textAlign:'center',color:'#5e6585',padding:40}}>등록된 품목이 없습니다</div>
                ) : (
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                    <thead>
                      <tr style={{background:'#191c2b'}}>
                        {['품목명','단위','현재 재고','직접 수정',''].map(h=>(
                          <th key={h} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:'#5e6585',
                            textAlign:h==='품목명'?'left':'center',whiteSpace:'nowrap'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(item=>(
                        <tr key={item.id}>
                          <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',color:'#dde1f2',fontWeight:600}}>{item.name}</td>
                          <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'center',color:'#5e6585'}}>{item.unit}</td>
                          <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'center'}}>
                            <span style={{
                              color: item.stock<=0?'#f87171':item.stock<=5?'#f9b934':'#34d399',
                              fontFamily:'DM Mono,monospace',fontWeight:700,fontSize:14
                            }}>
                              {item.stock}{item.unit}
                            </span>
                          </td>
                          <td style={{padding:'8px 14px',borderBottom:'1px solid #272a3d',textAlign:'center'}}>
                            <input type="number" defaultValue={item.stock} min="0" step="0.1"
                              onBlur={e=>updateStock(item.id,e.target.value)}
                              onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                              style={{width:70,background:'#191c2b',border:'1px solid #272a3d',borderRadius:5,
                                color:'#dde1f2',padding:'4px 6px',fontSize:11,textAlign:'center',
                                outline:'none',fontFamily:'DM Mono,monospace'}}/>
                          </td>
                          <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'center'}}>
                            <button onClick={()=>deleteItem(item.id)}
                              style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',
                                borderRadius:5,padding:'3px 8px',fontSize:10,cursor:'pointer',fontFamily:'inherit'}}>
                              삭제
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* 입고/사용 기록 */}
          {activeTab==='log' && (
            <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'20px'}}>
              <div style={{fontSize:13,fontWeight:600,marginBottom:16}}>✏️ 입고 / 사용 기록</div>

              {/* 유형 선택 */}
              <div style={{display:'flex',gap:8,marginBottom:16}}>
                {[
                  {key:'use', label:'➖ 사용', color:'#f87171', bg:'rgba(248,113,113,0.12)'},
                  {key:'in',  label:'➕ 입고', color:'#34d399', bg:'rgba(52,211,153,0.12)'},
                ].map(t=>(
                  <button key={t.key} onClick={()=>setLogType(t.key)}
                    style={{flex:1,padding:'10px',borderRadius:8,border:'none',fontSize:13,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                      background:logType===t.key?t.bg:'#191c2b',
                      color:logType===t.key?t.color:'#5e6585',
                      outline:logType===t.key?`1px solid ${t.color}`:'none'}}>
                    {t.label}
                  </button>
                ))}
              </div>

              <div style={{display:'flex',flexDirection:'column',gap:12}}>
                {/* 날짜 */}
                <div>
                  <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>날짜</label>
                  <input type="date" value={logDate} onChange={e=>setLogDate(e.target.value)}
                    style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                      padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
                </div>

                {/* 품목 선택 */}
                <div>
                  <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>품목</label>
                  <div style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:8}}>
                    {items.map(item=>(
                      <button key={item.id} onClick={()=>setLogItem(item.id)}
                        style={{padding:'6px 14px',borderRadius:6,border:'none',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                          background:logItem===item.id?'#f9b934':'#191c2b',
                          color:logItem===item.id?'#000':'#5e6585'}}>
                        {item.name}
                        <span style={{fontSize:10,marginLeft:4,opacity:.7}}>({item.stock}{item.unit})</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* 수량 */}
                <div>
                  <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>
                    {logType==='in'?'입고':'사용'} 수량
                    {logItem && ` (현재: ${items.find(i=>i.id===logItem)?.stock}${items.find(i=>i.id===logItem)?.unit})`}
                  </label>
                  <input type="number" value={logQty} onChange={e=>setLogQty(e.target.value)}
                    placeholder="0" min="0" step="0.1"
                    style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                      padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
                </div>

                {/* 메모 */}
                <div>
                  <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>메모 (선택)</label>
                  <input type="text" value={logMemo} onChange={e=>setLogMemo(e.target.value)}
                    placeholder="특이사항..."
                    style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                      padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
                </div>

                <button onClick={addLog}
                  style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,
                    padding:'12px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                  {logType==='in'?'➕ 입고 기록':'➖ 사용 기록'} 저장
                </button>
              </div>
            </div>
          )}

          {/* 기록 내역 */}
          {activeTab==='history' && (
            <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden'}}>
              <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>
                📜 전체 기록 내역
              </div>
              {logs.length===0 ? (
                <div style={{textAlign:'center',color:'#5e6585',padding:40}}>기록이 없습니다</div>
              ) : (
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                    <thead>
                      <tr style={{background:'#191c2b'}}>
                        {['날짜','품목','유형','수량','메모',''].map(h=>(
                          <th key={h} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:'#5e6585',
                            textAlign:h==='날짜'||h==='품목'||h==='메모'?'left':'center',whiteSpace:'nowrap'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {logs.map(log=>(
                        <tr key={log.id}>
                          <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',color:'#dde1f2',fontFamily:'DM Mono,monospace'}}>{log.date}</td>
                          <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',color:'#dde1f2',fontWeight:600}}>{log.itemName}</td>
                          <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'center'}}>
                            <span style={{
                              background:log.type==='in'?'rgba(52,211,153,0.15)':'rgba(248,113,113,0.15)',
                              color:log.type==='in'?'#34d399':'#f87171',
                              padding:'2px 8px',borderRadius:4,fontSize:11,fontWeight:600
                            }}>
                              {log.type==='in'?'입고':'사용'}
                            </span>
                          </td>
                          <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'center',
                            color:log.type==='in'?'#34d399':'#f87171',fontFamily:'DM Mono,monospace',fontWeight:700}}>
                            {log.type==='in'?'+':'-'}{log.qty}{log.unit}
                          </td>
                          <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',color:'#5e6585'}}>{log.memo||'—'}</td>
                          <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'center'}}>
                            <button onClick={()=>deleteLog(log.id,log)}
                              style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',
                                borderRadius:5,padding:'3px 8px',fontSize:10,cursor:'pointer',fontFamily:'inherit'}}>
                              삭제
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* 기간별 통계 */}
          {activeTab==='stats' && (
            <div>
              {/* 기간 설정 */}
              <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'18px',marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:600,marginBottom:12}}>📊 기간 설정</div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                  <div>
                    <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>시작일</label>
                    <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}
                      style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                        padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
                  </div>
                  <div>
                    <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>종료일</label>
                    <input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}
                      style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                        padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
                  </div>
                </div>
              </div>

              {statsByItem.length===0 ? (
                <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:40,textAlign:'center',color:'#5e6585'}}>
                  해당 기간에 기록이 없습니다
                </div>
              ) : (
                <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden'}}>
                  <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>
                    {startDate} ~ {endDate} 품목별 현황
                  </div>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                    <thead>
                      <tr style={{background:'#191c2b'}}>
                        {['품목','단위','입고량','사용량','현재 재고'].map(h=>(
                          <th key={h} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:'#5e6585',
                            textAlign:h==='품목'?'left':'center',whiteSpace:'nowrap'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {statsByItem.map(item=>(
                        <tr key={item.id}>
                          <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',color:'#dde1f2',fontWeight:600}}>{item.name}</td>
                          <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'center',color:'#5e6585'}}>{item.unit}</td>
                          <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'center',color:'#34d399',fontFamily:'DM Mono,monospace',fontWeight:700}}>
                            +{item.totalIn}{item.unit}
                          </td>
                          <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'center',color:'#f87171',fontFamily:'DM Mono,monospace',fontWeight:700}}>
                            -{item.totalUse}{item.unit}
                          </td>
                          <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'center'}}>
                            <span style={{
                              color:item.stock<=0?'#f87171':item.stock<=5?'#f9b934':'#34d399',
                              fontFamily:'DM Mono,monospace',fontWeight:700,fontSize:14
                            }}>
                              {item.stock}{item.unit}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
