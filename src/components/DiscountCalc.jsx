import { useState } from 'react'

// 매출분석 → 할인 손익 계산기
//  지금(할인 없음) 하루 이익 = 주문 × 객단가 × 이익률
//  건당 d원 할인하면 건당 이익 = 객단가 × 이익률 − d  →  같은 이익을 내려면 주문 = 지금 이익 ÷ (할인 후 건당 이익)
//  가정: 할인해도 객단가는 그대로, 할인은 가게가 전부 부담. 이익률은 배달앱 수수료·재료비·포장비를 뺀 뒤 남는 비율
//  base / cmp: [{ key, label, short, color, ordersPerDay, aov, ordN }] (위에서 고른 기간 / 비교할 예전 기간)
const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', soft:'#ECE8E1', accent:'#C3261C', green:'#2E7D45', red:'#B42318', field:'#F3F1EC' }
const num = { fontVariantNumeric:'tabular-nums' }
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

  const inp = (w = 90) => ({ background:'#FFFFFF', border:`1px solid ${T.rule}`, borderRadius:4, color:T.ink, padding:'6px 8px', fontSize:13,
    fontFamily:'inherit', outline:'none', width:w, textAlign:'right', boxSizing:'border-box', ...num })
  const leader = <span aria-hidden="true" style={{flex:1, borderBottom:`1px dotted ${T.faint}`, margin:'0 8px', minWidth:12, transform:'translateY(-4px)'}}/>
  const line = (label, value, { note, strong, color } = {}) => (
    <div style={{display:'flex', alignItems:'baseline', padding:'5px 0', fontSize: strong ? 15 : 13, fontWeight: strong ? 800 : 500, color:T.ink}}>
      <span style={{whiteSpace:'nowrap'}}>{label}</span>
      {note && <span style={{fontSize:11, color:T.sub, marginLeft:6, fontWeight:400}}>{note}</span>}
      {leader}<span style={{...num, whiteSpace:'nowrap', color: color || T.ink}}>{value}</span>
    </div>
  )
  const field = (label, value, onChange, { ph, unit, w } = {}) => (
    <label style={{display:'flex', flexDirection:'column', gap:3, fontSize:11, color:T.sub}}>
      {label}
      <span style={{display:'flex', alignItems:'center', gap:4}}>
        <input type="text" inputMode="decimal" value={value} placeholder={ph}
          onChange={e => onChange(e.target.value.replace(/[^0-9.]/g, ''))} style={inp(w)}/>
        <span style={{fontSize:12, color:T.ink}}>{unit}</span>
      </span>
    </label>
  )

  const apps = base.filter(p => p.ordersPerDay != null && p.aov != null && p.ordersPerDay > 0)
  const cmpTot = cmp ? total(cmp) : null

  return (
    <section style={{background:'#FFFFFF', border:`1px solid ${T.rule}`, borderRadius:6, padding:16, marginBottom:14}}>
      <button type="button" onClick={() => set({ open: !s.open })} aria-expanded={s.open}
        style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:10, flexWrap:'wrap', width:'100%', background:'none', border:'none', cursor:'pointer',
          fontFamily:'inherit', textAlign:'left', padding:'0 0 6px', borderBottom: s.open ? `2px solid ${T.ink}` : 'none', marginBottom: s.open ? 10 : 0}}>
        <span style={{fontSize:16, fontWeight:800, color:T.ink}}>할인 손익 계산기 <span style={{fontSize:12, fontWeight:500, color:'#2B5C9E', marginLeft:6}}>{s.open ? '접기' : '펼치기'}</span></span>
        <span style={{fontSize:11, color:T.sub, ...num}}>
          {!s.open && r && !r.impossible ? `${won(discount)}원 할인이면 하루 ${one(r.need)}건 (+${one(r.extra)}건) 필요` : '건당 할인을 하면 주문이 얼마나 늘어야 지금만큼 남는지'}
        </span>
      </button>
      {s.open && <>

      <div style={{display:'flex', gap:14, flexWrap:'wrap', alignItems:'flex-end', marginBottom:12}}>
        {field('하루 주문', s.orders, v => set({ orders: v }), { ph: one(dataTot.orders), unit:'건' })}
        {field('객단가', s.aov, v => set({ aov: v }), { ph: won(dataTot.aov), unit:'원', w:110 })}
        {field('이익률', s.margin, v => set({ margin: v }), { unit:'%', w:70 })}
        {field('건당 할인', s.discount, v => set({ discount: v }), { unit:'원', w:90 })}
        {(s.orders !== '' || s.aov !== '') && (
          <button type="button" onClick={() => set({ orders:'', aov:'' })}
            style={{background:'none', border:'none', color:'#2B5C9E', fontSize:12, cursor:'pointer', fontFamily:'inherit', padding:'0 0 8px'}}>실제 자료로 되돌리기</button>
        )}
      </div>
      <div style={{fontSize:11, color:T.sub, marginTop:-6, marginBottom:12, lineHeight:1.6}}>
        빈 칸은 {baseLabel} 배달앱 실제 평균({one(dataTot.orders)}건, {won(dataTot.aov)}원)을 써요. 이익률은 배달앱 수수료·재료비·포장비를 다 빼고 주문 하나에서 남는 비율이에요.
      </div>

      {loading ? <div style={{color:T.sub, fontSize:12}}>불러오는 중...</div> : !r ? (
        <div style={{color:T.sub, fontSize:12}}>하루 주문과 객단가를 넣어 주세요 (이 기간엔 주문 건수 기록이 없어요)</div>
      ) : (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap:'10px 36px'}}>
          <div>
            {r.impossible ? (
              <div style={{fontSize:15, fontWeight:800, color:T.red, margin:'4px 0 8px'}}>
                {won(discount)}원 할인은 주문 하나 이익({won(r.unit)}원)보다 커서 주문이 아무리 늘어도 손해예요
              </div>
            ) : (
              <div style={{fontSize:15, fontWeight:800, color:T.ink, margin:'4px 0 8px', lineHeight:1.5}}>
                {won(discount)}원 할인하면 하루 <span style={{color:T.accent}}>{Math.ceil(r.need)}건</span>(지금보다 <span style={{color:T.accent}}>+{one(r.extra)}건</span>, +{Math.round(r.extraPct)}%)은 받아야 지금만큼 남아요
              </div>
            )}
            {line('지금 하루 이익', `${won(r.now)}원`, { note:`${one(orders)}건 × ${won(aov)}원 × ${margin}%` })}
            {line('주문 하나 이익', `${won(r.unit)}원`, { note:'할인 없을 때' })}
            {line('할인 후 주문 하나 이익', `${won(r.after)}원`, { note:`− ${won(discount)}원`, color: r.after > 0 ? T.ink : T.red })}
            {!r.impossible && <>
              <div style={{borderTop:`3px double ${T.ink}`, marginTop:6, paddingTop:2}}>
                {line('필요한 하루 주문', `${one(r.need)}건`, { strong:true })}
              </div>
              {line('필요한 하루 매출', `${won(r.needSales)}원`, { note:`지금 ${won(orders * aov)}원` })}
              {line('한 달로 치면', `+${won(r.extra * MONTH_DAYS)}건`, { note:`영업 ${MONTH_DAYS}일 기준` })}
              {line('할인으로 나가는 돈', `하루 ${won(r.need * discount)}원`, { note:`한 달 약 ${won(r.need * discount * MONTH_DAYS / 10000)}만원` })}
            </>}
          </div>

          <div>
            <div style={{fontSize:12, fontWeight:700, color:T.ink, margin:'4px 0 6px'}}>할인 금액별로 보면</div>
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:12, ...num}}>
              <thead><tr style={{color:T.sub, fontSize:11}}>
                <th style={{textAlign:'left', padding:'4px 6px', fontWeight:500}}>건당 할인</th>
                <th style={{textAlign:'right', padding:'4px 6px', fontWeight:500}}>필요한 하루 주문</th>
                <th style={{textAlign:'right', padding:'4px 6px', fontWeight:500}}>더 받아야</th>
                <th style={{textAlign:'right', padding:'4px 6px', fontWeight:500}}>필요한 하루 매출</th>
              </tr></thead>
              <tbody>
                {[...new Set([...STEPS, discount])].filter(d => d > 0).sort((a, b) => a - b).map(d => {
                  const x = breakEven({ orders, aov, margin, discount: d })
                  const on = d === discount
                  return (
                    <tr key={d} onClick={() => set({ discount: String(d) })} style={{borderTop:`1px solid ${T.soft}`, cursor:'pointer', background: on ? '#FBEDEC' : 'transparent', fontWeight: on ? 700 : 400}}>
                      <td style={{padding:'6px'}}>{won(d)}원</td>
                      {x.impossible
                        ? <td colSpan={3} style={{padding:'6px', textAlign:'right', color:T.red}}>건당 이익보다 커서 늘 손해</td>
                        : <>
                          <td style={{padding:'6px', textAlign:'right'}}>{one(x.need)}건</td>
                          <td style={{padding:'6px', textAlign:'right', color:T.accent}}>+{one(x.extra)}건 ({Math.round(x.extraPct)}%)</td>
                          <td style={{padding:'6px', textAlign:'right'}}>{won(x.needSales)}원</td>
                        </>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div style={{fontSize:11, color:T.sub, marginTop:6}}>줄을 누르면 위 계산이 그 금액으로 바뀌어요</div>
          </div>
        </div>
      )}

      {/* 앱별 */}
      {!loading && apps.length > 0 && (
        <div style={{marginTop:16}}>
          <div style={{fontSize:12, fontWeight:700, color:T.ink, marginBottom:4}}>배달앱별로 {won(discount)}원 할인하면</div>
          <div style={{fontSize:11, color:T.sub, marginBottom:6}}>앱마다 수수료가 달라서 이익률을 따로 바꿀 수 있어요 (비우면 위의 {margin}%)</div>
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%', borderCollapse:'collapse', fontSize:12, minWidth:640, ...num}}>
              <thead><tr style={{color:T.sub, fontSize:11, textAlign:'right'}}>
                <th style={{textAlign:'left', padding:'4px 6px', fontWeight:500}}>앱</th>
                <th style={{padding:'4px 6px', fontWeight:500}}>지금 하루 주문</th>
                <th style={{padding:'4px 6px', fontWeight:500}}>객단가</th>
                <th style={{padding:'4px 6px', fontWeight:500}}>이익률</th>
                <th style={{padding:'4px 6px', fontWeight:500}}>지금 하루 이익</th>
                <th style={{padding:'4px 6px', fontWeight:500}}>필요한 하루 주문</th>
                <th style={{padding:'4px 6px', fontWeight:500}}>필요한 하루 매출</th>
              </tr></thead>
              <tbody>
                {apps.map(p => {
                  const m = marginOf(p.key)
                  const x = breakEven({ orders: p.ordersPerDay, aov: p.aov, margin: m, discount })
                  return (
                    <tr key={p.key} style={{borderTop:`1px solid ${T.soft}`, textAlign:'right'}}>
                      <td style={{textAlign:'left', padding:'6px'}}><span style={{borderLeft:`3px solid ${p.color}`, paddingLeft:6, fontWeight:700}}>{p.label}</span></td>
                      <td style={{padding:'6px'}}>{one(p.ordersPerDay)}건</td>
                      <td style={{padding:'6px'}}>{won(p.aov)}원</td>
                      <td style={{padding:'6px'}}>
                        <input type="text" inputMode="decimal" value={s.appMargin[p.key] ?? ''} placeholder={String(margin)}
                          onChange={e => set({ appMargin: { ...s.appMargin, [p.key]: e.target.value.replace(/[^0-9.]/g, '') } })}
                          style={{...inp(52), padding:'3px 6px', fontSize:12}}/>%
                      </td>
                      <td style={{padding:'6px'}}>{won(x.now)}원</td>
                      {x.impossible
                        ? <td colSpan={2} style={{padding:'6px', color:T.red}}>할인이 건당 이익보다 커요</td>
                        : <>
                          <td style={{padding:'6px', fontWeight:700}}>{one(x.need)}건 <span style={{color:T.accent, fontWeight:500}}>(+{one(x.extra)})</span></td>
                          <td style={{padding:'6px'}}>{won(x.needSales)}원 <span style={{color:T.sub}}>(지금 {won(p.ordersPerDay * p.aov)})</span></td>
                        </>}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 실제로 할인하던 때와 비교 */}
      <div style={{marginTop:16, borderTop:`1px solid ${T.rule}`, paddingTop:12}}>
        <div style={{fontSize:12, fontWeight:700, color:T.ink, marginBottom:6}}>실제로 할인하던 때와 비교</div>
        <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', fontSize:12, color:T.sub}}>
          할인하던 기간
          <input type="date" value={cmpRange?.from || ''} max={cmpRange?.to || undefined} onChange={e => setCmpRange(v => ({ ...(v || {}), from: e.target.value }))}
            style={{...inp(150), textAlign:'left'}} aria-label="할인하던 기간 시작"/>
          ~
          <input type="date" value={cmpRange?.to || ''} min={cmpRange?.from || undefined} onChange={e => setCmpRange(v => ({ ...(v || {}), to: e.target.value }))}
            style={{...inp(150), textAlign:'left'}} aria-label="할인하던 기간 끝"/>
          <span>그때 건당 {won(discount)}원 할인했다고 보고 계산해요</span>
        </div>
        {cmpTot && cmpTot.orders > 0 && dataTot.orders > 0 && (() => {
          const thenProfit = cmpTot.orders * (cmpTot.aov * margin / 100 - discount)
          const nowProfit = dataTot.orders * dataTot.aov * margin / 100
          const better = thenProfit > nowProfit
          return (
            <div style={{marginTop:10}}>
              <div style={{fontSize:14, fontWeight:800, color: better ? T.accent : T.green, marginBottom:6}}>
                {better ? `할인하던 때가 하루 약 ${won(thenProfit - nowProfit)}원 더 남았어요` : `할인을 뺀 지금이 하루 약 ${won(nowProfit - thenProfit)}원 더 남아요`}
              </div>
              {line('할인하던 때', `${won(thenProfit)}원 / 하루`, { note:`${one(cmpTot.orders)}건 × (${won(cmpTot.aov)}원 × ${margin}% − ${won(discount)}원)` })}
              {line(`지금 (${baseLabel})`, `${won(nowProfit)}원 / 하루`, { note:`${one(dataTot.orders)}건 × ${won(dataTot.aov)}원 × ${margin}%` })}
              <div style={{fontSize:11, color:T.sub, marginTop:4, lineHeight:1.6}}>
                방학·시험기간·날씨처럼 할인 말고도 주문을 바꾸는 일이 있어서, 비슷한 시기끼리 비교할수록 정확해요. 주문 건수를 적은 날만 계산해요.
              </div>
            </div>
          )
        })()}
        {cmpRange?.from && cmpRange?.to && cmpTot && !(cmpTot.orders > 0) && !loading && (
          <div style={{fontSize:12, color:T.sub, marginTop:8}}>그 기간엔 주문 건수 기록이 없어요. 위의 '배달앱 엑셀로 예전 자료 넣기'로 그때 자료를 먼저 넣어 주세요.</div>
        )}
      </div>

      <div style={{fontSize:11, color:T.sub, marginTop:12, lineHeight:1.6}}>
        할인해도 객단가는 그대로이고 할인은 가게가 다 부담한다고 보고 계산해요. 할인 때문에 주문 금액이 18,000원 최소주문에 맞춰 올라가면 실제로는 조금 더 남을 수 있어요.
      </div>
      {onMakeEvent && discount > 0 && (
        <button type="button" onClick={() => onMakeEvent(discount, margin)}
          style={{marginTop:10, background:T.accent, color:'#FFFFFF', border:'none', borderRadius:4, padding:'8px 14px', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit'}}>
          건당 {won(discount)}원 할인 시작을 일정에 적기
        </button>
      )}
      </>}
    </section>
  )
}
