import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useAuth } from '../AuthContext'

const pad = n => String(n).padStart(2,'0')
const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const wonCell = n => (n != null && n !== 0) ? n.toLocaleString('ko-KR') : '—'
const DAYS = ['일','월','화','수','목','금','토']
const SPLIT_FROM = '2025-05'

const DELIVERY_PLATFORMS = [
  { key:'baemin',   label:'배달의민족', color:'#34d399' },
  { key:'coupang',  label:'쿠팡이츠',   color:'#f87171' },
  { key:'yogiyo',   label:'요기요',     color:'#f9b934' },
  { key:'ddangyeo', label:'땡겨요',     color:'#93c5fd' },
]

// 세션별 접두어 매핑 (close는 접두어 없음)
const PREFIX = { morning:'morning', middle:'middle', close:'' }
const fieldKey = (session, base) => {
  const p = PREFIX[session]
  if(!p) return base
  return p + base.charAt(0).toUpperCase() + base.slice(1)
}

const getNowDD = () => pad(new Date().getDate())

export default function Revenue() {
  const { isOwner } = useAuth()
  const [curMonth, setCurMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [inputType, setInputType] = useState('morning') // 'morning' | 'middle' | 'close'
  const [day, setDay] = useState(getNowDD)
  const [kiosk, setKiosk] = useState('')
  const [del, setDel] = useState('')
  const [baemin,   setBaemin]   = useState('')
  const [coupang,  setCoupang]  = useState('')
  const [yogiyo,   setYogiyo]   = useState('')
  const [ddangyeo, setDdangyeo] = useState('')
  const [showDelDetail, setShowDelDetail] = useState(false)
  const delTotal = (+baemin||0)+(+coupang||0)+(+yogiyo||0)+(+ddangyeo||0)
  const [pos, setPos] = useState('')
  const [editDay, setEditDay] = useState(null)
  const [editType, setEditType] = useState(null)

  const isNewMonth = curMonth >= SPLIT_FROM
  const days = daysIn(curMonth)
  const monthOpts = []
  for(let y=2022;y<=2026;y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  const getDow = (ym, d) => {
    const [y,m] = ym.split('-').map(Number)
    return DAYS[new Date(y, m-1, +d).getDay()]
  }
  const getDowColor = (ym, d) => {
    const [y,m] = ym.split('-').map(Number)
    const dow = new Date(y, m-1, +d).getDay()
    return dow === 0 ? '#f87171' : dow === 6 ? '#93c5fd' : '#dde1f2'
  }

  async function load() {
    setLoading(true)
    try {
      const snap = await getDoc(doc(db,'revenue',curMonth))
      setData(snap.exists() ? snap.data() : {})
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [curMonth])

  // 세션별 값 읽기 헬퍼 (구버전 open/close 서브객체 호환)
  function getSession(r, session) {
    if(session === 'morning' && r.open && (r.open.kiosk||0)+(r.open.del||0)+(r.open.pos||0) > 0)
      return { kiosk:r.open.kiosk||0, del:r.open.del||0, pos:r.open.pos||0 }
    if(session === 'close' && r.close && (r.close.kiosk||0)+(r.close.del||0)+(r.close.pos||0) > 0)
      return { kiosk:r.close.kiosk||0, del:r.close.del||0, pos:r.close.pos||0 }
    return {
      kiosk: r[fieldKey(session,'kiosk')] || 0,
      del:   r[fieldKey(session,'del')]   || 0,
      pos:   r[fieldKey(session,'pos')]   || 0,
    }
  }
  const getMorning = r => getSession(r, 'morning')
  const getMiddle  = r => getSession(r, 'middle')
  const getTotal   = r => getSession(r, 'close')

  // 오후 = 마감 - 오전 - 미들
  function getAfternoon(r) {
    const m = getMorning(r)
    const mid = getMiddle(r)
    const t = getTotal(r)
    const hasAny = (m.kiosk+m.del+m.pos > 0) || (mid.kiosk+mid.del+mid.pos > 0)
    if(!hasAny || t.kiosk+t.del+t.pos === 0) return null
    return { kiosk:t.kiosk-m.kiosk-mid.kiosk, del:t.del-m.del-mid.del, pos:t.pos-m.pos-mid.pos }
  }

  const hasMorningData = (dd) => {
    const r = data[dd]; if(!r) return false
    const m = getMorning(r)
    return m.kiosk+m.del+m.pos > 0
  }
  const hasMiddleData = (dd) => {
    const r = data[dd]; if(!r) return false
    const m = getMiddle(r)
    return m.kiosk+m.del+m.pos > 0
  }
  const hasTotalData = (dd) => {
    const r = data[dd]; if(!r) return false
    const t = getTotal(r)
    return t.kiosk+t.del+t.pos > 0
  }
  const isDuplicateNew = (dd, type) =>
    type === 'morning' ? hasMorningData(dd) :
    type === 'middle'  ? hasMiddleData(dd)  : hasTotalData(dd)
  const isDuplicateOld = (dd) => {
    const r = data[dd]; if(!r) return false
    const t = getTotal(r)
    return t.kiosk+t.del+t.pos > 0
  }

  async function save() {
    const targetDay  = editDay || day
    const targetType = editDay ? editType : (isNewMonth ? inputType : 'close')
    if (!editDay) {
      const isDup = isNewMonth ? isDuplicateNew(targetDay, targetType) : isDuplicateOld(targetDay)
      if (isDup) {
        const label = isNewMonth
          ? `${+targetDay}일 ${targetType==='morning'?'오전':targetType==='middle'?'미들타임':'마감'}`
          : `${+targetDay}일`
        alert(`${label}은 이미 입력된 내역이 있습니다.\n수정하려면 해당 행의 수정 버튼을 클릭하세요.`)
        return
      }
    }
    setSaving(true)
    try {
      const existing = data[targetDay] || {}

      let kioskVal = +kiosk||0, posVal = +pos||0
      let baeminVal = +baemin||0, coupangVal = +coupang||0, yogiyoVal = +yogiyo||0, ddangyeoVal = +ddangyeo||0

      if (targetType === 'middle') {
        // 미들타임: 입력값(누적)에서 오전값을 빼서 순수 미들타임 매출로 저장
        kioskVal    = Math.max(0, kioskVal    - (existing.morningKiosk||0))
        posVal      = Math.max(0, posVal      - (existing.morningPos||0))
        baeminVal   = Math.max(0, baeminVal   - (existing.morningBaemin||0))
        coupangVal  = Math.max(0, coupangVal  - (existing.morningCoupang||0))
        yogiyoVal   = Math.max(0, yogiyoVal   - (existing.morningYogiyo||0))
        ddangyeoVal = Math.max(0, ddangyeoVal - (existing.morningDdangyeo||0))
      }

      const deliverySum = showDelDetail
        ? baeminVal+coupangVal+yogiyoVal+ddangyeoVal
        : Math.max(0, (+del||0) - (targetType==='middle' ? (existing.morningDel||0) : 0))

      let newRow
      if (isNewMonth) {
        newRow = {
          ...existing,
          [fieldKey(targetType,'kiosk')]: kioskVal,
          [fieldKey(targetType,'del')]:   deliverySum,
          [fieldKey(targetType,'pos')]:   posVal,
          ...(showDelDetail ? {
            [fieldKey(targetType,'baemin')]:   baeminVal,
            [fieldKey(targetType,'coupang')]:  coupangVal,
            [fieldKey(targetType,'yogiyo')]:   yogiyoVal,
            [fieldKey(targetType,'ddangyeo')]: ddangyeoVal,
          } : {}),
        }
      } else {
        newRow = { kiosk:+kiosk||0, del:deliverySum, pos:+pos||0,
          ...(showDelDetail ? {
            baemin:+baemin||0, coupang:+coupang||0,
            yogiyo:+yogiyo||0, ddangyeo:+ddangyeo||0
          } : {}) }
      }
      const newData = { ...data, [targetDay]: newRow }
      await setDoc(doc(db,'revenue',curMonth), newData)
      setData(newData)
      setKiosk(''); setDel(''); setPos('')
      setBaemin(''); setCoupang(''); setYogiyo(''); setDdangyeo('')
      setShowDelDetail(false)
      setEditDay(null); setEditType(null)
      if (!editDay) {
        const nextDay = Array.from({length:days},(_,i)=>pad(i+1)).find(dd => {
          if (isNewMonth) return !isDuplicateNew(dd, inputType)
          return !isDuplicateOld(dd)
        })
        if (nextDay) setDay(nextDay)
      }
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  function startEdit(dd, type) {
    const r = data[dd]
    setEditDay(dd); setEditType(type); setDay(dd)
    if (type === 'middle') {
      // 미들타임 수정 시: 저장된 순수값 + 오전값 = 누적값으로 복원해서 보여줌
      const m = getMorning(r)
      setKiosk((r.middleKiosk||0) + m.kiosk || '')
      setDel((r.middleDel||0) + m.del || '')
      setPos((r.middlePos||0) + m.pos || '')
      setBaemin((r.middleBaemin||0) + (r.morningBaemin||0) || '')
      setCoupang((r.middleCoupang||0) + (r.morningCoupang||0) || '')
      setYogiyo((r.middleYogiyo||0) + (r.morningYogiyo||0) || '')
      setDdangyeo((r.middleDdangyeo||0) + (r.morningDdangyeo||0) || '')
    } else {
      const s = getSession(r, type)
      setKiosk(s.kiosk||''); setDel(s.del||''); setPos(s.pos||'')
      setBaemin(r[fieldKey(type,'baemin')]||'')
      setCoupang(r[fieldKey(type,'coupang')]||'')
      setYogiyo(r[fieldKey(type,'yogiyo')]||'')
      setDdangyeo(r[fieldKey(type,'ddangyeo')]||'')
    }
    if(DELIVERY_PLATFORMS.some(p=>(r[fieldKey(type,p.key)]||0)>0)) setShowDelDetail(true)
    window.scrollTo({top:0, behavior:'smooth'})
  }

  function cancelEdit() {
    setEditDay(null); setEditType(null)
    setKiosk(''); setDel(''); setPos('')
    setBaemin(''); setCoupang(''); setYogiyo(''); setDdangyeo('')
    setShowDelDetail(false)
  }

  async function delRow(dd, type) {
    const label = isNewMonth
      ? `${+dd}일 ${type==='morning'?'오전':type==='middle'?'미들타임':'마감'}`
      : `${+dd}일 매출`
    if (!window.confirm(`${label} 내역을 삭제하시겠습니까?`)) return
    const newData = { ...data }
    if (isNewMonth) {
      const existing = { ...newData[dd] }
      ;['kiosk','del','pos','baemin','coupang','yogiyo','ddangyeo'].forEach(base=>{
        delete existing[fieldKey(type,base)]
      })
      if(type==='morning') delete existing.open
      if(type==='close')   delete existing.close
      const m = getMorning(existing), mid = getMiddle(existing), t = getTotal(existing)
      if(m.kiosk+m.del+m.pos+mid.kiosk+mid.del+mid.pos+t.kiosk+t.del+t.pos === 0) delete newData[dd]
      else newData[dd] = existing
    } else {
      delete newData[dd]
    }
    await setDoc(doc(db,'revenue',curMonth), newData)
    setData(newData)
  }

  const tot = Object.entries(data).reduce((a,[dd,r])=>{
    const t = getTotal(r)
    return { kiosk:a.kiosk+t.kiosk, del:a.del+t.del, pos:a.pos+t.pos }
  }, {kiosk:0,del:0,pos:0})
  const grand = tot.kiosk+tot.del+tot.pos

  const activeDays = Object.keys(data).filter(dd => {
    const r = data[dd]
    const m = getMorning(r), mid = getMiddle(r), t = getTotal(r)
    return m.kiosk+m.del+m.pos+mid.kiosk+mid.del+mid.pos+t.kiosk+t.del+t.pos > 0
  }).sort()

  const cellBase  = {fontFamily:'DM Mono, monospace', textAlign:'right'}
  const borderFull = {borderBottom:'1px solid #272a3d'}
  const borderSub  = {borderBottom:'1px solid #1a1d2e'}
  const activeType = editDay ? editType : inputType
  const TYPE_COLORS = { morning:'#f9b934', middle:'#a78bfa', close:'#93c5fd' }
  const typeColor  = TYPE_COLORS[activeType]
  const typeBorder = activeType==='morning' ? 'rgba(249,185,52,0.35)' : activeType==='middle' ? 'rgba(167,139,250,0.35)' : 'rgba(147,197,253,0.35)'

  const now = new Date()
  const curYM = `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  const isThisMonth = curMonth === curYM

  // 미들타임 입력 중 순수매출 미리보기 계산 (IIFE 대신 변수로 미리 계산)
  const isMiddleActive = (editDay ? editType : inputType) === 'middle'
  const middleTargetDay = editDay || day
  const middleExisting = data[middleTargetDay] || {}
  const middleMorningTotal = (middleExisting.morningKiosk||0)+(middleExisting.morningDel||0)+(middleExisting.morningPos||0)
  const middleInputTotal = (+kiosk||0)+(showDelDetail?delTotal:(+del||0))+(+pos||0)
  const pureMiddlePreview = Math.max(0, middleInputTotal - middleMorningTotal)

  // 채널 상세보기 토글 (합계만 / 채널별)
  const [showChannelDetail, setShowChannelDetail] = useState(true)

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22,flexWrap:'wrap',gap:10}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>💰 매출관리</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>{mLabel(curMonth)}</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{fontSize:18,fontWeight:700,color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{grand.toLocaleString()}원</div>
          <select value={curMonth} onChange={e=>setCurMonth(e.target.value)}
            style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,color:'#dde1f2',
              padding:'8px 12px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
            {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
          </select>
        </div>
      </div>

      {isOwner && (
        <div style={{background:'#12141f',border:`1px solid ${editDay?'#f9b934':'#272a3d'}`,borderRadius:12,marginBottom:18}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,
            color:editDay?'#f9b934':'#dde1f2',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span>
              {editDay
                ? `✏️ ${+editDay}일 (${getDow(curMonth,editDay)}) ${editType==='morning'?'오전':editType==='middle'?'미들타임':'마감'} 수정 중`
                : '매출 입력'}
            </span>
            {editDay && (
              <button onClick={cancelEdit}
                style={{background:'transparent',border:'1px solid #272a3d',color:'#5e6585',
                  borderRadius:6,padding:'4px 10px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
                취소
              </button>
            )}
          </div>

          {isNewMonth && !editDay && (
            <div style={{padding:'12px 18px 0',display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
              {[['morning','🌅 오전 입력','#f9b934'],['middle','☕ 미들타임 입력','#a78bfa'],['close','🌙 마감 입력','#93c5fd']].map(([t,label,c])=>(
                <button key={t} onClick={()=>setInputType(t)}
                  style={{padding:'7px 16px',borderRadius:7,border:'none',fontSize:12,fontWeight:600,
                    cursor:'pointer',fontFamily:'inherit',
                    background:inputType===t?`${c}22`:'#191c2b',
                    color:inputType===t?c:'#5e6585',
                    outline:inputType===t?`1.5px solid ${c}55`:'1.5px solid transparent'}}>
                  {label}
                </button>
              ))}
              {inputType==='close' && (
                <span style={{marginLeft:8,fontSize:10,color:'#5e6585'}}>오후는 자동 계산됩니다 (마감-오전-미들)</span>
              )}
            </div>
          )}
          {((editDay ? editType : inputType) === 'middle') && (
            <div style={{padding:'12px 18px 0'}}>
              <div style={{background:'rgba(167,139,250,0.08)',border:'1px solid rgba(167,139,250,0.2)',
                borderRadius:7,padding:'8px 10px',fontSize:10,color:'#a78bfa',lineHeight:1.6}}>
                💡 POS/키오스크에 찍힌 <b>누적 금액 그대로</b> 입력하세요. 오전 매출을 자동으로 빼서 미들타임 순수 매출만 저장돼요.
              </div>
            </div>
          )}

          <div style={{padding:'14px 18px',display:'grid',gridTemplateColumns:'140px repeat(3,1fr)',gap:10}}>
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              <label style={{fontSize:10,color:'#5e6585',fontWeight:600}}>날짜</label>
              {editDay ? (
                <div style={{background:'#191c2b',border:'1px solid #f9b934',borderRadius:7,
                  color:'#f9b934',padding:'8px 10px',fontSize:13,fontWeight:700}}>
                  {+editDay}일 ({getDow(curMonth,editDay)})
                </div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  {isThisMonth && (
                    <div style={{display:'flex',gap:6}}>
                      <button onClick={()=>setDay(pad(now.getDate()))}
                        style={{flex:1,padding:'5px',borderRadius:6,border:'none',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                          background:day===pad(now.getDate())?'#f9b934':'#191c2b',
                          color:day===pad(now.getDate())?'#000':'#5e6585'}}>
                        오늘 ({now.getDate()}일)
                      </button>
                      <button onClick={()=>{const y=new Date();y.setDate(y.getDate()-1);setDay(pad(y.getDate()))}}
                        style={{flex:1,padding:'5px',borderRadius:6,border:'none',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                          background:(()=>{const y=new Date();y.setDate(y.getDate()-1);return day===pad(y.getDate())})()? '#f9b934':'#191c2b',
                          color:(()=>{const y=new Date();y.setDate(y.getDate()-1);return day===pad(y.getDate())})()? '#000':'#5e6585'}}>
                        어제 ({(()=>{const y=new Date();y.setDate(y.getDate()-1);return y.getDate()})()}일)
                      </button>
                    </div>
                  )}
                  <select value={day} onChange={e=>setDay(e.target.value)}
                    style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                      padding:'8px 10px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
                    {Array.from({length:days},(_,i)=>{
                      const dd = pad(i+1)
                      const dup = isNewMonth ? isDuplicateNew(dd, inputType) : isDuplicateOld(dd)
                      return (
                        <option key={i} value={dd} style={{color:dup?'#f87171':'inherit'}}>
                          {i+1}일 ({getDow(curMonth,dd)}){dup?' ⚠중복':''}
                        </option>
                      )
                    })}
                  </select>
                </div>
              )}
            </div>
            {/* 키오스크 */}
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              <label style={{fontSize:10,fontWeight:600,color:isNewMonth?typeColor:'#5e6585'}}>🖥️ 키오스크 (원)</label>
              <input type="number" value={kiosk} onChange={e=>setKiosk(e.target.value)}
                placeholder="0" min="0"
                style={{background:'#191c2b',border:`1px solid ${isNewMonth?typeBorder:'#272a3d'}`,
                  borderRadius:7,color:'#dde1f2',padding:'8px 10px',fontSize:12,outline:'none',width:'100%'}}/>
            </div>
            {/* 배달 - 토글 */}
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <label style={{fontSize:10,fontWeight:600,color:isNewMonth?typeColor:'#5e6585'}}>🛵 배달 (원)</label>
                <button onClick={()=>setShowDelDetail(v=>!v)}
                  style={{fontSize:9,color:showDelDetail?typeColor:'#5e6585',background:'transparent',
                    border:`1px solid ${showDelDetail?typeBorder:'#272a3d'}`,borderRadius:4,
                    padding:'2px 7px',cursor:'pointer',fontFamily:'inherit'}}>
                  {showDelDetail ? '▲ 합계 입력' : '▼ 플랫폼별 입력'}
                </button>
              </div>
              {!showDelDetail ? (
                <input type="number" value={del} onChange={e=>setDel(e.target.value)}
                  placeholder="0" min="0"
                  style={{background:'#191c2b',border:`1px solid ${isNewMonth?typeBorder:'#272a3d'}`,
                    borderRadius:7,color:'#dde1f2',padding:'8px 10px',fontSize:12,outline:'none',width:'100%'}}/>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                    {[
                      [baemin,setBaemin,'배달의민족','#34d399'],
                      [coupang,setCoupang,'쿠팡이츠','#f87171'],
                      [yogiyo,setYogiyo,'요기요','#f9b934'],
                      [ddangyeo,setDdangyeo,'땡겨요','#93c5fd'],
                    ].map(([val,set,label,color])=>(
                      <div key={label}>
                        <label style={{fontSize:9,color:color,fontWeight:600,display:'block',marginBottom:3}}>{label}</label>
                        <input type="number" value={val} onChange={e=>set(e.target.value)}
                          placeholder="0" min="0"
                          style={{background:'#191c2b',border:`1px solid ${color}33`,
                            borderRadius:6,color:'#dde1f2',padding:'7px 8px',fontSize:12,
                            outline:'none',width:'100%',fontFamily:'DM Mono,monospace'}}/>
                      </div>
                    ))}
                  </div>
                  {delTotal > 0 && (
                    <div style={{textAlign:'right',fontSize:11,color:typeColor,fontFamily:'DM Mono,monospace',fontWeight:700}}>
                      배달 합계: {delTotal.toLocaleString()}원
                    </div>
                  )}
                </div>
              )}
            </div>
            {/* 포스 */}
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              <label style={{fontSize:10,fontWeight:600,color:isNewMonth?typeColor:'#5e6585'}}>🧾 포스/현장 (원)</label>
              <input type="number" value={pos} onChange={e=>setPos(e.target.value)}
                placeholder="0" min="0"
                style={{background:'#191c2b',border:`1px solid ${isNewMonth?typeBorder:'#272a3d'}`,
                  borderRadius:7,color:'#dde1f2',padding:'8px 10px',fontSize:12,outline:'none',width:'100%'}}/>
            </div>
          </div>
          {isMiddleActive && (
            <div style={{padding:'0 18px 14px'}}>
              <div style={{background:'#191c2b',borderRadius:8,padding:'10px 14px',
                display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:11,color:'#a78bfa',fontWeight:600}}>→ 미들타임 순수 매출 (저장될 값)</span>
                <span style={{fontSize:15,fontWeight:700,color:'#a78bfa',fontFamily:'DM Mono,monospace'}}>
                  {pureMiddlePreview.toLocaleString()}원
                </span>
              </div>
            </div>
          )}
          <div style={{padding:'0 18px 18px'}}>
            <button onClick={save} disabled={saving}
              style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'9px 20px',
                fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              {saving ? '저장 중...' : editDay ? '수정 완료' : '저 장'}
            </button>
          </div>
        </div>
      )}

      <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden'}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,
          display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
          <span>{mLabel(curMonth)} 매출 내역</span>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{display:'flex',gap:4}}>
              {[[true,'채널별'],[false,'합계만']].map(([val,label])=>(
                <button key={label} onClick={()=>setShowChannelDetail(val)}
                  style={{padding:'4px 10px',borderRadius:5,border:'none',fontSize:10,fontWeight:600,
                    cursor:'pointer',fontFamily:'inherit',
                    background:showChannelDetail===val?'#f9b934':'#191c2b',
                    color:showChannelDetail===val?'#000':'#5e6585',
                    outline:showChannelDetail===val?'none':'1px solid #272a3d'}}>
                  {label}
                </button>
              ))}
            </div>
            <span style={{color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{grand.toLocaleString()}원</span>
          </div>
        </div>
        {loading ? (
          <div style={{textAlign:'center',color:'#5e6585',padding:40}}>로딩 중...</div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead>
                <tr style={{background:'#191c2b'}}>
                  {[
                    '날짜','요일',
                    ...(isNewMonth ? ['구분'] : []),
                    ...(showChannelDetail ? ['키오스크','배달','포스'] : []),
                    '합계',
                    ...(isOwner ? ['관리'] : [])
                  ].map(h=>(
                    <th key={h} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:'#5e6585',
                      textAlign:['날짜','요일','구분'].includes(h)?'left':'right',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeDays.length === 0 && (
                  <tr>
                    <td colSpan={isOwner?9:8} style={{padding:28,textAlign:'center',color:'#5e6585'}}>
                      입력된 데이터가 없습니다
                    </td>
                  </tr>
                )}
                {activeDays.map(dd => {
                  const r = data[dd]
                  const hasMorning = hasMorningData(dd)
                  const hasMiddle  = hasMiddleData(dd)
                  const hasTotal   = hasTotalData(dd)

                  if (!isNewMonth) {
                    const t = getTotal(r)
                    const s = t.kiosk+t.del+t.pos
                    return (
                      <tr key={dd}>
                        <td style={{padding:'9px 14px',...borderFull,color:'#dde1f2',fontFamily:'DM Mono, monospace'}}>{+dd}일</td>
                        <td style={{padding:'9px 14px',...borderFull,color:getDowColor(curMonth,dd),fontWeight:600}}>{getDow(curMonth,dd)}</td>
                        {showChannelDetail && (
                          <>
                            <td style={{padding:'9px 14px',...borderFull,...cellBase}}>{wonCell(t.kiosk)}</td>
                            <td style={{padding:'9px 14px',...borderFull,...cellBase}}>
                              {wonCell(t.del)}
                              {DELIVERY_PLATFORMS.some(p=>(r[p.key]||0)>0) && (
                                <div style={{marginTop:3}}>
                                  {DELIVERY_PLATFORMS.filter(p=>(r[p.key]||0)>0).map(p=>(
                                    <div key={p.key} style={{display:'flex',justifyContent:'space-between',fontSize:9,color:'#5e6585'}}>
                                      <span style={{color:p.color}}>{p.label}</span>
                                      <span style={{fontFamily:'DM Mono,monospace'}}>{(r[p.key]||0).toLocaleString()}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </td>
                            <td style={{padding:'9px 14px',...borderFull,...cellBase}}>{wonCell(t.pos)}</td>
                          </>
                        )}
                        <td style={{padding:'9px 14px',...borderFull,...cellBase,color:'#f9b934',fontWeight:700}}>{s.toLocaleString()}</td>
                        {isOwner && (
                          <td style={{padding:'9px 14px',...borderFull,textAlign:'right',whiteSpace:'nowrap'}}>
                            <button onClick={()=>startEdit(dd,'close')}
                              style={{background:'transparent',border:'1px solid #272a3d',color:'#dde1f2',padding:'3px 8px',fontSize:10,borderRadius:4,cursor:'pointer',fontFamily:'inherit',marginRight:4}}>수정</button>
                            <button onClick={()=>delRow(dd,'close')}
                              style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',padding:'3px 8px',fontSize:10,borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>삭제</button>
                          </td>
                        )}
                      </tr>
                    )
                  }

                  const afternoon  = getAfternoon(r)
                  const morningRec = getMorning(r)
                  const middleRec  = getMiddle(r)
                  const totalRec   = getTotal(r)
                  const morningSum = morningRec.kiosk+morningRec.del+morningRec.pos
                  const middleSum  = middleRec.kiosk+middleRec.del+middleRec.pos
                  const totalSum   = totalRec.kiosk+totalRec.del+totalRec.pos
                  const aftSum     = afternoon ? afternoon.kiosk+afternoon.del+afternoon.pos : 0
                  const isNeg      = afternoon && (afternoon.kiosk<0||afternoon.del<0||afternoon.pos<0)

                  const subRows = []
                  if (hasMorning) {
                    subRows.push({id:'morning', label:'오전', color:'#f9b934',
                      k:morningRec.kiosk, d:morningRec.del, p:morningRec.pos, sum:morningSum,
                      canEdit:true, eType:'morning', isAuto:false})
                  }
                  if (hasMiddle) {
                    subRows.push({id:'middle', label:'미들', color:'#a78bfa',
                      k:middleRec.kiosk, d:middleRec.del, p:middleRec.pos, sum:middleSum,
                      canEdit:true, eType:'middle', isAuto:false})
                  }
                  if ((hasMorning || hasMiddle) && hasTotal) {
                    subRows.push({id:'afternoon', label:'오후', color:isNeg?'#f87171':'#93c5fd',
                      k:afternoon.kiosk, d:afternoon.del, p:afternoon.pos, sum:aftSum,
                      canEdit:false, isAuto:true, isNeg})
                    subRows.push({id:'total', label:'합계', color:'#34d399',
                      k:totalRec.kiosk, d:totalRec.del, p:totalRec.pos, sum:totalSum,
                      canEdit:true, eType:'close', isAuto:false})
                  } else if ((hasMorning || hasMiddle) && !hasTotal) {
                    subRows.push({id:'warn', label:'⚠ 마감미입력', color:'#f87171',
                      k:null, d:null, p:null, sum:null, canEdit:false, isWarn:true})
                  } else if (!hasMorning && !hasMiddle && hasTotal) {
                    subRows.push({id:'total', label:'—', color:'#dde1f2',
                      k:totalRec.kiosk, d:totalRec.del, p:totalRec.pos, sum:totalSum,
                      canEdit:true, eType:'close', isAuto:false})
                  }

                  const rowCount = subRows.length
                  return subRows.map((row, ri) => {
                    const isLast = ri === rowCount - 1
                    const bStyle = isLast ? borderFull : borderSub
                    const rowBg  =
                      row.id==='morning'   ? 'rgba(249,185,52,0.04)'  :
                      row.id==='middle'    ? 'rgba(167,139,250,0.04)' :
                      row.id==='afternoon' ? 'rgba(147,197,253,0.04)' :
                      row.id==='total'     ? 'rgba(52,211,153,0.04)'  :
                      row.isWarn           ? 'rgba(248,113,113,0.04)' : 'transparent'
                    const delPlatformKeys = row.id==='morning'
                      ? {baemin:'morningBaemin',coupang:'morningCoupang',yogiyo:'morningYogiyo',ddangyeo:'morningDdangyeo'}
                      : row.id==='middle'
                      ? {baemin:'middleBaemin',coupang:'middleCoupang',yogiyo:'middleYogiyo',ddangyeo:'middleDdangyeo'}
                      : {baemin:'baemin',coupang:'coupang',yogiyo:'yogiyo',ddangyeo:'ddangyeo'}
                    return (
                      <tr key={`${dd}-${row.id}`} style={{background:rowBg}}>
                        {ri === 0 && (
                          <>
                            <td rowSpan={rowCount}
                              style={{padding:'9px 14px',...borderFull,color:'#dde1f2',
                                fontFamily:'DM Mono, monospace',verticalAlign:'middle'}}>
                              {+dd}일
                            </td>
                            <td rowSpan={rowCount}
                              style={{padding:'9px 14px',...borderFull,
                                color:getDowColor(curMonth,dd),fontWeight:600,verticalAlign:'middle'}}>
                              {getDow(curMonth,dd)}
                            </td>
                          </>
                        )}
                        <td style={{padding:'6px 14px',...bStyle,fontSize:11,fontWeight:700,
                          color:row.color,whiteSpace:'nowrap'}}>
                          {row.isNeg ? '⚠ 오후(오전+미들>합계)' : row.label}
                          {row.isAuto && !row.isNeg
                            ? <span style={{fontSize:9,color:'#3d4060',marginLeft:4,fontWeight:400}}>자동</span>
                            : null}
                        </td>
                        {showChannelDetail && [row.k, row.d, row.p].map((v, ci) => {
                          const isDel = ci === 1
                          return (
                          <td key={ci} style={{padding:'6px 14px',...bStyle,...cellBase,
                            color:row.isNeg&&row.id==='afternoon'?'#f87171':'#dde1f2'}}>
                            {v !== null ? wonCell(v) : '—'}
                            {isDel && ['morning','middle'].includes(row.id) && DELIVERY_PLATFORMS.some(p=>(r[delPlatformKeys[p.key]]||0)>0) && (
                              <div style={{marginTop:3}}>
                                {DELIVERY_PLATFORMS.filter(p=>(r[delPlatformKeys[p.key]]||0)>0).map(p=>(
                                  <div key={p.key} style={{display:'flex',justifyContent:'space-between',fontSize:9,color:'#5e6585'}}>
                                    <span style={{color:p.color}}>{p.label}</span>
                                    <span style={{fontFamily:'DM Mono,monospace'}}>{(r[delPlatformKeys[p.key]]||0).toLocaleString()}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {isDel && row.id==='afternoon' && DELIVERY_PLATFORMS.some(p=>{
                              const val = (r[p.key]||0)-(r[`morning${p.key.charAt(0).toUpperCase()+p.key.slice(1)}`]||0)-(r[`middle${p.key.charAt(0).toUpperCase()+p.key.slice(1)}`]||0)
                              return val !== 0
                            }) && (
                              <div style={{marginTop:3}}>
                                {DELIVERY_PLATFORMS.map(p=>{
                                  const cap = p.key.charAt(0).toUpperCase()+p.key.slice(1)
                                  const val = (r[p.key]||0)-(r[`morning${cap}`]||0)-(r[`middle${cap}`]||0)
                                  if(!val) return null
                                  return (
                                    <div key={p.key} style={{display:'flex',justifyContent:'space-between',fontSize:9,color:'#5e6585'}}>
                                      <span style={{color:p.color}}>{p.label}</span>
                                      <span style={{fontFamily:'DM Mono,monospace'}}>{val.toLocaleString()}</span>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </td>
                        )})}
                        <td style={{padding:'6px 14px',...bStyle,...cellBase,
                          fontWeight:row.id==='total'?700:500,
                          color:row.id==='total'?'#34d399':row.id==='morning'?'#f9b934':row.id==='middle'?'#a78bfa':
                                row.id==='afternoon'?(row.isNeg?'#f87171':'#93c5fd'):'#5e6585'}}>
                          {row.sum !== null ? row.sum.toLocaleString() : '—'}
                        </td>
                        {isOwner && (
                          <td style={{padding:'6px 14px',...bStyle,textAlign:'right',whiteSpace:'nowrap'}}>
                            {row.canEdit && (
                              <>
                                <button onClick={()=>startEdit(dd, row.eType)}
                                  style={{background:'transparent',border:'1px solid #272a3d',color:'#dde1f2',
                                    padding:'3px 8px',fontSize:10,borderRadius:4,cursor:'pointer',fontFamily:'inherit',marginRight:4}}>
                                  수정
                                </button>
                                <button onClick={()=>delRow(dd, row.eType)}
                                  style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',
                                    padding:'3px 8px',fontSize:10,borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>
                                  삭제
                                </button>
                              </>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })
                })}
              </tbody>
              <tfoot>
                <tr style={{background:'#1f2236'}}>
                  <td colSpan={isNewMonth?3:2} style={{padding:'10px 14px',fontWeight:700,color:'#f9b934'}}>합 계</td>
                  {showChannelDetail && (
                    <>
                      <td style={{padding:'10px 14px',...cellBase,fontWeight:700,color:'#f9b934'}}>{wonCell(tot.kiosk)}</td>
                      <td style={{padding:'10px 14px',...cellBase,fontWeight:700,color:'#f9b934'}}>{wonCell(tot.del)}</td>
                      <td style={{padding:'10px 14px',...cellBase,fontWeight:700,color:'#f9b934'}}>{wonCell(tot.pos)}</td>
                    </>
                  )}
                  <td style={{padding:'10px 14px',...cellBase,fontWeight:700,color:'#f9b934'}}>{grand.toLocaleString()}</td>
                  {isOwner && <td></td>}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
