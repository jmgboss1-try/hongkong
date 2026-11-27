import { useEffect, useMemo, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceArea, ReferenceLine, CartesianGrid, Cell } from 'recharts'
import { readDeliveryExcel, pickSalesField, SALES_FIELDS } from '../lib/deliveryImport'
import DiscountCalc from '../components/DiscountCalc'
import { GoalCard } from '../components/DiscountGoal'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Table } from '@astryxdesign/core/Table'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { TextInput } from '@astryxdesign/core/TextInput'
import { TextArea } from '@astryxdesign/core/TextArea'
import { DateInput } from '@astryxdesign/core/DateInput'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { List, ListItem } from '@astryxdesign/core/List'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { AstryxPage, Legacy, PageHeader, LedgerCard } from '../astryx/AstryxPage'
import { PLATFORMS, EVENTS_DOC, OPEN_END, DEFAULT_MARGIN, DEFAULT_FEE_RATE, discountCost, discountLabel, isGoalEvent, goalMonths, addDays, daysBetween, dateRange, todayStr, monthsOf, dayValue, stats, loadSalesMonths } from '../lib/salesStats'

// 매출분석 — 배달앱별 하루 주문수·매출·객단가, 할인·이벤트 기간과 그 전 기간 비교
//
// 데이터: revenue/{YYYY-MM}[dd] 의 마감 값 (baemin·coupang·yogiyo·ddangyeo = 하루 매출,
//         baeminOrders… = 마감 때 적은 주문 건수)
// 배달앱 엑셀: revenue/_apps-{YYYY-MM} → { [앱]: { [dd]: { orders, sales, discount, payout, … } } } — 있으면 그날 그 앱은 이 값을 우선
// 이벤트: revenue/_salesEvents → { list: [{ id, title, kind, platforms:[], from, to, memo, perOrder?, margin? }] }
//         할인에 건당 할인(perOrder)을 적으면 '할인 목표'로 매일 추적 (lib/salesStats discountGoal, 대시보드에도 한 줄). 끝날 날 미정 = to OPEN_END
//         (매장 계정도 revenue 문서는 쓸 수 있어서 같은 컬렉션에 둠. revenue를 통째로 읽는 코드는 '_'로 시작하는 문서를 건너뛸 것)

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
const DAYS_KR = ['일','월','화','수','목','금','토']

const parseDate = s => new Date(`${s}T00:00:00Z`)
const weekday = s => parseDate(s).getUTCDay()
const shortDate = s => `${+s.slice(5,7)}/${+s.slice(8,10)}`
const won = n => n == null ? '—' : Math.round(n).toLocaleString('ko-KR')
const newId = () => `${Date.now()}`

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

function Change({ value }) {
  if (value == null) return <Text type="supporting" color="secondary">—</Text>
  if (Math.abs(value) < 0.5) return <Text type="supporting" color="secondary" hasTabularNumbers>0%</Text>
  const up = value >= 0
  return <Text type="supporting" weight="bold" color={up ? 'primary' : 'accent'} hasTabularNumbers>{up ? '▲' : '▼'} {Math.abs(value).toFixed(0)}%</Text>
}

function ChartTooltip({ active, payload, metric }) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return (
    <div style={{background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,padding:'8px 10px',fontSize:11,lineHeight:1.7,color:'#1D1B18'}}>
      <div style={{fontWeight:700}}>{shortDate(r.date)} ({DAYS_KR[weekday(r.date)]})</div>
      <div style={{color: metric==='orders' ? '#1D1B18' : '#5F5B54'}}>주문 {r.orders == null ? '기록 없음' : `${r.orders}건`}</div>
      <div style={{color: metric==='sales' ? '#1D1B18' : '#5F5B54'}}>매출 {r.sales == null ? '—' : `${won(r.sales)}원`}</div>
      <div style={{color: metric==='aov' ? '#1D1B18' : '#5F5B54'}}>객단가 {r.aov == null ? '—' : `${won(r.aov)}원`}</div>
      {r.discount != null && <div style={{color:'#5F5B54'}}>가게 부담 할인 {won(r.discount)}원</div>}
      {r.ads != null && r.ads > 0 && <div style={{color:'#5F5B54'}}>광고비 {won(r.ads)}원</div>}
      {r.excel && <div style={{color:'#6E6A63',fontSize:10}}>배달앱 엑셀 기준</div>}
      {r.events.length > 0 && <div style={{color:'var(--hk-accent)',marginTop:2}}>{r.events.join(', ')}</div>}
    </div>
  )
}

// ── 효과 한눈에: '평소'(직전 같은 기간과 4주 같은 요일의 평균)보다 얼마나 더/덜 팔렸나 ──
const avg2 = (a, b) => a == null ? b : b == null ? a : (a + b) / 2
function effectOf(months, periods, ev) {
  const targets = PLATFORMS.filter(p => !ev.platforms?.length || ev.platforms.includes(p.key))
  const others = PLATFORMS.filter(p => !targets.includes(p))
  const sumUp = list => list.reduce((acc, p) => {
    const E = stats(months, periods.during, p.key), B = stats(months, periods.before, p.key), W = stats(months, periods.sameWeekday, p.key)
    const base = avg2(B.salesPerDay, W.salesPerDay), baseOrd = avg2(B.ordersPerDay, W.ordersPerDay), baseDisc = avg2(B.discountPerDay, W.discountPerDay) ?? 0
    const row = { p, ev: E.salesPerDay, base, days: E.salesN,
      extra: E.salesPerDay != null && base != null ? (E.salesPerDay - base) * E.salesN : null,
      extraOrdPerDay: E.ordersPerDay != null && baseOrd != null ? E.ordersPerDay - baseOrd : null,
      extraDisc: E.discountPerDay != null ? (E.discountPerDay - baseDisc) * E.discN : null }
    acc.rows.push(row)
    if (row.extra != null) { acc.extra += row.extra; acc.evDay += E.salesPerDay; acc.baseDay += base; acc.n = Math.max(acc.n, E.salesN) }
    if (row.extraOrdPerDay != null) { acc.ordDay += row.extraOrdPerDay; acc.hasOrd = true }
    if (row.extraDisc != null) { acc.disc += row.extraDisc; acc.hasDisc = true }
    return acc
  }, { rows: [], extra: 0, evDay: 0, baseDay: 0, n: 0, ordDay: 0, hasOrd: false, disc: 0, hasDisc: false })
  const t = sumUp(targets), o = sumUp(others)
  const pctT = t.baseDay ? (t.evDay - t.baseDay) / t.baseDay * 100 : null
  const pctO = o.baseDay ? (o.evDay - o.baseDay) / o.baseDay * 100 : null
  return { targets, t, o, pctT, pctO, has: t.baseDay > 0 && t.n > 0 }
}

function EventEffect({ months, periods, ev }) {
  const R = effectOf(months, periods, ev)
  const days = periods.during.length
  if (!R.has) return <Text color="secondary">비교할 매출 기록이 아직 부족해요. 이벤트 기간과 그 전 기간의 마감 매출(또는 배달앱 엑셀)이 있어야 계산돼요.</Text>
  const { t, pctT, pctO } = R
  const perDay = t.evDay - t.baseDay
  const up = perDay >= 0
  const verdict = pctT >= 10 ? ['효과 있음', 'success'] : pctT <= -10 ? ['덜 팔렸어요', 'error'] : ['평소와 비슷해요', 'warning']
  const sign = n => (n >= 0 ? '+' : '−') + won(Math.abs(n))
  const man = n => { const a = Math.abs(n); return (n >= 0 ? '+' : '−') + (a >= 10000 ? `${(a / 10000).toFixed(a >= 1000000 ? 0 : 1).replace(/\.0$/, '')}만원` : `${won(a)}원`) }
  const net = t.hasDisc ? t.extra - t.disc : null
  const othersAlsoUp = R.o.rows.length > 0 && pctO != null && pctT != null && pctT > 5 && pctO >= pctT * 0.6

  // 날짜별: 이벤트 기간과 바로 전 기간, 대상 앱 합계
  const chartDays = [...periods.before, ...periods.during]
  const data = chartDays.map(d => {
    let sales = null
    for (const p of R.targets) { const v = dayValue(months, d, p.key).sales; if (v != null) sales = (sales || 0) + v }
    return { date: d, label: shortDate(d), sales, during: d >= ev.from }
  })
  const maxBar = Math.max(1, ...t.rows.flatMap(r => [r.ev || 0, r.base || 0]))

  return (
    <VStack gap={4}>
      {/* 결론 */}
      <Card variant="muted" padding={4}>
        <VStack gap={2}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Badge variant={verdict[1]} label={verdict[0]}/>
            <Text type="supporting" color="secondary">{shortDate(ev.from)}~{shortDate(periods.to)} {days}일 · {R.targets.map(p => p.short).join('·')} 기준</Text>
          </HStack>
          <Text type="display-3" color={up ? 'primary' : 'accent'}>평소보다 {man(t.extra)} {up ? '더 팔렸어요' : '덜 팔렸어요'}</Text>
          <Text hasTabularNumbers>하루 평균 {sign(perDay)}원 ({pctT >= 0 ? '+' : ''}{pctT.toFixed(0)}%){t.hasOrd && ` · 주문 하루 ${t.ordDay >= 0 ? '+' : '−'}${Math.abs(t.ordDay).toFixed(1)}건`}</Text>
          {net != null && <Text hasTabularNumbers>가게가 부담한 할인 {t.disc >= 0 ? '평소보다 ' : ''}{won(Math.abs(t.disc))}원 {t.disc >= 0 ? '더 씀' : '덜 씀'} → 할인 빼고 <Text weight="bold" color={net >= 0 ? 'primary' : 'accent'}>{man(net)}</Text></Text>}
          {othersAlsoUp && <Banner status="warning" title={`대상이 아닌 앱도 같은 기간에 ${pctO.toFixed(0)}% 올랐어요.`} description="이벤트보다 날씨·시기 영향이 섞였을 수 있어요."/>}
          <Text type="supporting" color="secondary">평소 = 바로 전 {periods.before.length}일과 4주 전까지 같은 요일의 하루 평균</Text>
        </VStack>
      </Card>

      {/* 앱별 평소 vs 이벤트 */}
      <VStack gap={2}>
        <Text weight="bold">앱별 하루 매출</Text>
        {[...t.rows, ...R.o.rows.map(r => ({ ...r, other: true }))].filter(r => r.ev != null || r.base != null).map(r => {
          const pc = r.ev != null && r.base ? (r.ev - r.base) / r.base * 100 : null
          return (
            <VStack key={r.p.key} gap={1}>
              <HStack hAlign="between" vAlign="center">
                <HStack gap={2} vAlign="center"><Text weight="bold">{r.p.short}</Text>{r.other && <Badge label="비교용"/>}</HStack>
                <Text type="supporting" hasTabularNumbers>{pc == null ? '—' : `${pc >= 0 ? '▲' : '▼'} ${Math.abs(pc).toFixed(0)}%`}</Text>
              </HStack>
              <HStack gap={2} vAlign="center"><ProgressBar label={`${r.p.short} 평소`} isLabelHidden value={r.base || 0} max={maxBar}/><Text type="supporting" color="secondary" hasTabularNumbers textWrap="nowrap">평소 {won(r.base)}</Text></HStack>
              <HStack gap={2} vAlign="center"><ProgressBar label={`${r.p.short} 이벤트`} isLabelHidden value={r.ev || 0} max={maxBar}/><Text type="supporting" hasTabularNumbers textWrap="nowrap">이벤트 {won(r.ev)}</Text></HStack>
            </VStack>
          )
        })}
      </VStack>

      {/* 날짜별: 평소선 위는 진하게 */}
      <VStack gap={1}>
        <Text weight="bold">날짜별 매출 ({R.targets.map(p => p.short).join('·')} 합계)</Text>
        <VStack height={200}>
          <ResponsiveContainer>
            <BarChart data={data} margin={{ top:8, right:8, left:0, bottom:0 }}>
              <CartesianGrid stroke="var(--color-border)" vertical={false}/>
              <XAxis dataKey="label" tick={{ fontSize:10, fill:'var(--color-text-secondary)' }} interval="preserveStartEnd"/>
              <YAxis tick={{ fontSize:10, fill:'var(--color-text-secondary)' }} width={46} tickFormatter={v => v >= 10000 ? `${Math.round(v / 10000)}만` : v}/>
              <ReferenceArea x1={shortDate(ev.from)} x2={shortDate(periods.to)} fill="var(--color-accent)" fillOpacity={0.06}/>
              <ReferenceLine y={t.baseDay} stroke="var(--color-text-secondary)" strokeDasharray="4 4" label={{ value:'평소', position:'insideTopLeft', fontSize:10, fill:'var(--color-text-secondary)' }}/>
              <Tooltip formatter={v => [`${won(v)}원`, '매출']} labelFormatter={(l, pl) => { const d = pl?.[0]?.payload?.date; return d ? `${l} (${DAYS_KR[weekday(d)]})${pl[0].payload.during ? ' · 이벤트' : ''}` : l }}/>
              <Bar dataKey="sales" radius={[2,2,0,0]}>
                {data.map(d => <Cell key={d.date} fill={!d.during ? 'var(--color-background-muted)' : (d.sales ?? 0) >= t.baseDay ? 'var(--color-accent)' : 'var(--hk-chart-bar)'}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </VStack>
        <Text type="supporting" color="secondary">옅은 회색 = 이벤트 전 · 진한 색 = 평소보다 많이 판 날 · 연한 색 = 덜 판 날 · 점선 = 평소</Text>
      </VStack>
    </VStack>
  )
}

function emptyForm() {
  const t = todayStr()
  return { id:null, title:'', kind:'discount', platforms:[], from:t, to:t, memo:'', perOrder:'', margin:'', funding:'store', appShare:'', hqShare:'', feeOn:false, feeRate:'' }
}

export default function SalesAnalysis() {
  const [showDetail, setShowDetail] = useState(false)
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
  const [cmpRange, setCmpRange] = useState(null) // 할인 손익 계산기: 실제로 할인하던 기간 { from, to }

  const selEvent = events.find(e => e.id === selId) || null
  const periods = useMemo(() => selEvent ? comparePeriods(selEvent) : null, [selEvent])

  // 필요한 달: 보는 기간 + 고른 이벤트의 비교 기간(4주 전까지)
  const neededMonths = useMemo(() => {
    const set = new Set(monthsOf(range.from, range.to))
    if (periods) monthsOf(periods.sameWeekday[0] || periods.before[0], periods.to).forEach(m => set.add(m))
    if (cmpRange?.from && cmpRange?.to && cmpRange.from <= cmpRange.to) monthsOf(cmpRange.from, cmpRange.to).forEach(m => set.add(m))
    for (const e of events) if (isGoalEvent(e)) goalMonths(e).forEach(m => set.add(m))
    return [...set].sort()
  }, [range.from, range.to, periods, cmpRange, events])

  useEffect(() => {
    const missing = neededMonths.filter(m => !(m in months))
    if (!missing.length) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    loadSalesMonths(missing)
      .then(got => { if (!cancelled) setMonths(prev => ({ ...prev, ...got })) })
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
    if (form.kind === 'discount' && form.perOrder !== '' && form.perOrder != null && !(+form.perOrder > 0)) return alert('건당 할인 금액을 확인해 주세요')
    if (form.kind === 'discount' && form.funding === 'collab' && (+form.appShare || 0) + (+form.hqShare || 0) > (+form.perOrder || 0)) return alert('배달앱·본사 지원을 합친 금액이 총 할인보다 커요')
    const ev = { ...form, title: form.title.trim(), memo: form.memo.trim(), id: form.id || newId(),
      perOrder: form.kind === 'discount' && +form.perOrder > 0 ? +form.perOrder : null,
      margin: form.kind === 'discount' && +form.perOrder > 0 ? (+form.margin || DEFAULT_MARGIN) : null }
    const isDisc = ev.kind === 'discount' && ev.perOrder
    const collab = isDisc && form.funding === 'collab'
    Object.assign(ev, { funding: collab ? 'collab' : 'store', appShare: collab ? (+form.appShare || 0) : null, hqShare: collab ? (+form.hqShare || 0) : null,
      feeOn: !!(isDisc && form.feeOn), feeRate: isDisc && form.feeOn ? (+form.feeRate || DEFAULT_FEE_RATE) : null })
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
    <AstryxPage>
    <VStack gap={4}>
      <PageHeader title="매출분석" sub="배달앱별 주문수·매출·객단가와 할인·이벤트 효과"/>

      {/* 기간 · 지표 */}
      <HStack gap={2} vAlign="end" hAlign="between" wrap="wrap">
        <HStack gap={2} vAlign="end" wrap="wrap">
          <SegmentedControl label="기간" value={range.preset || 'custom'} onChange={v=>v && v !== 'custom' && setPreset(v)}>
            {[['30','최근 30일'],['90','최근 90일'],['month','이번 달'],['last','지난 달'],['custom','직접']].map(([k,l]) => <SegmentedControlItem key={k} value={k} label={l}/>)}
          </SegmentedControl>
          <DateInput label="시작일" isLabelHidden size="sm" value={range.from} onChange={v=>v && v <= range.to && setRange(r=>({ ...r, from:v, preset:'' }))}/>
          <DateInput label="종료일" isLabelHidden size="sm" value={range.to} onChange={v=>v && v >= range.from && setRange(r=>({ ...r, to:v, preset:'' }))}/>
        </HStack>
        <SegmentedControl label="지표" value={metric} onChange={v=>v && setMetric(v)}>
          {METRICS.map(m => <SegmentedControlItem key={m.key} value={m.key} label={m.label}/>)}
        </SegmentedControl>
      </HStack>

      {!loading && !anyOrders && (
        <Banner status="info" title="이 기간엔 주문 건수 기록이 없어요." description="매출입력의 마감에서 앱별 주문 건수를 적으면 여기 쌓여요. 매출은 그대로 볼 수 있고, 예전 주문수는 아래 배달앱 엑셀로 채울 수 있어요."/>
      )}

      {/* 앱별 요약 */}
      <Grid columns={{ minWidth: 220, max: 4, repeat: 'fit' }} gap={3}>
        {PLATFORMS.map(p => {
          const s = stats(months, rangeDates, p.key)
          return (
            <LedgerCard key={p.key} title={p.label}>
              <Grid columns={2} gap={2}>
                <VStack gap={0}><Text type="supporting" color="secondary">하루 평균 주문</Text><Text type="large" weight="bold" hasTabularNumbers>{s.ordersPerDay == null ? '—' : s.ordersPerDay.toFixed(1)}건</Text></VStack>
                <VStack gap={0}><Text type="supporting" color="secondary">객단가</Text><Text type="large" weight="bold" hasTabularNumbers>{won(s.aov)}원</Text></VStack>
                <VStack gap={0}><Text type="supporting" color="secondary">하루 평균 매출</Text><Text weight="semibold" hasTabularNumbers>{won(s.salesPerDay)}원</Text></VStack>
                <VStack gap={0}><Text type="supporting" color="secondary">기간 합계</Text><Text weight="semibold" hasTabularNumbers>{s.ordN ? `${s.ordSum}건` : '—'}</Text></VStack>
              </Grid>
              {s.discN > 0 && <Text type="supporting" color="secondary" hasTabularNumbers>가게 부담 할인 하루 평균 <Text weight="bold" color="primary">{won(s.discountPerDay)}원</Text> (엑셀 {s.discN}일)</Text>}
              {s.adsN > 0 && <Text type="supporting" color="secondary" hasTabularNumbers>광고비 하루 평균 <Text weight="bold" color="primary">{won(s.adsPerDay)}원</Text></Text>}
              <Text type="supporting" color="secondary">매출 {s.salesN}일 · 주문수 {s.ordN}일 기록</Text>
            </LedgerCard>
          )
        })}
      </Grid>

      {/* 앱별 일일 그래프 */}
      <Grid columns={{ minWidth: 420, max: 2, repeat: 'fit' }} gap={3}>
        {PLATFORMS.map(p => {
          const data = chartData(p.key)
          const evs = eventsFor(p.key).filter(e => e.to >= range.from && e.from <= range.to)
          return (
            <LedgerCard key={p.key} title={`${p.label} · 하루 ${METRICS.find(m=>m.key===metric).label}`} right={evs.length > 0 && <Text type="supporting" color="secondary">옅은 칸 = 할인·이벤트 기간</Text>}>
              <VStack height={180}>
                {loading ? <Text color="secondary">불러오는 중...</Text> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} margin={{top:6,right:4,left:-14,bottom:0}} barCategoryGap={2}>
                      <CartesianGrid vertical={false} stroke="#ECE8E1"/>
                      <XAxis dataKey="date" tickFormatter={shortDate} tick={{fill:'#6E6A63',fontSize:10}} axisLine={{stroke:'#DCD7CE'}} tickLine={false} minTickGap={18}/>
                      <YAxis tick={{fill:'#6E6A63',fontSize:10}} axisLine={false} tickLine={false} width={metric==='orders' ? 36 : 56}
                        tickFormatter={v => metric==='orders' ? v : v >= 10000 ? `${Math.round(v/10000)}만` : v}/>
                      {evs.map(e => (
                        <ReferenceArea key={e.id} x1={e.from < range.from ? range.from : e.from} x2={e.to > range.to ? range.to : e.to}
                          fill="var(--hk-accent)" fillOpacity={0.08} stroke="none" ifOverflow="hidden"/>
                      ))}
                      <Tooltip content={<ChartTooltip metric={metric}/>} cursor={{fill:'rgba(0,0,0,0.04)'}}/>
                      <Bar dataKey={metric} fill={p.color} radius={[4,4,0,0]} maxBarSize={18} isAnimationActive={false}/>
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </VStack>
            </LedgerCard>
          )
        })}
      </Grid>

      <HStack><Button variant="ghost" label={showTable ? '날짜별 표 접기' : '날짜별 표로 보기'} onClick={()=>setShowTable(v=>!v)}/></HStack>
      {showTable && (
        <LedgerCard title="날짜별 주문 / 매출">
          <HStack isScrollable>
            <Table data={[...rangeDates].reverse().map(d => ({ d }))} idKey="d" density="compact"
              columns={[
                { key:'d', header:'날짜', width:90, renderCell: x => <Text type="supporting" color="secondary" textWrap="nowrap">{shortDate(x.d)} ({DAYS_KR[weekday(x.d)]})</Text> },
                ...PLATFORMS.map(p => ({ key:p.key, header:`${p.short} 주문 / 매출`, width:150, align:'end', renderCell: x => { const v = dayValue(months, x.d, p.key); return <Text type="supporting" hasTabularNumbers textWrap="nowrap">{v.orders == null ? '—' : `${v.orders}건`} / {won(v.sales)}</Text> } })),
              ]}/>
          </HStack>
        </LedgerCard>
      )}

      {/* 배달앱 엑셀로 예전 자료 넣기 */}
      <LedgerCard title="배달앱 엑셀로 예전 자료 넣기" right={
        <Legacy>
          <label style={{display:'inline-block'}}>
            <span style={{fontSize:12, marginRight:6}}>{imp?.busy ? (imp.decrypting ? '비밀번호 푸는 중... (10초쯤)' : '읽는 중...') : '엑셀 파일 고르기'}</span>
            <input type="file" accept=".xlsx,.xls,.csv" disabled={!!imp?.busy} onChange={e=>{ onExcel(e.target.files?.[0]); e.target.value='' }}/>
          </label>
        </Legacy>}>
        <Text type="supporting" color="secondary">사장님 사이트에서 받은 주문·매출내역 엑셀 (쿠팡이츠 매출내역, 배민 정산명세서, 요기요 정산내역, 땡겨요 부가세신고내역). 같은 날짜는 엑셀 값으로 덮어써요</Text>
        {imp?.needPw && (
          <form onSubmit={e=>{ e.preventDefault(); if (imp.pw) onExcel(imp.file, imp.pw) }}>
            <Card variant="muted" padding={3}>
              <VStack gap={2}>
                <HStack gap={2} vAlign="end" wrap="wrap">
                  <TextInput type="password" label="비밀번호가 걸린 파일이에요" placeholder="파일 비밀번호" value={imp.pw} onChange={pw=>setImp(v=>({ ...v, pw }))}/>
                  <Button type="submit" variant="primary" label="열기" isDisabled={!imp.pw}/>
                  <Button label="취소" onClick={()=>setImp(null)}/>
                </HStack>
                <Text type="supporting" color="secondary">비밀번호는 이 화면에서 파일을 여는 데만 쓰고 어디에도 저장하지 않아요</Text>
              </VStack>
            </Card>
          </form>
        )}
        {imp?.error && <Banner status="error" title={imp.error}/>}
        {imp?.done && <Banner status="success" title={imp.done}/>}
        {imp?.result && (()=>{
          const { result, dates, entered, match, field } = imp
          const tot = dates.reduce((a,d)=>{ const v = result.days[d]; return { est:(a.est||0)+(v.ordersEstimated||0), o:a.o+(v.orders||0), s:a.s+(v[field]||0), disc:a.disc+(v.discount||0), out:a.out+(v.payout||0), ads:a.ads+(v.ads||0) } }, { o:0, s:0, disc:0, out:0, ads:0 })
          const hasOrders = dates.some(d => result.days[d].orders != null)
          const unpaid = dates.filter(d => result.days[d].payout == null).length
          const fields = SALES_FIELDS.filter(f => dates.some(d => result.days[d][f.key] != null))
          const nEntered = Object.keys(entered).length
          const diff = nEntered ? dates.filter(d => entered[d] != null).reduce((a,d) => a + Math.abs(result.days[d][field] - entered[d]), 0) : null
          return (
            <Card variant="muted" padding={3}>
              <VStack gap={2}>
                <Text weight="bold">{result.label} · {dates[0]} ~ {dates[dates.length-1]} ({dates.length}일)</Text>
                <Text type="supporting" color="secondary" hasTabularNumbers>
                  {hasOrders ? `주문 ${tot.o}건${tot.est > 0 ? ` (그중 포장·가게배달 ${tot.est}건은 금액으로 추정)` : ''} · ` : ''}매출 {won(tot.s)}원 · 가게 부담 할인 {won(tot.disc)}원{tot.ads > 0 ? ` · 광고비 ${won(tot.ads)}원` : ''}
                  {unpaid < dates.length ? ` · 정산(입금)금액 ${won(tot.out)}원${unpaid > 0 ? ` (아직 입금 전 ${unpaid}일 제외)` : ''}` : ' · 이 엑셀엔 정산금액이 없어요'}
                </Text>
                {!hasOrders && <Text type="supporting" color="accent">이 엑셀엔 주문 건수가 없어요. 주문수·객단가는 마감 때 적은 건수로 계산해요</Text>}
                {tot.est > 0 && <Text type="supporting" color="secondary">배민 배달 건수는 건당 배달비로 정확히 세요. 마감 때 건수를 적은 날은 그 건수를 먼저 써요</Text>}
                <HStack gap={2} vAlign="center" wrap="wrap">
                  <Text type="supporting">매출로 쓸 금액</Text>
                  {fields.map(f => <Button key={f.key} size="sm" variant={field===f.key ? 'primary' : 'secondary'} label={f.label} onClick={()=>setImp(v=>({ ...v, field:f.key }))}/>)}
                </HStack>
                <Text type="supporting" color="secondary">
                  {nEntered
                    ? `매출입력에 적힌 ${nEntered}일치와 비교하면 ${SALES_FIELDS.find(f=>f.key===match.key).label}이 가장 가까워요${field === match.key ? '' : ' (다른 금액을 골랐어요)'} · 지금 고른 금액과 하루 평균 차이 ${won(diff / nEntered)}원`
                    : '이 기간엔 매출입력 기록이 없어서 결제금액(배민 출력물의 총 결제금액과 같은 기준)으로 넣어요'}
                </Text>
                {imp.saveError && <Banner status="error" title={imp.saveError}/>}
                <HStack gap={2}>
                  <Button variant="primary" label={imp.saving ? '저장 중...' : '매출분석에 넣기'} isDisabled={imp.saving} onClick={saveExcel}/>
                  <Button label="취소" onClick={()=>setImp(null)}/>
                </HStack>
              </VStack>
            </Card>
          )
        })()}
      </LedgerCard>

      {/* 할인 목표 (건당 할인 일정) */}
      {events.some(e => isGoalEvent(e)) && (
        <LedgerCard title="할인 목표">
          <Text type="supporting" color="secondary">건당 할인을 적은 할인 일정이에요. 할인 전 4주와 같은 이익을 내려면 하루 몇 건이 필요한지, 실제로 얼마나 받고 있는지</Text>
          {events.filter(e => isGoalEvent(e)).map(ev => <GoalCard key={ev.id} months={months} ev={ev} loading={loading}/>)}
        </LedgerCard>
      )}

      {/* 할인 손익 계산기 */}
        <DiscountCalc loading={loading}
          onMakeEvent={(perOrder, margin) => { setForm({ ...emptyForm(), title:`건당 ${perOrder.toLocaleString('ko-KR')}원 할인`, kind:'discount', perOrder:String(perOrder), margin:String(margin), to: OPEN_END });
            setTimeout(() => document.getElementById('sales-events')?.scrollIntoView({ behavior:'smooth' }), 50) }}
          base={PLATFORMS.map(p => ({ ...p, ...stats(months, rangeDates, p.key) }))}
          baseLabel={`${shortDate(range.from)}~${shortDate(range.to)}`}
          cmp={cmpRange?.from && cmpRange?.to && cmpRange.from <= cmpRange.to ? PLATFORMS.map(p => ({ ...p, ...stats(months, dateRange(cmpRange.from, cmpRange.to), p.key) })) : null}
          cmpRange={cmpRange} setCmpRange={setCmpRange}/>

      {/* 할인·이벤트 일정 */}
      <div id="sales-events"/>
      <LedgerCard title="할인·이벤트 일정" right={!form && <Button size="sm" variant="primary" label="+ 일정 추가" onClick={()=>setForm(emptyForm())}/>}>
        <Text type="supporting" color="secondary">방학·시험기간 같은 시기도 적어두면 비교할 때 도움이 돼요</Text>
        {eventsErr && <Banner status="error" title={eventsErr}/>}

        {form && (
          <Card variant="muted" padding={3}>
            <VStack gap={3}>
              <TextInput label="제목" placeholder="예: 배민 3,000원 할인" value={form.title} onChange={v=>setForm(f=>({ ...f, title:v }))}/>
              <HStack gap={2} vAlign="end" wrap="wrap">
                <DateInput label="시작일" value={form.from} onChange={v=>v && setForm(f=>({ ...f, from:v, to: f.to < v ? v : f.to }))}/>
                {form.to === OPEN_END ? <Text color="secondary">종료일: 정하지 않음 (계속)</Text>
                  : <DateInput label="종료일" value={form.to} onChange={v=>v && v >= form.from && setForm(f=>({ ...f, to:v }))}/>}
                <CheckboxInput label="끝나는 날 아직 안 정함" value={form.to === OPEN_END} onChange={v=>setForm(f=>({ ...f, to: v ? OPEN_END : f.from }))}/>
              </HStack>
              <VStack gap={1}><Text type="label">종류</Text>
                <HStack gap={1} wrap="wrap">{KINDS.map(k => <Button key={k.key} size="sm" variant={form.kind===k.key ? 'primary' : 'secondary'} label={k.label} onClick={()=>setForm(f=>({ ...f, kind:k.key }))}/>)}</HStack>
              </VStack>
              <VStack gap={1}><Text type="label">대상 앱 (안 고르면 전체)</Text>
                <HStack gap={1} wrap="wrap">
                  {PLATFORMS.map(p => {
                    const on = form.platforms.includes(p.key)
                    return <Button key={p.key} size="sm" variant={on ? 'primary' : 'secondary'} label={p.label} onClick={()=>setForm(f=>({ ...f, platforms: on ? f.platforms.filter(x=>x!==p.key) : [...f.platforms, p.key] }))}/>
                  })}
                </HStack>
              </VStack>
              {form.kind === 'discount' && (() => {
                const c = discountCost(form), w = n => (+n || 0).toLocaleString('ko-KR')
                return (
                  <Card padding={3}>
                    <VStack gap={3}>
                      <SegmentedControl label="누가 할인을 내나요" value={form.funding || 'store'} onChange={v=>v && setForm(f=>({ ...f, funding:v }))}>
                        <SegmentedControlItem value="store" label="매장 단독 할인"/>
                        <SegmentedControlItem value="collab" label="협업 할인 (배달앱·본사 지원)"/>
                      </SegmentedControl>
                      <HStack gap={2} vAlign="end" wrap="wrap">
                        <TextInput label={form.funding === 'collab' ? '손님이 받는 총 할인 (원)' : '주문 1건당 할인 (원)'} inputMode="numeric" placeholder={form.funding === 'collab' ? '예: 5000' : '예: 1000'} width={180}
                          value={form.perOrder ?? ''} onChange={v=>setForm(f=>({ ...f, perOrder:v.replace(/[^0-9]/g,'') }))}/>
                        {form.funding === 'collab' && <>
                          <TextInput label="배달앱 지원 (원)" inputMode="numeric" placeholder="예: 2000" width={140} value={form.appShare ?? ''} onChange={v=>setForm(f=>({ ...f, appShare:v.replace(/[^0-9]/g,'') }))}/>
                          <TextInput label="본사 지원 (원)" inputMode="numeric" placeholder="예: 1500" width={140} value={form.hqShare ?? ''} onChange={v=>setForm(f=>({ ...f, hqShare:v.replace(/[^0-9]/g,'') }))}/>
                        </>}
                        <TextInput label="이익률 (%)" inputMode="decimal" placeholder={String(DEFAULT_MARGIN)} width={110} value={form.margin ?? ''} onChange={v=>setForm(f=>({ ...f, margin:v.replace(/[^0-9.]/g,'') }))}/>
                      </HStack>
                      <VStack gap={1}>
                        <HStack gap={3} vAlign="end" wrap="wrap">
                          <CheckboxInput label="할인액에도 중개수수료가 붙음" description="배달앱이 할인 전 금액으로 수수료를 매기는 경우 (할인 전체 금액 기준)" value={!!form.feeOn} onChange={v=>setForm(f=>({ ...f, feeOn:v }))}/>
                          {form.feeOn && <TextInput label="중개수수료 (%)" inputMode="decimal" placeholder={String(DEFAULT_FEE_RATE)} width={130} value={form.feeRate ?? ''} onChange={v=>setForm(f=>({ ...f, feeRate:v.replace(/[^0-9.]/g,'') }))}/>}
                        </HStack>
                        {form.feeOn && <Text type="supporting" color="secondary">이익률 20%에 이 수수료 손해를 이미 넣어 두셨다면 여기서는 끄거나, 이익률을 수수료 빼기 전 값으로 적어 주세요 (두 번 빠지지 않게)</Text>}
                      </VStack>
                      {c.total > 0 && (
                        <Text weight="bold" hasTabularNumbers>
                          매장이 실제로 내는 돈: 주문 1건당 {w(c.cost)}원
                          <Text type="inherit" weight="normal" color="secondary">{form.funding === 'collab' ? ` (총 ${w(c.total)} − 배달앱 ${w(form.appShare)} − 본사 ${w(form.hqShare)} = 매장 ${w(c.share)}` : ` (할인 ${w(c.share)}`}{c.fee ? ` + 수수료 ${w(c.fee)}` : ''})</Text>
                        </Text>
                      )}
                      <Text type="supporting" color="secondary">할인 금액을 적으면 할인 전 4주 평균으로 '하루 몇 건 받아야 본전인지' 목표를 정하고, 시작하면 매일 실제 주문과 비교해요 (대시보드에도 나와요). 본전 계산에는 매장이 실제로 내는 돈만 써요.</Text>
                    </VStack>
                  </Card>
                )
              })()}
              <TextArea label="메모" isOptional rows={2} placeholder="예: 최소주문 20,000원, 첫 주문 고객만" value={form.memo} onChange={v=>setForm(f=>({ ...f, memo:v }))}/>
              <HStack gap={2}>
                <Button variant="primary" label={saving ? '저장 중...' : '저장'} isDisabled={saving} onClick={saveForm}/>
                <Button label="취소" onClick={()=>setForm(null)}/>
              </HStack>
            </VStack>
          </Card>
        )}

        {!events.length && !form && <Text color="secondary">아직 적어둔 일정이 없어요</Text>}
        <List hasDividers edge="flush">
          {events.map(ev => {
            const on = selId === ev.id
            return (
              <ListItem key={ev.id} startContent={<Badge label={KINDS.find(k=>k.key===ev.kind)?.label || '기타'}/>}
                label={<Text weight="bold">{ev.title}</Text>}
                description={<Text type="supporting" color="secondary" hasTabularNumbers>
                  {ev.to === OPEN_END ? `${ev.from} ~ 계속` : ev.from === ev.to ? ev.from : `${ev.from} ~ ${ev.to} (${daysBetween(ev.from, ev.to)+1}일)`}
                  {+ev.perOrder > 0 && ` · ${discountLabel(ev)}`}
                  {' · '}{ev.platforms?.length ? ev.platforms.map(k=>PLATFORMS.find(p=>p.key===k)?.short).join(', ') : '전체 앱'}
                  {ev.memo && ` · ${ev.memo}`}
                </Text>}
                endContent={<HStack gap={1}>
                  <Button size="sm" variant={on ? 'primary' : 'secondary'} label={on ? '효과 닫기' : '효과 보기'} onClick={()=>setSelId(on ? null : ev.id)}/>
                  <Button size="sm" variant="ghost" label="수정" onClick={()=>setForm({ ...emptyForm(), ...ev, platforms: ev.platforms || [], memo: ev.memo || '', perOrder: ev.perOrder ?? '', margin: ev.margin ?? '', funding: ev.funding || 'store', appShare: ev.appShare ?? '', hqShare: ev.hqShare ?? '', feeOn: !!ev.feeOn, feeRate: ev.feeRate ?? '' })}/>
                  <Button size="sm" variant="ghost" label="삭제" onClick={()=>removeEvent(ev)}/>
                </HStack>}/>
            )
          })}
        </List>
      </LedgerCard>

      {/* 효과 비교 */}
      {selEvent && (
        <LedgerCard title={`'${selEvent.title}' 효과`}>
          {!periods ? <Text color="secondary">아직 시작 전인 일정이에요</Text> : <>
            {!loading && <EventEffect months={months} periods={periods} ev={selEvent}/>}
            <HStack><Button size="sm" variant="ghost" label={showDetail ? '자세히 접기' : '자세히 보기 (숫자 표)'} onClick={()=>setShowDetail(v=>!v)}/></HStack>
            {showDetail && <>
              <Text type="supporting" color="secondary">
                이벤트 기간 {shortDate(selEvent.from)}~{shortDate(periods.to)} ({periods.during.length}일)을
                ① 바로 전 {periods.before.length}일 ({shortDate(periods.before[0])}~{shortDate(periods.before[periods.before.length-1])}),
                ② 그 전 4주의 같은 요일 평균과 비교해요. 하루 평균이라 기간 길이가 달라도 비교할 수 있어요.
              </Text>
              {loading ? <Text color="secondary">불러오는 중...</Text> : (()=>{
                // 배달앱 엑셀로 넣은 날이 있으면 가게 부담 할인도 비교
                const allDays = [...periods.during, ...periods.before, ...periods.sameWeekday]
                const hasDisc = PLATFORMS.some(p => stats(months, allDays, p.key).discN > 0)
                const fmtO = v => v == null ? '—' : v.toFixed(1)
                const rows = [...PLATFORMS].sort((a,b) => {
                  const t = p => !selEvent.platforms?.length || selEvent.platforms.includes(p.key) ? 0 : 1
                  return t(a) - t(b)
                }).map(p => ({ p, target: !selEvent.platforms?.length || selEvent.platforms.includes(p.key),
                  E: stats(months, periods.during, p.key), B: stats(months, periods.before, p.key), W: stats(months, periods.sameWeekday, p.key) }))
                const metric = (title, key, fmt) => ({ key, header: title, width: 190, renderCell: r => (
                  <VStack gap={0}>
                    <Text weight="bold" hasTabularNumbers>이벤트 {fmt(r.E[key])}</Text>
                    <HStack gap={1} vAlign="center"><Text type="supporting" color="secondary" hasTabularNumbers>① {fmt(r.B[key])}</Text><Change value={pct(r.E[key], r.B[key])}/></HStack>
                    <HStack gap={1} vAlign="center"><Text type="supporting" color="secondary" hasTabularNumbers>② {fmt(r.W[key])}</Text><Change value={pct(r.E[key], r.W[key])}/></HStack>
                  </VStack>) })
                return (
                  <HStack isScrollable>
                    <Table data={rows} idKey={r => r.p.key} density="compact" verticalAlign="top"
                      columns={[
                        { key:'app', header:'앱', width:120, renderCell: r => <VStack gap={0}><Text weight="bold">{r.p.label}</Text><Text type="supporting" color="secondary">{r.target ? '대상' : '비교용 (대상 아님)'}</Text></VStack> },
                        metric('하루 주문', 'ordersPerDay', fmtO),
                        metric('하루 매출', 'salesPerDay', won),
                        metric('객단가', 'aov', won),
                        ...(hasDisc ? [metric('가게 부담 할인(하루)', 'discountPerDay', won)] : []),
                      ]}/>
                  </HStack>
                )
              })()}
              <Text type="supporting" color="secondary">
                ▲▼는 이벤트 기간이 비교 기간보다 몇 % 높거나 낮은지예요. 주문수·객단가는 주문 건수를 적은 날만 계산해요.
                할인 대상이 아닌 앱도 같이 올랐다면 할인보다는 날씨·시기 영향일 수 있어요.
              </Text>
            </>}
          </>}
        </LedgerCard>
      )}
    </VStack>
    </AstryxPage>
  )
}
