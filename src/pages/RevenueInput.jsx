import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useAuth } from '../AuthContext'

const pad = n => String(n).padStart(2,'0')
const DAYS_KR = ['일','월','화','수','목','금','토']

export default function RevenueInput() {
  const { userData } = useAuth()
  const now = new Date()
  const today = `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  const todayDD = pad(now.getDate())
  const todayLabel = `${now.getMonth()+1}월 ${now.getDate()}일 (${DAYS_KR[now.getDay()]})`

  const [activeSession, setActiveSession] = useState('morning') // 'morning' | 'close'
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [kiosk, setKiosk] = useState('')
  const [del, setDel]     = useState('')
  const [pos, setPos]     = useState('')

  useEffect(()=>{
    async function load() {
      setLoading(true)
      try {
        const snap = await getDoc(doc(db,'revenue',today))
        setData(snap.exists() ? snap.data() : {})
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  },[])

  // 세션 전환 시 기존값 불러오기
  useEffect(()=>{
    const rec = data[todayDD]
    if(!rec) { setKiosk(''); setDel(''); setPos(''); return }
    if(activeSession === 'morning') {
      setKiosk(rec.morningKiosk || '')
      setDel(rec.morningDel   || '')
      setPos(rec.morningPos   || '')
    } else {
      setKiosk(rec.kiosk || '')
      setDel(rec.del     || '')
      setPos(rec.pos     || '')
    }
  },[activeSession, data])

  async function save() {
    setSaving(true)
    try {
      const existing = data[todayDD] || {}
      let newRow

      if (activeSession === 'morning') {
        // 오전: morningKiosk/morningDel/morningPos 로 저장
        newRow = {
          ...existing,
          morningKiosk: +kiosk||0,
          morningDel:   +del||0,
          morningPos:   +pos||0,
          morningBy:    userData?.name || '매장전용',
          morningAt:    new Date().toISOString(),
        }
      } else {
        // 마감: kiosk/del/pos 에 하루 전체 합계로 저장 (Revenue.jsx와 동일 구조)
        newRow = {
          ...existing,
          kiosk:   +kiosk||0,
          del:     +del||0,
          pos:     +pos||0,
          closeBy: userData?.name || '매장전용',
          closeAt: new Date().toISOString(),
        }
      }

      const newData = { ...data, [todayDD]: newRow }
      await setDoc(doc(db,'revenue',today), newData)
      setData(newData)
      alert(`${activeSession === 'morning' ? '🌅 오전' : '🌙 마감'} 매출이 저장됐습니다!`)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  const rec = data[todayDD] || {}

  // 오전 합계
  const hasMorning  = (rec.morningKiosk||0)+(rec.morningDel||0)+(rec.morningPos||0) > 0
  const hasClose    = (rec.kiosk||0)+(rec.del||0)+(rec.pos||0) > 0
  const morningSum  = (rec.morningKiosk||0)+(rec.morningDel||0)+(rec.morningPos||0)
  const closeSum    = (rec.kiosk||0)+(rec.del||0)+(rec.pos||0)

  // 오후 자동계산 (마감 - 오전)
  const hasAfternoon = hasMorning && hasClose
  const afternoonKiosk = (rec.kiosk||0) - (rec.morningKiosk||0)
  const afternoonDel   = (rec.del||0)   - (rec.morningDel||0)
  const afternoonPos   = (rec.pos||0)   - (rec.morningPos||0)
  const afternoonSum   = afternoonKiosk + afternoonDel + afternoonPos
  const isNegative     = afternoonKiosk < 0 || afternoonDel < 0 || afternoonPos < 0

  // 입력 안내
  const sessionInfo = {
    morning: { label:'🌅 오전 매출', color:'#f9b934', hint:'오전 영업 종료 후 입력' },
    close:   { label:'🌙 마감 매출', color:'#93c5fd', hint:'하루 전체 합계를 입력 (오후 자동계산)' },
  }
  const si = sessionInfo[activeSession]

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
          { label:'오전 매출',  val:morningSum, color:'#f9b934', filled:hasMorning,  by:rec.morningBy },
          { label:'마감 매출',  val:closeSum,   color:'#93c5fd', filled:hasClose,    by:rec.closeBy },
          { label:'당일 합계',  val:closeSum,   color:'#34d399', filled:hasClose,    by:null },
        ].map(k=>(
          <div key={k.label} style={{background:'#12141f',
            border:`1px solid ${k.filled ? k.color : '#272a3d'}`,
            borderRadius:12,padding:'14px 16px',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:3,
              background:k.color,opacity:k.filled?1:0.2}}/>
            <div style={{fontSize:10,fontWeight:600,color:'#5e6585',marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:18,fontWeight:700,
              color:k.filled?k.color:'#3d4060',fontFamily:'DM Mono,monospace'}}>
              {k.filled ? k.val.toLocaleString()+'원' : '미입력'}
            </div>
            {k.by && (
              <div style={{fontSize:9,color:'#5e6585',marginTop:3}}>{k.by} 입력</div>
            )}
          </div>
        ))}
      </div>

      {/* 세션 탭 */}
      <div style={{display:'flex',border:'1px solid #272a3d',borderRadius:10,overflow:'hidden',marginBottom:16}}>
        {Object.entries(sessionInfo).map(([key,s])=>(
          <button key={key} onClick={()=>setActiveSession(key)}
            style={{flex:1,padding:'10px',fontSize:12,fontWeight:600,border:'none',
              cursor:'pointer',fontFamily:'inherit',
              background: activeSession===key ? s.color : 'transparent',
              color: activeSession===key ? '#000' : '#5e6585'}}>
            {s.label}
            {((key==='morning'&&hasMorning)||(key==='close'&&hasClose)) && (
              <span style={{marginLeft:6,fontSize:10}}>✅</span>
            )}
          </button>
        ))}
      </div>

      {/* 입력 폼 */}
      {loading ? (
        <div style={{textAlign:'center',color:'#5e6585',padding:40}}>로딩 중...</div>
      ) : (
        <div style={{background:'#12141f',border:`1px solid ${si.color}`,borderRadius:12,padding:'18px'}}>
          <div style={{marginBottom:16}}>
            <div style={{fontSize:13,fontWeight:600,color:si.color}}>{si.label} 입력</div>
            <div style={{fontSize:11,color:'#5e6585',marginTop:3}}>{si.hint}</div>
          </div>

          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {[
              ['🖥️ 키오스크', kiosk, setKiosk],
              ['🛵 배달',     del,   setDel],
              ['🧾 포스(현장)', pos,  setPos],
            ].map(([label,val,set])=>(
              <div key={label}>
                <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>
                  {label} (원)
                </label>
                <input type="number" value={val} onChange={e=>set(e.target.value)}
                  placeholder="0" min="0"
                  style={{background:'#191c2b',border:`1px solid ${si.color}44`,borderRadius:7,
                    color:'#dde1f2',padding:'10px 12px',fontSize:14,outline:'none',
                    width:'100%',fontFamily:'DM Mono,monospace'}}/>
              </div>
            ))}

            {/* 소계 */}
            <div style={{background:'#191c2b',borderRadius:8,padding:'12px 14px',
              display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span style={{fontSize:12,color:'#5e6585'}}>소계</span>
              <span style={{fontSize:16,fontWeight:700,color:si.color,fontFamily:'DM Mono,monospace'}}>
                {((+kiosk||0)+(+del||0)+(+pos||0)).toLocaleString()}원
              </span>
            </div>

            <button onClick={save} disabled={saving}
              style={{background:si.color,color:'#000',border:'none',borderRadius:8,
                padding:'12px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              {saving ? '저장 중...' : `${si.label} 저장`}
            </button>
          </div>
        </div>
      )}

      {/* 오늘 입력 내역 */}
      {(hasMorning || hasClose) && (
        <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,
          overflow:'hidden',marginTop:16}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>
            오늘 입력 내역
          </div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead>
              <tr style={{background:'#191c2b'}}>
                {['구분','키오스크','배달','포스','합계','입력자'].map(h=>(
                  <th key={h} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:'#5e6585',
                    textAlign:['구분','입력자'].includes(h)?'left':'right'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* 오전 */}
              {hasMorning && (
                <tr style={{background:'rgba(249,185,52,0.03)'}}>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',color:'#f9b934',fontWeight:700,fontSize:11}}>오전</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',textAlign:'right',fontFamily:'DM Mono,monospace'}}>{(rec.morningKiosk||0).toLocaleString()}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',textAlign:'right',fontFamily:'DM Mono,monospace'}}>{(rec.morningDel||0).toLocaleString()}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',textAlign:'right',fontFamily:'DM Mono,monospace'}}>{(rec.morningPos||0).toLocaleString()}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',textAlign:'right',color:'#f9b934',fontFamily:'DM Mono,monospace',fontWeight:700}}>{morningSum.toLocaleString()}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',color:'#5e6585',fontSize:11}}>{rec.morningBy||'—'}</td>
                </tr>
              )}

              {/* 오후 자동계산 */}
              {hasAfternoon && (
                <tr style={{background:'rgba(147,197,253,0.03)'}}>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',fontSize:11,fontWeight:700}}>
                    <span style={{color:isNegative?'#f87171':'#93c5fd'}}>오후</span>
                    <span style={{fontSize:9,color:'#3d4060',marginLeft:4}}>자동</span>
                  </td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',textAlign:'right',fontFamily:'DM Mono,monospace',color:isNegative?'#f87171':'#dde1f2'}}>{afternoonKiosk.toLocaleString()}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',textAlign:'right',fontFamily:'DM Mono,monospace',color:isNegative?'#f87171':'#dde1f2'}}>{afternoonDel.toLocaleString()}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',textAlign:'right',fontFamily:'DM Mono,monospace',color:isNegative?'#f87171':'#dde1f2'}}>{afternoonPos.toLocaleString()}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',textAlign:'right',fontFamily:'DM Mono,monospace',fontWeight:700,color:isNegative?'#f87171':'#93c5fd'}}>{isNegative?'⚠ '+afternoonSum.toLocaleString():afternoonSum.toLocaleString()}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',color:'#5e6585',fontSize:11}}>—</td>
                </tr>
              )}

              {/* 합계(마감) */}
              {hasClose && (
                <tr style={{background:'rgba(52,211,153,0.03)'}}>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',color:'#34d399',fontWeight:700,fontSize:11}}>합계</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace'}}>{(rec.kiosk||0).toLocaleString()}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace'}}>{(rec.del||0).toLocaleString()}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace'}}>{(rec.pos||0).toLocaleString()}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',color:'#34d399',fontFamily:'DM Mono,monospace',fontWeight:700}}>{closeSum.toLocaleString()}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',color:'#5e6585',fontSize:11}}>{rec.closeBy||'—'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
