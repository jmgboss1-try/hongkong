import { useEffect, useState } from 'react'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Button } from '@astryxdesign/core/Button'
import { TextInput } from '@astryxdesign/core/TextInput'
import { Selector } from '@astryxdesign/core/Selector'
import { Divider } from '@astryxdesign/core/Divider'
import { Table } from '@astryxdesign/core/Table'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { Grid } from '@astryxdesign/core/Grid'
import { Banner } from '@astryxdesign/core/Banner'
import { AstryxPage, PageHeader, MonthNav, LedgerCard, Ledger, LedgerRow } from '../astryx/AstryxPage'
import CountUp from '../components/CountUp'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useAuth } from '../AuthContext'
import RevenuePace from '../components/RevenuePace'
import { monthLabels, monthScheme, mixedLabel, isAfterCut, chLabels, ETC_HINT, HALL_HINT } from '../lib/revenueChannels'

const pad = n => String(n).padStart(2,'0')
const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const wonCell = n => (n != null && n !== 0) ? n.toLocaleString('ko-KR') : '—'
const DAYS = ['일','월','화','수','목','금','토']
const SPLIT_FROM = '2025-05'

const DELIVERY_PLATFORMS = [
  { key:'baemin',   label:'배달의민족', color:'#2E7D45' },
  { key:'coupang',  label:'쿠팡이츠',   color:'#B42318' },
  { key:'yogiyo',   label:'요기요',     color:'var(--hk-accent)' },
  { key:'ddangyeo', label:'땡겨요',     color:'#2B5C9E' },
]

// 세션별 접두어 매핑 (close는 접두어 없음)
// early = 얼리 영업 (9:00~10:30, 사장님만 적음). 오전처럼 그 시각까지 쌓인 금액. 오전·마감은 9시부터 쌓인 금액이라 얼리를 포함
const PREFIX = { early:'early', morning:'morning', middle:'middle', close:'' }
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
  const hasEarlyData = (dd) => {
    const r = data[dd]; if(!r) return false
    const e = getSession(r, 'early')
    return e.kiosk+e.del+e.pos > 0
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
    type === 'early'   ? hasEarlyData(dd) :
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
          ? `${+targetDay}일 ${targetType==='early'?'얼리':targetType==='morning'?'오전':targetType==='middle'?'미들타임':'마감'}`
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
      ? `${+dd}일 ${type==='early'?'얼리':type==='morning'?'오전':type==='middle'?'미들타임':'마감'}`
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
      const m = getMorning(existing), mid = getMiddle(existing), t = getTotal(existing), e = getSession(existing, 'early')
      if(m.kiosk+m.del+m.pos+mid.kiosk+mid.del+mid.pos+t.kiosk+t.del+t.pos+e.kiosk+e.del+e.pos === 0) delete newData[dd]
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
  // 매출 구분 이름 (11월 9일부터 홀·배달·기타). 섞인 달은 장부에서 바뀌기 전/후를 따로 보여 줌
  const CH = monthLabels(curMonth), mixedMonth = monthScheme(curMonth) === 'mixed'
  const totCut = Object.entries(data).reduce((a,[dd,r]) => {
    if (!/^\d\d$/.test(dd)) return a
    const t = getTotal(r), side = isAfterCut(curMonth, dd) ? 'after' : 'before'
    a[side].kiosk += t.kiosk; a[side].pos += t.pos; return a
  }, { before:{kiosk:0,pos:0}, after:{kiosk:0,pos:0} })
  const inCH = chLabels(`${curMonth}-${String(editDay||day).padStart(2,'0')}`)

  const activeDays = Object.keys(data).filter(dd => {
    const r = data[dd]
    const m = getMorning(r), mid = getMiddle(r), t = getTotal(r), e = getSession(r, 'early')
    return m.kiosk+m.del+m.pos+mid.kiosk+mid.del+mid.pos+t.kiosk+t.del+t.pos+e.kiosk+e.del+e.pos > 0
  }).sort()

  const activeType = editDay ? editType : inputType
  const TYPE_COLORS = { early:'#B45309', morning:'var(--hk-accent)', middle:'#6B4FA0', close:'#2B5C9E' }

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
  const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', soft:'#ECE8E1', accent:'var(--hk-accent)',
    red:'#B42318', green:'#2E7D45', blue:'#2B5C9E', purple:'#6B4FA0' }
  const won = n => (n||0).toLocaleString('ko-KR')
  // 이 달 요약: 배달앱별 합계(마감 기준), 영업일, 하루 평균, 최고 매출일
  const platTot = DELIVERY_PLATFORMS.map(p => ({ ...p, sum: activeDays.reduce((a,dd)=>a+(data[dd]?.[p.key]||0),0) }))
  const dayTotals = activeDays.map(dd => { const t = getTotal(data[dd]); return { dd, sum: t.kiosk+t.del+t.pos } }).filter(x=>x.sum>0)
  const best = dayTotals.reduce((a,x)=> !a || x.sum > a.sum ? x : a, null)
  const avg = dayTotals.length ? Math.round(grand / dayTotals.length) : 0
  const yest = (()=>{ const y=new Date(); y.setDate(y.getDate()-1); return pad(y.getDate()) })()
  const typeLabel = t => t==='early' ? '얼리' : t==='morning' ? '오전' : t==='middle' ? '미들타임' : '마감'

  // 금액 입력 (쉼표 찍어 보여주고 숫자만 받음)
  const moneyIn = (label, val, set) => (
    <TextInput label={label} value={val === '' || val == null ? '' : (+val).toLocaleString('ko-KR')} onChange={v => set(v.replace(/[^0-9]/g, ''))} inputMode="numeric" placeholder="0"/>
  )
  // Astryx 장부 줄 (금액이 굴러가며 바뀜)
  const row = (label, value, o = {}) => <LedgerRow key={o.key || label} label={label} value={value} note={o.note} sub={o.sub} strong={o.strong} text={o.text}/>

  return (
    <AstryxPage>
    <VStack gap={5} maxWidth={1100}>
      <PageHeader title={`${mLabel(curMonth)} 매출`} right={<MonthNav value={curMonth} options={monthOpts} onChange={setCurMonth} label={mLabel}/>}/>

      {/* 이 달 요약 */}
      {!loading && (
        <Grid columns={{ minWidth: 340, max: 2, repeat: 'fit' }} gap={4}>
          <LedgerCard title="채널별 매출">
            <Ledger rows={<>
              {mixedMonth
                ? <>{row(mixedLabel('kiosk', false), totCut.before.kiosk)}{row(mixedLabel('kiosk', true), totCut.after.kiosk)}</>
                : row(CH.kiosk, tot.kiosk, { note: grand ? `${Math.round(tot.kiosk/grand*100)}%` : undefined })}
              {row('배달', tot.del, { note: grand ? `${Math.round(tot.del/grand*100)}%` : undefined })}
              {platTot.filter(p=>p.sum>0).map(p=>row(p.label, p.sum, { sub:true, key:p.key }))}
              {mixedMonth
                ? <>{row(mixedLabel('pos', false), totCut.before.pos)}{row(mixedLabel('pos', true), totCut.after.pos)}</>
                : row(CH.pos, tot.pos, { note: grand ? `${Math.round(tot.pos/grand*100)}%` : undefined })}
            </>} total={row('매출 합계', grand, { strong:true })}/>
          </LedgerCard>
          <LedgerCard title="한눈에">
            <Ledger rows={<>
              {row('마감 입력한 날', 0, { text:`${dayTotals.length}일` })}
              {row('하루 평균', avg)}
              {best && row('가장 많이 판 날', best.sum, { note:`${+best.dd}일 (${getDow(curMonth,best.dd)})` })}
            </>}/>
            {isNewMonth && activeDays.some(dd=>(hasMorningData(dd)||hasMiddleData(dd)) && !hasTotalData(dd)) && (
              <Banner status="warning" title="마감이 빠진 날"
                description={activeDays.filter(dd=>(hasMorningData(dd)||hasMiddleData(dd)) && !hasTotalData(dd)).map(dd=>`${+dd}일`).join(', ')}/>
            )}
          </LedgerCard>
        </Grid>
      )}

      {/* 지난달 같은 기간과 비교 */}
      {!loading && <RevenuePace ym={curMonth}/>}

      {/* 매출 입력 (사장만) */}
      {isOwner && (
        <LedgerCard title={editDay ? `${+editDay}일 (${getDow(curMonth,editDay)}) ${typeLabel(editType)} 고치는 중` : '매출 입력'}
          right={editDay ? <Button size="sm" label="취소" onClick={cancelEdit}/> : isNewMonth && (
            <SegmentedControl label="입력할 때" size="sm" value={inputType} onChange={setInputType}>
              <SegmentedControlItem value="early" label="얼리"/>
              <SegmentedControlItem value="morning" label="오전"/>
              <SegmentedControlItem value="middle" label="미들타임"/>
              <SegmentedControlItem value="close" label="마감"/>
            </SegmentedControl>)}>
          <VStack gap={3} maxWidth={560}>
            {!editDay && (
              <HStack gap={2} vAlign="end" wrap="wrap">
                {isThisMonth && <>
                  <Button size="sm" variant={day===pad(now.getDate()) ? 'primary' : 'secondary'} label={`오늘 (${now.getDate()}일)`} onClick={()=>setDay(pad(now.getDate()))}/>
                  <Button size="sm" variant={day===yest ? 'primary' : 'secondary'} label={`어제 (${+yest}일)`} onClick={()=>setDay(yest)}/>
                </>}
                <Selector label="날짜" isLabelHidden size="sm" value={day} onChange={v => v && setDay(v)}
                  options={Array.from({length:days},(_,i)=>{
                    const dd = pad(i+1)
                    const dup = isNewMonth ? isDuplicateNew(dd, inputType) : isDuplicateOld(dd)
                    return { value: dd, label: `${i+1}일 (${getDow(curMonth,dd)})${dup ? ' · 입력됨' : ''}` }
                  })}/>
              </HStack>
            )}
            {!editDay && isNewMonth && inputType==='close' && <Text type="supporting" color="secondary">오후는 마감 − 오전 − 미들로 자동 계산돼요</Text>}
            {!editDay && isNewMonth && inputType==='early' && <Text type="supporting" color="secondary">9:00~10:30 매출 (10시 30분에 POS에 쌓인 금액). 오전·마감은 지금처럼 9시부터 쌓인 금액으로 적어요</Text>}
            {activeType === 'middle' && <Banner status="info" title="POS·키오스크에 찍힌 누적 금액 그대로 적으세요" description="오전 매출을 빼서 미들타임 매출만 저장돼요."/>}

            {moneyIn(inCH.kiosk === '홀' ? `홀 (${HALL_HINT})` : '키오스크', kiosk, setKiosk)}
            {!showDelDetail ? moneyIn('배달', del, setDel) : <>
              <Heading level={5}>배달 (앱별)</Heading>
              {moneyIn('배달의민족', baemin, setBaemin)}
              {moneyIn('쿠팡이츠', coupang, setCoupang)}
              {moneyIn('요기요', yogiyo, setYogiyo)}
              {moneyIn('땡겨요', ddangyeo, setDdangyeo)}
              <LedgerRow label="배달 합계" value={delTotal} sub/>
            </>}
            <Button variant="ghost" size="sm" label={showDelDetail ? '배달을 합계 하나로 입력' : '배달을 앱별로 입력'} onClick={()=>setShowDelDetail(v=>!v)}/>
            {moneyIn(inCH.pos === '기타' ? `기타 (${ETC_HINT})` : '포스·현장', pos, setPos)}
            <Divider variant="strong"/>
            {isMiddleActive
              ? <LedgerRow label="미들타임 매출 (저장될 값)" value={pureMiddlePreview} strong/>
              : <LedgerRow label={`${+(editDay||day)}일 ${isNewMonth ? typeLabel(activeType) : ''} 합계`} value={(+kiosk||0)+(showDelDetail?delTotal:(+del||0))+(+pos||0)} strong/>}
            <Button variant="primary" label={saving ? '저장 중...' : editDay ? '고친 내용 저장' : '저장'} isLoading={saving} onClick={save}/>
          </VStack>
        </LedgerCard>
      )}

      {/* 일별 매출 내역 (하루에 여러 줄: 얼리·오전·미들·오후·하루 합계) */}
      <LedgerCard title="일별 매출 내역" right={
        <SegmentedControl label="보기" size="sm" value={showChannelDetail ? 'ch' : 'sum'} onChange={v => setShowChannelDetail(v === 'ch')}>
          <SegmentedControlItem value="ch" label="채널별"/>
          <SegmentedControlItem value="sum" label="합계만"/>
        </SegmentedControl>}>
        {loading ? <Text color="secondary">불러오는 중...</Text> : activeDays.length === 0 ? <EmptyState title="입력된 매출이 없어요" isCompact/> : (() => {
          // 표에 넣을 줄 만들기: 날짜는 그날 첫 줄에만
          const lines = []
          for (const dd of activeDays) {
            const r = data[dd]
            const pv = (keys, k) => typeof keys[k] === 'number' ? keys[k] : (r[keys[k]]||0)
            const plats = keys => keys ? DELIVERY_PLATFORMS.filter(p=>pv(keys,p.key)!==0).map(p => ({ label:p.label, v:pv(keys,p.key) })) : []
            const rows = []
            if (!isNewMonth) {
              const t = getTotal(r)
              rows.push({ id:'close', label:'마감', v:t, eType:'close', strong:true, plat:plats({ baemin:'baemin', coupang:'coupang', yogiyo:'yogiyo', ddangyeo:'ddangyeo' }) })
            } else {
              const afternoon = getAfternoon(r)
              const mRec = getMorning(r), midRec = getMiddle(r), tRec = getTotal(r)
              const hasM = hasMorningData(dd), hasMid = hasMiddleData(dd), hasT = hasTotalData(dd), hasE = hasEarlyData(dd)
              const isNeg = afternoon && (afternoon.kiosk<0||afternoon.del<0||afternoon.pos<0)
              const totalRow = label => ({ id:'total', label, v:tRec, eType:'close', strong:true, plat:plats({baemin:'baemin',coupang:'coupang',yogiyo:'yogiyo',ddangyeo:'ddangyeo'}) })
              if (hasE) rows.push({ id:'early', label:'얼리 9~10:30', v:getSession(r, 'early'), eType:'early', plat:plats({baemin:'earlyBaemin',coupang:'earlyCoupang',yogiyo:'earlyYogiyo',ddangyeo:'earlyDdangyeo'}) })
              // 오전은 9시부터 쌓인 금액으로 저장돼 있어서, 얼리가 있으면 얼리를 뺀 10:30 이후 금액만 보여 줌 (저장값은 그대로)
              if (hasM) {
                const eRec = hasE ? getSession(r, 'early') : null
                const net = (k, e) => (r[k]||0) - (hasE ? (r[e]||0) : 0)
                rows.push({ id:'morning', label: hasE ? '오전 10:30~' : '오전', eType:'morning',
                  v: eRec ? { kiosk:mRec.kiosk-eRec.kiosk, del:mRec.del-eRec.del, pos:mRec.pos-eRec.pos } : mRec,
                  plat:plats({ baemin:net('morningBaemin','earlyBaemin'), coupang:net('morningCoupang','earlyCoupang'), yogiyo:net('morningYogiyo','earlyYogiyo'), ddangyeo:net('morningDdangyeo','earlyDdangyeo') }) })
              }
              if (hasMid) rows.push({ id:'middle', label:'미들', v:midRec, eType:'middle', plat:plats({baemin:'middleBaemin',coupang:'middleCoupang',yogiyo:'middleYogiyo',ddangyeo:'middleDdangyeo'}) })
              if ((hasM||hasMid) && hasT) {
                rows.push({ id:'afternoon', label: isNeg ? '오후 (오전+미들이 더 큼)' : '오후 · 자동', v:afternoon, bad:isNeg })
                rows.push(totalRow('하루 합계'))
              } else if (hasM||hasMid||hasE) {
                if (hasE && hasT) rows.push(totalRow('하루 합계'))
                else rows.push({ id:'warn', label:'마감 미입력', v:null, bad:true })
              } else if (hasT) rows.push(totalRow('마감'))
            }
            rows.forEach((row, ri) => lines.push({ ...row, key:`${dd}-${row.id}`, dd, first: ri === 0 }))
          }
          lines.push({ key:'sum', id:'sum', label:'합계', v:tot, strong:true, grand:true, first:true })
          const amt = (v, k) => v ? <Text hasTabularNumbers color={v[k] < 0 ? 'accent' : 'primary'}>{wonCell(v[k])}</Text> : <Text color="secondary">—</Text>
          return (
            <Table data={lines} idKey="key" density="compact" columns={[
              { key:'d', header:'날짜', renderCell: l => l.grand ? <Text weight="bold">이 달</Text> : l.first ? <Text weight="bold" color={getDow(curMonth,l.dd)==='일' ? 'accent' : 'primary'}>{+l.dd}일 ({getDow(curMonth,l.dd)})</Text> : null },
              ...(isNewMonth ? [{ key:'t', header:'구분', renderCell: l => <Text weight={l.strong ? 'bold' : 'semibold'} color={l.bad ? 'accent' : l.strong ? 'primary' : 'secondary'}>{l.label}</Text> }] : []),
              ...(showChannelDetail ? [
                { key:'k', header:CH.kiosk, align:'end', renderCell: l => amt(l.v, 'kiosk') },
                { key:'del', header:'배달', align:'end', renderCell: l => <VStack gap={0} hAlign="end">{amt(l.v, 'del')}{(l.plat||[]).map(p => <Text key={p.label} type="supporting" color="secondary" hasTabularNumbers>{p.label} {won(p.v)}</Text>)}</VStack> },
                { key:'p', header:CH.pos, align:'end', renderCell: l => amt(l.v, 'pos') },
              ] : []),
              { key:'sum', header:'합계', align:'end', renderCell: l => l.v ? <Text weight={l.strong ? 'bold' : 'normal'} color={l.grand || l.bad ? 'accent' : 'primary'} hasTabularNumbers>{l.grand ? won(grand) : won(l.v.kiosk+l.v.del+l.v.pos)}</Text> : <Text color="secondary">—</Text> },
              ...(isOwner ? [{ key:'act', header:'', align:'end', renderCell: l => l.eType && (
                <HStack gap={1} hAlign="end">
                  <Button size="sm" variant="ghost" label="수정" onClick={()=>startEdit(l.dd, l.eType)}/>
                  <Button size="sm" variant="ghost" label="삭제" onClick={()=>delRow(l.dd, l.eType)}/>
                </HStack>) }] : []),
            ]}/>
          )
        })()}
      </LedgerCard>
    </VStack>
    </AstryxPage>
  )
}
