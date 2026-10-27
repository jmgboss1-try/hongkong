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
  { key:'baemin',   label:'배달의민족', color:'#2E7D45' },
  { key:'coupang',  label:'쿠팡이츠',   color:'#B42318' },
  { key:'yogiyo',   label:'요기요',     color:'#C3261C' },
  { key:'ddangyeo', label:'땡겨요',     color:'#2B5C9E' },
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
  for(let y=2022;y<=Math.max(2026,new Date().getFullYear());y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  const getDow = (ym, d) => {
    const [y,m] = ym.split('-').map(Number)
    return DAYS[new Date(y, m-1, +d).getDay()]
  }
  const getDowColor = (ym, d) => {
    const [y,m] = ym.split('-').map(Number)
    const dow = new Date(y, m-1, +d).getDay()
    return dow === 0 ? '#B42318' : dow === 6 ? '#2B5C9E' : '#1D1B18'
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
      if(type==='close') {
        delete existing.close
        ;['baemin','coupang','yogiyo','ddangyeo'].forEach(k=>delete existing[`${k}Orders`])
      }
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

  const activeType = editDay ? editType : inputType
  const TYPE_COLORS = { morning:'#C3261C', middle:'#6B4FA0', close:'#2B5C9E' }

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

  // ── 장부 화면 조각 (지출관리·대시보드와 같은 모양). 함수로 그려야 입력칸 포커스가 안 빠짐 ──
  const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', soft:'#ECE8E1', accent:'#C3261C',
    red:'#B42318', green:'#2E7D45', blue:'#2B5C9E', purple:'#6B4FA0' }
  const num = { fontVariantNumeric:'tabular-nums' }
  const won = n => (n||0).toLocaleString('ko-KR')
  const monthIdx = monthOpts.indexOf(curMonth)
  const field = extra => ({ background:'#FFFFFF', border:'1px solid #CBC5BA', borderRadius:4, color:T.ink, padding:'8px 10px',
    fontSize:14, outline:'none', fontFamily:'inherit', boxSizing:'border-box', ...extra })
  const money = (val, set, label) => (
    <input type="text" inputMode="numeric" placeholder="0" aria-label={label}
      value={val === '' || val == null ? '' : (+val).toLocaleString('ko-KR')}
      onChange={e=>set(e.target.value.replace(/[^0-9]/g,''))}
      style={field({ width:'min(160px, 40vw)', textAlign:'right', ...num })}/>
  )
  const leader = () => <span aria-hidden="true" style={{flex:1, borderBottom:`1px dotted ${T.faint}`, margin:'0 8px', minWidth:12, transform:'translateY(-4px)'}}/>
  const line = (label, value, { strong, sub, color, note, key, text } = {}) => (
    <div key={key||label} style={{display:'flex', alignItems:'baseline', padding: sub ? '3px 0 3px 14px' : '7px 0',
      fontSize: strong ? 17 : sub ? 13 : 15, fontWeight: strong ? 800 : sub ? 400 : 600, color: sub ? T.sub : T.ink}}>
      <span style={{whiteSpace:'nowrap'}}>{label}</span>
      {note && <span style={{fontSize:12, color:T.sub, marginLeft:6, whiteSpace:'nowrap', fontWeight:400}}>{note}</span>}
      {leader()}
      <span style={{...num, whiteSpace:'nowrap', color: color || 'inherit'}}>{text ?? won(value)}</span>
    </div>
  )
  const inputRow = (label, control, note) => (
    <div key={label} style={{display:'flex', alignItems:'center', padding:'5px 0', minHeight:44}}>
      <span style={{fontSize:14, whiteSpace:'nowrap'}}>{label}</span>
      {note && <span style={{fontSize:11, color:T.sub, marginLeft:6, whiteSpace:'nowrap'}}>{note}</span>}
      {leader()}
      {control}
    </div>
  )
  const sectionTitle = (text, right, color) => (
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:10, flexWrap:'wrap',
      borderBottom:`2px solid ${T.ink}`, paddingBottom:6, marginBottom:6}}>
      <h2 style={{fontSize:16, fontWeight:800, margin:0, fontFamily:'inherit', color: color || T.ink}}>{text}</h2>
      {right && <div style={{display:'flex', alignItems:'center', gap:14, flexWrap:'wrap', fontSize:12, color:T.sub}}>{right}</div>}
    </div>
  )
  const textTab = (on, label, onClick, color = T.accent) => (
    <button key={label} type="button" onClick={onClick}
      style={{background:'none', border:'none', padding:'4px 0', cursor:'pointer', fontFamily:'inherit', fontSize:13,
        fontWeight: on ? 800 : 500, color: on ? T.ink : T.sub, borderBottom:`2px solid ${on ? color : 'transparent'}`}}>
      {label}
    </button>
  )
  const chip = (on, label, onClick) => (
    <button type="button" onClick={onClick}
      style={{fontFamily:'inherit', cursor:'pointer', borderRadius:4, whiteSpace:'nowrap', fontSize:12, padding:'6px 12px',
        fontWeight: on ? 700 : 500, background: on ? T.accent : '#FFFFFF', color: on ? '#FFFFFF' : T.ink,
        border: on ? 'none' : `1px solid ${T.rule}`}}>
      {label}
    </button>
  )
  const smallBtn = (label, onClick, danger) => (
    <button type="button" onClick={onClick}
      style={{background:'transparent', border:'none', color: danger ? T.red : T.sub, fontSize:12, cursor:'pointer',
        padding: danger ? '0 0 0 6px' : '0 6px', fontFamily:'inherit'}}>{label}</button>
  )

  // 이 달 요약: 배달앱별 합계(마감 기준), 영업일, 하루 평균, 최고 매출일
  const platTot = DELIVERY_PLATFORMS.map(p => ({ ...p, sum: activeDays.reduce((a,dd)=>a+(data[dd]?.[p.key]||0),0) }))
  const dayTotals = activeDays.map(dd => { const t = getTotal(data[dd]); return { dd, sum: t.kiosk+t.del+t.pos } }).filter(x=>x.sum>0)
  const best = dayTotals.reduce((a,x)=> !a || x.sum > a.sum ? x : a, null)
  const avg = dayTotals.length ? Math.round(grand / dayTotals.length) : 0
  const yest = (()=>{ const y=new Date(); y.setDate(y.getDate()-1); return pad(y.getDate()) })()
  const typeLabel = t => t==='morning' ? '오전' : t==='middle' ? '미들타임' : '마감'

  return (
    <div style={{maxWidth:1100}}>
      {/* 머리 */}
      <header style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap',
        paddingBottom:10, borderBottom:`3px double ${T.ink}`, marginBottom:22}}>
        <h1 style={{fontSize:24, fontWeight:800, margin:0, letterSpacing:'-0.01em', fontFamily:'inherit', color:T.ink}}>{mLabel(curMonth)} 매출</h1>
        <div style={{display:'flex', alignItems:'center', gap:6}}>
          <button type="button" aria-label="이전 달" disabled={monthIdx<=0} onClick={()=>setCurMonth(monthOpts[monthIdx-1])}
            style={{background:'none', border:`1px solid ${T.rule}`, borderRadius:4, padding:'6px 10px', cursor:'pointer', fontFamily:'inherit', color:T.ink}}>이전</button>
          <select value={curMonth} onChange={e=>setCurMonth(e.target.value)} aria-label="달 고르기"
            style={{background:'#FFFFFF', border:`1px solid ${T.rule}`, borderRadius:4, color:T.ink, padding:'7px 10px', fontSize:13, fontFamily:'inherit', outline:'none'}}>
            {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
          </select>
          <button type="button" aria-label="다음 달" disabled={monthIdx>=monthOpts.length-1} onClick={()=>setCurMonth(monthOpts[monthIdx+1])}
            style={{background:'none', border:`1px solid ${T.rule}`, borderRadius:4, padding:'6px 10px', cursor:'pointer', fontFamily:'inherit', color:T.ink}}>다음</button>
        </div>
      </header>

      {/* 이 달 요약 */}
      {!loading && (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap:'28px 40px', marginBottom:30}}>
          <section>
            {sectionTitle('채널별 매출')}
            {line('키오스크', tot.kiosk, { note: grand ? `${Math.round(tot.kiosk/grand*100)}%` : undefined })}
            {line('배달', tot.del, { note: grand ? `${Math.round(tot.del/grand*100)}%` : undefined })}
            {platTot.filter(p=>p.sum>0).map(p=>line(p.label, p.sum, { sub:true, key:p.key }))}
            {line('포스', tot.pos, { note: grand ? `${Math.round(tot.pos/grand*100)}%` : undefined })}
            <div style={{borderTop:`3px double ${T.ink}`, marginTop:6, paddingTop:2}}>{line('매출 합계', grand, { strong:true })}</div>
          </section>
          <section>
            {sectionTitle('한눈에')}
            {line('마감 입력한 날', 0, { text:`${dayTotals.length}일` })}
            {line('하루 평균', avg)}
            {best && line('가장 많이 판 날', best.sum, { note:`${+best.dd}일 (${getDow(curMonth,best.dd)})` })}
            {isNewMonth && activeDays.some(dd=>(hasMorningData(dd)||hasMiddleData(dd)) && !hasTotalData(dd)) && (
              <div style={{marginTop:8, fontSize:13, color:T.red}}>
                마감이 빠진 날: {activeDays.filter(dd=>(hasMorningData(dd)||hasMiddleData(dd)) && !hasTotalData(dd)).map(dd=>`${+dd}일`).join(', ')}
              </div>
            )}
          </section>
        </div>
      )}

      {/* 매출 입력 (사장만) */}
      {isOwner && (
        <section style={{marginBottom:30}}>
          {sectionTitle(
            editDay ? `${+editDay}일 (${getDow(curMonth,editDay)}) ${typeLabel(editType)} 고치는 중` : '매출 입력',
            editDay
              ? <button type="button" onClick={cancelEdit} style={{background:'#FFFFFF', border:`1px solid ${T.rule}`, borderRadius:4, padding:'4px 10px', fontSize:12, cursor:'pointer', fontFamily:'inherit', color:T.ink}}>취소</button>
              : isNewMonth && <>
                  {textTab(inputType==='morning', '오전', ()=>setInputType('morning'), TYPE_COLORS.morning)}
                  {textTab(inputType==='middle', '미들타임', ()=>setInputType('middle'), TYPE_COLORS.middle)}
                  {textTab(inputType==='close', '마감', ()=>setInputType('close'), TYPE_COLORS.close)}
                </>,
            editDay ? T.accent : undefined)}

          <div style={{paddingTop:8}}>
            {!editDay && (
              <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:10}}>
                <span style={{fontSize:13, color:T.sub}}>날짜</span>
                {isThisMonth && <>
                  {chip(day===pad(now.getDate()), `오늘 (${now.getDate()}일)`, ()=>setDay(pad(now.getDate())))}
                  {chip(day===yest, `어제 (${+yest}일)`, ()=>setDay(yest))}
                </>}
                <select value={day} onChange={e=>setDay(e.target.value)} aria-label="날짜" style={field({ fontSize:13 })}>
                  {Array.from({length:days},(_,i)=>{
                    const dd = pad(i+1)
                    const dup = isNewMonth ? isDuplicateNew(dd, inputType) : isDuplicateOld(dd)
                    return <option key={i} value={dd}>{i+1}일 ({getDow(curMonth,dd)}){dup ? ' · 입력됨' : ''}</option>
                  })}
                </select>
                {isNewMonth && inputType==='close' && <span style={{fontSize:12, color:T.sub}}>오후는 마감 − 오전 − 미들로 자동 계산돼요</span>}
              </div>
            )}
            {activeType === 'middle' && (
              <div style={{fontSize:12, color:T.purple, marginBottom:6, lineHeight:1.6}}>
                POS·키오스크에 찍힌 <b>누적 금액 그대로</b> 적으세요. 오전 매출을 빼서 미들타임 매출만 저장돼요.
              </div>
            )}

            <div style={{maxWidth:520}}>
              {inputRow('키오스크', money(kiosk, setKiosk, '키오스크'))}
              {!showDelDetail
                ? inputRow('배달', money(del, setDel, '배달'))
                : <>
                    <div style={{fontSize:12, fontWeight:700, color:T.sub, padding:'8px 0 2px', borderBottom:`1px solid ${T.rule}`}}>배달 (앱별)</div>
                    {inputRow('배달의민족', money(baemin, setBaemin, '배달의민족'))}
                    {inputRow('쿠팡이츠', money(coupang, setCoupang, '쿠팡이츠'))}
                    {inputRow('요기요', money(yogiyo, setYogiyo, '요기요'))}
                    {inputRow('땡겨요', money(ddangyeo, setDdangyeo, '땡겨요'))}
                    {line('배달 합계', delTotal, { sub:true })}
                  </>}
              <button type="button" onClick={()=>setShowDelDetail(v=>!v)}
                style={{background:'none', border:'none', borderBottom:`1px solid ${T.blue}`, color:T.blue, padding:0, fontSize:12, cursor:'pointer', fontFamily:'inherit', margin:'2px 0 4px'}}>
                {showDelDetail ? '배달을 합계 하나로 입력' : '배달을 앱별로 입력'}
              </button>
              {inputRow('포스·현장', money(pos, setPos, '포스'))}
              <div style={{borderTop:`3px double ${T.ink}`, marginTop:6, paddingTop:2}}>
                {isMiddleActive
                  ? line('미들타임 매출 (저장될 값)', pureMiddlePreview, { strong:true, color:T.purple })
                  : line(`${+(editDay||day)}일 ${isNewMonth ? typeLabel(activeType) : ''} 합계`, (+kiosk||0)+(showDelDetail?delTotal:(+del||0))+(+pos||0), { strong:true })}
              </div>
            </div>
            <button onClick={save} disabled={saving}
              style={{marginTop:10, background:T.accent, color:'#FFFFFF', border:'none', borderRadius:4, padding:'8px 20px',
                fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit', opacity: saving ? 0.6 : 1}}>
              {saving ? '저장 중...' : editDay ? '고친 내용 저장' : '저장'}
            </button>
          </div>
        </section>
      )}

      {/* 일별 매출 내역 */}
      <section>
        {sectionTitle('일별 매출 내역', <>
          {textTab(showChannelDetail, '채널별', ()=>setShowChannelDetail(true))}
          {textTab(!showChannelDetail, '합계만', ()=>setShowChannelDetail(false))}
        </>)}
        {loading ? <div style={{color:T.sub, padding:'30px 0'}}>불러오는 중...</div> : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:13, ...num}}>
              <thead>
                <tr>
                  {['날짜', ...(isNewMonth ? ['구분'] : []), ...(showChannelDetail ? ['키오스크','배달','포스'] : []), '합계', ...(isOwner ? [''] : [])].map((h,i)=>(
                    <th key={h+i} style={{padding:'8px 12px', fontSize:12, fontWeight:600, color:T.sub, borderBottom:`1px solid ${T.ink}`,
                      textAlign:['날짜','구분'].includes(h)?'left':'right', whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {activeDays.length === 0 && (
                  <tr><td colSpan={isOwner?7:6} style={{padding:28, textAlign:'center', color:T.sub}}>입력된 매출이 없어요</td></tr>
                )}
                {activeDays.map(dd => {
                  const r = data[dd]
                  const dayCell = rowSpan => (
                    <td rowSpan={rowSpan} style={{padding:'8px 12px', borderBottom:`1px solid ${T.rule}`, verticalAlign:'top', whiteSpace:'nowrap',
                      color:getDowColor(curMonth,dd), fontWeight:600}}>{+dd}일 ({getDow(curMonth,dd)})</td>
                  )
                  const platLines = keys => DELIVERY_PLATFORMS.some(p=>(r[keys[p.key]]||0)!==0) && (
                    <div style={{marginTop:2}}>
                      {DELIVERY_PLATFORMS.filter(p=>(r[keys[p.key]]||0)!==0).map(p=>(
                        <div key={p.key} style={{display:'flex', justifyContent:'space-between', gap:8, fontSize:11, lineHeight:1.5, color:T.sub}}>
                          <span>{p.label}</span><span>{won(r[keys[p.key]])}</span>
                        </div>
                      ))}
                    </div>
                  )
                  const td = (last, extra) => ({ padding:'7px 12px', borderBottom:`1px solid ${last ? T.rule : T.soft}`, textAlign:'right', whiteSpace:'nowrap', verticalAlign:'top', ...extra })

                  if (!isNewMonth) {
                    const t = getTotal(r)
                    return (
                      <tr key={dd}>
                        {dayCell(1)}
                        {showChannelDetail && <>
                          <td style={td(true)}>{wonCell(t.kiosk)}</td>
                          <td style={td(true)}>{wonCell(t.del)}{platLines({ baemin:'baemin', coupang:'coupang', yogiyo:'yogiyo', ddangyeo:'ddangyeo' })}</td>
                          <td style={td(true)}>{wonCell(t.pos)}</td>
                        </>}
                        <td style={td(true, { fontWeight:700 })}>{won(t.kiosk+t.del+t.pos)}</td>
                        {isOwner && <td style={td(true)}>{smallBtn('수정', ()=>startEdit(dd,'close'))}{smallBtn('삭제', ()=>delRow(dd,'close'), true)}</td>}
                      </tr>
                    )
                  }

                  const afternoon = getAfternoon(r)
                  const mRec = getMorning(r), midRec = getMiddle(r), tRec = getTotal(r)
                  const hasM = hasMorningData(dd), hasMid = hasMiddleData(dd), hasT = hasTotalData(dd)
                  const isNeg = afternoon && (afternoon.kiosk<0||afternoon.del<0||afternoon.pos<0)
                  const rows = []
                  if (hasM) rows.push({ id:'morning', label:'오전', color:TYPE_COLORS.morning, v:mRec, eType:'morning',
                    plat:{baemin:'morningBaemin',coupang:'morningCoupang',yogiyo:'morningYogiyo',ddangyeo:'morningDdangyeo'} })
                  if (hasMid) rows.push({ id:'middle', label:'미들', color:TYPE_COLORS.middle, v:midRec, eType:'middle',
                    plat:{baemin:'middleBaemin',coupang:'middleCoupang',yogiyo:'middleYogiyo',ddangyeo:'middleDdangyeo'} })
                  if ((hasM||hasMid) && hasT) {
                    rows.push({ id:'afternoon', label: isNeg ? '오후 (오전+미들이 더 큼)' : '오후', auto:true, color: isNeg ? T.red : T.blue, v:afternoon })
                    rows.push({ id:'total', label:'하루 합계', color:T.ink, v:tRec, eType:'close', strong:true,
                      plat:{baemin:'baemin',coupang:'coupang',yogiyo:'yogiyo',ddangyeo:'ddangyeo'} })
                  } else if (hasM||hasMid) {
                    rows.push({ id:'warn', label:'마감 미입력', color:T.red, v:null })
                  } else if (hasT) {
                    rows.push({ id:'total', label:'마감', color:T.ink, v:tRec, eType:'close', strong:true,
                      plat:{baemin:'baemin',coupang:'coupang',yogiyo:'yogiyo',ddangyeo:'ddangyeo'} })
                  }
                  return rows.map((row, ri) => {
                    const last = ri === rows.length-1
                    const v = row.v
                    const sum = v ? v.kiosk+v.del+v.pos : null
                    return (
                      <tr key={`${dd}-${row.id}`}>
                        {ri === 0 && dayCell(rows.length)}
                        <td style={td(last, { textAlign:'left', color:row.color, fontWeight: row.strong ? 700 : 600, fontSize:12 })}>
                          {row.label}{row.auto && !isNeg && <span style={{fontSize:11, color:T.faint, marginLeft:4, fontWeight:400}}>자동</span>}
                        </td>
                        {showChannelDetail && <>
                          <td style={td(last, { color: v && v.kiosk<0 ? T.red : undefined })}>{v ? wonCell(v.kiosk) : '—'}</td>
                          <td style={td(last, { color: v && v.del<0 ? T.red : undefined })}>
                            {v ? wonCell(v.del) : '—'}
                            {row.plat && platLines(row.plat)}
                          </td>
                          <td style={td(last, { color: v && v.pos<0 ? T.red : undefined })}>{v ? wonCell(v.pos) : '—'}</td>
                        </>}
                        <td style={td(last, { fontWeight: row.strong ? 800 : 500, color: row.strong ? T.ink : row.color })}>{sum !== null ? won(sum) : '—'}</td>
                        {isOwner && (
                          <td style={td(last)}>
                            {row.eType && <>{smallBtn('수정', ()=>startEdit(dd,row.eType))}{smallBtn('삭제', ()=>delRow(dd,row.eType), true)}</>}
                          </td>
                        )}
                      </tr>
                    )
                  })
                })}
              </tbody>
              <tfoot>
                <tr style={{fontWeight:800}}>
                  {(() => { const tf = { padding:'10px 12px', borderTop:`3px double ${T.ink}`, textAlign:'right', whiteSpace:'nowrap' }; return (<>
                    <td colSpan={isNewMonth?2:1} style={{...tf, textAlign:'left'}}>합계</td>
                    {showChannelDetail && <>
                      <td style={tf}>{wonCell(tot.kiosk)}</td>
                      <td style={tf}>{wonCell(tot.del)}</td>
                      <td style={tf}>{wonCell(tot.pos)}</td>
                    </>}
                    <td style={{...tf, color:T.accent}}>{won(grand)}</td>
                    {isOwner && <td style={tf}></td>}
                  </>) })()}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
