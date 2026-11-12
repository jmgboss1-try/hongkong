import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts'
import { monthLabels, monthScheme } from '../lib/revenueChannels'

// 지난달 같은 기간과 비교 (대시보드·매출관리)
//  이번 달 1~N일 vs 지난달 1~N일 (N = 오늘, 오늘 마감이 아직 없으면 어제. 지난 달을 보면 그 달 끝까지)
//  영업일(마감 매출이 있는 날) 하루 평균, 이 속도면 월말 예상(남은 날 중 일요일·임시휴무 뺀 날 × 하루 평균), 누적 그래프
const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', accent:'#C3261C', red:'#B42318', green:'#2E7D45', field:'#F3F1EC' }
const num = { fontVariantNumeric:'tabular-nums' }
const pad = n => String(n).padStart(2, '0')
const won = n => Math.round(n || 0).toLocaleString('ko-KR')
const man = n => { const v = Math.round((n || 0) / 10000); return `${v.toLocaleString('ko-KR')}만원` }
const daysIn = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate() }
const prevOf = ym => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}` }
const monthNo = ym => +ym.slice(5)

// 마감 기준 하루 매출 (예전 close 묶음 호환)
function valueOf(r, ch) {
  if (!r || typeof r !== 'object') return 0
  const c = r.close && ((r.close.kiosk || 0) + (r.close.del || 0) + (r.close.pos || 0)) > 0 ? r.close : r
  const v = { kiosk: +c.kiosk || 0, del: +c.del || 0, pos: +c.pos || 0 }
  return ch === 'total' ? v.kiosk + v.del + v.pos : v[ch]
}
const closedDay = (dateStr, holidays) =>
  new Date(`${dateStr}T00:00:00`).getDay() === 0 || (holidays || []).some(h => h.startDate <= dateStr && dateStr <= h.endDate)

function paceOf(ym, cur, prev, holidays, ch, now = new Date()) {
  const thisYm = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
  if (ym > thisYm) return null
  const isNow = ym === thisYm
  const dim = daysIn(ym), pym = prevOf(ym), pdim = daysIn(pym)
  let cut = dim
  if (isNow) {
    cut = now.getDate()
    if (!valueOf(cur[pad(cut)], 'total')) cut -= 1   // 오늘 마감 전이면 어제까지
  }
  const sum = (d, upto, c) => { let s = 0, open = 0; for (let i = 1; i <= upto; i++) { const v = valueOf(d[pad(i)], c); s += v; if (valueOf(d[pad(i)], 'total') > 0) open++ } return { s, open } }
  const a = sum(cur, cut, ch), b = sum(prev, Math.min(cut, pdim), ch), pAll = sum(prev, pdim, ch)
  const curAvg = a.open ? a.s / a.open : 0, prevAvg = b.open ? b.s / b.open : 0
  let remain = 0
  if (isNow) for (let i = cut + 1; i <= dim; i++) if (!closedDay(`${ym}-${pad(i)}`, holidays)) remain++
  const rows = []
  let ca = 0, pa = 0
  for (let i = 1; i <= Math.max(dim, pdim); i++) {
    if (i <= dim) ca += valueOf(cur[pad(i)], ch)
    if (i <= pdim) pa += valueOf(prev[pad(i)], ch)
    rows.push({ label: `${i}일`, cur: i <= cut ? ca : null, prev: i <= pdim ? pa : null })
  }
  return {
    isNow, cut, pym, curSum: a.s, prevSum: b.s, curOpen: a.open, prevOpen: b.open, curAvg, prevAvg,
    diff: a.s - b.s, pct: b.s > 0 ? (a.s - b.s) / b.s * 100 : null,
    avgPct: prevAvg > 0 ? (curAvg - prevAvg) / prevAvg * 100 : null,
    remain, forecast: isNow ? a.s + curAvg * remain : null, prevMonthTotal: pAll.s, rows,
  }
}

export default function RevenuePace({ ym }) {
  const [raw, setRaw] = useState(null)
  const [ch, setCh] = useState('total')

  useEffect(() => {
    let alive = true
    const safe = p => p.then(s => (s.exists() ? s.data() : {})).catch(() => ({}))
    Promise.all([safe(getDoc(doc(db, 'revenue', ym))), safe(getDoc(doc(db, 'revenue', prevOf(ym)))), safe(getDoc(doc(db, 'checklist', 'holidays')))])
      .then(([cur, prev, hol]) => { if (alive) setRaw({ ym, cur, prev, holidays: hol.list || [] }) })
    return () => { alive = false }
  }, [ym])

  if (!raw || raw.ym !== ym) return null
  const p = paceOf(ym, raw.cur, raw.prev, raw.holidays, ch)
  if (!p) return null
  const L = monthLabels(ym)
  const chans = [['total', '합계'], ['kiosk', L.kiosk], ['del', '배달'], ['pos', L.pos]]
  const schemeDiffers = ch !== 'total' && ch !== 'del' && monthScheme(ym) !== monthScheme(p.pym)
  const cm = monthNo(ym), pm = monthNo(p.pym)
  const range = p.cut >= 1 ? `1~${p.cut}일` : ''
  const up = p.diff >= 0
  const leader = <span aria-hidden="true" style={{flex:1, borderBottom:`1px dotted ${T.faint}`, margin:'0 8px', minWidth:12, transform:'translateY(-4px)'}}/>
  const line = (label, value, { note, strong, color } = {}) => (
    <div style={{display:'flex', alignItems:'baseline', padding:'6px 0', fontSize: strong ? 16 : 14, fontWeight: strong ? 800 : 600, color:T.ink}}>
      <span style={{whiteSpace:'nowrap'}}>{label}</span>
      {note && <span style={{fontSize:12, color:T.sub, marginLeft:6, fontWeight:400, whiteSpace:'nowrap'}}>{note}</span>}
      {leader}
      <span style={{...num, whiteSpace:'nowrap', color: color || T.ink}}>{value}</span>
    </div>
  )

  return (
    <section style={{marginBottom:30}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:10, flexWrap:'wrap', borderBottom:`2px solid ${T.ink}`, paddingBottom:6, marginBottom:6}}>
        <h2 style={{fontSize:16, fontWeight:800, margin:0, fontFamily:'inherit', color:T.ink}}>지난달 같은 기간과 비교</h2>
        <div style={{display:'flex', gap:12, flexWrap:'wrap'}}>
          {chans.map(([k, l]) => (
            <button key={k} type="button" onClick={() => setCh(k)}
              style={{background:'none', border:'none', padding:'2px 0', cursor:'pointer', fontFamily:'inherit', fontSize:13,
                fontWeight: ch === k ? 800 : 500, color: ch === k ? T.ink : T.sub, borderBottom:`2px solid ${ch === k ? T.accent : 'transparent'}`}}>{l}</button>
          ))}
        </div>
      </div>

      {p.cut < 1 ? (
        <div style={{color:T.sub, fontSize:13, padding:'10px 0'}}>이번 달 마감 매출이 아직 없어요. 첫 마감을 입력하면 비교가 보여요.</div>
      ) : (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap:'10px 40px'}}>
          <div>
            <div style={{fontSize:15, fontWeight:800, color: up ? T.green : T.red, margin:'6px 0 4px', ...num}}>
              {cm}월 {range} 지난달보다 {man(Math.abs(p.diff))} {up ? '더' : '덜'} 팔았어요
              {p.pct != null && <span style={{marginLeft:6}}>({up ? '+' : '−'}{Math.abs(p.pct).toFixed(1)}%)</span>}
            </div>
            {line(`${cm}월 ${range}`, `${won(p.curSum)}원`, { note:`영업 ${p.curOpen}일` })}
            {line(`${pm}월 ${range}`, `${won(p.prevSum)}원`, { note:`영업 ${p.prevOpen}일` })}
            {line('영업일 하루 평균', `${won(p.curAvg)}원`, {
              note:`지난달 ${won(p.prevAvg)}원`,
              color: p.avgPct == null ? T.ink : p.avgPct >= 0 ? T.green : T.red,
            })}
            {p.avgPct != null && p.curOpen !== p.prevOpen && (
              <div style={{fontSize:12, color:T.sub, margin:'2px 0 4px'}}>
                영업일 수가 달라서({p.curOpen}일 / {p.prevOpen}일) 하루 평균으로 보면 {p.avgPct >= 0 ? '+' : '−'}{Math.abs(p.avgPct).toFixed(1)}%예요.
              </div>
            )}
            {p.isNow && (
              <div style={{borderTop:`3px double ${T.ink}`, marginTop:6, paddingTop:2}}>
                {line('이 속도면 월말', `약 ${man(p.forecast)}`, { strong:true, note:`남은 영업일 ${p.remain}일`,
                  color: p.forecast >= p.prevMonthTotal ? T.green : T.red })}
                <div style={{fontSize:12, color:T.sub}}>{pm}월 전체 {won(p.prevMonthTotal)}원 · 일요일과 임시휴무는 빼고 셌어요</div>
              </div>
            )}
            {schemeDiffers && (
              <div style={{fontSize:12, color:'#B45309', marginTop:6}}>11월 9일부터 매출 칸이 홀·기타로 바뀌어서, 이 칸은 바뀌기 전 달과 정확히 비교되지 않아요. 합계·배달은 그대로 비교돼요.</div>
            )}
          </div>
          <div style={{minWidth:0}}>
            <div style={{fontSize:12, color:T.sub, margin:'6px 0 4px'}}>1일부터 쌓인 매출 (실선 {cm}월, 점선 {pm}월)</div>
            <ResponsiveContainer width="100%" height={190}>
              <LineChart data={p.rows} margin={{ top:4, right:8, left:0, bottom:0 }}>
                <CartesianGrid stroke="#ECE8E1" vertical={false}/>
                <XAxis dataKey="label" tick={{ fontSize:10, fill:T.sub }} interval={4} tickLine={false} axisLine={{ stroke:T.rule }}/>
                <YAxis tick={{ fontSize:10, fill:T.sub }} tickFormatter={v => `${Math.round(v / 10000)}만`} width={48} tickLine={false} axisLine={false}/>
                <Tooltip formatter={(v, n) => [`${won(v)}원`, n]} contentStyle={{ fontSize:12, borderRadius:4, border:`1px solid ${T.rule}` }}/>
                <Line type="monotone" dataKey="prev" name={`${pm}월`} stroke={T.faint} strokeDasharray="4 3" strokeWidth={2} dot={false} isAnimationActive={false}/>
                <Line type="monotone" dataKey="cur" name={`${cm}월`} stroke={T.accent} strokeWidth={2.5} dot={false} connectNulls={false} isAnimationActive={false}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  )
}
