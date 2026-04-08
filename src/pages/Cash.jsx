import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useAuth } from '../AuthContext'

const pad = n => String(n).padStart(2,'0')

const BILLS = [
  { id:'w50000', label:'오만원권', value:50000 },
  { id:'w10000', label:'만원권',   value:10000 },
  { id:'w5000',  label:'오천원권', value:5000  },
  { id:'w1000',  label:'천원권',   value:1000  },
  { id:'w500',   label:'오백원',   value:500   },
  { id:'w100',   label:'백원',     value:100   },
]

function CashForm({ type, baseAmount, onSave, existing }) {
  const [counts, setCounts] = useState(() => {
    if(existing) return existing.counts || {}
    return {}
  })
  const [cashSales, setCashSales] = useState(existing?.cashSales||'')
  const [memo, setMemo] = useState(existing?.memo||'')
  const [saving, setSaving] = useState(false)

  const total = BILLS.reduce((a,b) => a + (counts[b.id]||0)*b.value, 0)
  const expected = baseAmount + (type==='close' ? (+cashSales||0) : 0)
  const diff = total - expected

  async function save() {
    setSaving(true)
    await onSave({ counts, total, cashSales:+cashSales||0, memo, diff, savedAt: new Date().toISOString() })
    setSaving(false)
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      {/* 권종 입력 */}
      <div style={{display:'flex',flexDirection:'column',gap:8}}>
        {BILLS.map(b=>(
          <div key={b.id} style={{display:'flex',alignItems:'center',gap:12,background:'#191c2b',borderRadius:8,padding:'10px 14px'}}>
            <div style={{flex:1}}>
              <div style={{fontSize:12,fontWeight:600}}>{b.label}</div>
              <div style={{fontSize:10,color:'#5e6585'}}>{b.value.toLocaleString()}원</div>
            </div>
            <div style={{display:'flex',alignItems:'center',gap:8}}>
              <button onClick={()=>setCounts(c=>({...c,[b.id]:Math.max(0,(c[b.id]||0)-1)}))}
                style={{width:28,height:28,borderRadius:6,background:'#272a3d',border:'none',color:'#dde1f2',fontSize:16,cursor:'pointer',fontFamily:'inherit'}}>−</button>
              <input type="number" value={counts[b.id]||''} min="0"
                onChange={e=>setCounts(c=>({...c,[b.id]:+e.target.value||0}))}
                style={{width:50,background:'#0b0d16',border:'1px solid #272a3d',borderRadius:6,color:'#dde1f2',padding:'4px 0',fontSize:13,textAlign:'center',outline:'none',fontFamily:'DM Mono, monospace'}}/>
              <button onClick={()=>setCounts(c=>({...c,[b.id]:(c[b.id]||0)+1}))}
                style={{width:28,height:28,borderRadius:6,background:'#272a3d',border:'none',color:'#dde1f2',fontSize:16,cursor:'pointer',fontFamily:'inherit'}}>＋</button>
              <div style={{width:70,textAlign:'right',fontFamily:'DM Mono, monospace',fontSize:11,color:'#f9b934'}}>
                {((counts[b.id]||0)*b.value).toLocaleString()}원
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* 현금 매출 (마감시에만) */}
      {type==='close' && (
        <div style={{background:'#191c2b',borderRadius:8,padding:'12px 14px'}}>
          <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>💰 현금 매출 (원)</label>
          <input type="number" value={cashSales} onChange={e=>setCashSales(e.target.value)} placeholder="0" min="0"
            style={{background:'#0b0d16',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',padding:'8px 10px',fontSize:12,outline:'none',width:'100%'}}/>
        </div>
      )}

      {/* 메모 */}
      <div style={{background:'#191c2b',borderRadius:8,padding:'12px 14px'}}>
        <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>메모</label>
        <input type="text" value={memo} onChange={e=>setMemo(e.target.value)} placeholder="특이사항 입력..."
          style={{background:'#0b0d16',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
      </div>

      {/* 합계 & 차액 */}
      <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:10,padding:'14px 16px',display:'flex',flexDirection:'column',gap:8}}>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}>
          <span style={{color:'#5e6585'}}>실제 시재 합계</span>
          <span style={{fontFamily:'DM Mono, monospace',fontWeight:700,color:'#dde1f2'}}>{total.toLocaleString()}원</span>
        </div>
        <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}>
          <span style={{color:'#5e6585'}}>기준 시재{type==='close'?'+현금매출':''}</span>
          <span style={{fontFamily:'DM Mono, monospace',color:'#5e6585'}}>{expected.toLocaleString()}원</span>
        </div>
        <div style={{borderTop:'1px solid #272a3d',paddingTop:8,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontSize:13,fontWeight:700}}>차액 (오차)</span>
          <span style={{fontFamily:'DM Mono, monospace',fontSize:16,fontWeight:700,color:diff===0?'#34d399':diff>0?'#f9b934':'#f87171'}}>
            {diff===0?'✅ 일치':diff>0?`+${diff.toLocaleString()}원`:`${diff.toLocaleString()}원`}
          </span>
        </div>
      </div>

      <button onClick={save} disabled={saving}
        style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'12px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
        {saving?'저장 중...':`${type==='open'?'오픈':'마감'} 시재 저장`}
      </button>
    </div>
  )
}

export default function Cash() {
  const { isOwner } = useAuth()
  const now = new Date()
  const today = `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  const todayDD = pad(now.getDate())

  const [baseAmount, setBaseAmount] = useState(0)
  const [tempBase, setTempBase] = useState('')
  const [activeType, setActiveType] = useState('open')
  const [records, setRecords] = useState({})
  const [loading, setLoading] = useState(true)
  const [viewDate, setViewDate] = useState(todayDD)
  const [showHistory, setShowHistory] = useState(false)

  useEffect(()=>{
    async function load() {
      setLoading(true)
      try {
        // 기준 시재 불러오기
        const baseSnap = await getDoc(doc(db,'cashSettings','base'))
        if(baseSnap.exists()) setBaseAmount(baseSnap.data().amount||0)

        // 오늘 시재 기록
        const snap = await getDoc(doc(db,'cash',today))
        if(snap.exists()) setRecords(snap.data())
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  },[])

  async function saveBaseAmount() {
    const amt = +tempBase
    if(!amt) return alert('금액을 입력해주세요')
    await setDoc(doc(db,'cashSettings','base'), {amount:amt})
    setBaseAmount(amt)
    setTempBase('')
    alert(`기준 시재가 ${amt.toLocaleString()}원으로 설정됐습니다.`)
  }

  async function saveRecord(type, data) {
    const newRecords = {
      ...records,
      [todayDD]: {
        ...(records[todayDD]||{}),
        [type]: {...data, recordedAt: new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})}
      }
    }
    await setDoc(doc(db,'cash',today), newRecords)
    setRecords(newRecords)
    alert(`${type==='open'?'오픈':'마감'} 시재가 저장됐습니다!`)
  }

  const todayRecord = records[todayDD] || {}
  const isOwnerView = isOwner

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>💵 현금시재</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>
            {now.getFullYear()}년 {now.getMonth()+1}월 {now.getDate()}일
          </div>
        </div>
      </div>

      {/* 기준 시재 설정 (사장만) */}
      {isOwner && (
        <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'16px 18px',marginBottom:18}}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:10}}>⚙️ 기준 시재 설정</div>
          <div style={{display:'flex',gap:10,alignItems:'center'}}>
            <div style={{flex:1}}>
              <input type="number" value={tempBase} onChange={e=>setTempBase(e.target.value)}
                placeholder={`현재: ${baseAmount.toLocaleString()}원`}
                style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',padding:'9px 12px',fontSize:12,outline:'none',width:'100%'}}/>
            </div>
            <button onClick={saveBaseAmount}
              style={{background:'#f9b934',color:'#000',border:'none',borderRadius:7,padding:'9px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>
              설정
            </button>
          </div>
          <div style={{fontSize:10,color:'#5e6585',marginTop:6}}>현재 기준 시재: {baseAmount.toLocaleString()}원</div>
        </div>
      )}

      {/* 오늘 현황 요약 */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:18}}>
        {['open','close'].map(type=>{
          const rec = todayRecord[type]
          return(
            <div key={type} style={{background:'#12141f',border:`1px solid ${rec?'#34d399':'#272a3d'}`,borderRadius:12,padding:'14px 16px'}}>
              <div style={{fontSize:11,fontWeight:600,color:'#5e6585',marginBottom:6}}>{type==='open'?'🌅 오픈 시재':'🌙 마감 시재'}</div>
              {rec ? (
                <>
                  <div style={{fontSize:16,fontWeight:700,color:'#34d399',fontFamily:'DM Mono, monospace'}}>{rec.total?.toLocaleString()}원</div>
                  <div style={{fontSize:10,color:'#5e6585',marginTop:4}}>{rec.recordedAt} 기록</div>
                  <div style={{fontSize:11,marginTop:4,color:rec.diff===0?'#34d399':rec.diff>0?'#f9b934':'#f87171'}}>
                    차액: {rec.diff===0?'일치':rec.diff>0?`+${rec.diff?.toLocaleString()}원`:`${rec.diff?.toLocaleString()}원`}
                  </div>
                </>
              ) : (
                <div style={{fontSize:12,color:'#5e6585'}}>미입력</div>
              )}
            </div>
          )
        })}
      </div>

      {/* 오픈/마감 탭 */}
      <div style={{display:'flex',border:'1px solid #272a3d',borderRadius:10,overflow:'hidden',marginBottom:16}}>
        {[['open','🌅 오픈 시재'],['close','🌙 마감 시재']].map(([type,label])=>(
          <button key={type} onClick={()=>setActiveType(type)}
            style={{flex:1,padding:'10px',fontSize:12,fontWeight:600,border:'none',cursor:'pointer',fontFamily:'inherit',transition:'.15s',
              background:activeType===type?'#f9b934':'transparent',
              color:activeType===type?'#000':'#5e6585'}}>
            {label}
          </button>
        ))}
      </div>

      {/* 입력 폼 */}
      {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:40}}>로딩 중...</div> : (
        <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'18px'}}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:14}}>
            {activeType==='open'?'🌅 오픈 시재 입력':'🌙 마감 시재 입력'}
            {todayRecord[activeType] && <span style={{fontSize:10,color:'#34d399',marginLeft:8}}>✅ 저장됨</span>}
          </div>
          <CashForm
            key={activeType}
            type={activeType}
            baseAmount={baseAmount}
            existing={todayRecord[activeType]}
            onSave={(data)=>saveRecord(activeType,data)}
          />
        </div>
      )}

      {/* 사장만: 이전 기록 조회 */}
      {isOwner && (
        <div style={{marginTop:18}}>
          <button onClick={()=>setShowHistory(v=>!v)}
            style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,color:'#5e6585',padding:'8px 16px',fontSize:12,cursor:'pointer',fontFamily:'inherit',width:'100%'}}>
            {showHistory?'▲ 이전 기록 닫기':'▼ 이전 기록 보기'}
          </button>
          {showHistory && (
            <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,marginTop:10,overflow:'hidden'}}>
              <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>이번달 시재 기록</div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead>
                    <tr style={{background:'#191c2b'}}>
                      {['날짜','오픈 시재','오픈 차액','마감 시재','마감 차액','현금매출'].map(h=>(
                        <th key={h} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:'#5e6585',textAlign:'right',whiteSpace:'nowrap'}}>
                          {h==='날짜'?<span style={{float:'left'}}>{h}</span>:h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.keys(records).sort().map(dd=>{
                      const r=records[dd]
                      return(
                        <tr key={dd}>
                          <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',color:'#dde1f2'}}>{+dd}일</td>
                          <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace'}}>{r.open?.total?.toLocaleString()||'—'}</td>
                          <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace',
                            color:r.open?.diff===0?'#34d399':r.open?.diff>0?'#f9b934':'#f87171'}}>
                            {r.open?.diff===undefined?'—':r.open.diff===0?'일치':r.open.diff>0?`+${r.open.diff.toLocaleString()}`:r.open.diff.toLocaleString()}
                          </td>
                          <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace'}}>{r.close?.total?.toLocaleString()||'—'}</td>
                          <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace',
                            color:r.close?.diff===0?'#34d399':r.close?.diff>0?'#f9b934':'#f87171'}}>
                            {r.close?.diff===undefined?'—':r.close.diff===0?'일치':r.close.diff>0?`+${r.close.diff.toLocaleString()}`:r.close.diff.toLocaleString()}
                          </td>
                          <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace',color:'#f9b934'}}>
                            {r.close?.cashSales?r.close.cashSales.toLocaleString()+'원':'—'}
                          </td>
                        </tr>
                      )
                    })}
                    {Object.keys(records).length===0&&(
                      <tr><td colSpan={6} style={{padding:24,textAlign:'center',color:'#5e6585'}}>기록 없음</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
