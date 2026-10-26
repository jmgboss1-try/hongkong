import { useEffect, useState } from 'react'
import { db, auth } from '../firebase'
import { compressImage, PhoneReceiveModal } from '../components/PhotoAttach'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useAuth } from '../AuthContext'

const pad = n => String(n).padStart(2,'0')
const DAYS_KR = ['일','월','화','수','목','금','토']

const DELIVERY_PLATFORMS = [
  { key:'baemin',  label:'배달의민족', color:'#2E7D45', emoji:'' },
  { key:'coupang', label:'쿠팡이츠',   color:'#B42318', emoji:'' },
  { key:'yogiyo',  label:'요기요',     color:'#C3261C', emoji:'' },
  { key:'ddangyeo',label:'땡겨요',     color:'#2B5C9E', emoji:'' },
]

// 화면 색 — 주문전표·장부 디자인 (종이 흰색 바탕, 먹색 글씨, 강조는 짬뽕 빨강 하나, 영수증 같은 점선 줄)
const T = { bg:'#FAF9F6', ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', strong:'#1D1B18',
  accent:'#C3261C', onAccent:'#FFFFFF', accentSoft:'#F7E6E3', warn:'#8A5300', ok:'#2E6A3A', field:'#FFFFFF', fieldLine:'#CBC5BA', leader:true }
const won = n => (n || 0).toLocaleString('ko-KR')


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
  // 마감 때만: 배달앱별 주문 건수 (매출분석에서 객단가·할인 효과 계산에 씀)
  const [orders, setOrders] = useState({ baemin:'', coupang:'', yogiyo:'', ddangyeo:'' })

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
    setOrders({ baemin:'', coupang:'', yogiyo:'', ddangyeo:'' })
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
    const o = k => rec[`${k}Orders`] != null ? String(rec[`${k}Orders`]) : ''
    setOrders({ baemin:o('baemin'), coupang:o('coupang'), yogiyo:o('yogiyo'), ddangyeo:o('ddangyeo') })
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
      setOrders({ baemin:v(result.baeminOrders), coupang:v(result.coupangOrders), yogiyo:v(result.yogiyoOrders), ddangyeo:v(result.ddangyeoOrders) })
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
        // 마감: 앱별 주문 건수 (비워두면 기록 안 함)
        ...(activeSession==='close' ? Object.fromEntries(Object.entries(orders)
          .filter(([,v])=>v!=='' && v!=null).map(([k,v])=>[`${k}Orders`, Math.max(0, Math.round(+v)||0)])) : {}),
        [activeSession==='morning'?'morningBy':activeSession==='middle'?'middleBy':'closeBy']: userData?.name || '매장전용',
        [activeSession==='morning'?'morningAt':activeSession==='middle'?'middleAt':'closeAt']: new Date().toISOString(),
      }
      // 오늘 날짜 칸만 저장 (다른 날짜는 건드리지 않음)
      await setDoc(doc(db,'revenue',today), { [todayDD]: newRow }, { merge:true })
      setData({ ...latest, [todayDD]: newRow })
      const label = activeSession==='morning'?'오전':activeSession==='middle'?'미들타임':'마감'
      alert(`${label} 매출을 저장했어요`)
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
    morning: { label:'오전',     hint:'오전 영업이 끝나면 입력' },
    middle:  { label:'미들타임', hint:'14:30~16:30, 포스에 찍힌 누적 금액 그대로 입력' },
    close:   { label:'마감',     hint:'하루 전체 합계를 입력해요. 오후 매출은 자동으로 계산돼요' },
  }
  const si = sessionInfo[activeSession]
  const num = { fontVariantNumeric:'tabular-nums', fontFeatureSettings:'"tnum"' }
  const subtotal = (+kiosk||0) + delTotal + (+pos||0)
  const morningTotal = (rec.morningKiosk||0)+(rec.morningDel||0)+(rec.morningPos||0)

  const field = (extra) => ({ background:T.field, border:`1px solid ${T.fieldLine}`, borderRadius:4, color:T.ink,
    padding:'9px 10px', fontSize:16, outline:'none', fontFamily:'inherit', textAlign:'right', boxSizing:'border-box', ...num, ...extra })
  // 금액 칸: 쉼표 찍어 보여주고 숫자만 받음 (값은 숫자 문자열 그대로)
  const money = (val, set, label, extra) => (
    <input type="text" inputMode="numeric" value={val === '' || val == null ? '' : won(+val)} placeholder="0" aria-label={label}
      onChange={e=>set(e.target.value.replace(/[^0-9]/g,''))} style={field(extra)}/>
  )
  const leader = () => T.leader
    ? <span aria-hidden="true" style={{flex:1, borderBottom:`1px dotted ${T.faint}`, margin:'0 6px', alignSelf:'flex-end', marginBottom:12, minWidth:4}}/>
    : <span style={{flex:1, minWidth:4}}/>
  // 컴포넌트가 아니라 함수로 그림 (렌더마다 새 컴포넌트가 되면 입력칸이 다시 만들어져 포커스가 빠짐)
  const row = (label, control) => (
    <div style={{display:'flex', alignItems:'center', padding:'6px 0', minHeight:46}}>
      <span style={{fontSize:14, color:T.ink, whiteSpace:'nowrap'}}>{label}</span>
      {leader()}
      {control}
    </div>
  )

  function DeliveryDetail({ session }) {
    const parts = DELIVERY_PLATFORMS.filter(p => (rec[fieldKey(session,p.key)]||0) > 0)
    if (!parts.length) return null
    return (
      <div style={{marginTop:2, display:'flex', flexDirection:'column', gap:1}}>
        {parts.map(p => (
          <div key={p.key} style={{display:'flex', justifyContent:'space-between', gap:8, fontSize:11, color:T.sub}}>
            <span>{p.label}</span><span style={num}>{won(rec[fieldKey(session,p.key)])}</span>
          </div>
        ))}
      </div>
    )
  }

  const summary = [
    { key:'morning', label:'오전',  val:morningSum, filled:hasMorning, by:rec.morningBy },
    { key:'middle',  label:'미들',  val:middleSum,  filled:hasMiddle,  by:rec.middleBy },
    { key:'close',   label:'마감 (하루 합계)', val:closeSum, filled:hasClose, by:rec.closeBy },
  ]
  const cell = { padding:'10px 12px', borderBottom:`1px solid ${T.rule}`, textAlign:'right', ...num }

  return (
    <div className="page-surface" style={{background:T.bg, color:T.ink}}>
      <div style={{maxWidth:640}}>
        <header style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:12, paddingBottom:10,
          borderBottom: T.leader ? `3px double ${T.strong}` : `1px solid ${T.rule}`}}>
          <h1 style={{fontSize:22, fontWeight:800, margin:0, letterSpacing:'-0.01em'}}>매출 입력</h1>
          <span style={{fontSize:14, color:T.sub}}>{todayLabel}</span>
        </header>

        {/* 오늘 현황 */}
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr 1.3fr', borderBottom:`1px solid ${T.rule}`, marginBottom:22}}>
          {summary.map((k,i) => (
            <div key={k.key} style={{padding:'12px 0 12px', paddingLeft: i ? 14 : 0, borderLeft: i ? `1px solid ${T.rule}` : 'none'}}>
              <div style={{fontSize:12, color:T.sub}}>{k.label}</div>
              <div style={{fontSize: k.key==='close' ? 20 : 17, fontWeight:700, marginTop:3, color: k.filled ? T.ink : T.faint, ...num}}>
                {k.filled ? won(k.val) : '미입력'}
              </div>
              {k.by && <div style={{fontSize:11, color:T.sub, marginTop:2}}>{k.by}</div>}
            </div>
          ))}
        </div>

        {/* 오전 · 미들 · 마감 */}
        <div role="tablist" style={{display:'flex', gap:22, borderBottom:`1px solid ${T.rule}`, marginBottom:18}}>
          {Object.entries(sessionInfo).map(([key,s]) => {
            const on = activeSession===key
            const done = (key==='morning'&&hasMorning)||(key==='middle'&&hasMiddle)||(key==='close'&&hasClose)
            return (
              <button key={key} role="tab" aria-selected={on} onClick={()=>setActiveSession(key)}
                style={{background:'none', border:'none', padding:'10px 0', marginBottom:-1, cursor:'pointer', fontFamily:'inherit',
                  fontSize:16, fontWeight: on ? 800 : 500, color: on ? T.ink : T.sub,
                  borderBottom:`3px solid ${on ? T.accent : 'transparent'}`}}>
                {s.label}
                {done && <span style={{fontSize:11, fontWeight:600, color:T.ok, marginLeft:6}}>입력됨</span>}
              </button>
            )
          })}
        </div>

        {loading ? (
          <div style={{color:T.sub, padding:'40px 0'}}>불러오는 중...</div>
        ) : (
          <section>
            <p style={{fontSize:13, color:T.sub, margin:'0 0 14px', lineHeight:1.6}}>
              {si.hint}
              {activeSession==='middle' && <> · 오전 매출({hasMorning ? `${won(morningTotal)}원` : '미입력'})을 빼서 미들타임 매출만 저장해요</>}
            </p>

            {activeSession==='close' && (
              <div style={{marginBottom:16}}>
                <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
                  <button type="button" disabled={!!scan?.busy} onClick={()=>setPhoneOpen(true)}
                    style={{background:'transparent', border:`1.5px solid ${T.accent}`, color:T.accent, borderRadius:4,
                      padding:'10px 14px', fontSize:14, fontWeight:700, cursor: scan?.busy ? 'default' : 'pointer', fontFamily:'inherit'}}>
                    {scan?.busy ? '사진 읽는 중... (10~30초)' : '폰으로 마감 출력물 찍어서 채우기'}
                  </button>
                  {!scan?.busy && (
                    <label style={{fontSize:13, color:T.sub, cursor:'pointer', textDecoration:'underline', textUnderlineOffset:3}}>
                      이 기기에서 사진 고르기
                      <input type="file" accept="image/*" capture="environment" style={{display:'none'}}
                        onChange={async e=>{ const f = e.target.files?.[0]; e.target.value=''; if (f) readPhoto(await compressImage(f, 1600, 450)) }}/>
                    </label>
                  )}
                </div>
                {phoneOpen && (
                  <PhoneReceiveModal hiRes title="마감 출력물 사진 받기"
                    hint={<>폰 카메라로 QR을 찍고 마감 출력물을 찍어 보내세요.<br/>받으면 바로 숫자를 읽어 칸을 채워요.</>}
                    onAdd={fresh=>{ setPhoneOpen(false); readPhoto(fresh[fresh.length-1]); return '' }}
                    onClose={()=>setPhoneOpen(false)}/>
                )}
                {scan?.error && <div style={{fontSize:13, color:T.accent, marginTop:8}}>{scan.error}</div>}
                {scan?.result && (()=>{
                  const r = scan.result
                  const warns = []
                  if (r.total != null && r.total !== subtotal) warns.push(`출력물 합계 ${won(r.total)}원과 아래 합계 ${won(subtotal)}원이 달라요`)
                  if (r.delivery != null && r.delivery !== delTotal) warns.push(`출력물 배달 합계 ${won(r.delivery)}원과 배달 칸 합계 ${won(delTotal)}원이 달라요`)
                  if (r.date && r.date !== `${today}-${todayDD}`) warns.push(`출력물 날짜가 ${r.date}예요. 오늘 출력물이 맞는지 확인하세요`)
                  if (r.notes) warns.push(r.notes)
                  return (
                    <div style={{display:'flex', gap:12, marginTop:12, padding:'10px 0', borderTop:`1px solid ${T.rule}`, borderBottom:`1px solid ${T.rule}`}}>
                      <img src={scan.photo} alt="받은 출력물" style={{width:52, height:68, objectFit:'cover', borderRadius:2, flexShrink:0}}/>
                      <div style={{fontSize:13, lineHeight:1.6, minWidth:0}}>
                        <div style={{fontWeight:700}}>출력물에서 읽은 숫자로 채웠어요. 확인하고 저장하세요</div>
                        {warns.map((w,i) => <div key={i} style={{color:T.warn}}>{w}</div>)}
                      </div>
                    </div>
                  )
                })()}
              </div>
            )}

            {row('키오스크',
              money(kiosk, setKiosk, '키오스크 매출', {width:'min(170px, 46vw)'}))}

            <div style={{marginTop:6}}>
              <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', padding:'8px 0 2px'}}>
                <span style={{fontSize:14}}>배달</span>
                <span style={{fontSize:13, color:T.sub, ...num}}>{delTotal > 0 ? `${won(delTotal)}원` : ''}</span>
              </div>
              {[
                [baemin,   setBaemin,   '배달의민족', 'baemin'],
                [coupang,  setCoupang,  '쿠팡이츠',   'coupang'],
                [yogiyo,   setYogiyo,   '요기요',     'yogiyo'],
                [ddangyeo, setDdangyeo, '땡겨요',     'ddangyeo'],
              ].map(([val, set, label, key]) => (
                <div key={key} style={{display:'flex', alignItems:'center', gap:6, padding:'4px 0 4px 12px', minHeight:46, flexWrap:'wrap'}}>
                  <span style={{fontSize:14, color:T.ink, whiteSpace:'nowrap'}}>{label}</span>
                  {leader()}
                  {activeSession==='close' && (
                    <span style={{display:'flex', alignItems:'center', gap:4}}>
                      <input type="text" inputMode="numeric" value={orders[key]} placeholder="0"
                        onChange={e=>{ const v = e.target.value.replace(/[^0-9]/g,''); setOrders(o=>({ ...o, [key]: v })) }}
                        aria-label={`${label} 주문 건수`} style={field({width:48, fontSize:15, padding:'8px 6px'})}/>
                      <span style={{fontSize:13, color:T.sub}}>건</span>
                    </span>
                  )}
                  {money(val, set, `${label} 매출`, {width:'min(150px, 34vw)'})}
                  {activeSession==='close' && +orders[key] > 0 && +val > 0 && (
                    <span style={{width:'100%', textAlign:'right', fontSize:12, color:T.sub, marginTop:-2, ...num}}>
                      객단가 {won(Math.round(+val / +orders[key]))}원
                    </span>
                  )}
                </div>
              ))}
            </div>

            {row('포스 (현장)',
              money(pos, setPos, '포스 매출', {width:'min(170px, 46vw)'}))}

            <div style={{marginTop:10, paddingTop:12, borderTop: T.leader ? `3px double ${T.strong}` : `1px solid ${T.strong}`}}>
              <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline'}}>
                <span style={{fontSize:15, fontWeight:700}}>{activeSession==='middle' ? '입력한 누적 금액' : '합계'}</span>
                <span style={{fontSize:32, fontWeight:800, letterSpacing:'-0.02em', ...num}}>{won(subtotal)}<span style={{fontSize:16, fontWeight:600, marginLeft:2}}>원</span></span>
              </div>
              {activeSession==='middle' && (
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginTop:4, color:T.sub}}>
                  <span style={{fontSize:13}}>저장될 미들타임 매출 (오전 제외)</span>
                  <span style={{fontSize:18, fontWeight:700, color:T.ink, ...num}}>{won(Math.max(0, subtotal - morningTotal))}원</span>
                </div>
              )}
            </div>

            <button onClick={save} disabled={saving}
              style={{width:'100%', marginTop:16, background:T.accent, color:T.onAccent, border:'none', borderRadius:4,
                padding:'14px', fontSize:16, fontWeight:800, cursor:'pointer', fontFamily:'inherit'}}>
              {saving ? '저장 중...' : `${si.label} 매출 저장`}
            </button>
          </section>
        )}

        {/* 오늘 입력 내역 */}
        {(hasMorning || hasMiddle || hasClose) && (
          <section style={{marginTop:34}}>
            <h2 style={{fontSize:15, fontWeight:800, margin:'0 0 6px'}}>오늘 입력 내역</h2>
            <div style={{overflowX:'auto'}}>
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:13, minWidth:480}}>
                <thead>
                  <tr style={{borderTop:`2px solid ${T.strong}`}}>
                    {['구분','키오스크','배달','포스','합계','입력'].map(h => (
                      <th key={h} style={{padding:'8px 12px', fontSize:12, fontWeight:600, color:T.sub, borderBottom:`1px solid ${T.rule}`,
                        textAlign:['구분','입력'].includes(h) ? 'left' : 'right'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hasMorning && (
                    <tr>
                      <td style={{...cell, textAlign:'left', fontWeight:600}}>오전</td>
                      <td style={cell}>{won(rec.morningKiosk)}</td>
                      <td style={cell}>{won(rec.morningDel)}<DeliveryDetail session="morning"/></td>
                      <td style={cell}>{won(rec.morningPos)}</td>
                      <td style={{...cell, fontWeight:700}}>{won(morningSum)}</td>
                      <td style={{...cell, textAlign:'left', color:T.sub}}>{rec.morningBy||'–'}</td>
                    </tr>
                  )}
                  {hasMiddle && (
                    <tr>
                      <td style={{...cell, textAlign:'left', fontWeight:600}}>미들</td>
                      <td style={cell}>{won(rec.middleKiosk)}</td>
                      <td style={cell}>{won(rec.middleDel)}<DeliveryDetail session="middle"/></td>
                      <td style={cell}>{won(rec.middlePos)}</td>
                      <td style={{...cell, fontWeight:700}}>{won(middleSum)}</td>
                      <td style={{...cell, textAlign:'left', color:T.sub}}>{rec.middleBy||'–'}</td>
                    </tr>
                  )}
                  {hasAfternoon && (
                    <tr style={{color: isNegative ? T.accent : T.ink}}>
                      <td style={{...cell, textAlign:'left', fontWeight:600}}>오후 <span style={{fontSize:11, color:T.sub, fontWeight:400}}>자동 계산</span></td>
                      <td style={cell}>{won(afternoonKiosk)}</td>
                      <td style={cell}>{won(afternoonDel)}</td>
                      <td style={cell}>{won(afternoonPos)}</td>
                      <td style={{...cell, fontWeight:700}}>{won(afternoonSum)}</td>
                      <td style={{...cell, textAlign:'left', color:T.sub}}>{isNegative ? '마감이 오전보다 작아요' : '–'}</td>
                    </tr>
                  )}
                  {hasClose && (
                    <tr>
                      <td style={{...cell, textAlign:'left', fontWeight:800, borderBottom:`2px solid ${T.strong}`}}>하루 합계</td>
                      <td style={{...cell, borderBottom:`2px solid ${T.strong}`}}>{won(rec.kiosk)}</td>
                      <td style={{...cell, borderBottom:`2px solid ${T.strong}`}}>{won(rec.del)}<DeliveryDetail session="close"/></td>
                      <td style={{...cell, borderBottom:`2px solid ${T.strong}`}}>{won(rec.pos)}</td>
                      <td style={{...cell, fontWeight:800, borderBottom:`2px solid ${T.strong}`}}>{won(closeSum)}</td>
                      <td style={{...cell, textAlign:'left', color:T.sub, borderBottom:`2px solid ${T.strong}`}}>{rec.closeBy||'–'}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
