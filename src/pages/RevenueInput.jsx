import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useAuth } from '../AuthContext'

const pad = n => String(n).padStart(2,'0')
const DAYS_KR = ['일','월','화','수','목','금','토']

const SESSIONS = {
  open:  { label:'🌅 오전 매출', color:'#f9b934' },
  close: { label:'🌙 마감 매출', color:'#93c5fd' },
}

export default function RevenueInput() {
  const { userData } = useAuth()
  const now = new Date()
  const today = `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  const todayDD = pad(now.getDate())
  const todayLabel = `${now.getMonth()+1}월 ${now.getDate()}일 (${DAYS_KR[now.getDay()]})`

  const [activeSession, setActiveSession] = useState('open')
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // 입력값
  const [kiosk, setKiosk] = useState('')
  const [del, setDel] = useState('')
  const [pos, setPos] = useState('')

  useEffect(()=>{
    async function load() {
      setLoading(true)
      try {
        const snap = await getDoc(doc(db,'revenue',today))
        if(snap.exists()) setData(snap.data())
        else setData({})
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  },[])

  // 세션 전환시 기존값 불러오기
  useEffect(()=>{
    const rec = data[todayDD]?.[activeSession]
    if(rec) {
      setKiosk(rec.kiosk||'')
      setDel(rec.del||'')
      setPos(rec.pos||'')
    } else {
      setKiosk(''); setDel(''); setPos('')
    }
  },[activeSession, data])

  async function save() {
    setSaving(true)
    try {
      const newData = {
        ...data,
        [todayDD]: {
          ...(data[todayDD]||{}),
          [activeSession]: {
            kiosk: +kiosk||0,
            del: +del||0,
            pos: +pos||0,
            savedAt: new Date().toISOString(),
            savedBy: userData?.name || '직원',
          }
        }
      }

      // revenue 컬렉션에 저장 (사장 매출탭과 공유)
      // 사장이 보는 형식과 합치기
      const merged = { ...data }
      const todayRevenue = merged[todayDD] || {}

      // 오전+마감 합산해서 기존 revenue 형식으로 저장
      const openRec = activeSession==='open'
        ? {kiosk:+kiosk||0, del:+del||0, pos:+pos||0}
        : (todayRevenue.open || {kiosk:0,del:0,pos:0})
      const closeRec = activeSession==='close'
        ? {kiosk:+kiosk||0, del:+del||0, pos:+pos||0}
        : (todayRevenue.close || {kiosk:0,del:0,pos:0})

      const totalKiosk = (openRec.kiosk||0) + (closeRec.kiosk||0)
      const totalDel   = (openRec.del||0)   + (closeRec.del||0)
      const totalPos   = (openRec.pos||0)   + (closeRec.pos||0)

      merged[todayDD] = {
        ...todayRevenue,
        [activeSession]: {
          kiosk: +kiosk||0, del: +del||0, pos: +pos||0,
          savedAt: new Date().toISOString(),
          savedBy: userData?.name || '직원',
        },
        // 사장 매출탭과 연동되는 합산값
        kiosk: totalKiosk,
        del: totalDel,
        pos: totalPos,
      }

      await setDoc(doc(db,'revenue',today), merged)
      setData(merged)
      alert(`${SESSIONS[activeSession].label} 저장됐습니다!`)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  const todayRec = data[todayDD] || {}
  const openRec  = todayRec.open  || null
  const closeRec = todayRec.close || null

  const openTotal  = openRec  ? (openRec.kiosk||0)+(openRec.del||0)+(openRec.pos||0)   : 0
  const closeTotal = closeRec ? (closeRec.kiosk||0)+(closeRec.del||0)+(closeRec.pos||0) : 0
  const dayTotal   = openTotal + closeTotal

  const wonFmt = n => n ? n.toLocaleString()+'원' : '—'

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>💰 매출 입력</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>{todayLabel} 당일 매출</div>
        </div>
      </div>

      {/* 당일 현황 요약 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12,marginBottom:18}}>
        {[
          {label:'오전 매출', val:openTotal,  color:'#f9b934', rec:openRec},
          {label:'마감 매출', val:closeTotal, color:'#93c5fd', rec:closeRec},
          {label:'당일 합계', val:dayTotal,   color:'#34d399', rec:true},
        ].map(k=>(
          <div key={k.label} style={{background:'#12141f',border:`1px solid ${k.rec?k.color:'#272a3d'}`,
            borderRadius:12,padding:'14px 16px',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:k.color,opacity:k.rec?.savedAt||k.label==='당일 합계'?1:0.3}}></div>
            <div style={{fontSize:10,fontWeight:600,color:'#5e6585',marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:18,fontWeight:700,color:k.rec?k.color:'#3d4060',fontFamily:'DM Mono,monospace'}}>
              {k.rec ? k.val.toLocaleString()+'원' : '미입력'}
            </div>
            {k.rec?.savedBy && (
              <div style={{fontSize:9,color:'#5e6585',marginTop:3}}>{k.rec.savedBy} 입력</div>
            )}
          </div>
        ))}
      </div>

      {/* 세션 탭 */}
      <div style={{display:'flex',border:'1px solid #272a3d',borderRadius:10,overflow:'hidden',marginBottom:16}}>
        {Object.entries(SESSIONS).map(([key,s])=>(
          <button key={key} onClick={()=>setActiveSession(key)}
            style={{flex:1,padding:'10px',fontSize:12,fontWeight:600,border:'none',cursor:'pointer',fontFamily:'inherit',
              background:activeSession===key?s.color:'transparent',
              color:activeSession===key?'#000':'#5e6585'}}>
            {s.label}
            {data[todayDD]?.[key] && <span style={{marginLeft:6,fontSize:10}}>✅</span>}
          </button>
        ))}
      </div>

      {/* 입력 폼 */}
      {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:40}}>로딩 중...</div> : (
        <div style={{background:'#12141f',border:`1px solid ${SESSIONS[activeSession].color}`,borderRadius:12,padding:'18px'}}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:16,color:SESSIONS[activeSession].color}}>
            {SESSIONS[activeSession].label} 입력
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {[
              ['🖥️ 키오스크', kiosk, setKiosk],
              ['🛵 배달',     del,   setDel],
              ['🧾 포스(현장)', pos, setPos],
            ].map(([label,val,set])=>(
              <div key={label}>
                <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>{label} (원)</label>
                <input type="number" value={val} onChange={e=>set(e.target.value)}
                  placeholder="0" min="0"
                  style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                    padding:'10px 12px',fontSize:14,outline:'none',width:'100%',fontFamily:'DM Mono,monospace'}}/>
              </div>
            ))}

            {/* 소계 */}
            <div style={{background:'#191c2b',borderRadius:8,padding:'12px 14px',
              display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontSize:12,color:'#5e6585'}}>소계</span>
              <span style={{fontSize:16,fontWeight:700,color:SESSIONS[activeSession].color,fontFamily:'DM Mono,monospace'}}>
                {((+kiosk||0)+(+del||0)+(+pos||0)).toLocaleString()}원
              </span>
            </div>

            <button onClick={save} disabled={saving}
              style={{background:SESSIONS[activeSession].color,color:'#000',border:'none',borderRadius:8,
                padding:'12px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              {saving?'저장 중...':`${SESSIONS[activeSession].label} 저장`}
            </button>
          </div>
        </div>
      )}

      {/* 상세 내역 */}
      {(openRec||closeRec) && (
        <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden',marginTop:16}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>
            오늘 입력 내역
          </div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead>
              <tr style={{background:'#191c2b'}}>
                {['구분','키오스크','배달','포스','합계','입력자'].map(h=>(
                  <th key={h} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:'#5e6585',
                    textAlign:h==='구분'||h==='입력자'?'left':'right'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[['오전',openRec,'#f9b934'],['마감',closeRec,'#93c5fd']].map(([label,rec,color])=>(
                rec ? (
                  <tr key={label}>
                    <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',color,fontWeight:600}}>{label}</td>
                    <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace'}}>{(rec.kiosk||0).toLocaleString()}</td>
                    <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace'}}>{(rec.del||0).toLocaleString()}</td>
                    <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace'}}>{(rec.pos||0).toLocaleString()}</td>
                    <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',color,fontFamily:'DM Mono,monospace',fontWeight:700}}>
                      {((rec.kiosk||0)+(rec.del||0)+(rec.pos||0)).toLocaleString()}
                    </td>
                    <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',color:'#5e6585',fontSize:11}}>{rec.savedBy||'—'}</td>
                  </tr>
                ) : null
              ))}
            </tbody>
            <tfoot>
              <tr style={{background:'#1f2236'}}>
                <td style={{padding:'10px 14px',fontWeight:700,color:'#34d399'}}>합 계</td>
                <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#34d399',fontFamily:'DM Mono,monospace'}}>
                  {((openRec?.kiosk||0)+(closeRec?.kiosk||0)).toLocaleString()}
                </td>
                <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#34d399',fontFamily:'DM Mono,monospace'}}>
                  {((openRec?.del||0)+(closeRec?.del||0)).toLocaleString()}
                </td>
                <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#34d399',fontFamily:'DM Mono,monospace'}}>
                  {((openRec?.pos||0)+(closeRec?.pos||0)).toLocaleString()}
                </td>
                <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#34d399',fontFamily:'DM Mono,monospace'}}>
                  {dayTotal.toLocaleString()}
                </td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
