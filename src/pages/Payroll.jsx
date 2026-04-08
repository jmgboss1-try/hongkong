import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }

// 주휴수당 계산 (1주 15시간 이상 근무시 발생)
// 주휴수당 = (1주 총 근무시간 / 40) * 8 * 시급
function calcWeeklyHoliday(weekHours, wage) {
  if (weekHours < 15) return 0
  return Math.round((weekHours / 40) * 8 * wage)
}

function calcPayroll(schData, wage) {
  if (!schData) return { totalHours:0, totalWage:0, weeklyHoliday:0, totalWithHoliday:0, weeks:[] }

  // 날짜별 시간 정리
  const dayHours = {}
  Object.entries(schData).forEach(([dd,h]) => { dayHours[+dd] = h })

  // 주차별 계산 (월요일 기준)
  const weeks = []
  const days = Object.keys(dayHours).map(Number).sort((a,b)=>a-b)
  if (days.length === 0) return { totalHours:0, totalWage:0, weeklyHoliday:0, totalWithHoliday:0, weeks:[] }

  // 간단하게 7일씩 묶어서 주차 계산
  let weekStart = 1
  while (weekStart <= 31) {
    const weekEnd = weekStart + 6
    const weekDays = days.filter(d => d >= weekStart && d <= weekEnd)
    const weekHours = weekDays.reduce((a,d) => a + (dayHours[d]||0), 0)
    const holiday = calcWeeklyHoliday(weekHours, wage)
    if (weekHours > 0) {
      weeks.push({
        label: `${weekStart}일~${Math.min(weekEnd,31)}일`,
        hours: weekHours,
        wage: Math.round(weekHours * wage),
        holiday
      })
    }
    weekStart += 7
  }

  const totalHours = days.reduce((a,d) => a + (dayHours[d]||0), 0)
  const totalWage = Math.round(totalHours * wage)
  const weeklyHoliday = weeks.reduce((a,w) => a + w.holiday, 0)
  const totalWithHoliday = totalWage + weeklyHoliday

  return { totalHours, totalWage, weeklyHoliday, totalWithHoliday, weeks }
}

export default function Payroll() {
  const [curMonth, setCurMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [employees, setEmployees] = useState([])
  const [schData, setSchData] = useState({})
  const [loading, setLoading] = useState(true)
  const [activeEmp, setActiveEmp] = useState(null)

  const monthOpts = []
  for(let y=2022;y<=2026;y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const empSnap = await getDoc(doc(db,'meta','employees'))
        const emps = empSnap.exists() ? empSnap.data().list || [] : []
        setEmployees(emps)
        const schSnap = await getDoc(doc(db,'schedule',curMonth))
        setSchData(schSnap.exists() ? schSnap.data() : {})
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [curMonth])

  const payrolls = employees.map(e => ({
    ...e,
    ...calcPayroll(schData[e.uid], e.wage||10030)
  }))

  const totalWage = payrolls.reduce((a,p) => a + p.totalWage, 0)
  const totalHoliday = payrolls.reduce((a,p) => a + p.weeklyHoliday, 0)
  const totalAll = payrolls.reduce((a,p) => a + p.totalWithHoliday, 0)

  const today = new Date()
  const dateStr = `${today.getFullYear()}년 ${today.getMonth()+1}월 ${today.getDate()}일`

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>📄 인건비 보고서</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>{mLabel(curMonth)} — 주휴수당 포함</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <button onClick={()=>window.print()}
            style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'9px 18px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
            🖨️ 인쇄 / PDF
          </button>
          <select value={curMonth} onChange={e=>setCurMonth(e.target.value)}
            style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,color:'#dde1f2',padding:'8px 12px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
            {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
          </select>
        </div>
      </div>

      {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:60}}>로딩 중...</div> : (
        <>
          {/* 요약 카드 */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:20}}>
            {[
              {label:'기본급 합계', val:totalWage, color:'#f9b934'},
              {label:'주휴수당 합계', val:totalHoliday, color:'#93c5fd'},
              {label:'총 지급액', val:totalAll, color:'#34d399'},
            ].map(k=>(
              <div key={k.label} style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'18px 20px',position:'relative',overflow:'hidden'}}>
                <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:k.color}}></div>
                <div style={{fontSize:10,fontWeight:600,color:'#5e6585',textTransform:'uppercase',letterSpacing:.8,marginBottom:6}}>{k.label}</div>
                <div style={{fontSize:20,fontWeight:700,color:k.color,fontFamily:'DM Mono, monospace'}}>{k.val.toLocaleString()}원</div>
              </div>
            ))}
          </div>

          {/* 인원별 탭 */}
          <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
            <button onClick={()=>setActiveEmp(null)}
              style={{padding:'7px 14px',borderRadius:7,border:'none',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                background:activeEmp===null?'#f9b934':'#191c2b',color:activeEmp===null?'#000':'#5e6585'}}>
              전체
            </button>
            {payrolls.map(p=>(
              <button key={p.uid} onClick={()=>setActiveEmp(p.uid)}
                style={{padding:'7px 14px',borderRadius:7,border:'none',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                  background:activeEmp===p.uid?'#f9b934':'#191c2b',color:activeEmp===p.uid?'#000':'#5e6585'}}>
                {p.name}
              </button>
            ))}
          </div>

          {/* 전체 보기 */}
          {activeEmp === null && (
            <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden',marginBottom:18}}>
              <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>전체 급여 내역</div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead>
                    <tr style={{background:'#191c2b'}}>
                      {['직원','시급','근무시간','기본급','주휴수당','총 지급액'].map(h=>(
                        <th key={h} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:'#5e6585',textAlign:h==='직원'?'left':'right',whiteSpace:'nowrap'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {payrolls.map(p=>(
                      <tr key={p.uid} onClick={()=>setActiveEmp(p.uid)} style={{cursor:'pointer'}}>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',color:'#dde1f2',fontWeight:600}}>{p.name}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace'}}>{(p.wage||10030).toLocaleString()}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace'}}>{p.totalHours}h</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace'}}>{p.totalWage.toLocaleString()}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace',color:'#93c5fd'}}>{p.weeklyHoliday.toLocaleString()}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace',color:'#34d399',fontWeight:700}}>{p.totalWithHoliday.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{background:'#1f2236'}}>
                      <td style={{padding:'10px 14px',fontWeight:700,color:'#f9b934'}}>합 계</td>
                      <td></td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{payrolls.reduce((a,p)=>a+p.totalHours,0)}h</td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{totalWage.toLocaleString()}</td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{totalHoliday.toLocaleString()}</td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{totalAll.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* 개인 상세 보기 */}
          {activeEmp !== null && (() => {
            const p = payrolls.find(x=>x.uid===activeEmp)
            if (!p) return null
            return (
              <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden',marginBottom:18}}>
                <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span>{p.name} 급여 상세</span>
                  <span style={{fontSize:11,color:'#5e6585'}}>{mLabel(curMonth)}</span>
                </div>
                <div style={{padding:18}}>
                  {/* 요약 */}
                  <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10,marginBottom:16}}>
                    {[
                      {label:'총 근무시간', val:`${p.totalHours}h`, color:'#f9b934'},
                      {label:'기본급', val:`${p.totalWage.toLocaleString()}원`, color:'#dde1f2'},
                      {label:'주휴수당', val:`${p.weeklyHoliday.toLocaleString()}원`, color:'#93c5fd'},
                    ].map(k=>(
                      <div key={k.label} style={{background:'#191c2b',borderRadius:8,padding:'12px 14px'}}>
                        <div style={{fontSize:10,color:'#5e6585',marginBottom:4}}>{k.label}</div>
                        <div style={{fontSize:14,fontWeight:700,color:k.color,fontFamily:'DM Mono, monospace'}}>{k.val}</div>
                      </div>
                    ))}
                  </div>

                  {/* 총 지급액 */}
                  <div style={{background:'rgba(52,211,153,0.08)',border:'1px solid rgba(52,211,153,0.2)',borderRadius:8,padding:'14px 16px',marginBottom:16,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                    <div style={{fontSize:12,color:'#5e6585'}}>총 지급액 (기본급 + 주휴수당)</div>
                    <div style={{fontSize:20,fontWeight:700,color:'#34d399',fontFamily:'DM Mono, monospace'}}>{p.totalWithHoliday.toLocaleString()}원</div>
                  </div>

                  {/* 주차별 상세 */}
                  <div style={{fontSize:12,fontWeight:600,marginBottom:10}}>주차별 상세</div>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    {p.weeks.map((w,i)=>(
                      <div key={i} style={{background:'#191c2b',borderRadius:8,padding:'12px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                        <div>
                          <div style={{fontSize:11,fontWeight:600,marginBottom:3}}>{i+1}주차 ({w.label})</div>
                          <div style={{fontSize:10,color:'#5e6585'}}>{w.hours}h 근무 · 기본급 {w.wage.toLocaleString()}원</div>
                        </div>
                        <div style={{textAlign:'right'}}>
                          <div style={{fontSize:10,color:'#93c5fd',marginBottom:2}}>주휴수당 {w.holiday.toLocaleString()}원</div>
                          <div style={{fontSize:12,fontWeight:700,color:'#34d399',fontFamily:'DM Mono, monospace'}}>{(w.wage+w.holiday).toLocaleString()}원</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* 인쇄용 */}
                  <div id="printArea" style={{display:'none'}}>
                    <div style={{fontFamily:'Noto Sans KR, sans-serif', color:'#111', padding:'20px'}}>
                      <h2>홍콩반점 중앙대점 — {mLabel(curMonth)} 급여명세서</h2>
                      <p>성명: {p.name} | 시급: {(p.wage||10030).toLocaleString()}원 | 작성일: {dateStr}</p>
                      <hr/>
                      <p>총 근무시간: {p.totalHours}h</p>
                      <p>기본급: {p.totalWage.toLocaleString()}원</p>
                      <p>주휴수당: {p.weeklyHoliday.toLocaleString()}원</p>
                      <h3>총 지급액: {p.totalWithHoliday.toLocaleString()}원</h3>
                    </div>
                  </div>
                </div>
              </div>
            )
          })()}

          {/* 인쇄용 전체 문서 */}
          <div className="print-only" style={{background:'#fff',color:'#111',borderRadius:12,padding:'40px 44px',maxWidth:760,margin:'0 auto',fontFamily:'Noto Sans KR, sans-serif',boxShadow:'0 8px 40px rgba(0,0,0,.5)'}}>
            <div style={{fontSize:13,color:'#555',marginBottom:3}}>홍콩반점 중앙대점</div>
            <div style={{fontSize:24,fontWeight:900,color:'#111',marginBottom:4}}>인건비 지급 내역서</div>
            <div style={{fontSize:13,color:'#444',marginBottom:26,paddingBottom:16,borderBottom:'2.5px solid #111'}}>
              {mLabel(curMonth)} 귀속 &nbsp;|&nbsp; 작성일: {dateStr}
            </div>
            <table style={{width:'100%',borderCollapse:'collapse',marginBottom:28}}>
              <thead>
                <tr style={{background:'#111'}}>
                  {['성 명','시 급','근무시간','기본급','주휴수당','총 지급액'].map((h,i)=>(
                    <th key={h} style={{color:'#fff',padding:'11px 14px',fontSize:12,fontWeight:700,textAlign:i===0?'left':'center'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payrolls.map((p,i)=>(
                  <tr key={p.uid} style={{background:i%2===0?'#fafafa':'#fff'}}>
                    <td style={{padding:'12px 14px',borderBottom:'1px solid #e8e8e8',fontWeight:600}}>{p.name}</td>
                    <td style={{padding:'12px 14px',borderBottom:'1px solid #e8e8e8',textAlign:'center',fontFamily:'DM Mono, monospace'}}>{(p.wage||10030).toLocaleString()}원</td>
                    <td style={{padding:'12px 14px',borderBottom:'1px solid #e8e8e8',textAlign:'center',fontFamily:'DM Mono, monospace'}}>{p.totalHours}h</td>
                    <td style={{padding:'12px 14px',borderBottom:'1px solid #e8e8e8',textAlign:'center',fontFamily:'DM Mono, monospace'}}>{p.totalWage.toLocaleString()}원</td>
                    <td style={{padding:'12px 14px',borderBottom:'1px solid #e8e8e8',textAlign:'center',fontFamily:'DM Mono, monospace'}}>{p.weeklyHoliday.toLocaleString()}원</td>
                    <td style={{padding:'12px 14px',borderBottom:'1px solid #e8e8e8',textAlign:'center',fontFamily:'DM Mono, monospace',fontWeight:700}}>{p.totalWithHoliday.toLocaleString()}원</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{background:'#111'}}>
                  <td style={{padding:'13px 14px',color:'#fff',fontWeight:700}}>합 계</td>
                  <td style={{padding:'13px 14px',color:'#fff',textAlign:'center'}}>—</td>
                  <td style={{padding:'13px 14px',color:'#fff',textAlign:'center',fontFamily:'DM Mono, monospace'}}>{payrolls.reduce((a,p)=>a+p.totalHours,0)}h</td>
                  <td style={{padding:'13px 14px',color:'#fff',textAlign:'center',fontFamily:'DM Mono, monospace'}}>{totalWage.toLocaleString()}원</td>
                  <td style={{padding:'13px 14px',color:'#fff',textAlign:'center',fontFamily:'DM Mono, monospace'}}>{totalHoliday.toLocaleString()}원</td>
                  <td style={{padding:'13px 14px',color:'#fff',textAlign:'center',fontFamily:'DM Mono, monospace',fontSize:15}}>{totalAll.toLocaleString()}원</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
