import { useEffect, useMemo, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea, CartesianGrid } from 'recharts'
import { readDeliveryExcel, pickSalesField, SALES_FIELDS } from '../lib/deliveryImport'

// 매출분석 — 배달앱별 하루 주문수·매출·객단가, 할인·이벤트 기간과 그 전 기간 비교
//
// 데이터: revenue/{YYYY-MM}[dd] 의 마감 값 (baemin·coupang·yogiyo·ddangyeo = 하루 매출,
//         baeminOrders… = 마감 때 적은 주문 건수)
// 배달앱 엑셀: revenue/_apps-{YYYY-MM} → { [앱]: { [dd]: { orders, sales, discount, payout, … } } } — 있으면 그날 그 앱은 이 값을 우선
// 이벤트: revenue/_salesEvents → { list: [{ id, title, kind, platforms:[], from, to, memo }] }
//         (매장 계정도 revenue 문서는 쓸 수 있어서 같은 컬렉션에 둠. revenue를 통째로 읽는 코드는 '_'로 시작하는 문서를 건너뛸 것)

const PLATFORMS = [
  { key:'baemin',   label:'배달의민족', short:'배민',   color:'#34d399' },
  { key:'coupang',  label:'쿠팡이츠',   short:'쿠팡',   color:'#f87171' },
  { key:'yogiyo',   label:'요기요',     short:'요기요', color:'#f9b934' },
  { key:'ddangyeo', label:'땡겨요',     short:'땡겨요', color:'#93c5fd' },
]
const KINDS = [
  { key:'discount', label:'할인' },
  { key:'event',    label:'이벤트' },
  { key:'season',   label:'학사일정·시즌' },
  { key:'other',    label:'기타' },
]
const METRICS = [
  { key:'orders', label:'주문수', unit:'건' },
  { key:'sales',  label:'매출',   unit:'원' },
  { key:'aov',    label:'객단가', unit:'원' },
]
const EVENTS_DOC = ['revenue', '_salesEvents']
const DAYS_KR = ['일','월','화','수','목','금','토']

const pad = n => String(n).padStart(2,'0')
const fmtDate = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`
const parseDate = s => new Date(`${s}T00:00:00Z`)
const addDays = (s, n) => { const d = parseDate(s); d.setUTCDate(d.getUTCDate()+n); return fmtDate(d) }
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000)
const dateRange = (from, to) => { const out = []; for (let d = from; d <= to; d = addDays(d, 1)) out.push(d); return out }
const weekday = s => parseDate(s).getUTCDay()
const shortDate = s => `${+s.slice(5,7)}/${+s.slice(8,10)}`
const won = n => n == null ? '—' : Math.round(n).toLocaleString('ko-KR')
const todayStr = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}` }
const monthsOf = (from, to) => { const out = new Set(); for (let d = from; d <= to; d = addDays(d, 1)) out.add(d.slice(0,7)); return [...out] }
const newId = () => `${Date.now()}`

// 하루·앱 하나의 값. 배달앱 엑셀로 넣은 날은 그 값(가게 부담 할인·정산금액 포함),
// 아니면 마감 매출과 마감 때 적은 주문 건수
function dayValue(months, date, p) {
  const m = months[date.slice(0,7)], dd = date.slice(8,10)
  const x = m?.apps?.[p]?.[dd]
  const rec = m?.rev?.[dd]
  const entered = rec && typeof rec[`${p}Orders`] === 'number' ? rec[`${p}Orders`] : null
  // 배민 정산명세서처럼 엑셀에 주문 건수가 없으면 마감 때 적은 건수를 씀
  if (x) return { sales:x.sales, orders: x.orders ?? entered, discount:x.discount ?? null, payout:x.payout ?? null, ads:x.ads ?? null, excel:true }
  if (!rec) return { sales:null, orders:null, discount:null, payout:null, ads:null }
  const sales = typeof rec[p] === 'number' ? rec[p] : null
  const orders = typeof rec[`${p}Orders`] === 'number' ? rec[`${p}Orders`] : null
  return { sales, orders, discount:null, payout:null, ads:null }
}

// 여러 날의 평균. 주문수·객단가는 주문 건수를 적은 날만, 매출은 매출이 있는 날만 셈
function stats(months, dates, p) {
  let salesN = 0, salesSum = 0, ordN = 0, ordSum = 0, ordSales = 0, discN = 0, discSum = 0, adsN = 0, adsSum = 0
  for (const d of dates) {
    const v = dayValue(months, d, p)
    if (v.sales != null) { salesN++; salesSum += v.sales }
    if (v.orders != null) { ordN++; ordSum += v.orders; ordSales += v.sales || 0 }
    if (v.discount != null) { discN++; discSum += v.discount }
    if (v.ads != null) { adsN++; adsSum += v.ads }
  }
  return {
    salesN, ordN, ordSum, salesSum, discN, discSum,
    discountPerDay: discN ? discSum / discN : null,
    adsN, adsPerDay: adsN ? adsSum / adsN : null,
    salesPerDay: salesN ? salesSum / salesN : null,
    ordersPerDay: ordN ? ordSum / ordN : null,
    aov: ordSum ? ordSales / ordSum : null,
  }
}

// 이벤트 비교 기간: 이벤트 기간(오늘까지), 바로 전 같은 길이, 4주 전까지 같은 요일
function comparePeriods(ev) {
  const to = ev.to < todayStr() ? ev.to : todayStr()
  if (to < ev.from) return null
  const during = dateRange(ev.from, to)
  const len = during.length
  const before = dateRange(addDays(ev.from, -len), addDays(ev.from, -1))
  const sameWeekday = [...new Set(during.flatMap(d => [7,14,21,28].map(w => addDays(d, -w))))]
    .filter(d => d < ev.from).sort()
  return { during, before, sameWeekday, to }
}

const pct = (a, b) => (a == null || b == null || b === 0) ? null : (a - b) / b * 100

const card = { background:'#12141f', border:'1px solid #272a3d', borderRadius:12, padding:16 }
const input = { background:'#191c2b', border:'1px solid #272a3d', borderRadius:7, color:'#dde1f2', padding:'7px 10px',
  fontSize:12, outline:'none', fontFamily:'inherit', boxSizing:'border-box' }
const chip = on => ({ padding:'6px 12px', borderRadius:6, border:'none', fontSize:11, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
  background: on ? '#f9b934' : '#191c2b', color: on ? '#000' : '#8b92b0', outline: on ? 'none' : '1px solid #272a3d' })

function Change({ value }) {
  if (value == null) return <span style={{color:'#5e6585'}}>—</span>
  if (Math.abs(value) < 0.5) return <span style={{color:'#8b92b0',fontFamily:'DM Mono,monospace'}}>0%</span>
  const up = value >= 0
  return (
    <span style={{color: up ? '#34d399' : '#f87171', fontWeight:700, fontFamily:'DM Mono,monospace'}}>
      {up ? '▲' : '▼'} {Math.abs(value).toFixed(0)}%
    </span>
  )
}

function ChartTooltip({ active, payload, metric }) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return (
    <div style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,padding:'8px 10px',fontSize:11,lineHeight:1.7,color:'#dde1f2'}}>
      <div style={{fontWeight:700}}>{shortDate(r.date)} ({DAYS_KR[weekday(r.date)]})</div>
      <div style={{color: metric==='orders' ? '#dde1f2' : '#8b92b0'}}>주문 {r.orders == null ? '기록 없음' : `${r.orders}건`}</div>
      <div style={{color: metric==='sales' ? '#dde1f2' : '#8b92b0'}}>매출 {r.sales == null ? '—' : `${won(r.sales)}원`}</div>
      <div style={{color: metric==='aov' ? '#dde1f2' : '#8b92b0'}}>객단가 {r.aov == null ? '—' : `${won(r.aov)}원`}</div>
      {r.discount != null && <div style={{color:'#8b92b0'}}>가게 부담 할인 {won(r.discount)}원</div>}
      {r.ads != null && r.ads > 0 && <div style={{color:'#8b92b0'}}>광고비 {won(r.ads)}원</div>}
      {r.excel && <div style={{color:'#5e6585',fontSize:10}}>배달앱 엑셀 기준</div>}
      {r.events.length > 0 && <div style={{color:'#f9b934',marginTop:2}}>{r.events.join(', ')}</div>}
    </div>
  )
}

function emptyForm() {
  const t = todayStr()
  return { id:null, title:'', kind:'discount', platforms:[], from:t, to:t, memo:'' }
}

export default function SalesAnalysis() {
  const [range, setRange]   = useState(()=>({ from: addDays(todayStr(), -29), to: todayStr(), preset:'30' }))
  const [metric, setMetric] = useState('orders')
  const [months, setMonths] = useState({})       // { 'YYYY-MM': { rev: revenue 문서, apps: 배달앱 엑셀 문서 } }
  const [imp, setImp]       = useState(null)     // 엑셀 불러오기: { busy } | { error } | { result, field, match, entered } | { done }
  const [loading, setLoading] = useState(true)
  const [events, setEvents] = useState([])
  const [eventsErr, setEventsErr] = useState('')
  const [form, setForm]     = useState(null)     // 이벤트 추가/수정 폼
  const [saving, setSaving] = useState(false)
  const [selId, setSelId]   = useState(null)     // 효과를 볼 이벤트
  const [showTable, setShowTable] = useState(false)

  const selEvent = events.find(e => e.id === selId) || null
  const periods = useMemo(() => selEvent ? comparePeriods(selEvent) : null, [selEvent])

  // 필요한 달: 보는 기간 + 고른 이벤트의 비교 기간(4주 전까지)
  const neededMonths = useMemo(() => {
    const set = new Set(monthsOf(range.from, range.to))
    if (periods) monthsOf(periods.sameWeekday[0] || periods.before[0], periods.to).forEach(m => set.add(m))
    return [...set].sort()
  }, [range.from, range.to, periods])

  useEffect(() => {
    const missing = neededMonths.filter(m => !(m in months))
    if (!missing.length) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    const read = id => getDoc(doc(db,'revenue',id)).then(s => s.exists() ? s.data() : {})
    Promise.all(missing.map(m => Promise.all([read(m), read(`_apps-${m}`).catch(() => ({}))]).then(([rev, apps]) => [m, { rev, apps }])))
      .then(list => { if (!cancelled) setMonths(prev => ({ ...prev, ...Object.fromEntries(list) })) })
      .catch(e => console.error(e))
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [neededMonths, months])

  async function loadEvents() {
    try {
      const s = await getDoc(doc(db, ...EVENTS_DOC))
      setEvents(s.exists() ? (s.data().list || []) : [])
      setEventsErr('')
    } catch (e) { console.error(e); setEventsErr('이벤트 일정을 불러오지 못했어요') }
  }
  useEffect(() => { loadEvents() }, [])

  async function writeEvents(change) {
    setSaving(true)
    try {
      const s = await getDoc(doc(db, ...EVENTS_DOC))       // 다른 기기에서 바꿨을 수 있으니 저장 직전에 다시 읽음
      const list = change(s.exists() ? (s.data().list || []) : [])
        .sort((a,b) => b.from.localeCompare(a.from))
      await setDoc(doc(db, ...EVENTS_DOC), { list })
      setEvents(list)
      setEventsErr('')
      return true
    } catch (e) {
      console.error(e)
      setEventsErr(e?.code === 'permission-denied' ? '저장 권한이 없어요 (Firebase 보안 규칙 확인 필요)' : '저장하지 못했어요. 다시 시도해 주세요')
      return false
    } finally { setSaving(false) }
  }

  async function saveForm() {
    if (!form.title.trim()) return alert('제목을 적어주세요')
    if (!form.from || !form.to || form.to < form.from) return alert('기간을 확인해 주세요')
    const ev = { ...form, title: form.title.trim(), memo: form.memo.trim(), id: form.id || newId() }
    const ok = await writeEvents(list => [...list.filter(e => e.id !== ev.id), ev])
    if (ok) { setForm(null); setSelId(ev.id) }
  }

  async function removeEvent(ev) {
    if (!window.confirm(`'${ev.title}' 일정을 삭제할까요?`)) return
    if (await writeEvents(list => list.filter(e => e.id !== ev.id)) && selId === ev.id) setSelId(null)
  }

  async function onExcel(file, password) {
    if (!file) return
    setImp({ busy:true, decrypting: !!password })
    try {
      const result = await readDeliveryExcel(file, password)
      const dates = Object.keys(result.days).sort()
      if (!dates.length) throw new Error('엑셀에 주문이 없어요')
      // 그 기간에 매출입력에서 적은 같은 앱 매출 (어느 금액 칸이 같은 기준인지 맞춰보려고)
      const entered = {}
      for (const ym of monthsOf(dates[0], dates[dates.length-1])) {
        const s = await getDoc(doc(db,'revenue',ym))
        const rev = s.exists() ? s.data() : {}
        for (const d of dates) if (d.startsWith(ym) && typeof rev[d.slice(8,10)]?.[result.platform] === 'number') entered[d] = rev[d.slice(8,10)][result.platform]
      }
      const match = pickSalesField(result.days, entered)
      setImp({ result, dates, entered, match, field: match.key })
    } catch (e) {
      console.error(e)
      // 비밀번호가 걸린 파일(배민 정산명세서 등): 비밀번호를 받아 다시 읽음. 비밀번호는 저장하지 않음
      if (e.code === 'NEED_PASSWORD' || /비밀번호가 맞지/.test(e.message)) setImp({ needPw:true, file, pw:'', error: e.code === 'NEED_PASSWORD' ? '' : e.message })
      else setImp({ error: e.message || '엑셀을 읽지 못했어요' })
    }
  }

  async function saveExcel() {
    const { result, dates, field } = imp
    setImp(v => ({ ...v, saving:true }))
    try {
      for (const ym of monthsOf(dates[0], dates[dates.length-1])) {
        const ref = doc(db,'revenue',`_apps-${ym}`)
        const s = await getDoc(ref)                       // 저장 직전에 다시 읽고 이 앱의 해당 날짜만 바꿈
        const cur = s.exists() ? s.data() : {}
        const days = { ...(cur[result.platform] || {}) }
        for (const d of dates) if (d.startsWith(ym)) days[d.slice(8,10)] = { ...result.days[d], sales: result.days[d][field] }
        await setDoc(ref, { ...cur, [result.platform]: days, [`${result.platform}SalesField`]: field })
      }
      setMonths(prev => { const n = { ...prev }; monthsOf(dates[0], dates[dates.length-1]).forEach(m => delete n[m]); return n })
      setImp({ done: `${result.label} ${shortDate(dates[0])}~${shortDate(dates[dates.length-1])} ${dates.length}일치를 넣었어요` })
    } catch (e) {
      console.error(e)
      setImp(v => ({ ...v, saving:false, saveError: e?.code === 'permission-denied' ? '저장 권한이 없어요 (Firebase 보안 규칙 확인 필요)' : '저장하지 못했어요. 다시 시도해 주세요' }))
    }
  }

  function setPreset(p) {
    const t = todayStr()
    if (p === '30') setRange({ from: addDays(t, -29), to: t, preset:p })
    else if (p === '90') setRange({ from: addDays(t, -89), to: t, preset:p })
    else if (p === 'month') setRange({ from: `${t.slice(0,7)}-01`, to: t, preset:p })
    else if (p === 'last') {
      const first = `${t.slice(0,7)}-01`
      const lastEnd = addDays(first, -1)
      setRange({ from: `${lastEnd.slice(0,7)}-01`, to: lastEnd, preset:p })
    }
  }

  const rangeDates = useMemo(() => dateRange(range.from, range.to), [range.from, range.to])
  const eventsFor = p => events.filter(e => !e.platforms?.length || e.platforms.includes(p))

  const chartData = p => rangeDates.map(date => {
    const v = dayValue(months, date, p)
    return { date, ...v, aov: v.orders ? (v.sales || 0) / v.orders : null,
      events: eventsFor(p).filter(e => e.from <= date && date <= e.to).map(e => e.title) }
  })

  const anyOrders = rangeDates.some(d => PLATFORMS.some(p => dayValue(months, d, p.key).orders != null))

  return (
    <div style={{maxWidth:1200}}>
      <div style={{marginBottom:18}}>
        <div style={{fontSize:20,fontWeight:700}}>🎯 매출분석</div>
        <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>배달앱별 주문수·매출·객단가와 할인·이벤트 효과</div>
      </div>

      {/* 기간 · 지표 */}
      <div style={{display:'flex',flexWrap:'wrap',gap:8,alignItems:'center',marginBottom:14}}>
        {[['30','최근 30일'],['90','최근 90일'],['month','이번 달'],['last','지난 달']].map(([k,l])=>(
          <button key={k} type="button" onClick={()=>setPreset(k)} style={chip(range.preset===k)}>{l}</button>
        ))}
        <input type="date" value={range.from} max={range.to} onChange={e=>e.target.value && setRange(r=>({ ...r, from:e.target.value, preset:'' }))} style={input} aria-label="시작일"/>
        <span style={{color:'#5e6585',fontSize:12}}>~</span>
        <input type="date" value={range.to} min={range.from} onChange={e=>e.target.value && setRange(r=>({ ...r, to:e.target.value, preset:'' }))} style={input} aria-label="종료일"/>
        <div style={{flex:1}}/>
        <div style={{display:'flex',gap:4}}>
          {METRICS.map(m => <button key={m.key} type="button" onClick={()=>setMetric(m.key)} style={chip(metric===m.key)}>{m.label}</button>)}
        </div>
      </div>

      {!loading && !anyOrders && (
        <div style={{...card,marginBottom:14,borderColor:'rgba(249,185,52,0.35)',fontSize:12,color:'#dde1f2',lineHeight:1.7}}>
          이 기간엔 주문 건수 기록이 없어요. 매출입력의 <b>마감</b>에서 앱별 주문 건수를 적으면 여기 쌓여요.
          매출은 그대로 볼 수 있고, 예전 주문수는 배달앱 엑셀을 올리는 기능으로 채울 예정이에요.
        </div>
      )}

      {/* 앱별 요약 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))',gap:12,marginBottom:14}}>
        {PLATFORMS.map(p => {
          const s = stats(months, rangeDates, p.key)
          return (
            <div key={p.key} style={{...card,borderTop:`3px solid ${p.color}`}}>
              <div style={{fontSize:13,fontWeight:700,marginBottom:10}}>{p.label}</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                <div>
                  <div style={{fontSize:10,color:'#5e6585'}}>하루 평균 주문</div>
                  <div style={{fontSize:18,fontWeight:700,fontFamily:'DM Mono,monospace'}}>
                    {s.ordersPerDay == null ? '—' : s.ordersPerDay.toFixed(1)}<span style={{fontSize:11,color:'#5e6585'}}> 건</span>
                  </div>
                </div>
                <div>
                  <div style={{fontSize:10,color:'#5e6585'}}>객단가</div>
                  <div style={{fontSize:18,fontWeight:700,fontFamily:'DM Mono,monospace'}}>
                    {won(s.aov)}<span style={{fontSize:11,color:'#5e6585'}}> 원</span>
                  </div>
                </div>
                <div>
                  <div style={{fontSize:10,color:'#5e6585'}}>하루 평균 매출</div>
                  <div style={{fontSize:13,fontWeight:600,fontFamily:'DM Mono,monospace'}}>{won(s.salesPerDay)}원</div>
                </div>
                <div>
                  <div style={{fontSize:10,color:'#5e6585'}}>기간 합계</div>
                  <div style={{fontSize:13,fontWeight:600,fontFamily:'DM Mono,monospace'}}>{s.ordN ? `${s.ordSum}건` : '—'}</div>
                </div>
              </div>
              {s.discN > 0 && (
                <div style={{fontSize:11,color:'#8b92b0',marginTop:8}}>
                  가게 부담 할인 하루 평균 <b style={{color:'#dde1f2',fontFamily:'DM Mono,monospace'}}>{won(s.discountPerDay)}원</b>
                  <span style={{color:'#5e6585'}}> (엑셀 {s.discN}일)</span>
                </div>
              )}
              {s.adsN > 0 && (
                <div style={{fontSize:11,color:'#8b92b0',marginTop:2}}>
                  광고비 하루 평균 <b style={{color:'#dde1f2',fontFamily:'DM Mono,monospace'}}>{won(s.adsPerDay)}원</b>
                </div>
              )}
              <div style={{fontSize:10,color:'#5e6585',marginTop:8}}>
                매출 {s.salesN}일 · 주문수 {s.ordN}일 기록
              </div>
            </div>
          )
        })}
      </div>

      {/* 앱별 일일 그래프 (앱마다 따로) */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,460px),1fr))',gap:12,marginBottom:8}}>
        {PLATFORMS.map(p => {
          const data = chartData(p.key)
          const evs = eventsFor(p.key).filter(e => e.to >= range.from && e.from <= range.to)
          return (
            <div key={p.key} style={card}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:6}}>
                <span style={{fontSize:12,fontWeight:700}}>{p.label} · 하루 {METRICS.find(m=>m.key===metric).label}</span>
                {evs.length > 0 && <span style={{fontSize:10,color:'#8b92b0'}}>옅은 노란 칸 = 할인·이벤트 기간</span>}
              </div>
              <div style={{height:180}}>
                {loading ? <div style={{color:'#5e6585',fontSize:12,padding:60,textAlign:'center'}}>불러오는 중...</div> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{top:6,right:4,left:-14,bottom:0}} barCategoryGap={2}>
                      <CartesianGrid vertical={false} stroke="#1d2030"/>
                      <XAxis dataKey="date" tickFormatter={shortDate} tick={{fill:'#5e6585',fontSize:10}} axisLine={{stroke:'#272a3d'}} tickLine={false} minTickGap={18}/>
                      <YAxis tick={{fill:'#5e6585',fontSize:10}} axisLine={false} tickLine={false} width={metric==='orders' ? 36 : 56}
                        tickFormatter={v => metric==='orders' ? v : v >= 10000 ? `${Math.round(v/10000)}만` : v}/>
                      {evs.map(e => (
                        <ReferenceArea key={e.id} x1={e.from < range.from ? range.from : e.from} x2={e.to > range.to ? range.to : e.to}
                          fill="#f9b934" fillOpacity={0.08} stroke="none" ifOverflow="hidden"/>
                      ))}
                      <Tooltip content={<ChartTooltip metric={metric}/>} cursor={{fill:'rgba(255,255,255,0.04)'}}/>
                      <Bar dataKey={metric} fill={p.color} radius={[4,4,0,0]} maxBarSize={18} isAnimationActive={false}/>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <button type="button" onClick={()=>setShowTable(v=>!v)}
        style={{background:'transparent',border:'none',color:'#93c5fd',fontSize:11,cursor:'pointer',fontFamily:'inherit',padding:'4px 0',marginBottom:14}}>
        {showTable ? '▾ 날짜별 표 접기' : '▸ 날짜별 표로 보기'}
      </button>
      {showTable && (
        <div style={{...card,overflowX:'auto',marginBottom:14,padding:0}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:11,minWidth:640}}>
            <thead>
              <tr style={{color:'#5e6585',textAlign:'right'}}>
                <th style={{textAlign:'left',padding:'8px 12px',fontWeight:600}}>날짜</th>
                {PLATFORMS.map(p => <th key={p.key} style={{padding:'8px 12px',fontWeight:600}}>{p.short} 주문 / 매출</th>)}
              </tr>
            </thead>
            <tbody>
              {[...rangeDates].reverse().map(d => (
                <tr key={d} style={{borderTop:'1px solid #1d2030',textAlign:'right',fontFamily:'DM Mono,monospace'}}>
                  <td style={{textAlign:'left',padding:'6px 12px',color:'#8b92b0',fontFamily:'inherit'}}>{shortDate(d)} ({DAYS_KR[weekday(d)]})</td>
                  {PLATFORMS.map(p => { const v = dayValue(months, d, p.key); return (
                    <td key={p.key} style={{padding:'6px 12px'}}>
                      {v.orders == null ? '—' : `${v.orders}건`} <span style={{color:'#5e6585'}}>/ {won(v.sales)}</span>
                    </td>
                  )})}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 배달앱 엑셀로 예전 자료 넣기 */}
      <div style={{...card,marginBottom:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:14,fontWeight:700}}>📥 배달앱 엑셀로 예전 자료 넣기</div>
            <div style={{fontSize:11,color:'#5e6585',marginTop:2}}>사장님 사이트에서 받은 주문·매출내역 엑셀 (쿠팡이츠 매출내역, 배민 정산명세서). 같은 날짜는 엑셀 값으로 덮어써요</div>
          </div>
          <label style={{background:'#191c2b',border:'1px solid #272a3d',color:'#dde1f2',borderRadius:8,padding:'8px 14px',fontSize:12,fontWeight:600,
            cursor: imp?.busy ? 'default' : 'pointer'}}>
            {imp?.busy ? (imp.decrypting ? '비밀번호 푸는 중... (10초쯤)' : '읽는 중...') : '엑셀 파일 고르기'}
            <input type="file" accept=".xlsx,.xls,.csv" disabled={!!imp?.busy} style={{display:'none'}}
              onChange={e=>{ onExcel(e.target.files?.[0]); e.target.value='' }}/>
          </label>
        </div>
        {imp?.needPw && (
          <form onSubmit={e=>{ e.preventDefault(); if (imp.pw) onExcel(imp.file, imp.pw) }}
            style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:12,background:'#191c2b',borderRadius:10,padding:12}}>
            <span style={{fontSize:12}}>🔒 비밀번호가 걸린 파일이에요</span>
            <input type="password" value={imp.pw} autoFocus onChange={e=>{ const pw = e.target.value; setImp(v=>({ ...v, pw })) }}
              placeholder="파일 비밀번호" aria-label="파일 비밀번호" style={{...input,width:150,background:'#12141f'}}/>
            <button type="submit" disabled={!imp.pw}
              style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'7px 14px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>열기</button>
            <button type="button" onClick={()=>setImp(null)}
              style={{background:'transparent',border:'1px solid #272a3d',color:'#8b92b0',borderRadius:8,padding:'7px 12px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>취소</button>
            <span style={{width:'100%',fontSize:10,color:'#5e6585'}}>비밀번호는 이 화면에서 파일을 여는 데만 쓰고 어디에도 저장하지 않아요</span>
          </form>
        )}
        {imp?.error && <div style={{fontSize:12,color:'#f87171',marginTop:10}}>⚠️ {imp.error}</div>}
        {imp?.done && <div style={{fontSize:12,color:'#34d399',marginTop:10}}>✅ {imp.done}</div>}
        {imp?.result && (()=>{
          const { result, dates, entered, match, field } = imp
          const tot = dates.reduce((a,d)=>{ const v = result.days[d]; return { o:a.o+(v.orders||0), s:a.s+(v[field]||0), disc:a.disc+(v.discount||0), out:a.out+(v.payout||0), ads:a.ads+(v.ads||0) } }, { o:0, s:0, disc:0, out:0, ads:0 })
          const hasOrders = dates.some(d => result.days[d].orders != null)
          const unpaid = dates.filter(d => result.days[d].payout == null).length
          const fields = SALES_FIELDS.filter(f => dates.some(d => result.days[d][f.key] != null))
          const nEntered = Object.keys(entered).length
          const diff = nEntered ? dates.filter(d => entered[d] != null).reduce((a,d) => a + Math.abs(result.days[d][field] - entered[d]), 0) : null
          return (
            <div style={{background:'#191c2b',borderRadius:10,padding:14,marginTop:12,fontSize:12,lineHeight:1.8}}>
              <div style={{fontWeight:700}}>{result.label} · {dates[0]} ~ {dates[dates.length-1]} ({dates.length}일)</div>
              <div style={{color:'#8b92b0'}}>
                {hasOrders ? <>주문 <b style={{color:'#dde1f2'}}>{tot.o}건</b> · </> : null}매출 <b style={{color:'#dde1f2'}}>{won(tot.s)}원</b>
                {' · '}가게 부담 할인 <b style={{color:'#dde1f2'}}>{won(tot.disc)}원</b>
                {tot.ads > 0 && <> · 광고비 <b style={{color:'#dde1f2'}}>{won(tot.ads)}원</b></>}
                {' · '}정산(입금)금액 <b style={{color:'#dde1f2'}}>{won(tot.out)}원</b>{unpaid > 0 && <span style={{color:'#5e6585'}}> (아직 입금 전 {unpaid}일 제외)</span>}
              </div>
              {!hasOrders && <div style={{fontSize:11,color:'#f9b934'}}>이 엑셀엔 주문 건수가 없어요. 주문수·객단가는 마감 때 적은 건수로 계산해요</div>}
              <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginTop:6}}>
                <span style={{color:'#8b92b0'}}>매출로 쓸 금액</span>
                {fields.map(f => <button key={f.key} type="button" onClick={()=>setImp(v=>({ ...v, field:f.key }))} style={chip(field===f.key)}>{f.label}</button>)}
              </div>
              <div style={{fontSize:11,color:'#5e6585',marginTop:4}}>
                {nEntered
                  ? <>매출입력에 적힌 {nEntered}일치와 비교하면 <b style={{color:'#dde1f2'}}>{SALES_FIELDS.find(f=>f.key===match.key).label}</b>이 가장 가까워요
                      {field === match.key ? '' : ' (다른 금액을 골랐어요)'} · 지금 고른 금액과 하루 평균 차이 {won(diff / nEntered)}원</>
                  : '이 기간엔 매출입력 기록이 없어서 결제금액(배민 출력물의 총 결제금액과 같은 기준)으로 넣어요'}
              </div>
              {imp.saveError && <div style={{color:'#f87171',marginTop:6}}>⚠️ {imp.saveError}</div>}
              <div style={{display:'flex',gap:8,marginTop:10}}>
                <button type="button" onClick={saveExcel} disabled={imp.saving}
                  style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'8px 18px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                  {imp.saving ? '저장 중...' : '매출분석에 넣기'}
                </button>
                <button type="button" onClick={()=>setImp(null)}
                  style={{background:'transparent',border:'1px solid #272a3d',color:'#8b92b0',borderRadius:8,padding:'8px 14px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
                  취소
                </button>
              </div>
            </div>
          )
        })()}
      </div>

      {/* 할인·이벤트 일정 */}
      <div style={{...card,marginBottom:14}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12,gap:8,flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:14,fontWeight:700}}>🗓 할인·이벤트 일정</div>
            <div style={{fontSize:11,color:'#5e6585',marginTop:2}}>방학·시험기간 같은 시기도 적어두면 비교할 때 도움이 돼요</div>
          </div>
          {!form && (
            <button type="button" onClick={()=>setForm(emptyForm())}
              style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'8px 14px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              + 일정 추가
            </button>
          )}
        </div>
        {eventsErr && <div style={{fontSize:11,color:'#f87171',marginBottom:10}}>⚠️ {eventsErr}</div>}

        {form && (
          <div style={{background:'#191c2b',border:'1px solid #f9b934',borderRadius:10,padding:14,marginBottom:12}}>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:10}}>
              <label style={{gridColumn:'1/-1',fontSize:10,color:'#5e6585'}}>제목
                <input value={form.title} onChange={e=>setForm(f=>({ ...f, title:e.target.value }))} placeholder="예: 배민 3,000원 할인"
                  style={{...input,width:'100%',marginTop:4,background:'#12141f'}}/>
              </label>
              <label style={{fontSize:10,color:'#5e6585'}}>시작일
                <input type="date" value={form.from} onChange={e=>setForm(f=>({ ...f, from:e.target.value, to: f.to < e.target.value ? e.target.value : f.to }))}
                  style={{...input,width:'100%',marginTop:4,background:'#12141f'}}/>
              </label>
              <label style={{fontSize:10,color:'#5e6585'}}>종료일
                <input type="date" value={form.to} min={form.from} onChange={e=>setForm(f=>({ ...f, to:e.target.value }))}
                  style={{...input,width:'100%',marginTop:4,background:'#12141f'}}/>
              </label>
              <div style={{fontSize:10,color:'#5e6585'}}>종류
                <div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:4}}>
                  {KINDS.map(k => <button key={k.key} type="button" onClick={()=>setForm(f=>({ ...f, kind:k.key }))} style={chip(form.kind===k.key)}>{k.label}</button>)}
                </div>
              </div>
              <div style={{gridColumn:'1/-1',fontSize:10,color:'#5e6585'}}>대상 앱 (안 고르면 전체)
                <div style={{display:'flex',gap:4,flexWrap:'wrap',marginTop:4}}>
                  {PLATFORMS.map(p => {
                    const on = form.platforms.includes(p.key)
                    return <button key={p.key} type="button" style={chip(on)}
                      onClick={()=>setForm(f=>({ ...f, platforms: on ? f.platforms.filter(x=>x!==p.key) : [...f.platforms, p.key] }))}>{p.label}</button>
                  })}
                </div>
              </div>
              <label style={{gridColumn:'1/-1',fontSize:10,color:'#5e6585'}}>메모 (선택)
                <textarea value={form.memo} onChange={e=>setForm(f=>({ ...f, memo:e.target.value }))} rows={2}
                  placeholder="예: 최소주문 20,000원, 첫 주문 고객만"
                  style={{...input,width:'100%',marginTop:4,background:'#12141f',resize:'vertical'}}/>
              </label>
            </div>
            <div style={{display:'flex',gap:8,marginTop:12}}>
              <button type="button" onClick={saveForm} disabled={saving}
                style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'8px 18px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                {saving ? '저장 중...' : '저장'}
              </button>
              <button type="button" onClick={()=>setForm(null)}
                style={{background:'transparent',border:'1px solid #272a3d',color:'#8b92b0',borderRadius:8,padding:'8px 14px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
                취소
              </button>
            </div>
          </div>
        )}

        {!events.length && !form && <div style={{fontSize:12,color:'#5e6585',padding:'10px 0'}}>아직 적어둔 일정이 없어요</div>}
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          {events.map(ev => {
            const on = selId === ev.id
            return (
              <div key={ev.id} style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',background:'#191c2b',borderRadius:8,padding:'9px 12px',
                outline: on ? '1px solid #f9b934' : 'none'}}>
                <span style={{fontSize:10,fontWeight:700,padding:'2px 7px',borderRadius:4,background:'rgba(249,185,52,0.12)',color:'#f9b934'}}>
                  {KINDS.find(k=>k.key===ev.kind)?.label || '기타'}
                </span>
                <div style={{flex:1,minWidth:160}}>
                  <div style={{fontSize:12,fontWeight:600}}>{ev.title}</div>
                  <div style={{fontSize:10,color:'#5e6585',marginTop:2}}>
                    {ev.from === ev.to ? ev.from : `${ev.from} ~ ${ev.to}`} ({daysBetween(ev.from, ev.to)+1}일)
                    {' · '}{ev.platforms?.length ? ev.platforms.map(k=>PLATFORMS.find(p=>p.key===k)?.short).join(', ') : '전체 앱'}
                    {ev.memo && ` · ${ev.memo}`}
                  </div>
                </div>
                <button type="button" onClick={()=>setSelId(on ? null : ev.id)} style={chip(on)}>{on ? '효과 닫기' : '효과 보기'}</button>
                <button type="button" onClick={()=>setForm({ ...emptyForm(), ...ev, platforms: ev.platforms || [], memo: ev.memo || '' })}
                  style={{...chip(false),padding:'6px 10px'}}>수정</button>
                <button type="button" onClick={()=>removeEvent(ev)}
                  style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',borderRadius:6,padding:'5px 9px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>삭제</button>
              </div>
            )
          })}
        </div>
      </div>

      {/* 효과 비교 */}
      {selEvent && (
        <div style={{...card,borderColor:'rgba(249,185,52,0.45)'}}>
          <div style={{fontSize:14,fontWeight:700,marginBottom:4}}>📊 '{selEvent.title}' 효과</div>
          {!periods ? (
            <div style={{fontSize:12,color:'#5e6585'}}>아직 시작 전인 일정이에요</div>
          ) : (
            <>
              <div style={{fontSize:11,color:'#5e6585',lineHeight:1.7,marginBottom:12}}>
                이벤트 기간 {shortDate(selEvent.from)}~{shortDate(periods.to)} ({periods.during.length}일)을
                ① 바로 전 {periods.before.length}일 ({shortDate(periods.before[0])}~{shortDate(periods.before[periods.before.length-1])}),
                ② 그 전 4주의 같은 요일 평균과 비교해요. 하루 평균이라 기간 길이가 달라도 비교할 수 있어요.
              </div>
              {loading ? <div style={{color:'#5e6585',fontSize:12}}>불러오는 중...</div> : (()=>{
                // 배달앱 엑셀로 넣은 날이 있으면 가게 부담 할인도 비교
                const allDays = [...periods.during, ...periods.before, ...periods.sameWeekday]
                const hasDisc = PLATFORMS.some(p => stats(months, allDays, p.key).discN > 0)
                const groups = ['하루 주문','하루 매출','객단가', ...(hasDisc ? ['가게 부담 할인(하루)'] : [])]
                return (
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12,minWidth: hasDisc ? 940 : 720}}>
                    <thead>
                      <tr style={{color:'#5e6585',fontSize:10}}>
                        <th style={{textAlign:'left',padding:'6px 8px',fontWeight:600}}>앱</th>
                        {groups.map(h => (
                          <th key={h} colSpan={3} style={{padding:'6px 8px',fontWeight:600,textAlign:'center',borderLeft:'1px solid #272a3d'}}>{h}</th>
                        ))}
                      </tr>
                      <tr style={{color:'#5e6585',fontSize:10,textAlign:'right'}}>
                        <th/>
                        {groups.map((g,i) => [
                          <th key={`a${i}`} style={{padding:'4px 8px',fontWeight:500,borderLeft:'1px solid #272a3d'}}>이벤트</th>,
                          <th key={`b${i}`} style={{padding:'4px 8px',fontWeight:500}}>① 직전</th>,
                          <th key={`c${i}`} style={{padding:'4px 8px',fontWeight:500}}>② 같은 요일</th>,
                        ])}
                      </tr>
                    </thead>
                    <tbody>
                      {[...PLATFORMS].sort((a,b) => {
                        const t = p => !selEvent.platforms?.length || selEvent.platforms.includes(p.key) ? 0 : 1
                        return t(a) - t(b)
                      }).map(p => {
                        const target = !selEvent.platforms?.length || selEvent.platforms.includes(p.key)
                        const E = stats(months, periods.during, p.key)
                        const B = stats(months, periods.before, p.key)
                        const W = stats(months, periods.sameWeekday, p.key)
                        const cell = (val, base, fmt) => (
                          <>
                            <div style={{fontFamily:'DM Mono,monospace'}}>{fmt(base)}</div>
                            <div style={{fontSize:10}}><Change value={pct(val, base)}/></div>
                          </>
                        )
                        const fmtO = v => v == null ? '—' : v.toFixed(1)
                        return (
                          <tr key={p.key} style={{borderTop:'1px solid #1d2030',textAlign:'right',opacity: target ? 1 : 0.7}}>
                            <td style={{textAlign:'left',padding:'8px'}}>
                              <div style={{fontWeight:700,borderLeft:`3px solid ${p.color}`,paddingLeft:6}}>{p.label}</div>
                              <div style={{fontSize:10,color:'#5e6585',paddingLeft:9}}>{target ? '대상' : '비교용 (대상 아님)'}</div>
                            </td>
                            <td style={{padding:'8px',borderLeft:'1px solid #272a3d',fontWeight:700,fontFamily:'DM Mono,monospace'}}>{fmtO(E.ordersPerDay)}</td>
                            <td style={{padding:'8px'}}>{cell(E.ordersPerDay, B.ordersPerDay, fmtO)}</td>
                            <td style={{padding:'8px'}}>{cell(E.ordersPerDay, W.ordersPerDay, fmtO)}</td>
                            <td style={{padding:'8px',borderLeft:'1px solid #272a3d',fontWeight:700,fontFamily:'DM Mono,monospace'}}>{won(E.salesPerDay)}</td>
                            <td style={{padding:'8px'}}>{cell(E.salesPerDay, B.salesPerDay, won)}</td>
                            <td style={{padding:'8px'}}>{cell(E.salesPerDay, W.salesPerDay, won)}</td>
                            <td style={{padding:'8px',borderLeft:'1px solid #272a3d',fontWeight:700,fontFamily:'DM Mono,monospace'}}>{won(E.aov)}</td>
                            <td style={{padding:'8px'}}>{cell(E.aov, B.aov, won)}</td>
                            <td style={{padding:'8px'}}>{cell(E.aov, W.aov, won)}</td>
                            {hasDisc && <>
                              <td style={{padding:'8px',borderLeft:'1px solid #272a3d',fontWeight:700,fontFamily:'DM Mono,monospace'}}>{won(E.discountPerDay)}</td>
                              <td style={{padding:'8px'}}>{cell(E.discountPerDay, B.discountPerDay, won)}</td>
                              <td style={{padding:'8px'}}>{cell(E.discountPerDay, W.discountPerDay, won)}</td>
                            </>}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                )
              })()}
              <div style={{fontSize:10,color:'#5e6585',marginTop:10,lineHeight:1.7}}>
                ▲▼는 이벤트 기간이 비교 기간보다 몇 % 높거나 낮은지예요. 주문수·객단가는 주문 건수를 적은 날만 계산해요.
                할인 대상이 아닌 앱도 같이 올랐다면 할인보다는 날씨·시기 영향일 수 있어요.
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
