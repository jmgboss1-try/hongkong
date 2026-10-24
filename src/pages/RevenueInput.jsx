import { useEffect, useState } from 'react'
import { db, auth } from '../firebase'
import { compressImage, PhoneReceiveModal } from '../components/PhotoAttach'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useAuth } from '../AuthContext'

const pad = n => String(n).padStart(2,'0')
const DAYS_KR = ['일','월','화','수','목','금','토']

const DELIVERY_PLATFORMS = [
  { key:'baemin',  label:'배달의민족', color:'#34d399', emoji:'🟢' },
  { key:'coupang', label:'쿠팡이츠',   color:'#f87171', emoji:'🔴' },
  { key:'yogiyo',  label:'요기요',     color:'#f9b934', emoji:'🟡' },
  { key:'ddangyeo',label:'땡겨요',     color:'#93c5fd', emoji:'🔵' },
]

// 세션별 필드 접두어 매핑
const PREFIX = { morning:'morning', middle:'middle', close:'' }
const fieldKey = (session, base) => {
  const p = PREFIX[session]
  if(!p) return base // close는 접두어 없음
  return p + base.charAt(0).toUpperCase() + base.slice(1)
}

export default function RevenueInput() {
  const { userData } = useAuth()
  const now = new Date()
  const today = `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  const todayDD = pad(now.getDate())
  const todayLabel = `${now.getMonth()+1}월 ${now.getDate()}일 (${DAYS_KR[now.getDay()]})`

  const [activeSession, setActiveSession] = useState('morning') // 'morning' | 'middle' | 'close'
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const [kiosk, setKiosk] = useState('')
  const [pos, setPos]     = useState('')
  const [baemin,   setBaemin]   = useState('')
  const [coupang,  setCoupang]  = useState('')
  const [yogiyo,   setYogiyo]   = useState('')
  const [ddangyeo, setDdangyeo] = useState('')

  const delTotal = (+baemin||0)+(+coupang||0)+(+yogiyo||0)+(+ddangyeo||0)

  // 포스기에서 하루 종일 켜두므로 1분마다 날짜를 다시 확인 — 날짜가 바뀌면 그날 문서를 새로 불러옴
  const [, setTick] = useState(0)
  const [scan, setScan] = useState(null) // 사진 인식: { busy } | { result, photo } | { error }
  const [phoneOpen, setPhoneOpen] = useState(false) // 폰에서 출력물 사진 받기 (QR)
  useEffect(()=>{
    const id = setInterval(()=>setTick(t=>t+1), 60000)
    return ()=>clearInterval(id)
  },[])

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
  },[today, todayDD])

  function resetInputs() {
    setKiosk(''); setPos('')
    setBaemin(''); setCoupang(''); setYogiyo(''); setDdangyeo('')
  }

  useEffect(()=>{
    setScan(null)
    const rec = data[todayDD]
    if(!rec) { resetInputs(); return }
    if(activeSession === 'middle') {
      // 미들타임은 "누적값" 기준으로 입력/표시 (저장은 순수값으로 되어있으므로 오전값을 더해 복원)
      setKiosk(rec.middleKiosk!=null ? (rec.middleKiosk + (rec.morningKiosk||0)) : '')
      setPos(rec.middlePos!=null ? (rec.middlePos + (rec.morningPos||0)) : '')
      setBaemin(rec.middleBaemin!=null ? (rec.middleBaemin + (rec.morningBaemin||0)) : '')
      setCoupang(rec.middleCoupang!=null ? (rec.middleCoupang + (rec.morningCoupang||0)) : '')
      setYogiyo(rec.middleYogiyo!=null ? (rec.middleYogiyo + (rec.morningYogiyo||0)) : '')
      setDdangyeo(rec.middleDdangyeo!=null ? (rec.middleDdangyeo + (rec.morningDdangyeo||0)) : '')
    } else {
      setKiosk(rec[fieldKey(activeSession,'kiosk')] || '')
      setPos(rec[fieldKey(activeSession,'pos')] || '')
      setBaemin(rec[fieldKey(activeSession,'baemin')] || '')
      setCoupang(rec[fieldKey(activeSession,'coupang')] || '')
      setYogiyo(rec[fieldKey(activeSession,'yogiyo')] || '')
      setDdangyeo(rec[fieldKey(activeSession,'ddangyeo')] || '')
    }
  },[activeSession, data])

  // 마감 출력물 사진(JPEG data URL) → 서버(/api/read-receipt)에서 Claude로 읽어 칸을 채움. 저장은 확인 후 직접
  async function readPhoto(photo) {
    if (!photo) return
    setScan({ busy:true })
    try {
      const token = await auth.currentUser?.getIdToken()
      const r = await fetch('/api/read-receipt', {
        method:'POST',
        headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${token||''}` },
        body: JSON.stringify({ image: photo }),
      })
      const result = await r.json().catch(()=>({}))
      if (!r.ok) throw new Error(result.error || `사진 인식 실패 (${r.status})`)
      const v = n => n == null ? '' : String(n)
      setKiosk(v(result.kiosk)); setPos(v(result.pos))
      setBaemin(v(result.baemin)); setCoupang(v(result.coupang)); setYogiyo(v(result.yogiyo)); setDdangyeo(v(result.ddangyeo))
      setScan({ result, photo })
    } catch(e) {
      console.error(e)
      setScan({ error: e.message || '사진을 읽지 못했어요' })
    }
  }

  async function save() {
    setSaving(true)
    try {
      // 저장 직전 최신 데이터를 다시 읽음 — 켜둔 사이 사장님이 다른 기기에서 고친 내용을 덮어쓰지 않도록
      const snap = await getDoc(doc(db,'revenue',today))
      const latest = snap.exists() ? snap.data() : {}
      const existing = latest[todayDD] || {}

      let kioskVal, posVal, baeminVal, coupangVal, yogiyoVal, ddangyeoVal

      if (activeSession === 'middle') {
        // 미들타임: 입력값(누적)에서 오전값을 빼서 순수 미들타임 매출로 저장
        kioskVal    = Math.max(0, (+kiosk||0)    - (existing.morningKiosk||0))
        posVal      = Math.max(0, (+pos||0)      - (existing.morningPos||0))
        baeminVal   = Math.max(0, (+baemin||0)   - (existing.morningBaemin||0))
        coupangVal  = Math.max(0, (+coupang||0)  - (existing.morningCoupang||0))
        yogiyoVal   = Math.max(0, (+yogiyo||0)   - (existing.morningYogiyo||0))
        ddangyeoVal = Math.max(0, (+ddangyeo||0) - (existing.morningDdangyeo||0))
      } else {
        kioskVal=+kiosk||0; posVal=+pos||0
        baeminVal=+baemin||0; coupangVal=+coupang||0; yogiyoVal=+yogiyo||0; ddangyeoVal=+ddangyeo||0
      }
      const delSum = baeminVal+coupangVal+yogiyoVal+ddangyeoVal

      const newRow = {
        ...existing,
        [fieldKey(activeSession,'kiosk')]:    kioskVal,
        [fieldKey(activeSession,'del')]:      delSum,
        [fieldKey(activeSession,'baemin')]:   baeminVal,
        [fieldKey(activeSession,'coupang')]:  coupangVal,
        [fieldKey(activeSession,'yogiyo')]:   yogiyoVal,
        [fieldKey(activeSession,'ddangyeo')]: ddangyeoVal,
        [fieldKey(activeSession,'pos')]:      posVal,
        [activeSession==='morning'?'morningBy':activeSession==='middle'?'middleBy':'closeBy']: userData?.name || '매장전용',
        [activeSession==='morning'?'morningAt':activeSession==='middle'?'middleAt':'closeAt']: new Date().toISOString(),
      }
      // 오늘 날짜 칸만 저장 (다른 날짜는 건드리지 않음)
      await setDoc(doc(db,'revenue',today), { [todayDD]: newRow }, { merge:true })
      setData({ ...latest, [todayDD]: newRow })
      const label = activeSession==='morning'?'🌅 오전':activeSession==='middle'?'☕ 미들타임':'🌙 마감'
      alert(`${label} 매출이 저장됐습니다!`)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  const rec = data[todayDD] || {}

  const sum = (session) =>
    (rec[fieldKey(session,'kiosk')]||0) + (rec[fieldKey(session,'del')]||0) + (rec[fieldKey(session,'pos')]||0)

  const hasMorning = sum('morning') > 0
  const hasMiddle  = sum('middle') > 0
  const hasClose   = sum('close') > 0
  const morningSum = sum('morning')
  const middleSum  = sum('middle')
  const closeSum   = sum('close')

  // 오후 = 마감 - 오전 - 미들
  const hasAfternoon   = hasClose && (hasMorning || hasMiddle)
  const afternoonKiosk = (rec.kiosk||0) - (rec.morningKiosk||0) - (rec.middleKiosk||0)
  const afternoonDel   = (rec.del||0)   - (rec.morningDel||0)   - (rec.middleDel||0)
  const afternoonPos   = (rec.pos||0)   - (rec.morningPos||0)   - (rec.middlePos||0)
  const afternoonSum   = afternoonKiosk + afternoonDel + afternoonPos
  const isNegative     = afternoonKiosk < 0 || afternoonDel < 0 || afternoonPos < 0

  const sessionInfo = {
    morning: { label:'🌅 오전 매출',     color:'#f9b934', hint:'오전 영업 종료 후 입력' },
    middle:  { label:'☕ 미들타임 매출', color:'#a78bfa', hint:'14:30~16:30 매출 별도 입력' },
    close:   { label:'🌙 마감 매출',     color:'#93c5fd', hint:'하루 전체 합계를 입력 (오후 자동계산)' },
  }
  const si = sessionInfo[activeSession]

  function DeliveryDetail({ session }) {
    const hasDetail = DELIVERY_PLATFORMS.some(p=>(rec[fieldKey(session,p.key)]||0)>0)
    if(!hasDetail) return null
    return (
      <div style={{marginTop:4,display:'flex',flexDirection:'column',gap:2}}>
        {DELIVERY_PLATFORMS.map(p=>{
          const val = rec[fieldKey(session,p.key)]||0
          if(!val) return null
          return (
            <div key={p.key} style={{display:'flex',justifyContent:'space-between',fontSize:9,color:'#5e6585'}}>
              <span>{p.emoji} {p.label}</span>
              <span style={{fontFamily:'DM Mono,monospace'}}>{val.toLocaleString()}</span>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>💰 매출 입력</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>{todayLabel} 당일 매출</div>
        </div>
      </div>

      {/* 당일 현황 요약 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        {[
          { label:'오전 매출',  val:morningSum, color:'#f9b934', filled:hasMorning, by:rec.morningBy },
          { label:'미들 매출',  val:middleSum,  color:'#a78bfa', filled:hasMiddle,  by:rec.middleBy },
          { label:'마감 매출',  val:closeSum,   color:'#93c5fd', filled:hasClose,   by:rec.closeBy },
          { label:'당일 합계',  val:closeSum,   color:'#34d399', filled:hasClose,   by:null },
        ].map(k=>(
          <div key={k.label} style={{background:'#12141f',
            border:`1px solid ${k.filled?k.color:'#272a3d'}`,
            borderRadius:12,padding:'14px 16px',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:3,
              background:k.color,opacity:k.filled?1:0.2}}/>
            <div style={{fontSize:10,fontWeight:600,color:'#5e6585',marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:16,fontWeight:700,
              color:k.filled?k.color:'#3d4060',fontFamily:'DM Mono,monospace'}}>
              {k.filled ? k.val.toLocaleString()+'원' : '미입력'}
            </div>
            {k.by && <div style={{fontSize:9,color:'#5e6585',marginTop:3}}>{k.by} 입력</div>}
          </div>
        ))}
      </div>

      {/* 세션 탭 */}
      <div style={{display:'flex',border:'1px solid #272a3d',borderRadius:10,overflow:'hidden',marginBottom:16}}>
        {Object.entries(sessionInfo).map(([key,s])=>(
          <button key={key} onClick={()=>setActiveSession(key)}
            style={{flex:1,padding:'10px',fontSize:12,fontWeight:600,border:'none',
              cursor:'pointer',fontFamily:'inherit',
              background:activeSession===key?s.color:'transparent',
              color:activeSession===key?'#000':'#5e6585'}}>
            {s.label}
            {((key==='morning'&&hasMorning)||(key==='middle'&&hasMiddle)||(key==='close'&&hasClose)) && (
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
            {activeSession==='middle' && (
              <div style={{marginTop:8,background:'rgba(167,139,250,0.08)',border:'1px solid rgba(167,139,250,0.2)',
                borderRadius:7,padding:'8px 10px',fontSize:10,color:'#a78bfa',lineHeight:1.6}}>
                💡 지금 화면(POS/키오스크)에 찍힌 <b>누적 금액 그대로</b> 입력하세요.<br/>
                오전 매출({(rec.morningKiosk||0)+(rec.morningDel||0)+(rec.morningPos||0)>0
                  ? ((rec.morningKiosk||0)+(rec.morningDel||0)+(rec.morningPos||0)).toLocaleString()+'원'
                  : '미입력'})을 자동으로 빼서 미들타임 순수 매출만 저장돼요.
              </div>
            )}
          </div>

          {/* 마감 출력물 사진으로 채우기 (마감만) */}
          {activeSession==='close' && <div style={{marginBottom:16}}>
            <button type="button" disabled={!!scan?.busy} onClick={()=>setPhoneOpen(true)}
              style={{width:'100%',background: scan?.busy ? '#191c2b' : `${si.color}18`, border:`1px dashed ${si.color}88`,borderRadius:8,
                padding:'11px',fontSize:12,fontWeight:700,color:si.color,cursor: scan?.busy ? 'default' : 'pointer',fontFamily:'inherit'}}>
              {scan?.busy ? '⏳ 사진 읽는 중... (10~30초)' : '📲 폰으로 마감 출력물 찍어서 채우기 (QR)'}
            </button>
            {!scan?.busy && (
              <label style={{display:'block',textAlign:'center',fontSize:10,color:'#5e6585',marginTop:6,cursor:'pointer'}}>
                또는 이 기기로 찍기·사진 고르기
                <input type="file" accept="image/*" capture="environment" style={{display:'none'}}
                  onChange={async e=>{ const f = e.target.files?.[0]; e.target.value=''; if (f) readPhoto(await compressImage(f, 1600, 450)) }}/>
              </label>
            )}
            {phoneOpen && (
              <PhoneReceiveModal hiRes title="📲 마감 출력물 사진 받기"
                hint={<>폰 카메라로 QR을 찍고 마감 출력물을 찍어 보내세요.<br/>받으면 바로 숫자를 읽어 칸을 채워요.</>}
                onAdd={fresh=>{ setPhoneOpen(false); readPhoto(fresh[fresh.length-1]); return '' }}
                onClose={()=>setPhoneOpen(false)}/>
            )}
            {scan?.error && <div style={{fontSize:11,color:'#f87171',marginTop:6}}>⚠️ {scan.error}</div>}
            {scan?.result && (()=>{
              const r = scan.result
              const sum = (+kiosk||0) + delTotal + (+pos||0)
              const warns = []
              if (r.total != null && r.total !== sum) warns.push(`적힌 합계 ${r.total.toLocaleString()}원과 칸 합계 ${sum.toLocaleString()}원이 달라요`)
              if (r.delivery != null && r.delivery !== delTotal) warns.push(`적힌 배달 합계 ${r.delivery.toLocaleString()}원과 배달 칸 합계 ${delTotal.toLocaleString()}원이 달라요`)
              if (r.date && r.date !== `${today}-${todayDD}`) warns.push(`출력물 날짜가 ${r.date}예요 (오늘이 아니에요)`)
              if (r.notes) warns.push(r.notes)
              return (
                <div style={{display:'flex',gap:10,marginTop:8,background:'#191c2b',borderRadius:8,padding:10,alignItems:'flex-start'}}>
                  <img src={scan.photo} alt="출력물" style={{width:56,height:72,objectFit:'cover',borderRadius:4,flexShrink:0}}/>
                  <div style={{fontSize:11,lineHeight:1.6,color:'#dde1f2',minWidth:0}}>
                    <div style={{color:'#34d399',fontWeight:700}}>✅ 사진에서 읽은 숫자로 아래 칸을 채웠어요. 확인하고 저장하세요.</div>
                    {warns.map((w,i)=><div key={i} style={{color:'#f9b934'}}>⚠️ {w}</div>)}
                  </div>
                </div>
              )
            })()}
          </div>}

          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {/* 키오스크 */}
            <div>
              <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>
                🖥️ 키오스크 (원)
              </label>
              <input type="number" value={kiosk} onChange={e=>setKiosk(e.target.value)}
                placeholder="0" min="0"
                style={{background:'#191c2b',border:`1px solid ${si.color}44`,borderRadius:7,
                  color:'#dde1f2',padding:'10px 12px',fontSize:14,outline:'none',
                  width:'100%',fontFamily:'DM Mono,monospace'}}/>
            </div>

            {/* 배달 - 4개 플랫폼 */}
            <div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <label style={{fontSize:10,color:'#5e6585',fontWeight:600}}>🛵 배달 (원)</label>
                {delTotal > 0 && (
                  <span style={{fontSize:11,color:si.color,fontFamily:'DM Mono,monospace',fontWeight:700}}>
                    합계 {delTotal.toLocaleString()}원
                  </span>
                )}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                {[
                  [baemin,   setBaemin,   '배달의민족', '#34d399'],
                  [coupang,  setCoupang,  '쿠팡이츠',   '#f87171'],
                  [yogiyo,   setYogiyo,   '요기요',     '#f9b934'],
                  [ddangyeo, setDdangyeo, '땡겨요',     '#93c5fd'],
                ].map(([val, set, label, color])=>(
                  <div key={label}>
                    <label style={{fontSize:9,color:color,fontWeight:600,display:'block',marginBottom:4}}>
                      {label}
                    </label>
                    <input type="number" value={val} onChange={e=>set(e.target.value)}
                      placeholder="0" min="0"
                      style={{background:'#191c2b',border:`1px solid ${color}33`,borderRadius:7,
                        color:'#dde1f2',padding:'8px 10px',fontSize:13,outline:'none',
                        width:'100%',fontFamily:'DM Mono,monospace'}}/>
                  </div>
                ))}
              </div>
            </div>

            {/* 포스 */}
            <div>
              <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>
                🧾 포스(현장) (원)
              </label>
              <input type="number" value={pos} onChange={e=>setPos(e.target.value)}
                placeholder="0" min="0"
                style={{background:'#191c2b',border:`1px solid ${si.color}44`,borderRadius:7,
                  color:'#dde1f2',padding:'10px 12px',fontSize:14,outline:'none',
                  width:'100%',fontFamily:'DM Mono,monospace'}}/>
            </div>

            {/* 소계 */}
            <div style={{background:'#191c2b',borderRadius:8,padding:'12px 14px',
              display:'flex',flexDirection:'column',gap:6}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:12,color:'#5e6585'}}>{activeSession==='middle'?'입력한 누적 금액':'소계'}</span>
                <span style={{fontSize:16,fontWeight:700,color:si.color,fontFamily:'DM Mono,monospace'}}>
                  {((+kiosk||0)+delTotal+(+pos||0)).toLocaleString()}원
                </span>
              </div>
              {activeSession==='middle' && (
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',
                  paddingTop:6,borderTop:'1px solid #272a3d'}}>
                  <span style={{fontSize:11,color:'#a78bfa',fontWeight:600}}>→ 미들타임 순수 매출 (저장될 값)</span>
                  <span style={{fontSize:15,fontWeight:700,color:'#a78bfa',fontFamily:'DM Mono,monospace'}}>
                    {Math.max(0,((+kiosk||0)+delTotal+(+pos||0)) - ((rec.morningKiosk||0)+(rec.morningDel||0)+(rec.morningPos||0))).toLocaleString()}원
                  </span>
                </div>
              )}
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
      {(hasMorning || hasMiddle || hasClose) && (
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
              {hasMorning && (
                <tr style={{background:'rgba(249,185,52,0.03)'}}>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',color:'#f9b934',fontWeight:700,fontSize:11}}>오전</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',textAlign:'right',fontFamily:'DM Mono,monospace'}}>{(rec.morningKiosk||0).toLocaleString()}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',textAlign:'right',fontFamily:'DM Mono,monospace'}}>
                    {(rec.morningDel||0).toLocaleString()}
                    <DeliveryDetail session="morning"/>
                  </td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',textAlign:'right',fontFamily:'DM Mono,monospace'}}>{(rec.morningPos||0).toLocaleString()}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',textAlign:'right',color:'#f9b934',fontFamily:'DM Mono,monospace',fontWeight:700}}>{morningSum.toLocaleString()}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',color:'#5e6585',fontSize:11}}>{rec.morningBy||'—'}</td>
                </tr>
              )}

              {hasMiddle && (
                <tr style={{background:'rgba(167,139,250,0.03)'}}>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',color:'#a78bfa',fontWeight:700,fontSize:11}}>미들</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',textAlign:'right',fontFamily:'DM Mono,monospace'}}>{(rec.middleKiosk||0).toLocaleString()}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',textAlign:'right',fontFamily:'DM Mono,monospace'}}>
                    {(rec.middleDel||0).toLocaleString()}
                    <DeliveryDetail session="middle"/>
                  </td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',textAlign:'right',fontFamily:'DM Mono,monospace'}}>{(rec.middlePos||0).toLocaleString()}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',textAlign:'right',color:'#a78bfa',fontFamily:'DM Mono,monospace',fontWeight:700}}>{middleSum.toLocaleString()}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #1a1d2e',color:'#5e6585',fontSize:11}}>{rec.middleBy||'—'}</td>
                </tr>
              )}

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

              {hasClose && (
                <tr style={{background:'rgba(52,211,153,0.03)'}}>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',color:'#34d399',fontWeight:700,fontSize:11}}>합계</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace'}}>{(rec.kiosk||0).toLocaleString()}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace'}}>
                    {(rec.del||0).toLocaleString()}
                    <DeliveryDetail session="close"/>
                  </td>
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
