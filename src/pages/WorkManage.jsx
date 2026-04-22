import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')
const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const DAYS_KR = ['일','월','화','수','목','금','토']

function calcWeeklyHoliday(totalHours, wage) {
  if(totalHours < 15) return 0
  return Math.round((totalHours/40)*8*wage)
}

export default function WorkManage() {
  const [curMonth, setCurMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [employees, setEmployees] = useState([])
  const [workHours, setWorkHours] = useState({})
  const [loading, setLoading] = useState(true)
  const [activeEmp, setActiveEmp] = useState(null)

  const monthOpts = []
  for(let y=2022;y<=2026;y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  async function load() {
    setLoading(true)
    try {
      // users 컬렉션에서 승인된 직원 불러오기
      const usersSnap = await getDocs(collection(db,'users'))
      const finalEmps = []
      usersSnap.forEach(d => {
        const data = d.data()
        if(data.status === 'approved' && data.role !== 'owner') {
          finalEmps.push({uid: d.id, name: data.name, wage: data.wage||10030, email: data.email})
        }
      })
      setEmployees(finalEmps)

      const whSnap = await getDoc(doc(db,'workhours',curMonth))
      setWorkHours(whSnap.exists() ? whSnap.data() : {})
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [curMonth])

  async function saveWorkHours(uid, dd, hours) {
    const h = +hours || 0
    const newWH = {
      ...workHours,
      [uid]: { ...(workHours[uid]||{}), [dd]: h }
    }
    if(!h) delete newWH[uid][dd]
    await setDoc(doc(db,'workhours',curMonth), newWH)
    setWorkHours(newWH)
  }

  function getEmpStats(emp) {
    const wh = workHours[emp.uid] || {}
    const wage = emp.wage || 10030
    const days = daysIn(curMonth)
    let totalHours = 0
    for(let d=1;d<=days;d++) {
      totalHours += wh[pad(d)] || 0
    }
    let weeklyHoliday = 0
    let weekStart = 1
    while(weekStart <= 31) {
      let weekH = 0
      for(let d=weekStart;d<weekStart+7&&d<=31;d++) weekH += wh[pad(d)]||0
      weeklyHoliday += calcWeeklyHoliday(weekH, wage)
      weekStart += 7
    }
    const basePay = Math.round(totalHours * wage)
    return { totalHours, basePay, weeklyHoliday, totalPay: basePay + weeklyHoliday }
  }

  const allStats = employees.map(e => ({ emp:e, ...getEmpStats(e) }))
  const grandTotal = allStats.reduce((a,s) => a + s.totalPay, 0)
  const grandBase = allStats.reduce((a,s) => a + s.basePay, 0)
  const grandHoliday = allStats.reduce((a,s) => a + s.weeklyHoliday, 0)

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>⏱ 근무관리</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>{mLabel(curMonth)} — 사장 전용</div>
        </div>
        <select value={curMonth} onChange={e=>setCurMonth(e.target.value)}
          style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,color:'#dde1f2',padding:'8px 12px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
          {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
        </select>
      </div>

      {/* 월 합계 요약 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:20}}>
        {[
          {label:'기본급 합계', val:grandBase, color:'#f9b934'},
          {label:'주휴수당 합계', val:grandHoliday, color:'#93c5fd'},
          {label:'총 인건비', val:grandTotal, color:'#34d399'},
        ].map(k=>(
          <div key={k.label} style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'18px 20px',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:k.color}}></div>
            <div style={{fontSize:10,fontWeight:600,color:'#5e6585',textTransform:'uppercase',letterSpacing:.8,marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:20,fontWeight:700,color:k.color,fontFamily:'DM Mono,monospace'}}>{k.val.toLocaleString()}원</div>
          </div>
        ))}
      </div>

      {/* 직원 탭 */}
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
        <button onClick={()=>setActiveEmp(null)}
          style={{padding:'7px 14px',borderRadius:7,border:'none',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
            background:activeEmp===null?'#f9b934':'#191c2b',color:activeEmp===null?'#000':'#5e6585'}}>
          전체 요약
        </button>
        {employees.map(e=>(
          <button key={e.uid} onClick={()=>setActiveEmp(e.uid)}
            style={{padding:'7px 14px',borderRadius:7,border:'none',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
              background:activeEmp===e.uid?'#f9b934':'#191c2b',color:activeEmp===e.uid?'#000':'#5e6585'}}>
            {e.name}
          </button>
        ))}
      </div>

      {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:60}}>로딩 중...</div> : (
        <>
          {/* 전체 요약 */}
          {activeEmp===null && (
            <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden',marginBottom:18}}>
              <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>직원별 급여 요약</div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead>
                    <tr style={{background:'#191c2b'}}>
                      {['직원','시급','총 근무시간','기본급','주휴수당','총 지급액'].map(h=>(
                        <th key={h} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:'#5e6585',
                          textAlign:h==='직원'?'left':'right',whiteSpace:'nowrap'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allStats.map(({emp,totalHours,basePay,weeklyHoliday,totalPay})=>(
                      <tr key={emp.uid} onClick={()=>setActiveEmp(emp.uid)} style={{cursor:'pointer'}}>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',color:'#dde1f2',fontWeight:600}}>{emp.name}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace',color:'#dde1f2'}}>{(emp.wage||10030).toLocaleString()}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace',color:'#dde1f2'}}>{totalHours.toFixed(1)}h</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace',color:'#dde1f2'}}>{basePay.toLocaleString()}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace',color:'#93c5fd'}}>{weeklyHoliday.toLocaleString()}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace',color:'#34d399',fontWeight:700}}>{totalPay.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{background:'#1f2236'}}>
                      <td style={{padding:'10px 14px',fontWeight:700,color:'#f9b934'}}>합 계</td>
                      <td></td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>{allStats.reduce((a,s)=>a+s.totalHours,0).toFixed(1)}h</td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>{grandBase.toLocaleString()}</td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>{grandHoliday.toLocaleString()}</td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>{grandTotal.toLocaleString()}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* 개인별 상세 */}
          {activeEmp!==null && (()=>{
            const empData = allStats.find(s=>s.emp.uid===activeEmp)
            if(!empData) return null
            const {emp, totalHours, basePay, weeklyHoliday, totalPay} = empData
            const wh = workHours[emp.uid] || {}
            const days = daysIn(curMonth)
            const [cy,cm] = curMonth.split('-').map(Number)

            return (
              <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden'}}>
                <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span>{emp.name} 근무 상세</span>
                  <span style={{fontSize:11,color:'#5e6585'}}>시급 {(emp.wage||10030).toLocaleString()}원/h</span>
                </div>

                {/* 급여 요약 */}
                <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
                  {[
                    {label:'총 근무시간', val:`${totalHours.toFixed(1)}h`, color:'#f9b934'},
                    {label:'기본급', val:`${basePay.toLocaleString()}원`, color:'#dde1f2'},
                    {label:'주휴수당', val:`${weeklyHoliday.toLocaleString()}원`, color:'#93c5fd'},
                    {label:'총 지급액', val:`${totalPay.toLocaleString()}원`, color:'#34d399'},
                  ].map(k=>(
                    <div key={k.label} style={{background:'#191c2b',borderRadius:8,padding:'10px 12px'}}>
                      <div style={{fontSize:10,color:'#5e6585',marginBottom:3}}>{k.label}</div>
                      <div style={{fontSize:13,fontWeight:700,color:k.color,fontFamily:'DM Mono,monospace'}}>{k.val}</div>
                    </div>
                  ))}
                </div>

                {/* 일별 근무시간 입력 */}
                <div style={{padding:'12px 18px',borderBottom:'1px solid #272a3d',fontSize:12,fontWeight:600,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span>일별 근무시간 입력</span>
                  <span style={{fontSize:10,color:'#5e6585'}}>입력 후 Enter 또는 클릭 이동</span>
                </div>
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                    <thead>
                      <tr style={{background:'#191c2b'}}>
                        {['날짜','요일','근무시간 (h)','일급'].map(h=>(
                          <th key={h} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:'#5e6585',
                            textAlign:h==='날짜'||h==='요일'?'left':'center',whiteSpace:'nowrap'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from({length:days},(_,i)=>{
                        const d = i+1
                        const dd = pad(d)
                        const dow = new Date(cy,cm-1,d).getDay()
                        const h = wh[dd] || 0
                        const isWeekend = dow===0||dow===6
                        return (
                          <tr key={dd} style={{background:h>0?'rgba(249,185,52,0.05)':'transparent'}}>
                            <td style={{padding:'7px 14px',borderBottom:'1px solid #1a1d2e',
                              color:isWeekend?(dow===0?'#f87171':'#93c5fd'):'#dde1f2',fontWeight:600}}>
                              {d}일
                            </td>
                            <td style={{padding:'7px 14px',borderBottom:'1px solid #1a1d2e',
                              color:isWeekend?(dow===0?'#f87171':'#93c5fd'):'#5e6585',fontSize:11}}>
                              {DAYS_KR[dow]}
                            </td>
                            <td style={{padding:'5px 14px',borderBottom:'1px solid #1a1d2e',textAlign:'center'}}>
                              <input
                                type="number"
                                defaultValue={h||''}
                                min="0" max="24" step="0.5"
                                placeholder="0"
                                onBlur={e=>saveWorkHours(emp.uid,dd,e.target.value)}
                                onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                                style={{
                                  width:70,
                                  background: h>0 ? 'rgba(249,185,52,0.15)' : '#191c2b',
                                  border: h>0 ? '1px solid #f9b934' : '1px solid #272a3d',
                                  borderRadius:6,
                                  color: h>0 ? '#f9b934' : '#dde1f2',
                                  padding:'6px 8px',
                                  fontSize:13,
                                  fontWeight: h>0 ? 700 : 400,
                                  textAlign:'center',
                                  outline:'none',
                                  fontFamily:'DM Mono,monospace'
                                }}
                              />
                            </td>
                            <td style={{padding:'7px 14px',borderBottom:'1px solid #1a1d2e',textAlign:'center',
                              fontFamily:'DM Mono,monospace',
                              color:h>0?'#f9b934':'#272a3d',
                              fontWeight:h>0?700:400}}>
                              {h>0 ? Math.round(h*(emp.wage||10030)).toLocaleString()+'원' : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{background:'#1f2236'}}>
                        <td colSpan={2} style={{padding:'10px 14px',fontWeight:700,color:'#f9b934'}}>합 계</td>
                        <td style={{padding:'10px 14px',textAlign:'center',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>{totalHours.toFixed(1)}h</td>
                        <td style={{padding:'10px 14px',textAlign:'center',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>{basePay.toLocaleString()}원</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )
          })()}
        </>
      )}
    </div>
  )
}
