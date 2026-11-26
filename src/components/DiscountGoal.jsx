import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts'
import { VStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Badge } from '@astryxdesign/core/Badge'
import { HStack } from '@astryxdesign/core/Layout'
import { Divider } from '@astryxdesign/core/Divider'
import { Table } from '@astryxdesign/core/Table'
import { List, ListItem } from '@astryxdesign/core/List'
import { AstryxPage, LedgerCard } from '../astryx/AstryxPage'
import { discountGoal, goalMonths, isGoalEvent, loadSalesEvents, loadSalesMonths, OPEN_END, todayStr } from '../lib/salesStats'

// 할인 목표 (건당 할인 일정): 매출분석의 카드(GoalCard)와 대시보드 한 줄(GoalLine)
const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', soft:'#ECE8E1', accent:'var(--hk-accent)', green:'#2E7D45', red:'#B42318' }
const won = n => n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('ko-KR')
const one = n => n == null || !isFinite(n) ? '—' : (Math.round(n * 10) / 10).toLocaleString('ko-KR')
const md = s => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`
const period = ev => `${md(ev.from)}~${!ev.to || ev.to === OPEN_END ? '계속' : md(ev.to)}`
const appNames = g => g.apps.map(p => p.short).join('·')

// 한 줄 결론
function verdict(g) {
  const t = g.total
  if (g.noBase) return { text:'할인 전 4주에 주문 건수 기록이 없어서 목표를 못 정해요', color:T.sub }
  if (g.rows.some(r => r.impossible)) return { text:'할인이 주문 하나 이익보다 커서 아무리 팔아도 손해예요', color:T.red }
  if (!g.started) return { text:`${md(g.startDate)}부터 하루 ${one(t.need)}건은 받아야 본전이에요 (할인 전 ${one(t.base)}건 → +${one(t.need - t.base)}건)`, color:T.ink }
  if (t.actual == null) return { text:`하루 ${one(t.need)}건이 목표예요 · 아직 시작 뒤 주문 건수 기록이 없어요`, color:T.ink }
  const gap = t.actual - t.need
  return gap >= 0
    ? { text:`목표 하루 ${one(t.need)}건 · 시작 뒤 평균 ${one(t.actual)}건으로 본전을 넘었어요 (+${one(gap)}건)`, color:T.green }
    : { text:`목표 하루 ${one(t.need)}건 · 시작 뒤 평균 ${one(t.actual)}건, 하루 ${one(-gap)}건 모자라요`, color:T.red }
}

export function GoalCard({ months, ev, loading }) {
  if (loading) return null
  const g = { ...discountGoal(months, ev), startDate: ev.from }
  const v = verdict(g)
  const chart = g.daily.map(x => ({ label: md(x.date), orders: x.orders }))
  const rows = [...g.rows, { key:'_t', label:'합계', base:g.total.base, need:g.total.need, actual:g.total.actual, last7:g.total.last7, total:true }]
  return (
    <VStack gap={2}>
      <Divider/>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Text weight="bold">{ev.title}</Text>
        <Text type="supporting" color="secondary">{appNames(g)} · 건당 {won(g.d)}원 · 이익률 {g.margin}% · {period(ev)}{g.ended ? ' (끝남)' : !g.started ? ' (시작 전)' : ''}</Text>
      </HStack>
      <HStack gap={2} vAlign="center" wrap="wrap">
        {v.color === T.green ? <Badge variant="success" label="본전 넘음"/> : v.color === T.red ? <Badge variant="error" label="모자라요"/> : null}
        <Text type="large" weight="bold">{v.text}</Text>
      </HStack>

      {!g.noBase && (
        <HStack isScrollable>
          <Table data={rows} idKey="key" density="compact"
            columns={[
              { key:'label', header:'앱', renderCell: r => <Text weight={r.total ? 'bold' : undefined}>{r.label}</Text> },
              { key:'base', header:'할인 전 하루', align:'end', renderCell: r => <Text hasTabularNumbers>{one(r.base)}건</Text> },
              { key:'aov', header:'할인 전 객단가', align:'end', renderCell: r => <Text hasTabularNumbers>{r.total ? '' : `${won(r.baseAov)}원`}</Text> },
              { key:'need', header:'목표 하루', align:'end', renderCell: r => <Text weight="bold" color="accent" hasTabularNumbers>{r.impossible ? '손해' : `${one(r.need)}건`}</Text> },
              ...(g.started ? [
                { key:'actual', header:'시작 뒤 평균', align:'end', renderCell: r => <Text hasTabularNumbers>{one(r.actual)}건</Text> },
                { key:'last7', header:'최근 7일', align:'end', renderCell: r => <Text hasTabularNumbers>{one(r.last7)}건</Text> },
                { key:'pct', header:'달성', align:'end', renderCell: r => { const pct = r.need && r.actual != null ? r.actual / r.need * 100 : null
                  return pct == null ? <Text color="secondary">—</Text> : <Badge variant={pct >= 100 ? 'success' : 'error'} label={`${Math.round(pct)}%`}/> } },
              ] : []),
            ]}/>
        </HStack>
      )}

      {g.started && chart.some(x => x.orders != null) && <>
        <Text type="supporting" color="secondary">날마다 주문 (점선 = 목표 {one(g.total.need)}건, 진한 막대 = 목표 넘은 날) · {g.total.days}일 중 {g.total.hit}일 달성</Text>
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={chart} margin={{ top:6, right:6, left:0, bottom:0 }}>
            <XAxis dataKey="label" tick={{ fontSize:10, fill:'var(--color-text-secondary)' }} tickLine={false} axisLine={{ stroke:'var(--color-border)' }} interval="preserveStartEnd"/>
            <YAxis tick={{ fontSize:10, fill:'var(--color-text-secondary)' }} width={28} tickLine={false} axisLine={false}/>
            <Tooltip formatter={val => [`${val}건`, '주문']}/>
            <ReferenceLine y={g.total.need} stroke="var(--color-accent)" strokeDasharray="4 3"/>
            <Bar dataKey="orders" isAnimationActive={false} radius={[2,2,0,0]}>
              {chart.map((x, i) => <Cell key={i} fill={x.orders != null && x.orders >= g.total.need ? 'var(--color-accent)' : 'var(--hk-chart-bar)'}/>)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </>}
      {g.started && g.total.actualProfit != null && (
        <Text type="supporting" color="secondary" hasTabularNumbers>
          하루 이익 추정: 할인 전 {won(g.total.baseProfit)}원 → 할인 뒤 {won(g.total.actualProfit)}원{' '}
          <Text weight="bold" color={g.total.actualProfit >= g.total.baseProfit ? 'primary' : 'accent'}>({g.total.actualProfit >= g.total.baseProfit ? '+' : '−'}{won(Math.abs(g.total.actualProfit - g.total.baseProfit))}원)</Text>
        </Text>
      )}
      <Text type="supporting" color="secondary">목표 = 할인 전 4주({md(g.baseFrom)}~{md(g.baseTo)}) 하루 이익을 할인 뒤에도 내는 주문 수. 객단가는 할인 전 그대로 두고, 할인은 가게가 다 낸다고 봐요.</Text>
    </VStack>
  )
}

// 대시보드: 진행 중이거나 곧 시작하는 건당 할인을 한 줄씩 (사장님 화면)
export function GoalLine() {
  const [state, setState] = useState(null)   // { events, months }
  useEffect(() => {
    let alive = true
    const today = todayStr()
    loadSalesEvents().then(list => {
      const evs = list.filter(e => isGoalEvent(e, today))
      if (!evs.length) { if (alive) setState({ events: [], months: {} }); return }
      const ids = [...new Set(evs.flatMap(e => goalMonths(e, today)))]
      return loadSalesMonths(ids).then(months => { if (alive) setState({ events: evs, months }) })
    }).catch(e => console.error(e))
    return () => { alive = false }
  }, [])
  if (!state?.events.length) return null
  return (
    <AstryxPage>
      <LedgerCard title="할인 목표" right={<Link to="/sales-analysis"><Text type="supporting" color="accent">매출분석에서 자세히</Text></Link>}>
        <List hasDividers edge="flush">
          {state.events.map(ev => {
            const g = { ...discountGoal(state.months, ev), startDate: ev.from }
            const v = verdict(g)
            return (
              <ListItem key={ev.id} align="start"
                label={<Text type="supporting" color="secondary">{ev.title} · {appNames(g)} 건당 {won(g.d)}원 · {period(ev)}</Text>}
                description={<VStack gap={1}>
                  <Text weight="bold" hasTabularNumbers>{v.text}</Text>
                  {g.started && !g.noBase && (
                    <Text type="supporting" color="secondary" hasTabularNumbers>
                      어제 {g.total.yesterday != null ? `${g.total.yesterday}건` : '기록 없음'} · 최근 7일 평균 {one(g.total.last7)}건 · {g.total.days}일 중 {g.total.hit}일 달성
                    </Text>
                  )}
                </VStack>}
                endContent={v.color === T.green ? <Badge variant="success" label="본전 넘음"/> : v.color === T.red ? <Badge variant="error" label="모자라요"/> : null}/>
            )
          })}
        </List>
      </LedgerCard>
    </AstryxPage>
  )
}
