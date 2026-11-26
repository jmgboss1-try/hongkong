import { useState } from 'react'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Grid } from '@astryxdesign/core/Grid'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Divider } from '@astryxdesign/core/Divider'
import { TextInput } from '@astryxdesign/core/TextInput'
import { DateInput } from '@astryxdesign/core/DateInput'
import { Table } from '@astryxdesign/core/Table'
import { LedgerCard, Ledger, LedgerRow } from '../astryx/AstryxPage'

// 매출분석 → 할인 손익 계산기
//  지금(할인 없음) 하루 이익 = 주문 × 객단가 × 이익률
//  건당 d원 할인하면 건당 이익 = 객단가 × 이익률 − d  →  같은 이익을 내려면 주문 = 지금 이익 ÷ (할인 후 건당 이익)
//  가정: 할인해도 객단가는 그대로, 할인은 가게가 전부 부담. 이익률은 배달앱 수수료·재료비·포장비를 뺀 뒤 남는 비율
//  base / cmp: [{ key, label, short, color, ordersPerDay, aov, ordN }] (위에서 고른 기간 / 비교할 예전 기간)
const won = n => n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('ko-KR')
const one = n => n == null || !isFinite(n) ? '—' : (Math.round(n * 10) / 10).toLocaleString('ko-KR')
const STEPS = [500, 1000, 1500, 2000, 3000]
const MONTH_DAYS = 26   // 일요일 쉬는 한 달 영업일

const load = () => { try { return JSON.parse(localStorage.getItem('discountCalc') || '{}') } catch { return {} } }
const keep = v => { try { localStorage.setItem('discountCalc', JSON.stringify(v)) } catch { /* 저장 못 해도 계산은 됨 */ } }

// 하루 기준 손익 분기
function breakEven({ orders, aov, margin, discount }) {
  const unit = aov * margin / 100
  const now = orders * unit
  const after = unit - discount
  if (!(orders > 0) || !(aov > 0)) return null
  if (after <= 0) return { now, unit, after, impossible: true }
  const need = now / after
  return { now, unit, after, need, extra: need - orders, extraPct: (need - orders) / orders * 100, needSales: need * aov }
}

export default function DiscountCalc({ base, baseLabel, cmp, cmpRange, setCmpRange, loading, onMakeEvent }) {
  const saved = load()
  const total = (list) => {
    const has = list.filter(p => p.ordersPerDay != null && p.aov != null)
    const orders = has.reduce((a, p) => a + p.ordersPerDay, 0)
    const sales = has.reduce((a, p) => a + p.ordersPerDay * p.aov, 0)
    return { orders, aov: orders ? sales / orders : null }
  }
  const dataTot = total(base)
  const [s, setS] = useState(() => ({ margin: saved.margin ?? 20, discount: saved.discount ?? 1000, orders: '', aov: '', appMargin: saved.appMargin || {}, open: !!saved.open }))
  const set = patch => setS(v => { const n = { ...v, ...patch }; keep({ margin: n.margin, discount: n.discount, appMargin: n.appMargin, open: n.open }); return n })

  const orders = s.orders !== '' ? +s.orders : dataTot.orders
  const aov = s.aov !== '' ? +s.aov : dataTot.aov
  const margin = +s.margin || 0, discount = +s.discount || 0
  const r = breakEven({ orders, aov, margin, discount })
  const marginOf = k => s.appMargin[k] !== undefined && s.appMargin[k] !== '' ? +s.appMargin[k] : margin

  const line = (label, value, { note, strong, bad } = {}) => <LedgerRow label={label} note={note} text={value} strong={strong} tone={bad ? 'bad' : undefined}/>
  const field = (label, value, onChange, { ph, unit, w } = {}) => (
    <TextInput label={`${label} (${unit})`} inputMode="decimal" width={w || 110} value={value} placeholder={ph} onChange={v => onChange(v.replace(/[^0-9.]/g, ''))}/>
  )

  const apps = base.filter(p => p.ordersPerDay != null && p.aov != null && p.ordersPerDay > 0)
  const cmpTot = cmp ? total(cmp) : null

  const stepRows = [...new Set([...STEPS, discount])].filter(d => d > 0).sort((a, b) => a - b).map(d => ({ d, x: breakEven({ orders, aov, margin, discount: d }) }))

  return (
    <LedgerCard title="할인 손익 계산기" right={<HStack gap={2} vAlign="center">
      <Text type="supporting" color="secondary" hasTabularNumbers>{!s.open && r && !r.impossible ? `${won(discount)}원 할인이면 하루 ${one(r.need)}건 (+${one(r.extra)}건) 필요` : '건당 할인을 하면 주문이 얼마나 늘어야 지금만큼 남는지'}</Text>
      <Button size="sm" label={s.open ? '접기' : '펼치기'} onClick={() => set({ open: !s.open })}/>
    </HStack>}>
      {s.open && <>
        <HStack gap={2} vAlign="end" wrap="wrap">
          {field('하루 주문', s.orders, v => set({ orders: v }), { ph: one(dataTot.orders), unit:'건' })}
          {field('객단가', s.aov, v => set({ aov: v }), { ph: won(dataTot.aov), unit:'원', w:130 })}
          {field('이익률', s.margin, v => set({ margin: v }), { unit:'%', w:90 })}
          {field('건당 할인', s.discount, v => set({ discount: v }), { unit:'원', w:110 })}
          {(s.orders !== '' || s.aov !== '') && <Button variant="ghost" label="실제 자료로 되돌리기" onClick={() => set({ orders:'', aov:'' })}/>}
        </HStack>
        <Text type="supporting" color="secondary">빈 칸은 {baseLabel} 배달앱 실제 평균({one(dataTot.orders)}건, {won(dataTot.aov)}원)을 써요. 이익률은 배달앱 수수료·재료비·포장비를 다 빼고 주문 하나에서 남는 비율이에요.</Text>

        {loading ? <Text color="secondary">불러오는 중...</Text> : !r ? (
          <Text color="secondary">하루 주문과 객단가를 넣어 주세요 (이 기간엔 주문 건수 기록이 없어요)</Text>
        ) : (
          <Grid columns={{ minWidth: 320, max: 2, repeat: 'fit' }} gap={6}>
            <VStack gap={2}>
              {r.impossible
                ? <Banner status="error" title={`${won(discount)}원 할인은 주문 하나 이익(${won(r.unit)}원)보다 커서 주문이 아무리 늘어도 손해예요`}/>
                : <Text type="large" weight="bold">{won(discount)}원 할인하면 하루 <Text color="accent">{Math.ceil(r.need)}건</Text>(지금보다 <Text color="accent">+{one(r.extra)}건</Text>, +{Math.round(r.extraPct)}%)은 받아야 지금만큼 남아요</Text>}
              <Ledger rows={<>
                {line('지금 하루 이익', `${won(r.now)}원`, { note:`${one(orders)}건 × ${won(aov)}원 × ${margin}%` })}
                {line('주문 하나 이익', `${won(r.unit)}원`, { note:'할인 없을 때' })}
                {line('할인 후 주문 하나 이익', `${won(r.after)}원`, { note:`− ${won(discount)}원`, bad: r.after <= 0 })}
              </>} total={!r.impossible && <>
                {line('필요한 하루 주문', `${one(r.need)}건`, { strong:true })}
                {line('필요한 하루 매출', `${won(r.needSales)}원`, { note:`지금 ${won(orders * aov)}원` })}
                {line('한 달로 치면', `+${won(r.extra * MONTH_DAYS)}건`, { note:`영업 ${MONTH_DAYS}일 기준` })}
                {line('할인으로 나가는 돈', `하루 ${won(r.need * discount)}원`, { note:`한 달 약 ${won(r.need * discount * MONTH_DAYS / 10000)}만원` })}
              </>}/>
            </VStack>
            <VStack gap={2}>
              <Text weight="bold">할인 금액별로 보면</Text>
              <Table data={stepRows} idKey="d" density="compact"
                columns={[
                  { key:'d', header:'건당 할인', renderCell: ({ d }) => <Button size="sm" variant={d === discount ? 'primary' : 'ghost'} label={`${won(d)}원`} onClick={() => set({ discount: String(d) })}/> },
                  { key:'need', header:'필요한 하루 주문', align:'end', renderCell: ({ x }) => x.impossible ? <Text color="accent">늘 손해</Text> : <Text hasTabularNumbers>{one(x.need)}건</Text> },
                  { key:'extra', header:'더 받아야', align:'end', renderCell: ({ x }) => x.impossible ? null : <Text color="accent" hasTabularNumbers>+{one(x.extra)}건 ({Math.round(x.extraPct)}%)</Text> },
                  { key:'sales', header:'필요한 하루 매출', align:'end', renderCell: ({ x }) => x.impossible ? null : <Text hasTabularNumbers>{won(x.needSales)}원</Text> },
                ]}/>
              <Text type="supporting" color="secondary">금액을 누르면 왼쪽 계산이 그 금액으로 바뀌어요</Text>
            </VStack>
          </Grid>
        )}

        {/* 앱별 */}
        {!loading && apps.length > 0 && (
          <VStack gap={2}>
            <Text weight="bold">배달앱별로 {won(discount)}원 할인하면</Text>
            <Text type="supporting" color="secondary">앱마다 수수료가 달라서 이익률을 따로 바꿀 수 있어요 (비우면 위의 {margin}%)</Text>
            <HStack isScrollable>
              <Table data={apps} idKey="key" density="compact"
                columns={[
                  { key:'label', header:'앱', width:100, renderCell: p => <Text weight="bold">{p.label}</Text> },
                  { key:'o', header:'지금 하루 주문', width:110, align:'end', renderCell: p => <Text hasTabularNumbers>{one(p.ordersPerDay)}건</Text> },
                  { key:'aov', header:'객단가', width:100, align:'end', renderCell: p => <Text hasTabularNumbers>{won(p.aov)}원</Text> },
                  { key:'m', header:'이익률 (%)', width:100, renderCell: p => <TextInput label={`${p.label} 이익률`} isLabelHidden size="sm" inputMode="decimal" width={70} placeholder={String(margin)} value={s.appMargin[p.key] ?? ''}
                    onChange={v => set({ appMargin: { ...s.appMargin, [p.key]: v.replace(/[^0-9.]/g, '') } })}/> },
                  { key:'now', header:'지금 하루 이익', width:120, align:'end', renderCell: p => <Text hasTabularNumbers>{won(breakEven({ orders: p.ordersPerDay, aov: p.aov, margin: marginOf(p.key), discount }).now)}원</Text> },
                  { key:'need', header:'필요한 하루 주문', width:140, align:'end', renderCell: p => { const x = breakEven({ orders: p.ordersPerDay, aov: p.aov, margin: marginOf(p.key), discount })
                    return x.impossible ? <Text color="accent">할인이 건당 이익보다 커요</Text> : <Text weight="bold" hasTabularNumbers>{one(x.need)}건 <Text color="accent">(+{one(x.extra)})</Text></Text> } },
                  { key:'sales', header:'필요한 하루 매출', width:200, align:'end', renderCell: p => { const x = breakEven({ orders: p.ordersPerDay, aov: p.aov, margin: marginOf(p.key), discount })
                    return x.impossible ? null : <Text hasTabularNumbers>{won(x.needSales)}원 <Text color="secondary">(지금 {won(p.ordersPerDay * p.aov)})</Text></Text> } },
                ]}/>
            </HStack>
          </VStack>
        )}

        {/* 실제로 할인하던 때와 비교 */}
        <Divider/>
        <VStack gap={2}>
          <Text weight="bold">실제로 할인하던 때와 비교</Text>
          <HStack gap={2} vAlign="end" wrap="wrap">
            <DateInput label="할인하던 기간 시작" value={cmpRange?.from || ''} onChange={v => setCmpRange(x => ({ ...(x || {}), from: v || '' }))}/>
            <DateInput label="할인하던 기간 끝" value={cmpRange?.to || ''} onChange={v => setCmpRange(x => ({ ...(x || {}), to: v || '' }))}/>
            <Text type="supporting" color="secondary">그때 건당 {won(discount)}원 할인했다고 보고 계산해요</Text>
          </HStack>
          {cmpTot && cmpTot.orders > 0 && dataTot.orders > 0 && (() => {
            const thenProfit = cmpTot.orders * (cmpTot.aov * margin / 100 - discount)
            const nowProfit = dataTot.orders * dataTot.aov * margin / 100
            const better = thenProfit > nowProfit
            return <>
              <Text type="large" weight="bold" color={better ? 'accent' : 'primary'}>{better ? `할인하던 때가 하루 약 ${won(thenProfit - nowProfit)}원 더 남았어요` : `할인을 뺀 지금이 하루 약 ${won(nowProfit - thenProfit)}원 더 남아요`}</Text>
              <Ledger rows={<>
                {line('할인하던 때', `${won(thenProfit)}원 / 하루`, { note:`${one(cmpTot.orders)}건 × (${won(cmpTot.aov)}원 × ${margin}% − ${won(discount)}원)` })}
                {line(`지금 (${baseLabel})`, `${won(nowProfit)}원 / 하루`, { note:`${one(dataTot.orders)}건 × ${won(dataTot.aov)}원 × ${margin}%` })}
              </>}/>
              <Text type="supporting" color="secondary">방학·시험기간·날씨처럼 할인 말고도 주문을 바꾸는 일이 있어서, 비슷한 시기끼리 비교할수록 정확해요. 주문 건수를 적은 날만 계산해요.</Text>
            </>
          })()}
          {cmpRange?.from && cmpRange?.to && cmpTot && !(cmpTot.orders > 0) && !loading && (
            <Text type="supporting" color="secondary">그 기간엔 주문 건수 기록이 없어요. 위의 '배달앱 엑셀로 예전 자료 넣기'로 그때 자료를 먼저 넣어 주세요.</Text>
          )}
        </VStack>

        <Text type="supporting" color="secondary">할인해도 객단가는 그대로이고 할인은 가게가 다 부담한다고 보고 계산해요. 할인 때문에 주문 금액이 18,000원 최소주문에 맞춰 올라가면 실제로는 조금 더 남을 수 있어요.</Text>
        {onMakeEvent && discount > 0 && <HStack><Button variant="primary" label={`건당 ${won(discount)}원 할인 시작을 일정에 적기`} onClick={() => onMakeEvent(discount, margin)}/></HStack>}
      </>}
    </LedgerCard>
  )
}
