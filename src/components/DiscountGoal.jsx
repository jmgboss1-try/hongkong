import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts'
import { VStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Badge } from '@astryxdesign/core/Badge'
import { List, ListItem } from '@astryxdesign/core/List'
import { AstryxPage, LedgerCard } from '../astryx/AstryxPage'
import { discountGoal, goalMonths, isGoalEvent, loadSalesEvents, loadSalesMonths, OPEN_END, todayStr } from '../lib/salesStats'

// 할인 목표 (건당 할인 일정): 매출분석의 카드(GoalCard)와 대시보드 한 줄(GoalLine)
const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', soft:'#ECE8E1', accent:'var(--hk-accent)', green:'#2E7D45', red:'#B42318' }
const num = { fontVariantNumeric:'tabular-nums' }
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
  return (
    <div style={{borderTop:`1px solid ${T.rule}`, padding:'12px 0 4px'}}>
      <div style={{display:'flex', gap:8, alignItems:'baseline', flexWrap:'wrap'}}>
        <b style={{fontSize:14, color:T.ink}}>{ev.title}</b>
        <span style={{fontSize:12, color:T.sub}}>{appNames(g)} · 건당 {won(g.d)}원 · 이익률 {g.margin}% · {period(ev)}{g.ended ? ' (끝남)' : !g.started ? ' (시작 전)' : ''}</span>
      </div>
      <div style={{fontSize:15, fontWeight:800, color:v.color, margin:'6px 0 8px', lineHeight:1.5}}>{v.text}</div>

      {!g.noBase && (
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:560, ...num}}>
            <thead><tr style={{color:T.sub, fontSize:11, textAlign:'right'}}>
              <th style={{textAlign:'left', padding:'4px 6px', fontWeight:500}}>앱</th>
              <th style={{padding:'4px 6px', fontWeight:500}}>할인 전 하루</th>
              <th style={{padding:'4px 6px', fontWeight:500}}>할인 전 객단가</th>
              <th style={{padding:'4px 6px', fontWeight:500}}>목표 하루</th>
              {g.started && <th style={{padding:'4px 6px', fontWeight:500}}>시작 뒤 평균</th>}
              {g.started && <th style={{padding:'4px 6px', fontWeight:500}}>최근 7일</th>}
              {g.started && <th style={{padding:'4px 6px', fontWeight:500}}>달성</th>}
            </tr></thead>
            <tbody>
              {[...g.rows, { key:'_t', label:'합계', color:T.ink, base:g.total.base, need:g.total.need, actual:g.total.actual, last7:g.total.last7, total:true }].map(r => {
                const pct = r.need && r.actual != null ? r.actual / r.need * 100 : null
                return (
                  <tr key={r.key} style={{borderTop: r.total ? `2px solid ${T.ink}` : `1px solid ${T.soft}`, textAlign:'right', fontWeight: r.total ? 700 : 400}}>
                    <td style={{textAlign:'left', padding:'6px'}}><span style={{borderLeft:`3px solid ${r.color}`, paddingLeft:6}}>{r.label}</span></td>
                    <td style={{padding:'6px'}}>{one(r.base)}건</td>
                    <td style={{padding:'6px'}}>{r.total ? '' : `${won(r.baseAov)}원`}</td>
                    <td style={{padding:'6px', color:T.accent, fontWeight:700}}>{r.impossible ? '손해' : `${one(r.need)}건`}</td>
                    {g.started && <td style={{padding:'6px'}}>{one(r.actual)}건</td>}
                    {g.started && <td style={{padding:'6px'}}>{one(r.last7)}건</td>}
                    {g.started && <td style={{padding:'6px', color: pct == null ? T.sub : pct >= 100 ? T.green : T.red}}>{pct == null ? '—' : `${Math.round(pct)}%`}</td>}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {g.started && chart.some(x => x.orders != null) && (
        <>
          <div style={{fontSize:11, color:T.sub, margin:'10px 0 2px'}}>날마다 주문 (점선 = 목표 {one(g.total.need)}건, 초록 = 목표 넘은 날) · {g.total.days}일 중 {g.total.hit}일 달성</div>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={chart} margin={{ top:6, right:6, left:0, bottom:0 }}>
              <XAxis dataKey="label" tick={{ fontSize:10, fill:T.sub }} tickLine={false} axisLine={{ stroke:T.rule }} interval="preserveStartEnd"/>
              <YAxis tick={{ fontSize:10, fill:T.sub }} width={28} tickLine={false} axisLine={false}/>
              <Tooltip formatter={v => [`${v}건`, '주문']} contentStyle={{ fontSize:12, borderRadius:4, border:`1px solid ${T.rule}` }}/>
              <ReferenceLine y={g.total.need} stroke={T.accent} strokeDasharray="4 3"/>
              <Bar dataKey="orders" isAnimationActive={false} radius={[2,2,0,0]}>
                {chart.map((x, i) => <Cell key={i} fill={x.orders != null && x.orders >= g.total.need ? T.green : '#C9C3B8'}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
      {g.started && g.total.actualProfit != null && (
        <div style={{fontSize:12, color:T.sub, marginTop:4}}>
          하루 이익 추정: 할인 전 {won(g.total.baseProfit)}원 → 할인 뒤 {won(g.total.actualProfit)}원
          <b style={{marginLeft:6, color: g.total.actualProfit >= g.total.baseProfit ? T.green : T.red}}>
            ({g.total.actualProfit >= g.total.baseProfit ? '+' : '−'}{won(Math.abs(g.total.actualProfit - g.total.baseProfit))}원)
          </b>
        </div>
      )}
      <div style={{fontSize:11, color:T.sub, marginTop:4}}>
        목표 = 할인 전 4주({md(g.baseFrom)}~{md(g.baseTo)}) 하루 이익을 할인 뒤에도 내는 주문 수. 객단가는 할인 전 그대로 두고, 할인은 가게가 다 낸다고 봐요.
      </div>
    </div>
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
