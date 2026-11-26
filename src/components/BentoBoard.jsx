// 대시보드 카드형 보드 — Astryx 버전 (도입 0단계: Astryx 로 옮긴 첫 화면)
//  숫자 4칸(첫 칸은 강조색으로 꽉 찬 카드), 날짜별 매출 막대(아직 안 온 날은 옅게), 얼리 비중 반원, 지출 구성, 지금 매장, 할 일
//  색·모서리·굵기는 모두 src/astryx/hongkongTheme.js 테마에서 옴 (화면 코드에는 색 직접 지정 없음).
//  강조색 4가지는 기기에서 고른 테마(lib/dashTheme.js)를 그대로 따라감. mode = 'light' | 'dark'
//  계산은 예전 BentoBoard 와 같음. 데이터: 대시보드가 계산한 값 + revDoc + 이 컴포넌트가 읽는 지난달 revenue·이번 달 attendance
import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'
import { Theme } from '@astryxdesign/core/theme'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { ProgressBar } from '@astryxdesign/core/ProgressBar'
import { List, ListItem } from '@astryxdesign/core/List'
import { Avatar } from '@astryxdesign/core/Avatar'
import { StatusDot } from '@astryxdesign/core/StatusDot'
import { Banner } from '@astryxdesign/core/Banner'
import { BarChart, Bar, Cell, XAxis, ResponsiveContainer, PieChart, Pie, Tooltip } from 'recharts'
import { hongkongTheme } from '../astryx/hongkongTheme'
import CountUp from './CountUp'

const pad = n => String(n).padStart(2, '0')
const won = n => Math.round(n || 0).toLocaleString('ko-KR')
const man = n => { const v = (n || 0) / 10000; return `${(Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10).toLocaleString('ko-KR')}만` }
const totalOf = r => {
  if (!r || typeof r !== 'object') return 0
  const c = r.close && ((r.close.kiosk || 0) + (r.close.del || 0) + (r.close.pos || 0)) > 0 ? r.close : r
  return (+c.kiosk || 0) + (+c.del || 0) + (+c.pos || 0)
}
const earlyOf = r => r ? (+r.earlyKiosk || 0) + (+r.earlyDel || 0) + (+r.earlyPos || 0) : 0
const prevYm = ym => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}` }
const toDate = t => !t ? null : t.toDate ? t.toDate() : new Date(t)
const reduceMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
// 차트 색도 테마 토큰으로
const ACCENT = 'var(--color-accent)', SOFT = 'var(--hk-chart-bar)', MUTED = 'var(--color-background-muted)'

// 숫자 칸 하나 (filled = 강조색으로 꽉 찬 카드, 글자는 강조색 위 글자색을 물려받음)
function Kpi({ label, value, note, bad, filled }) {
  const sub = filled ? 'inherit' : 'secondary'
  return (
    <Card variant={filled ? 'red' : 'default'}>
      <VStack gap={1}>
        <Text type="label" color={sub}>{label}</Text>
        <Text type="display-3" color={filled ? 'inherit' : 'primary'} hasTabularNumbers textWrap="nowrap">
          {value == null ? '—' : <><CountUp value={value}/><Text type="large" color="inherit"> 원</Text></>}
        </Text>
        {note && <Text type="supporting" color={filled ? 'inherit' : bad ? 'accent' : 'secondary'} hasTabularNumbers>{note}</Text>}
      </VStack>
    </Card>
  )
}

function Panel({ title, right, children }) {
  return (
    <Card>
      <VStack gap={3}>
        <HStack hAlign="between" vAlign="center">
          <Heading level={4}>{title}</Heading>
          {right && <Text type="supporting" color="secondary" hasTabularNumbers>{right}</Text>}
        </HStack>
        {children}
      </VStack>
    </Card>
  )
}

export default function BentoBoard({ ym, rev, exp, profit, labor, staffCount, revDoc, theme, mode = 'light' }) {
  const [extra, setExtra] = useState(null)   // { prev: 지난달 revenue 문서, att: 이번 달 attendance 문서 }
  useEffect(() => {
    let alive = true
    const read = (c, id) => getDoc(doc(db, c, id)).then(s => s.exists() ? s.data() : {}).catch(() => ({}))
    Promise.all([read('revenue', prevYm(ym)), read('attendance', ym)]).then(([prev, att]) => { if (alive) setExtra({ prev, att }) })
    return () => { alive = false }
  }, [ym])

  const now = new Date()
  const isNow = ym === `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
  const todayDD = pad(now.getDate())
  const [y, m] = ym.split('-').map(Number)
  const dim = new Date(y, m, 0).getDate()
  const days = Array.from({ length: dim }, (_, i) => pad(i + 1))
  const daily = days.map(dd => ({ dd, day: +dd, v: totalOf(revDoc?.[dd]), future: isNow && dd > todayDD, sun: new Date(y, m - 1, +dd).getDay() === 0 }))
  const max = Math.max(1, ...daily.map(d => d.v))
  const best = daily.reduce((a, d) => d.v > (a?.v || 0) ? d : a, null)
  // 지난달 같은 기간 (오늘 마감이 없으면 어제까지)
  let cut = dim
  if (isNow) { cut = now.getDate(); if (!totalOf(revDoc?.[todayDD])) cut -= 1 }
  const sumTo = (d, n) => { let s = 0; for (let i = 1; i <= n; i++) s += totalOf(d?.[pad(i)]); return s }
  const curCut = sumTo(revDoc, cut), prevCut = extra ? sumTo(extra.prev, cut) : null
  const vsPrev = prevCut ? (curCut - prevCut) / prevCut * 100 : null
  const todayRev = isNow ? totalOf(revDoc?.[todayDD]) : null
  const lastDay = [...daily].reverse().find(d => d.v > 0)
  // 얼리 비중 (얼리를 적은 날들의 하루 매출 중)
  let eSum = 0, eTot = 0
  for (const dd of days) { const e = earlyOf(revDoc?.[dd]); if (e) { eSum += e; eTot += totalOf(revDoc?.[dd]) } }
  const eShare = eTot ? eSum / eTot : null
  // 지금 매장: 오늘 출근했고 아직 퇴근 안 한 사람
  const working = isNow && extra ? Object.values(extra.att || {}).map(u => u?.[todayDD]).filter(r => r?.in && !r.out)
    .map(r => ({ name: r.name || '직원', in: toDate(r.splitBack || r.in) })) : []
  // 할 일: 지난 영업일(일요일 빼고) 중 마감이 없는 날
  const missing = daily.filter(d => !d.future && !d.sun && !d.v && (!isNow || d.dd < todayDD)).map(d => d.day)
  const secs = ['재료비', '관리비', '인건비', '기타'].map(k => ({ k, v: exp.bySec?.[k] || 0 })).filter(x => x.v > 0)
  const secMax = Math.max(1, ...secs.map(s => s.v))
  // 아직 안 온 날은 옅은 막대(높이 고정), 최고·오늘은 강조색
  const bars = daily.map(d => ({ ...d, h: d.future ? max * 0.4 : d.v }))
  const anim = !reduceMotion()

  return (
    <Theme theme={hongkongTheme(theme)} mode={mode}>
      <VStack gap={4}>
        <Grid columns={{ minWidth: 200, max: 4, repeat: 'fit' }} gap={4}>
          <Kpi filled label={`${m}월 매출`} value={rev.total}
            note={vsPrev == null ? '지난달 같은 기간 자료 없음' : `지난달 1~${cut}일보다 ${vsPrev >= 0 ? '+' : ''}${vsPrev.toFixed(1)}%`}/>
          {isNow
            ? <Kpi label="오늘 매출" value={todayRev || null} note={todayRev ? '마감 기준' : lastDay ? `아직 마감 전 · 마지막 ${lastDay.day}일 ${man(lastDay.v)}원` : '아직 마감 전'}/>
            : <Kpi label="가장 많이 판 날" value={best?.v || null} note={best?.v ? `${best.day}일` : ''}/>}
          <Kpi label={profit >= 0 ? '남은 돈' : '모자란 돈'} value={Math.abs(profit)} bad={profit < 0}
            note={rev.total ? `지출 ${won(exp.total)}원 · 매출의 ${Math.round(exp.total / rev.total * 100)}%` : `지출 ${won(exp.total)}원`}/>
          <Kpi label="영업 잔액" value={exp.balance || 0}
            note={exp.bank?.closing != null ? (exp.bank.diff === 0 ? '통장과 일치해요' : `통장과 ${won(Math.abs(exp.bank.diff))}원 차이`) : '전월 이월 + 실입금 − 지출'}
            bad={exp.bank?.closing != null && exp.bank.diff !== 0}/>
        </Grid>

        <Grid columns={{ minWidth: 300, max: 2, repeat: 'fit' }} gap={4}>
          <Panel title="날짜별 매출" right={best?.v ? `최고 ${best.day}일 ${man(best.v)}원` : ''}>
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={bars} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barCategoryGap="20%">
                <XAxis dataKey="day" ticks={[1, Math.ceil(dim / 2), dim]} tickFormatter={v => `${v}일`} axisLine={false} tickLine={false}
                  tick={{ fontSize: 11, fill: 'var(--color-text-secondary)' }} interval={0}/>
                <Tooltip cursor={false} formatter={(_, __, p) => [p.payload.future ? '아직' : `${won(p.payload.v)}원`, `${p.payload.day}일`]} labelFormatter={() => ''}/>
                <Bar dataKey="h" radius={[7, 7, 7, 7]} isAnimationActive={anim} animationDuration={700}>
                  {bars.map(d => <Cell key={d.dd} fill={d.future ? MUTED : (best?.dd === d.dd || (isNow && d.dd === todayDD)) ? ACCENT : SOFT}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </Panel>

          <Panel title="얼리 영업 비중" right="9:00~10:30">
            {eShare == null ? <Text color="secondary">이 달엔 얼리 매출 기록이 없어요</Text> : <>
              <ResponsiveContainer width="100%" height={110}>
                <PieChart>
                  <Pie data={[{ v: eShare }, { v: 1 - eShare }]} dataKey="v" startAngle={180} endAngle={0} cy="100%" innerRadius="140%" outerRadius="190%"
                    cornerRadius={9} stroke="none" isAnimationActive={anim} animationDuration={800}>
                    <Cell fill={ACCENT}/><Cell fill={MUTED}/>
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <VStack gap={0} hAlign="center">
                <Text type="display-3" hasTabularNumbers>{(eShare * 100).toFixed(1)}%</Text>
                <Text type="supporting" color="secondary" hasTabularNumbers>얼리 {won(eSum)}원</Text>
              </VStack>
            </>}
          </Panel>
        </Grid>

        <Grid columns={{ minWidth: 260, max: 3, repeat: 'fit' }} gap={4}>
          <Panel title="지출 구성" right={`${won(exp.total)}원`}>
            {!secs.length ? <Text color="secondary">지출 기록이 없어요</Text> : secs.map(s => (
              <VStack key={s.k} gap={1}>
                <HStack hAlign="between">
                  <Text>{s.k}</Text>
                  <Text type="supporting" color="secondary" hasTabularNumbers>{won(s.v)}원{rev.total ? ` · ${Math.round(s.v / rev.total * 100)}%` : ''}</Text>
                </HStack>
                <ProgressBar label={s.k} isLabelHidden value={s.v} max={secMax}/>
              </VStack>
            ))}
            <Text type="supporting" color="secondary" hasTabularNumbers>인건비(근무기록 기준) {won(labor)}원 · {staffCount}명</Text>
          </Panel>

          <Panel title="지금 매장" right={isNow ? `${working.length}명 근무 중` : ''}>
            {!isNow ? <Text color="secondary">이번 달을 볼 때만 보여요</Text>
              : !working.length ? <Text color="secondary">지금 출근해 있는 직원이 없어요</Text> : (
              <List hasDividers density="compact" edge="flush">
                {working.map((w, i) => (
                  <ListItem key={i} label={w.name}
                    startContent={<Avatar name={w.name.length >= 3 ? w.name.slice(-2) : w.name} size="md"/>}
                    endContent={<HStack gap={2} vAlign="center">
                      <StatusDot variant="success" label="근무 중" isPulsing/>
                      <Text type="supporting" color="secondary" hasTabularNumbers>{w.in ? `${pad(w.in.getHours())}:${pad(w.in.getMinutes())} 출근` : ''}</Text>
                    </HStack>}/>
                ))}
              </List>
            )}
          </Panel>

          <Panel title="할 일">
            {missing.length
              ? <Banner status="warning" title={`마감 매출을 안 적은 날 ${missing.length}일`}
                  description={missing.slice(0, 12).map(d => `${d}일`).join(', ') + (missing.length > 12 ? ' …' : '')}/>
              : <Banner status="success" title="빠진 마감 매출이 없어요"/>}
          </Panel>
        </Grid>
      </VStack>
    </Theme>
  )
}
