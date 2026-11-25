import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'

// 대시보드 → 얼리 영업 (9:00~10:30, 2026-11-16 시작). 월~금 영업일엔 항상 얼리를 엶 (토요일·일요일·임시휴무 제외)
//  얼리 매출 = revenue/{YYYY-MM}[dd] 의 earlyKiosk(홀) + earlyDel(배달) + earlyPos(기타) (매출관리에서 사장님이 '얼리' 탭으로 적음)
//  하루 매출 = 마감 값. 오전·마감은 9시부터 쌓인 금액이라 얼리를 포함
//  설정 revenue/_early = { start, marginDel(배달 이익률 %), marginHall(홀·기타 이익률 %), days(얼리 여는 요일), costOn, wage, hours }
//    인건비는 사장님이 일찍 나오는 시간을 최저시급으로 친 가상 비용 (지출로는 안 적음), 얼리 여는 날마다 셈
//  '정말 늘었나': 얼리 시작 전 4주의 얼리 요일 하루 평균 매출 vs 시작 뒤 얼리 요일 하루 평균 매출
const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', soft:'#ECE8E1', accent:'var(--hk-accent)', green:'#2E7D45', red:'#B42318', amber:'#B45309', field:'#F3F1EC' }
const num = { fontVariantNumeric:'tabular-nums' }
const won = n => n == null || !isFinite(n) ? '—' : Math.round(n).toLocaleString('ko-KR')
const man = n => n == null || !isFinite(n) ? '—' : `${(Math.round(n / 1000) / 10).toLocaleString('ko-KR')}만원`
const pad = n => String(n).padStart(2, '0')
const addDays = (s, n) => { const d = new Date(`${s}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const ymNext = ym => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}` }
const todayStr = () => { const n = new Date(); return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}` }
const DOW = ['일', '월', '화', '수', '목', '금', '토']
const EARLY_DEFAULT = { start: '2026-11-16', marginDel: 20, marginHall: 50, days: [1, 2, 3, 4, 5], costOn: true, wage: 10320, hours: 1.5 }

const totalOf = r => {
  if (!r || typeof r !== 'object') return 0
  const c = r.close && ((r.close.kiosk || 0) + (r.close.del || 0) + (r.close.pos || 0)) > 0 ? r.close : r
  return (+c.kiosk || 0) + (+c.del || 0) + (+c.pos || 0)
}
const earlyOf = r => r ? (+r.earlyKiosk || 0) + (+r.earlyDel || 0) + (+r.earlyPos || 0) : 0
const dowOf = s => new Date(`${s}T00:00:00`).getDay()
const isHoliday = (s, holidays) => (holidays || []).some(h => h.startDate <= s && s <= h.endDate)
// 얼리 여는 날: 시작일 이후, 정한 요일, 임시휴무 아님
const isEarlyDay = (s, cfg, holidays) => s >= cfg.start && (cfg.days || EARLY_DEFAULT.days).includes(dowOf(s)) && !isHoliday(s, holidays)

// 한 달 얼리 요약: 얼리 여는 날(오늘은 적었을 때만, 미래 제외)마다 인건비, 적은 날의 매출로 이익
function monthEarly(docs, ym, cfg, holidays, today) {
  const doc = docs[ym] || {}
  const last = new Date(+ym.slice(0, 4), +ym.slice(5), 0).getDate()
  let open = 0, days = 0, early = 0, total = 0, hall = 0, del = 0, etc = 0
  const missing = []
  for (let i = 1; i <= last; i++) {
    const dd = pad(i), date = `${ym}-${dd}`, r = doc[dd]
    const e = earlyOf(r)
    if (date > today || (date === today && !e)) continue
    if (isEarlyDay(date, cfg, holidays)) { open++; if (!e) missing.push(date) }
    if (!e || date < cfg.start) continue
    days++; early += e; total += totalOf(r)
    hall += +r.earlyKiosk || 0; del += +r.earlyDel || 0; etc += +r.earlyPos || 0
  }
  const gross = del * (+cfg.marginDel || 0) / 100 + (hall + etc) * (+cfg.marginHall || 0) / 100
  const cost = cfg.costOn ? open * (+cfg.wage || 0) * (+cfg.hours || 0) : 0
  return { open, days, missing, early, total, hall, del, etc, gross, cost, profit: gross - cost,
    share: total ? early / total : null, perDay: days ? early / days : null, totalPerDay: days ? total / days : null }
}

export default function EarlySales({ ym }) {
  const [cfg, setCfg] = useState(null)
  const [docs, setDocs] = useState(null)   // { 'YYYY-MM': revenue 문서 }
  const [holidays, setHolidays] = useState([])
  const [edit, setEdit] = useState(null)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let alive = true
    getDoc(doc(db, 'checklist', 'holidays')).then(s => { if (alive) setHolidays(s.exists() ? (s.data().list || []) : []) }).catch(() => {})
    getDoc(doc(db, 'revenue', '_early')).then(s => s.exists() ? { ...EARLY_DEFAULT, ...s.data() } : EARLY_DEFAULT).catch(() => EARLY_DEFAULT)
      .then(c => {
        // 시작 전 4주가 걸친 달 ~ 보는 달 (보는 달이 시작 전이면 그 달만)
        const from = addDays(c.start, -28).slice(0, 7)
        const ids = []
        for (let m = from; m <= (ym > c.start.slice(0, 7) ? ym : c.start.slice(0, 7)) && ids.length < 36; m = ymNext(m)) ids.push(m)
        return Promise.all(ids.map(id => getDoc(doc(db, 'revenue', id)).then(s => [id, s.exists() ? s.data() : {}]).catch(() => [id, {}])))
          .then(list => { if (alive) { setCfg(c); setDocs(Object.fromEntries(list)) } })
      })
    return () => { alive = false }
  }, [ym])

  if (!cfg || !docs) return null
  if (ym < cfg.start.slice(0, 7)) return null
  const today = todayStr()
  const cur = monthEarly(docs, ym, cfg, holidays, today)
  const dayTotal = d => totalOf(docs[d.slice(0, 7)]?.[d.slice(8, 10)])
  const daysOn = (cfg.days || EARLY_DEFAULT.days)
  // 시작 전 4주 · 얼리 요일 하루 평균 (마감이 있는 날)
  let bN = 0, bSum = 0
  for (let d = addDays(cfg.start, -28); d < cfg.start; d = addDays(d, 1)) {
    if (!daysOn.includes(dowOf(d)) || isHoliday(d, holidays)) continue
    const t = dayTotal(d)
    if (t > 0) { bN++; bSum += t }
  }
  const before = bN ? bSum / bN : null
  // 시작 뒤 · 얼리 여는 날 하루 평균 (마감이 있는 날), 달별 표
  let aN = 0, aSum = 0, allEarly = 0, allDays = 0, allGross = 0
  const months = []
  for (let m = cfg.start.slice(0, 7); m <= ym; m = ymNext(m)) {
    const x = monthEarly(docs, m, cfg, holidays, today)
    if (x.open || x.days) months.push({ ym: m, ...x })
    allEarly += x.early; allDays += x.days; allGross += x.gross
    const last = new Date(+m.slice(0, 4), +m.slice(5), 0).getDate()
    for (let i = 1; i <= last; i++) {
      const d = `${m}-${pad(i)}`
      if (d > today || !isEarlyDay(d, cfg, holidays)) continue
      const t = dayTotal(d)
      if (t > 0) { aN++; aSum += t }
    }
  }
  const after = aN ? aSum / aN : null
  const lift = before != null && after != null ? after - before : null
  const earlyPerDay = allDays ? allEarly / allDays : null
  const blended = allEarly ? allGross / allEarly : null   // 얼리 매출의 홀·배달 섞인 이익률
  const newPart = lift != null && earlyPerDay != null ? Math.max(0, Math.min(lift, earlyPerDay)) : null

  const leader = <span aria-hidden="true" style={{flex:1, borderBottom:`1px dotted ${T.faint}`, margin:'0 8px', minWidth:12, transform:'translateY(-4px)'}}/>
  const line = (label, value, { note, strong, color, sub } = {}) => (
    <div style={{display:'flex', alignItems:'baseline', padding: sub ? '3px 0 3px 14px' : '6px 0', fontSize: strong ? 16 : sub ? 13 : 14, fontWeight: strong ? 800 : sub ? 400 : 600, color: sub ? T.sub : T.ink}}>
      <span style={{whiteSpace:'nowrap'}}>{label}</span>
      {note && <span style={{fontSize:12, color:T.sub, marginLeft:6, fontWeight:400, whiteSpace:'nowrap'}}>{note}</span>}
      {leader}<span style={{...num, whiteSpace:'nowrap', color: color || 'inherit'}}>{value}</span>
    </div>
  )
  async function save() {
    const c = { start: edit.start || EARLY_DEFAULT.start, marginDel: +edit.marginDel || 0, marginHall: +edit.marginHall || 0,
      days: (edit.days || []).length ? [...edit.days].sort() : EARLY_DEFAULT.days, costOn: !!edit.costOn, wage: +edit.wage || 0, hours: +edit.hours || 0 }
    try { await setDoc(doc(db, 'revenue', '_early'), c); setCfg(c); setEdit(null); setMsg('저장했어요') }
    catch (e) { console.error(e); setMsg('저장하지 못했어요') }
  }
  const inp = w => ({ background:'#FFFFFF', border:`1px solid ${T.rule}`, borderRadius:4, color:T.ink, padding:'5px 8px', fontSize:13, fontFamily:'inherit', width:w, boxSizing:'border-box', ...num })

  return (
    <section style={{marginBottom:30}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:10, flexWrap:'wrap', borderBottom:`2px solid ${T.ink}`, paddingBottom:6, marginBottom:6}}>
        <h2 style={{fontSize:16, fontWeight:800, margin:0, fontFamily:'inherit', color:T.ink}}>얼리 영업 <span style={{fontSize:12, fontWeight:500, color:T.sub}}>9:00~10:30 · {daysOn.map(d => DOW[d]).join('')} · {+cfg.start.slice(5, 7)}/{+cfg.start.slice(8)}부터</span></h2>
        <button type="button" onClick={() => setEdit(edit ? null : { ...cfg })}
          style={{background:'none', border:'none', color:'#2B5C9E', fontSize:12, cursor:'pointer', fontFamily:'inherit', padding:0}}>{edit ? '닫기' : '설정'}</button>
      </div>

      {edit && (
        <div style={{display:'flex', gap:12, flexWrap:'wrap', alignItems:'flex-end', background:T.field, borderRadius:4, padding:'10px 12px', margin:'6px 0 10px', fontSize:12, color:T.sub}}>
          <label>시작일<br/><input type="date" value={edit.start} onChange={e => setEdit(v => ({ ...v, start: e.target.value }))} style={inp(150)}/></label>
          <label>배달 이익률 (%)<br/><input type="text" inputMode="decimal" value={edit.marginDel} onChange={e => setEdit(v => ({ ...v, marginDel: e.target.value.replace(/[^0-9.]/g, '') }))} style={inp(70)}/></label>
          <label>홀·기타 이익률 (%)<br/><input type="text" inputMode="decimal" value={edit.marginHall} onChange={e => setEdit(v => ({ ...v, marginHall: e.target.value.replace(/[^0-9.]/g, '') }))} style={inp(70)}/></label>
          <span>얼리 여는 요일<br/>
            <span style={{display:'inline-flex', gap:3, marginTop:2}}>{[1, 2, 3, 4, 5, 6].map(d => {
              const on = (edit.days || []).includes(d)
              return <button key={d} type="button" onClick={() => setEdit(v => ({ ...v, days: on ? v.days.filter(x => x !== d) : [...(v.days || []), d] }))}
                style={{width:28, padding:'5px 0', borderRadius:4, border: on ? 'none' : `1px solid ${T.rule}`, background: on ? T.ink : '#FFFFFF', color: on ? '#FFFFFF' : T.ink, fontSize:12, cursor:'pointer', fontFamily:'inherit'}}>{DOW[d]}</button>
            })}</span>
          </span>
          <label style={{display:'flex', alignItems:'center', gap:4, paddingBottom:6}}><input type="checkbox" checked={!!edit.costOn} onChange={e => setEdit(v => ({ ...v, costOn: e.target.checked }))}/>내 시간 인건비로 빼기</label>
          {edit.costOn && <>
            <label>시급<br/><input type="text" inputMode="numeric" value={edit.wage} onChange={e => setEdit(v => ({ ...v, wage: e.target.value.replace(/[^0-9]/g, '') }))} style={inp(90)}/></label>
            <label>하루 시간<br/><input type="text" inputMode="decimal" value={edit.hours} onChange={e => setEdit(v => ({ ...v, hours: e.target.value.replace(/[^0-9.]/g, '') }))} style={inp(60)}/></label>
          </>}
          <button type="button" onClick={save} style={{background:T.accent, color:'#FFFFFF', border:'none', borderRadius:4, padding:'7px 14px', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit'}}>저장</button>
        </div>
      )}
      {msg && !edit && <div style={{fontSize:12, color:T.sub, marginBottom:4}}>{msg}</div>}

      {cur.missing.length > 0 && (
        <div style={{fontSize:12, color:T.amber, margin:'4px 0 2px'}}>
          얼리 매출을 아직 안 적은 날 {cur.missing.length}일: {cur.missing.map(d => `${+d.slice(5, 7)}/${+d.slice(8)}`).join(', ')} · 매출관리 → 매출 입력 '얼리' 탭에서 적으면 정확해져요
        </div>
      )}
      {!cur.days ? (
        <div style={{fontSize:13, color:T.sub, padding:'8px 0'}}>이 달에 적은 얼리 매출이 없어요. 매출관리 → 매출 입력의 '얼리' 탭에서 10시 30분까지의 매출을 적으면 여기 쌓여요.</div>
      ) : (
        <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap:'6px 40px'}}>
          <div>
            <div style={{fontSize:15, fontWeight:800, margin:'6px 0 4px', color: cur.profit >= 0 ? T.green : T.red, ...num}}>
              {+ym.slice(5)}월 얼리로 {man(cur.early)} 팔고 {cur.profit >= 0 ? `약 ${man(cur.profit)} 남았어요` : `약 ${man(-cur.profit)} 손해예요`}
            </div>
            {line('얼리 매출', `${won(cur.early)}원`, { note:`적은 ${cur.days}일 · 하루 평균 ${won(cur.perDay)}원` })}
            {cur.hall > 0 && line('홀', `${won(cur.hall)}원`, { sub:true })}
            {cur.del > 0 && line('배달', `${won(cur.del)}원`, { sub:true })}
            {cur.etc > 0 && line('기타', `${won(cur.etc)}원`, { sub:true })}
            {line('하루 매출 중 얼리', cur.share != null ? `${(cur.share * 100).toFixed(1)}%` : '—', { note:`그날들 하루 평균 ${won(cur.totalPerDay)}원` })}
            {line('이익', `${won(cur.gross)}원`, { note:`배달 ${cfg.marginDel}% · 홀·기타 ${cfg.marginHall}%` })}
            {line('배달분', `${won(cur.del * cfg.marginDel / 100)}원`, { sub:true })}
            {line('홀·기타분', `${won((cur.hall + cur.etc) * cfg.marginHall / 100)}원`, { sub:true })}
            {cfg.costOn && line('내 시간 인건비', `−${won(cur.cost)}원`, { note:`${won(cfg.wage)}원 × ${cfg.hours}시간 × 얼리 연 ${cur.open}일`, color:T.red })}
            <div style={{borderTop:`3px double ${T.ink}`, marginTop:4, paddingTop:2}}>
              {line('얼리로 남은 돈', `${won(cur.profit)}원`, { strong:true, color: cur.profit >= 0 ? T.green : T.red })}
            </div>
          </div>
          <div>
            <div style={{fontSize:13, fontWeight:700, color:T.ink, margin:'8px 0 2px'}}>하루 매출이 정말 늘었나</div>
            {line('얼리 시작 전 4주', before != null ? `${won(before)}원 / 하루` : '—', { note: bN ? `${daysOn.map(d => DOW[d]).join('')} ${bN}일 평균` : '마감 기록 없음' })}
            {line('얼리 시작 뒤', after != null ? `${won(after)}원 / 하루` : '—', { note:`얼리 연 ${aN}일 평균` })}
            {lift != null && line('차이', `${lift >= 0 ? '+' : '−'}${won(Math.abs(lift))}원`, { color: lift >= 0 ? T.green : T.red, strong:true })}
            {newPart != null && earlyPerDay > 0 && (
              <div style={{fontSize:12, color:T.sub, lineHeight:1.6, marginTop:4}}>
                얼리 매출 하루 {won(earlyPerDay)}원 중 약 {won(newPart)}원({Math.round(newPart / earlyPerDay * 100)}%)이 새로 늘어난 매출로 보여요.
                {newPart < earlyPerDay && ' 나머지는 원래 점심에 왔을 손님이 일찍 온 것일 수 있어요.'} 날씨·시험기간 영향도 섞이니 몇 주 쌓이면 더 정확해져요.
              </div>
            )}
            {newPart != null && (() => {
              const real = newPart * (blended || 0) * cur.open - cur.cost
              return line('늘어난 매출만 치면', `${won(real)}원`, { note:`${+ym.slice(5)}월 얼리 연 ${cur.open}일 기준`, color: real >= 0 ? T.green : T.red })
            })()}
            {months.length > 1 && (
              <table style={{width:'100%', borderCollapse:'collapse', fontSize:12, marginTop:10, ...num}}>
                <thead><tr style={{color:T.sub, fontSize:11, textAlign:'right'}}>
                  <th style={{textAlign:'left', padding:'4px 6px', fontWeight:500}}>달</th><th style={{padding:'4px 6px', fontWeight:500}}>얼리 매출</th>
                  <th style={{padding:'4px 6px', fontWeight:500}}>비중</th><th style={{padding:'4px 6px', fontWeight:500}}>남은 돈</th>
                </tr></thead>
                <tbody>{months.map(m => (
                  <tr key={m.ym} style={{borderTop:`1px solid ${T.soft}`, textAlign:'right'}}>
                    <td style={{textAlign:'left', padding:'5px 6px'}}>{m.ym.slice(0, 4)}.{m.ym.slice(5)} <span style={{color:T.sub}}>({m.open}일)</span></td>
                    <td style={{padding:'5px 6px'}}>{won(m.early)}원</td>
                    <td style={{padding:'5px 6px'}}>{m.share != null ? `${(m.share * 100).toFixed(1)}%` : '—'}</td>
                    <td style={{padding:'5px 6px', color: m.profit >= 0 ? T.green : T.red}}>{won(m.profit)}원</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
