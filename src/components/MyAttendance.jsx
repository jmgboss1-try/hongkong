import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'
import { hm, toDate, calcRecord, minsLabel, monthStatus, loadMonthContext } from '../lib/attendance'

const DAYS_KR = ['일','월','화','수','목','금','토']
const T = { ink:'#1D1B18', sub:'#6E6A63', rule:'#DCD7CE', soft:'#ECE8E1', red:'#B42318', green:'#2E7D45', amber:'#B45309' }
const num = { fontVariantNumeric:'tabular-nums' }

// 내 기록: 이 달 내 출퇴근 (지각·조퇴·결근, 인정 시간, 승인 대기)과 개근 포상 결과
export default function MyAttendance({ curMonth, uid }) {
  const [data, setData] = useState(null)

  useEffect(() => {
    let off = false
    Promise.all([
      loadMonthContext(curMonth),
      getDoc(doc(db,'users',uid)).then(s => s.exists() ? s.data() : {}),
      getDoc(doc(db,'rewards',curMonth)).then(s => s.exists() ? s.data() : null).catch(() => null),
    ]).then(([ctx, me, reward]) => {
      if (off) return
      const st = monthStatus({ ym:curMonth, uid, user:me, recs:ctx.att[uid], holidays:ctx.holidays, subs:ctx.subs, since:ctx.since })
      setData({ st, mine: reward?.list?.find(r => r.uid === uid) || null })
    }).catch(e => { console.error(e); if (!off) setData({ error:true }) })
    return () => { off = true }
  }, [curMonth, uid])

  if (!data || data.error) return null
  const { st, mine } = data
  if (!st.days.length && !mine) return null
  const c = st.cnt
  const [y, m] = curMonth.split('-').map(Number)
  const dow = dd => DAYS_KR[new Date(y, m-1, +dd).getDay()]

  return (
    <section style={{marginBottom:20}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:10, flexWrap:'wrap', borderBottom:`2px solid ${T.ink}`, paddingBottom:6, marginBottom:6}}>
        <h2 style={{fontSize:16, fontWeight:800, margin:0, fontFamily:'inherit', color:T.ink}}>내 출퇴근</h2>
        {st.perfect && <span style={{fontSize:13, fontWeight:800, color:T.green}}>{st.monthOver ? `${m}월 개근` : '지금까지 개근 중'}</span>}
      </div>
      <div style={{display:'flex', gap:14, flexWrap:'wrap', fontSize:13, padding:'4px 0 8px', ...num}}>
        <span>출근 <b>{c.worked}</b>일</span>
        <span style={{color: c.late ? T.red : T.sub}}>지각 <b>{c.late}</b>회{c.late ? ` (${minsLabel(c.lateMins)})` : ''}</span>
        <span style={{color: c.leftEarly ? T.red : T.sub}}>조퇴 <b>{c.leftEarly}</b>회</span>
        <span style={{color: c.absent ? T.red : T.sub}}>결근 <b>{c.absent}</b>일</span>
      </div>
      {mine && (
        <div style={{borderLeft:`4px solid ${T.green}`, background:'#2E7D4510', borderRadius:'0 4px 4px 0', padding:'7px 12px', fontSize:14, marginBottom:8}}>
          {m}월 개근 포상: <b>{mine.prize}</b>{mine.paid ? ` · 급여 상여로 ${mine.amount.toLocaleString('ko-KR')}원` : ''}
        </div>
      )}
      {[...st.days].reverse().map(d => {
        const calc = d.rec?.in ? calcRecord(d.rec) : null
        return (
          <div key={d.dd} style={{display:'flex', alignItems:'baseline', gap:10, padding:'7px 0', borderBottom:`1px solid ${T.soft}`, fontSize:13, flexWrap:'wrap'}}>
            <span style={{...num, color:T.sub, minWidth:62}}>{+d.dd}일 ({dow(d.dd)})</span>
            {d.rec?.in
              ? <span style={{...num, fontWeight:600}}>{hm(toDate(d.rec.in))} ~ {d.rec.out ? hm(toDate(d.rec.out)) : '—'}</span>
              : <span style={{color:T.sub}}>기록 없음</span>}
            {d.sched && <span style={{fontSize:12, color:T.sub}}>예정 {d.sched.start}~{d.sched.end}</span>}
            <span style={{flex:1}}/>
            {d.late > 0 && <b style={{color:T.red}}>지각 {minsLabel(d.late)}</b>}
            {d.leftEarly > 0 && <b style={{color:T.red}}>조퇴 {minsLabel(d.leftEarly)}</b>}
            {d.absent && <b style={{color:T.red}}>결근</b>}
            {d.excused && <span style={{color:T.sub}}>사유 인정</span>}
            {d.noOut && <b style={{color:T.amber}}>퇴근 안 찍음</b>}
            {calc && <span style={{...num}}>인정 {minsLabel(calc.total)}</span>}
            {calc?.pending && <span style={{color:T.amber, fontSize:12, fontWeight:700}}>승인 대기</span>}
          </div>
        )
      })}
    </section>
  )
}
