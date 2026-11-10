import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'
import { loadMyPayslip, loadMyPrivate } from '../lib/privateInfo'

// 임금명세서 모아보기 (직원 내 급여): 사장님이 급여를 확정한 달은 자동으로 명세서가 쌓임
// 근로기준법 시행령 제27조의2 기재 사항: 근로자 정보, 임금지급일, 임금 총액, 항목별 금액(기본급·수당·상여),
// 근로일수·총 근로시간, 항목별 계산 방법, 공제 항목별 금액과 총액
// 데이터: payslips/{uid}/months/{달} (확정된 급여·상여의 내 복사본), workhours/workextra/{달}[uid] (근로일수), userPrivate/{uid} (생년월일)
const T = { ink:'#1D1B18', sub:'#6E6A63', rule:'#DCD7CE', soft:'#ECE8E1', chip:'#F3F1EC', accent:'#C3261C', green:'#2E7D45', blue:'#2B5C9E' }
const num = { fontVariantNumeric:'tabular-nums' }
const pad = n => String(n).padStart(2, '0')
const won = n => `${Math.round(n || 0).toLocaleString('ko-KR')}원`
const mLabel = ym => { const [y, m] = ym.split('-'); return `${y}년 ${+m}월` }
const lastDay = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate() }

// 입사한 달(없으면 2년 전)부터 이번 달까지 (최대 36개월)
function monthsFor(joinDate) {
  const now = new Date()
  const start = joinDate && !isNaN(new Date(joinDate)) ? new Date(joinDate) : new Date(now.getFullYear() - 2, now.getMonth(), 1)
  const out = []
  for (let d = new Date(now.getFullYear(), now.getMonth(), 1); d >= new Date(start.getFullYear(), start.getMonth(), 1) && out.length < 36; d.setMonth(d.getMonth() - 1))
    out.push(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`)
  return out
}

export default function WageStatements({ uid, userData }) {
  const [list, setList] = useState(null)   // [{ ym, p, bonuses, days }]
  const [open, setOpen] = useState(null)
  const [ssn, setSsn] = useState('')

  useEffect(() => {
    if (!uid) return
    let off = false
    const months = monthsFor(userData?.joinDate)
    const safe = p => p.then(s => s.exists() ? s.data() : null).catch(() => null)
    loadMyPrivate(uid, userData).then(pr => { if (!off) setSsn(pr.ssn || '') })
    Promise.all(months.map(ym => loadMyPayslip(uid, ym).then(async mine => {
      const p = mine.pay
      if (!p?.confirmedByOwner) return null
      const [wh, ex] = await Promise.all([safe(getDoc(doc(db, 'workhours', ym))), safe(getDoc(doc(db, 'workextra', ym)))])
      const h = wh?.[uid] || {}, e = ex?.[uid] || {}
      const days = Object.keys({ ...h, ...e }).filter(dd => /^\d\d$/.test(dd) && ((+h[dd] || 0) > 0 || (+e[dd] || 0) > 0)).length
      return { ym, p, bonuses: mine.bonuses, days }
    }))).then(rows => { if (!off) setList(rows.filter(Boolean)) })
    return () => { off = true }
  }, [uid, userData?.joinDate]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!list) return null
  return (
    <section style={{marginTop:24}}>
      <style>{STATEMENT_PRINT_CSS}</style>
      <div style={{borderBottom:`2px solid ${T.ink}`, paddingBottom:6, marginBottom:6, display:'flex', alignItems:'baseline', gap:10, flexWrap:'wrap'}}>
        <h2 style={{fontSize:16, fontWeight:800, margin:0, fontFamily:'inherit', color:T.ink}}>임금명세서</h2>
        <span style={{fontSize:12, color:T.sub}}>사장님이 급여를 확정한 달은 여기에 자동으로 쌓여요</span>
      </div>
      {list.length === 0 && <div style={{fontSize:13, color:T.sub, padding:'8px 0'}}>아직 확정된 급여가 없어요</div>}
      {list.map(r => (
        <div key={r.ym} style={{borderBottom:`1px solid ${T.soft}`}}>
          <button type="button" onClick={()=>setOpen(o => o === r.ym ? null : r.ym)} className="ws-noprint"
            style={{display:'flex', width:'100%', alignItems:'baseline', gap:10, padding:'10px 0', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', color:T.ink, textAlign:'left'}}>
            <b style={{fontSize:14, minWidth:96}}>{mLabel(r.ym)}</b>
            <span style={{fontSize:12, color: r.p.paid ? T.blue : T.sub}}>{r.p.paid ? `지급 ${r.p.paidAt?.slice(0,10) || ''}` : '지급 전'}</span>
            <span style={{flex:1}}/>
            <span style={{fontSize:14, fontWeight:700, ...num}}>{won((r.p.netPay || 0) + r.bonuses.reduce((a, b) => a + (+b.amount || 0), 0))}</span>
            <span style={{fontSize:12, color:T.blue}}>{open === r.ym ? '접기' : '보기'}</span>
          </button>
          {open === r.ym && <Statement r={r} userData={userData} ssn={ssn}/>}
        </div>
      ))}
    </section>
  )
}

// 인쇄할 때 명세서만 보이게
export const STATEMENT_PRINT_CSS = `@media print {
  body * { visibility: hidden !important; }
  #wage-statement-print, #wage-statement-print * { visibility: visible !important; }
  #wage-statement-print { position: absolute; left: 0; top: 0; width: 100%; }
  .ws-noprint { display: none !important; }
}`

// r = { ym, p, bonuses, days }. 사장님 본인 명세서(급여관리)도 이걸로 그림: days 가 null 이면 근로일수 '—'
export function Statement({ r, userData, ssn }) {
  const { ym, p, bonuses, days } = r
  const d = p.deduction || {}
  const bonusTotal = bonuses.reduce((a, b) => a + (+b.amount || 0), 0)
  const gross = (p.totalPay || 0) + bonusTotal
  // 3.3%는 소득세 3% + 지방소득세 0.3%로 나눠 적음
  // 사장님 명세서처럼 소득세·지방소득세를 따로 적어 둔 경우는 그 값, 아니면 3.3%를 3% / 0.3%로 나눔
  const incomeTax = d.incomeTax ?? (d.tax ? Math.round((p.totalPay || 0) * 0.03) : 0)
  const localTax = d.localTax ?? (d.tax ? d.tax - incomeTax : 0)
  const deductions = [
    ['소득세', incomeTax], ['지방소득세', localTax], ['국민연금', d.pension], ['건강보험', d.health], ['장기요양보험', d.care], ['고용보험', d.employ],
  ].filter(([, v]) => v > 0)
  const dedTotal = d.total || 0
  const hours = `${p.totalHours || 0}시간${p.totalMins ? ` ${p.totalMins}분` : ''}`
  const row = (k, v, opt = {}) => (
    <div style={{display:'flex', alignItems:'baseline', gap:8, padding:'6px 0', borderBottom: opt.last ? 'none' : `1px dotted ${T.rule}`, fontSize:13, fontWeight: opt.bold ? 800 : 400}}>
      <span style={{color: opt.bold ? T.ink : T.sub, minWidth:96}}>{k}</span>
      {opt.note && <span style={{fontSize:11, color:T.sub, flex:1}}>{opt.note}</span>}
      {!opt.note && <span style={{flex:1}}/>}
      <span style={{...num, color: opt.color || T.ink}}>{v}</span>
    </div>
  )
  const head = t => <div style={{fontSize:12, fontWeight:800, color:T.ink, margin:'14px 0 2px', borderBottom:`1px solid ${T.ink}`, paddingBottom:3}}>{t}</div>

  return (
    <div id="wage-statement-print" style={{background:'#FFFFFF', border:`1px solid ${T.rule}`, borderRadius:6, padding:'18px 20px', margin:'4px 0 14px'}}>
      <div style={{textAlign:'center', borderBottom:`3px double ${T.ink}`, paddingBottom:8}}>
        <div style={{fontSize:18, fontWeight:900, letterSpacing:4}}>임금명세서</div>
        <div style={{fontSize:12, color:T.sub, marginTop:2}}>{mLabel(ym)}분 · 홍콩반점 중앙대점</div>
      </div>

      {head('근로자')}
      {row('성명', userData?.name || '')}
      {ssn && row('생년월일', String(ssn).slice(0, 6))}
      {userData?.joinDate && row('입사일', userData.joinDate)}
      {row('임금 계산 기간', `${ym}-01 ~ ${ym}-${lastDay(ym)}`)}
      {row('임금 지급일', p.paid ? (p.paidAt?.slice(0, 10) || '지급함') : '지급 전', { last:true })}

      {head('근로 시간')}
      {row('근로일수', days == null ? '—' : `${days}일`)}
      {row('총 근로시간', p.isFixed ? '월급제' : hours, { last:true })}

      {head('지급 항목')}
      {p.isFixed
        ? row('기본급 (월급)', won(p.basePay))
        : row('기본급', won(p.basePay), { note:`시급 ${won(p.wage)} × ${hours}` })}
      {(p.weeklyHoliday || 0) > 0 && row('주휴수당', won(p.weeklyHoliday), { note:'주 15시간 이상 근무하고 소정근로일을 다 나온 주' })}
      {bonuses.map((b, i) => <div key={i}>{row(b.memo ? `상여 (${b.memo})` : '상여', won(b.amount))}</div>)}
      {row('지급 총액', won(gross), { bold:true, last:true })}

      {head('공제 항목')}
      {deductions.length === 0 && row('공제', dedTotal > 0 ? won(dedTotal) : '없음')}
      {deductions.map(([k, v]) => <div key={k}>{row(k, won(v), { note: d.tax && (k === '소득세' || k === '지방소득세') ? '사업소득 원천징수 3.3% (상여 제외)' : undefined })}</div>)}
      {row('공제 총액', won(dedTotal), { bold:true, last:true })}

      <div style={{display:'flex', alignItems:'baseline', marginTop:12, paddingTop:8, borderTop:`3px double ${T.ink}`, fontSize:15, fontWeight:900}}>
        <span>실지급액</span><span style={{flex:1}}/><span style={{...num, color:T.accent}}>{won(gross - dedTotal)}</span>
      </div>
      <div style={{fontSize:11, color:T.sub, marginTop:8, lineHeight:1.6}}>
        {p.confirmedAt ? `확정일 ${p.confirmedAt.slice(0, 10)}` : ''}
      </div>
      <div className="ws-noprint" style={{marginTop:12}}>
        <button type="button" onClick={()=>window.print()}
          style={{fontFamily:'inherit', fontSize:13, padding:'7px 14px', borderRadius:4, border:`1px solid ${T.rule}`, background:'#FFFFFF', color:T.ink, cursor:'pointer'}}>인쇄 · PDF로 저장</button>
      </div>
    </div>
  )
}
