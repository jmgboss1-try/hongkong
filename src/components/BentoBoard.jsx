import { useEffect, useRef, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'
import { THEMES } from '../lib/dashTheme'

// 대시보드 카드형(벤토) 보기 — 맨 위 숫자 4칸, 날짜별 매출 둥근 막대(아직 안 온 날은 빗금), 얼리 비중 반원, 지출 구성, 지금 매장, 할 일
//  강조색 하나만 바꾸면 전체 색이 같이 바뀜 (THEMES, 기기마다 localStorage 'dash.theme')
//  데이터: 대시보드가 이미 계산한 값(rev·exp·profit·labor) + revenue 문서(revDoc) + 이 컴포넌트가 읽는 지난달 revenue·이번 달 attendance
const C = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#E6E2DA', card:'#FFFFFF', green:'#2E7D45', red:'#B42318', amber:'#B45309' }
const num = { fontVariantNumeric:'tabular-nums' }
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

// 숫자가 0에서 올라가며 바뀜 (움직임 줄이기 설정이면 바로)
function useCountUp(value, ms = 700) {
  const [v, setV] = useState(value)
  const from = useRef(0)
  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const dur = reduce ? 1 : ms
    const start = performance.now(), a = from.current, b = value
    let raf
    const step = t => {
      const k = Math.min(1, (t - start) / dur), e = 1 - Math.pow(1 - k, 3)
      setV(a + (b - a) * e)
      if (k < 1) raf = requestAnimationFrame(step); else from.current = b
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [value, ms])
  return v
}
function Count({ value, fmt = won }) { return <>{fmt(useCountUp(value))}</> }

export default function BentoBoard({ ym, rev, exp, profit, labor, staffCount, revDoc, theme }) {
  const th = THEMES[theme] || THEMES.red
  const [extra, setExtra] = useState(null)   // { prev: 지난달 revenue 문서, att: 이번 달 attendance 문서 }
  useEffect(() => {
    let alive = true
    const read = (c, id) => getDoc(doc(db, c, id)).then(s => s.exists() ? s.data() : {}).catch(() => ({}))
    Promise.all([read('revenue', prevYm(ym)), read('attendance', ym)]).then(([prev, att]) => { if (alive) setExtra({ prev, att }) })
    return () => { alive = false }
  }, [ym])

  const now = new Date()
  const thisYm = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
  const isNow = ym === thisYm
  const todayDD = pad(now.getDate())
  const [y, m] = ym.split('-').map(Number)
  const dim = new Date(y, m, 0).getDate()
  const days = Array.from({ length: dim }, (_, i) => pad(i + 1))
  const daily = days.map(dd => ({ dd, v: totalOf(revDoc?.[dd]), future: isNow && dd > todayDD, sun: new Date(y, m - 1, +dd).getDay() === 0 }))
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
  const missing = daily.filter(d => !d.future && !d.sun && !d.v && (!isNow || d.dd < todayDD)).map(d => +d.dd)
  const secs = ['재료비', '관리비', '인건비', '기타'].map(k => ({ k, v: exp.bySec?.[k] || 0 })).filter(x => x.v > 0)
  const secMax = Math.max(1, ...secs.map(s => s.v))

  const card = (extraStyle = {}) => ({ background: C.card, borderRadius: 16, padding: 'clamp(12px, 3vw, 16px) clamp(14px, 3.4vw, 18px)', border: `1px solid ${C.rule}`,
    boxShadow: '0 1px 2px rgba(29,27,24,.04)', minWidth: 0, boxSizing: 'border-box', ...extraStyle })
  const head = (t, right) => (
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
      <span style={{fontSize:14, fontWeight:700, color:C.ink}}>{t}</span>{right}
    </div>
  )
  const tile = ({ label, value, fmt, note, noteColor, filled }) => (
    <div key={label} style={card(filled ? { background: th.accent, border: 'none', color: '#FFFFFF' } : {})}>
      <div style={{fontSize:13, fontWeight:600, opacity: filled ? 0.9 : 1, color: filled ? '#FFFFFF' : C.sub}}>{label}</div>
      <div style={{fontSize:'clamp(20px, 4.6vw, 30px)', fontWeight:800, letterSpacing:'-0.02em', margin:'6px 0 4px', whiteSpace:'nowrap', ...num}}>
        {value == null ? '—' : <Count value={value} fmt={fmt}/>}<span style={{fontSize:15, fontWeight:600, marginLeft:2}}>{value == null ? '' : '원'}</span>
      </div>
      {note && <div style={{fontSize:12, color: filled ? 'rgba(255,255,255,.85)' : (noteColor || C.sub), ...num}}>{note}</div>}
    </div>
  )

  // 반원 게이지
  const gauge = p => {
    const a = Math.PI * Math.min(1, Math.max(0, p))
    const R = 70, cx = 90, cy = 86
    const x = cx - R * Math.cos(a), yy = cy - R * Math.sin(a)
    return (
      <svg viewBox="0 0 180 100" style={{width:'100%', maxWidth:220, display:'block', margin:'0 auto'}} aria-hidden="true">
        <path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${cx + R} ${cy}`} fill="none" stroke={th.soft} strokeWidth="18" strokeLinecap="round"/>
        {p > 0 && <path d={`M ${cx - R} ${cy} A ${R} ${R} 0 0 1 ${x} ${yy}`} fill="none" stroke={th.accent} strokeWidth="18" strokeLinecap="round"/>}
      </svg>
    )
  }

  return (
    <div style={{marginBottom:28}}>
      <style>{`@keyframes bentoGrow { from { transform: scaleY(0) } to { transform: scaleY(1) } }
        .bento-bar { transform-origin: bottom; animation: bentoGrow .6s cubic-bezier(.2,.8,.2,1) both }
        @media (prefers-reduced-motion: reduce) { .bento-bar { animation: none } }
        .bento-mid { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) }
        .bento-kpi { grid-template-columns: repeat(4, minmax(0, 1fr)) }
        @media (max-width: 900px) { .bento-kpi { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px !important } }
        @media (max-width: 760px) { .bento-mid { grid-template-columns: minmax(0, 1fr) } }`}</style>

      {/* 맨 위 숫자 4칸 */}
      <div className="bento-kpi" style={{display:'grid', gap:14, marginBottom:14}}>
        {tile({ filled:true, label:`${m}월 매출`, value:rev.total,
          note: vsPrev == null ? '지난달 같은 기간 자료 없음' : `지난달 1~${cut}일보다 ${vsPrev >= 0 ? '+' : ''}${vsPrev.toFixed(1)}%` })}
        {isNow
          ? tile({ label:'오늘 매출', value: todayRev || null, note: todayRev ? '마감 기준' : lastDay ? `아직 마감 전 · 마지막 ${+lastDay.dd}일 ${man(lastDay.v)}원` : '아직 마감 전' })
          : tile({ label:'가장 많이 판 날', value: best?.v || null, note: best?.v ? `${+best.dd}일` : '' })}
        {tile({ label: profit >= 0 ? '남은 돈' : '모자란 돈', value: Math.abs(profit),
          note: rev.total ? `지출 ${won(exp.total)}원 · 매출의 ${Math.round(exp.total / rev.total * 100)}%` : `지출 ${won(exp.total)}원`,
          noteColor: profit >= 0 ? C.sub : C.red })}
        {tile({ label:'영업 잔액', value: exp.balance || 0,
          note: exp.bank?.closing != null ? (exp.bank.diff === 0 ? '통장과 일치해요' : `통장과 ${won(Math.abs(exp.bank.diff))}원 차이`) : '전월 이월 + 실입금 − 지출',
          noteColor: exp.bank?.closing != null ? (exp.bank.diff === 0 ? C.green : C.red) : C.sub })}
      </div>

      {/* 가운데: 날짜별 매출 + 오른쪽 작은 칸 */}
      <div className="bento-mid" style={{display:'grid', gap:14, marginBottom:14}}>
        <div style={card()}>
          {head('날짜별 매출', <span style={{fontSize:12, color:C.sub, ...num}}>{best?.v ? `최고 ${+best.dd}일 ${man(best.v)}원` : ''}</span>)}
          <svg viewBox={`0 0 ${dim * 20} 150`} style={{width:'100%', height:170, display:'block'}} preserveAspectRatio="none" role="img" aria-label="날짜별 매출 막대">
            <defs>
              <pattern id="bento-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="6" height="6" fill="#F3F1EC"/><line x1="0" y1="0" x2="0" y2="6" stroke="#CFC9BE" strokeWidth="2.4"/>
              </pattern>
            </defs>
            {daily.map((d, i) => {
              const h = d.future ? 60 : Math.max(d.v ? 8 : 0, d.v / max * 140)
              const isBest = best && d.dd === best.dd && d.v
              return (
                <g key={d.dd}>
                  {d.future
                    ? <rect x={i * 20 + 3} y={150 - h} width="14" height={h} rx="7" fill="url(#bento-hatch)"/>
                    : d.v > 0 && <rect className="bento-bar" style={{animationDelay:`${i * 15}ms`}} x={i * 20 + 3} y={150 - h} width="14" height={h} rx="7"
                        fill={isBest ? th.accent : d.dd === todayDD && isNow ? th.accent : th.mid}/>}
                  <title>{`${+d.dd}일 ${d.v ? `${won(d.v)}원` : d.future ? '아직' : '기록 없음'}`}</title>
                </g>
              )
            })}
          </svg>
          <div style={{display:'flex', justifyContent:'space-between', fontSize:11, color:C.faint, marginTop:4, ...num}}>
            <span>1일</span><span>{Math.ceil(dim / 2)}일</span><span>{dim}일</span>
          </div>
        </div>

        <div style={card()}>
          {head('얼리 영업 비중')}
          {eShare == null ? <div style={{fontSize:13, color:C.sub, padding:'20px 0'}}>이 달엔 얼리 매출 기록이 없어요</div> : <>
            {gauge(eShare)}
            <div style={{textAlign:'center', marginTop:-34, fontSize:30, fontWeight:800, ...num}}><Count value={eShare * 100} fmt={v => v.toFixed(1)}/><span style={{fontSize:15}}>%</span></div>
            <div style={{textAlign:'center', fontSize:12, color:C.sub, marginTop:4, ...num}}>얼리 {won(eSum)}원 · 9:00~10:30</div>
          </>}
        </div>
      </div>

      {/* 아래: 지출 구성 · 지금 매장 · 할 일 */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap:14}}>
        <div style={card()}>
          {head('지출 구성', <span style={{fontSize:12, color:C.sub, ...num}}>{won(exp.total)}원</span>)}
          {!secs.length ? <div style={{fontSize:13, color:C.sub}}>지출 기록이 없어요</div> : secs.map(s => (
            <div key={s.k} style={{marginBottom:9}}>
              <div style={{display:'flex', justifyContent:'space-between', fontSize:13, marginBottom:4, ...num}}>
                <span>{s.k}</span><span style={{color:C.sub}}>{won(s.v)}원{rev.total ? ` · ${Math.round(s.v / rev.total * 100)}%` : ''}</span>
              </div>
              <div style={{height:10, borderRadius:5, background:th.soft, overflow:'hidden'}}>
                <div style={{height:'100%', width:`${s.v / secMax * 100}%`, background:th.accent, borderRadius:5, transition:'width .6s'}}/>
              </div>
            </div>
          ))}
          <div style={{fontSize:12, color:C.sub, marginTop:6, ...num}}>인건비(근무기록 기준) {won(labor)}원 · {staffCount}명</div>
        </div>

        <div style={card(isNow ? {} : { opacity: 0.6 })}>
          {head('지금 매장', isNow && <span style={{fontSize:12, color:C.sub}}>{working.length}명 근무 중</span>)}
          {!isNow ? <div style={{fontSize:13, color:C.sub}}>이번 달을 볼 때만 보여요</div>
            : !working.length ? <div style={{fontSize:13, color:C.sub}}>지금 출근해 있는 직원이 없어요</div>
            : working.map((w, i) => (
              <div key={i} style={{display:'flex', alignItems:'center', gap:10, padding:'7px 0', borderBottom: i < working.length - 1 ? `1px solid ${C.rule}` : 'none'}}>
                <span style={{width:36, height:36, borderRadius:18, background:th.soft, color:th.accent, display:'inline-flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:12}}>{w.name.length >= 3 ? w.name.slice(-2) : w.name}</span>
                <span style={{flex:1, fontSize:14, fontWeight:600}}>{w.name}</span>
                <span style={{fontSize:12, color:C.sub, ...num}}>{w.in ? `${pad(w.in.getHours())}:${pad(w.in.getMinutes())} 출근` : ''}</span>
              </div>
            ))}
        </div>

        <div style={card(missing.length ? { borderColor: '#EBC9A0' } : {})}>
          {head('할 일')}
          {missing.length
            ? <div style={{fontSize:13, lineHeight:1.7}}>
                <b style={{color:C.amber}}>마감 매출을 안 적은 날 {missing.length}일</b><br/>
                <span style={{color:C.sub, ...num}}>{missing.slice(0, 12).map(d => `${d}일`).join(', ')}{missing.length > 12 ? ' …' : ''}</span>
              </div>
            : <div style={{fontSize:13, color:C.green, fontWeight:600}}>빠진 마감 매출이 없어요</div>}
        </div>
      </div>
    </div>
  )
}
