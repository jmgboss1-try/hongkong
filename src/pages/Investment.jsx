import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')
const wonFmt = n => (n||0).toLocaleString('ko-KR') + '원'
const dateFmt = d => d ? d.slice(0,10) : '—'

const INVESTORS = {
  terry: { name: '테리', ratio: 0.7, color: '#f9b934', emoji: '👑' },
  hyung:  { name: '형',   ratio: 0.3, color: '#93c5fd', emoji: '🤝' },
}

// 투자자별 카테고리 분리
const CATEGORIES_BY_INVESTOR = {
  terry: [
    { key: 'investment', label: '💰 투자금 회수' },
    { key: 'loss',       label: '📉 운영 손해분 회수' },
    { key: 'severance',  label: '📦 퇴직금 대납 회수' },
  ],
  hyung: [
    { key: 'investment', label: '💰 투자금 회수' },
  ],
}
// 전체 카테고리 (집계/테이블용)
const ALL_CATEGORIES = [
  { key: 'investment', label: '💰 투자금 회수' },
  { key: 'loss',       label: '📉 운영 손해분 회수' },
  { key: 'severance',  label: '📦 퇴직금 대납 회수' },
]

// 단리 이자 계산 (연 5%, 일 단위)
function calcInterest(principal, fromDate, toDate, rate = 0.05) {
  if (!principal || !fromDate) return 0
  const from = new Date(fromDate)
  const to   = toDate ? new Date(toDate) : new Date()
  const days  = Math.max(0, Math.floor((to - from) / (1000*60*60*24)))
  return Math.round(principal * rate * (days / 365))
}

function calcTotalInterest(config, toDate) {
  const results = {}
  for (const [uid, inv] of Object.entries(config)) {
    if (!inv.amount || !inv.startDate) { results[uid] = 0; continue }
    results[uid] = calcInterest(inv.amount, inv.startDate, toDate)
  }
  return results
}

function ProgressBar({ value, max, color }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div style={{width:'100%'}}>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:10,color:'#5e6585',marginBottom:4}}>
        <span>{wonFmt(value)} 회수</span>
        <span style={{color: pct>=100 ? '#34d399' : color, fontWeight:700}}>{pct}%</span>
      </div>
      <div style={{background:'#272a3d',borderRadius:99,height:7,overflow:'hidden'}}>
        <div style={{width:`${pct}%`,height:'100%',borderRadius:99,
          background: pct>=100 ? '#34d399' : color,
          transition:'width .6s cubic-bezier(.4,0,.2,1)'}}/>
      </div>
      <div style={{fontSize:10,color:'#5e6585',marginTop:3}}>
        목표 {wonFmt(max)}
      </div>
    </div>
  )
}

export default function Investment() {
  const [config, setConfig]   = useState({
    terry: { amount: 0, startDate: '', interestRate: 0.05 },
    hyung:  { amount: 0, startDate: '', interestRate: 0.05 },
  })
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)

  const [showConfig, setShowConfig]   = useState(false)
  const [editConfig, setEditConfig]   = useState({})
  const [showForm, setShowForm]       = useState(false)
  const [form, setForm]               = useState({ date:'', amount:'', investor:'terry', category:'investment', memo:'' })

  async function load() {
    setLoading(true)
    try {
      const [cfgSnap, recSnap] = await Promise.all([
        getDoc(doc(db,'investment','config')),
        getDoc(doc(db,'investment','records')),
      ])
      if (cfgSnap.exists()) setConfig(cfgSnap.data())
      if (recSnap.exists()) setRecords(recSnap.data().list || [])
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(()=>{ load() },[])

  async function saveConfig() {
    setSaving(true)
    try {
      await setDoc(doc(db,'investment','config'), editConfig)
      setConfig(editConfig)
      setShowConfig(false)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  async function saveRecord() {
    if (!form.amount || !form.date) return alert('날짜와 금액을 입력해주세요')
    setSaving(true)
    try {
      const newRecord = {
        id:        Date.now().toString(),
        date:      form.date,
        amount:    +form.amount,
        investor:  form.investor,
        category:  form.category,
        memo:      form.memo,
        createdAt: new Date().toISOString(),
      }
      const newList = [...records, newRecord].sort((a,b)=>a.date>b.date?1:-1)
      await setDoc(doc(db,'investment','records'), { list: newList })
      setRecords(newList)
      setForm({ date:'', amount:'', investor:'terry', category:'investment', memo:'' })
      setShowForm(false)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  async function deleteRecord(id) {
    if (!window.confirm('이 회수 내역을 삭제하시겠습니까?')) return
    const newList = records.filter(r => r.id !== id)
    await setDoc(doc(db,'investment','records'), { list: newList })
    setRecords(newList)
  }

  const today = new Date().toISOString().slice(0,10)
  const interests = calcTotalInterest(config, today)

  const summary = {}
  for (const uid of Object.keys(INVESTORS)) {
    const inv      = config[uid] || {}
    const interest = interests[uid] || 0
    const principal = inv.amount || 0
    const totalTarget = principal + interest

    const recovered = records
      .filter(r => r.investor === uid)
      .reduce((a,r) => a + (r.amount||0), 0)

    const byCategory = {}
    for (const cat of ALL_CATEGORIES) {
      byCategory[cat.key] = records
        .filter(r => r.investor === uid && r.category === cat.key)
        .reduce((a,r) => a + (r.amount||0), 0)
    }

    summary[uid] = { principal, interest, totalTarget, recovered, remaining: Math.max(0, totalTarget - recovered), byCategory }
  }

  const totalPrincipal  = Object.values(summary).reduce((a,s)=>a+s.principal,0)
  const totalInterest   = Object.values(summary).reduce((a,s)=>a+s.interest,0)
  const totalTarget     = Object.values(summary).reduce((a,s)=>a+s.totalTarget,0)
  const totalRecovered  = Object.values(summary).reduce((a,s)=>a+s.recovered,0)
  const totalRemaining  = Object.values(summary).reduce((a,s)=>a+s.remaining,0)
  const overallPct      = totalTarget > 0 ? Math.min(100, Math.round(totalRecovered/totalTarget*100)) : 0

  const cell  = {fontFamily:'DM Mono,monospace', textAlign:'right'}
  const bdBot = {borderBottom:'1px solid #272a3d'}

  return (
    <div>
      {/* 헤더 */}
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>📈 투자관리</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>사장 전용 — 투자금 회수 현황</div>
        </div>
        <div style={{display:'flex',gap:8}}>
          <button onClick={()=>{ setEditConfig(JSON.parse(JSON.stringify(config))); setShowConfig(v=>!v) }}
            style={{background:'#191c2b',border:'1px solid #272a3d',color:'#dde1f2',borderRadius:8,
              padding:'8px 14px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
            ⚙️ 투자금 설정
          </button>
          <button onClick={()=>setShowForm(v=>!v)}
            style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,
              padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
            + 회수 입력
          </button>
        </div>
      </div>

      {/* 투자금 설정 패널 */}
      {showConfig && (
        <div style={{background:'#12141f',border:'1px solid #f9b934',borderRadius:12,marginBottom:18,padding:18}}>
          <div style={{fontSize:13,fontWeight:600,color:'#f9b934',marginBottom:16}}>⚙️ 투자금 설정</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            {Object.entries(INVESTORS).map(([uid,inv])=>(
              <div key={uid} style={{background:'#191c2b',borderRadius:10,padding:14,
                border:`1px solid ${inv.color}33`}}>
                <div style={{fontSize:12,fontWeight:700,color:inv.color,marginBottom:10}}>
                  {inv.emoji} {inv.name} ({(inv.ratio*100).toFixed(0)}%)
                </div>
                {[
                  ['투자 원금 (원)','number','amount'],
                  ['투자 시작일','date','startDate'],
                ].map(([label,type,key])=>(
                  <div key={key} style={{marginBottom:10}}>
                    <label style={{fontSize:10,color:'#5e6585',display:'block',marginBottom:4}}>{label}</label>
                    <input type={type}
                      value={editConfig[uid]?.[key] || ''}
                      onChange={e=>setEditConfig(prev=>({
                        ...prev,
                        [uid]: {...(prev[uid]||{}), [key]: type==='number'?+e.target.value:e.target.value}
                      }))}
                      style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:7,
                        color:'#dde1f2',padding:'8px 10px',fontSize:12,outline:'none',
                        width:'100%',fontFamily:'inherit'}}/>
                  </div>
                ))}
                <div style={{fontSize:10,color:'#5e6585',marginTop:4}}>
                  연 이자율: 5% (단리) — 추후 변경 가능
                </div>
              </div>
            ))}
          </div>
          <div style={{display:'flex',gap:8,marginTop:14}}>
            <button onClick={saveConfig} disabled={saving}
              style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,
                padding:'9px 20px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              {saving?'저장 중...':'저 장'}
            </button>
            <button onClick={()=>setShowConfig(false)}
              style={{background:'transparent',border:'1px solid #272a3d',color:'#5e6585',
                borderRadius:8,padding:'9px 16px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
              취소
            </button>
          </div>
        </div>
      )}

      {/* 회수 입력 폼 */}
      {showForm && (
        <div style={{background:'#12141f',border:'1px solid #34d399',borderRadius:12,marginBottom:18,padding:18}}>
          <div style={{fontSize:13,fontWeight:600,color:'#34d399',marginBottom:16}}>+ 회수 입력</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:12}}>
            <div>
              <label style={{fontSize:10,color:'#5e6585',display:'block',marginBottom:4}}>날짜</label>
              <input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))}
                style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                  padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
            </div>
            <div>
              <label style={{fontSize:10,color:'#5e6585',display:'block',marginBottom:4}}>회수 금액 (원)</label>
              <input type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))}
                placeholder="0" min="0"
                style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                  padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
            </div>
            {/* 투자자 선택 - 변경 시 카테고리 자동 초기화 */}
            <div>
              <label style={{fontSize:10,color:'#5e6585',display:'block',marginBottom:4}}>대상 투자자</label>
              <select value={form.investor}
                onChange={e=>{
                  const newInvestor = e.target.value
                  const cats = CATEGORIES_BY_INVESTOR[newInvestor] || CATEGORIES_BY_INVESTOR.terry
                  setForm(f=>({...f, investor:newInvestor, category:cats[0].key}))
                }}
                style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                  padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}>
                {Object.entries(INVESTORS).map(([uid,inv])=>(
                  <option key={uid} value={uid}>{inv.emoji} {inv.name}</option>
                ))}
              </select>
            </div>
            {/* 카테고리 - 선택된 투자자 기준으로만 표시 */}
            <div>
              <label style={{fontSize:10,color:'#5e6585',display:'block',marginBottom:4}}>카테고리</label>
              <select value={form.category}
                onChange={e=>setForm(f=>({...f,category:e.target.value}))}
                style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                  padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}>
                {(CATEGORIES_BY_INVESTOR[form.investor]||CATEGORIES_BY_INVESTOR.terry).map(c=>(
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </select>
            </div>
            <div style={{gridColumn:'1/-1'}}>
              <label style={{fontSize:10,color:'#5e6585',display:'block',marginBottom:4}}>메모 (선택)</label>
              <input type="text" value={form.memo} onChange={e=>setForm(f=>({...f,memo:e.target.value}))}
                placeholder="비고 사항"
                style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                  padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
            </div>
          </div>
          <div style={{display:'flex',gap:8,marginTop:14}}>
            <button onClick={saveRecord} disabled={saving}
              style={{background:'#34d399',color:'#000',border:'none',borderRadius:8,
                padding:'9px 20px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              {saving?'저장 중...':'저 장'}
            </button>
            <button onClick={()=>setShowForm(false)}
              style={{background:'transparent',border:'1px solid #272a3d',color:'#5e6585',
                borderRadius:8,padding:'9px 16px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
              취소
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{textAlign:'center',color:'#5e6585',padding:60}}>로딩 중...</div>
      ) : (
        <>
          {/* 전체 요약 */}
          <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,
            padding:'18px 20px',marginBottom:18,position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:3,
              background:`linear-gradient(90deg,#f9b934 ${overallPct*0.7}%,#93c5fd ${overallPct}%)`,opacity:.8}}/>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',flexWrap:'wrap',gap:12,marginBottom:16}}>
              <div>
                <div style={{fontSize:11,color:'#5e6585',marginBottom:4}}>📊 전체 회수 현황</div>
                <div style={{fontSize:22,fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>
                  {wonFmt(totalRecovered)}
                  <span style={{fontSize:13,color:'#5e6585',fontWeight:400,marginLeft:8}}>/ {wonFmt(totalTarget)}</span>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,minWidth:300}}>
                {[
                  {label:'총 원금',   val:totalPrincipal, color:'#dde1f2'},
                  {label:'누적 이자', val:totalInterest,  color:'#f87171'},
                  {label:'잔여 회수', val:totalRemaining,  color:'#93c5fd'},
                ].map(k=>(
                  <div key={k.label} style={{background:'#191c2b',borderRadius:8,padding:'10px 12px'}}>
                    <div style={{fontSize:10,color:'#5e6585',marginBottom:3}}>{k.label}</div>
                    <div style={{fontSize:13,fontWeight:700,color:k.color,fontFamily:'DM Mono,monospace'}}>
                      {wonFmt(k.val)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <ProgressBar value={totalRecovered} max={totalTarget} color="#f9b934"/>
          </div>

          {/* 투자자별 카드 */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14,marginBottom:18}}>
            {Object.entries(INVESTORS).map(([uid,inv])=>{
              const s   = summary[uid]
              const inv_cfg = config[uid] || {}
              const pct = s.totalTarget > 0
                ? Math.min(100, Math.round(s.recovered/s.totalTarget*100)) : 0
              const isDone = pct >= 100

              return (
                <div key={uid} style={{background:'#12141f',
                  border:`1px solid ${isDone?'rgba(52,211,153,0.4)':inv.color+'44'}`,
                  borderRadius:12,overflow:'hidden'}}>
                  <div style={{padding:'14px 16px',borderBottom:'1px solid #272a3d',
                    display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{fontSize:20}}>{inv.emoji}</div>
                      <div>
                        <div style={{fontSize:14,fontWeight:700,color:inv.color}}>{inv.name}</div>
                        <div style={{fontSize:10,color:'#5e6585'}}>투자 비율 {(inv.ratio*100).toFixed(0)}%</div>
                      </div>
                    </div>
                    {isDone && (
                      <span style={{fontSize:11,fontWeight:700,padding:'4px 10px',borderRadius:5,
                        background:'rgba(52,211,153,0.15)',color:'#34d399'}}>✅ 완료</span>
                    )}
                  </div>

                  <div style={{padding:'14px 16px'}}>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:14}}>
                      {[
                        {label:'투자 원금',    val:s.principal,   color:'#dde1f2'},
                        {label:'누적 이자(5%)', val:s.interest,    color:'#f87171'},
                        {label:'총 회수 목표',  val:s.totalTarget, color:inv.color},
                        {label:'회수 완료',     val:s.recovered,   color:'#34d399'},
                      ].map(k=>(
                        <div key={k.label} style={{background:'#191c2b',borderRadius:7,padding:'8px 10px'}}>
                          <div style={{fontSize:9,color:'#5e6585',marginBottom:2}}>{k.label}</div>
                          <div style={{fontSize:12,fontWeight:700,color:k.color,fontFamily:'DM Mono,monospace'}}>
                            {wonFmt(k.val)}
                          </div>
                        </div>
                      ))}
                    </div>

                    <ProgressBar value={s.recovered} max={s.totalTarget} color={inv.color}/>

                    {/* 카테고리별 회수 — 투자자별로 해당 카테고리만 표시 */}
                    <div style={{marginTop:14,display:'flex',flexDirection:'column',gap:6}}>
                      <div style={{fontSize:10,color:'#5e6585',fontWeight:600,marginBottom:2}}>카테고리별 회수 현황</div>
                      {(CATEGORIES_BY_INVESTOR[uid]||CATEGORIES_BY_INVESTOR.terry).map(cat=>{
                        const val = s.byCategory[cat.key] || 0
                        return (
                          <div key={cat.key} style={{display:'flex',justifyContent:'space-between',
                            alignItems:'center',fontSize:11,padding:'6px 10px',borderRadius:6,
                            background:'#191c2b'}}>
                            <span style={{color:'#5e6585'}}>{cat.label}</span>
                            <span style={{color:val>0?inv.color:'#3d4060',fontFamily:'DM Mono,monospace',fontWeight:val>0?700:400}}>
                              {val>0 ? wonFmt(val) : '—'}
                            </span>
                          </div>
                        )
                      })}
                    </div>

                    {inv_cfg.startDate && (
                      <div style={{marginTop:10,fontSize:10,color:'#5e6585',textAlign:'right'}}>
                        이자 산정 시작: {inv_cfg.startDate} (연 5% 단리)
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 회수 내역 목록 */}
          <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden'}}>
            <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,
              display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span>📋 회수 내역</span>
              <span style={{fontSize:11,color:'#5e6585'}}>총 {records.length}건 · {wonFmt(totalRecovered)}</span>
            </div>
            {records.length === 0 ? (
              <div style={{textAlign:'center',color:'#5e6585',padding:40}}>회수 내역이 없습니다</div>
            ) : (
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead>
                    <tr style={{background:'#191c2b'}}>
                      {['날짜','대상','카테고리','금액','메모','삭제'].map(h=>(
                        <th key={h} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:'#5e6585',
                          textAlign:h==='금액'?'right':'left',whiteSpace:'nowrap'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...records].reverse().map(r=>{
                      const inv = INVESTORS[r.investor]
                      const cat = ALL_CATEGORIES.find(c=>c.key===r.category)
                      return (
                        <tr key={r.id}>
                          <td style={{padding:'9px 14px',...bdBot,fontFamily:'DM Mono,monospace',color:'#5e6585'}}>{dateFmt(r.date)}</td>
                          <td style={{padding:'9px 14px',...bdBot}}>
                            <span style={{color:inv?.color,fontWeight:600}}>{inv?.emoji} {inv?.name}</span>
                          </td>
                          <td style={{padding:'9px 14px',...bdBot,color:'#dde1f2'}}>{cat?.label||r.category}</td>
                          <td style={{padding:'9px 14px',...bdBot,...cell,color:'#f9b934',fontWeight:700}}>
                            {wonFmt(r.amount)}
                          </td>
                          <td style={{padding:'9px 14px',...bdBot,color:'#5e6585'}}>{r.memo||'—'}</td>
                          <td style={{padding:'9px 14px',...bdBot}}>
                            <button onClick={()=>deleteRecord(r.id)}
                              style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',
                                padding:'3px 8px',fontSize:10,borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>
                              삭제
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
