import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')
const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const DAYS_KR = ['일','월','화','수','목','금','토']

function calcWeeklyHoliday(weekHours, wage) {
  if(weekHours < 15) return 0
  return Math.round((weekHours/40)*8*wage)
}

export default function WorkManage() {
  const [curMonth, setCurMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [employees, setEmployees] = useState([])
  const [workHours, setWorkHours] = useState({})
  const [memos, setMemos] = useState({}) // {uid: {dd: memo}}
  const [loading, setLoading] = useState(true)
  const [activeEmp, setActiveEmp] = useState(null)

  const monthOpts = []
  for(let y=2022;y<=2026;y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  async function load() {
    setLoading(true)
    try {
      const usersSnap = await getDocs(collection(db,'users'))
      const finalEmps = []
      usersSnap.forEach(d => {
        const data = d.data()
        if(data.status==='approved' && data.role!=='owner') {
          finalEmps.push({uid:d.id, name:data.name, wage:data.wage||10030})
        }
      })
      setEmployees(finalEmps)

      const whSnap = await getDoc(doc(db,'workhours',curMonth))
      setWorkHours(whSnap.exists() ? whSnap.data() : {})

      const memoSnap = await getDoc(doc(db,'workmemos',curMonth))
      setMemos(memoSnap.exists() ? memoSnap.data() : {})
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [curMonth])

  async function saveWorkHours(uid, dd, hours) {
    const h = +hours || 0
    const newWH = { ...workHours, [uid]: { ...(workHours[uid]||{}), [dd]: h } }
    if(!h) delete newWH[uid][dd]
    await setDoc(doc(db,'workhours',curMonth), newWH)
    setWorkHours(newWH)
  }

  async function saveMemo(uid, dd, memo) {
    const newMemos = { ...memos, [uid]: { ...(memos[uid]||{}), [dd]: memo } }
    if(!memo) delete newMemos[uid][dd]
    await setDoc(doc(db,'workmemos',curMonth), newMemos)
    setMemos(newMemos)
  }

  function getEmpStats(emp) {
    const wh = workHours[emp.uid] || {}
    const wage = emp.wage || 10030
    const days = daysIn(curMonth)
    const [cy,cm] = curMonth.split('-').map(Number)

    let totalHours = 0
    let totalWeeklyHoliday = 0
    const rows = []

    for(let d=1; d<=days; d++) {
      const dd = pad(d)
      const dow = new Date(cy,cm-1,d).getDay()
      const h = wh[dd] || 0
      totalHours += h

      // 일요일이면 그 주(일~토) 근무시간 합산해서 주휴수당 계산
      let weeklyHoliday = 0
      if(dow === 0) {
        let weekH = 0
        // 이번 일요일 포함 직전 7일 (월~토)
        for(let wd=1; wd<=6; wd++) {
          const prevD = d - wd
          if(prevD >= 1) weekH += wh[pad(prevD)] || 0
        }
        weeklyHoliday = calcWeeklyHoliday(weekH, wage)
        totalWeeklyHoliday += weeklyHoliday
      }

      rows.push({ d, dd, dow, h, weeklyHoliday })
    }

    // 마지막 주 처리 (월말이 일요일이 아닌 경우)
    const lastDow = new Date(cy,cm-1,days).getDay()
    if(lastDow !== 0) {
      // 마지막 일요일 다음~월말까지 남은 시간
      let remainH = 0
      for(let d=1; d<=days; d++) {
        const dow = new Date(cy,cm-1,d).getDay()
        if(dow === 0) remainH = 0 // 일요일마다 초기화
        remainH += wh[pad(d)] || 0
      }
      // 마지막 주 주휴수당은 별도 행으로 추가하지 않음 (다음달 일요일에 계산됨)
    }

    const basePay = Math.round(totalHours * wage)
    const totalPay = basePay + totalWeeklyHoliday

    return { totalHours, basePay, totalWeeklyHoliday, totalPay, rows }
  }

  const allStats = employees.map(e => ({ emp:e, ...getEmpStats(e) }))
  const grandBase = allStats.reduce((a,s)=>a+s.basePay,0)
  const grandHoliday = allStats.reduce((a,s)=>a+s.totalWeeklyHoliday,0)
  const grandTotal = allStats.reduce((a,s)=>a+s.totalPay,0)

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

      {/* 월 합계 */}
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
                    {allStats.map(({emp,totalHours,basePay,totalWeeklyHoliday,totalPay})=>(
                      <tr key={emp.uid} onClick={()=>setActiveEmp(emp.uid)} style={{cursor:'pointer'}}>
<th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#5e6585',textAlign:'left',width:45}}>날짜</th>
<th style={{padding:'8px 6px',fontSize:10,fontWeight:600,color:'#5e6585',textAlign:'left',width:30}}>요일</th>
<th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#5e6585',textAlign:'center',width:180}}>근무시간(h)</th>
<th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#93c5fd',textAlign:'center',width:200}}>주휴수당</th>
<th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#5e6585',textAlign:'left'}}>비고</th>                      </tr>
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
            const {emp, totalHours, basePay, totalWeeklyHoliday, totalPay, rows} = empData
            const empMemos = memos[emp.uid] || {}

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
                    {label:'주휴수당', val:`${totalWeeklyHoliday.toLocaleString()}원`, color:'#93c5fd'},
                    {label:'이달 월급', val:`${totalPay.toLocaleString()}원`, color:'#34d399'},
                  ].map(k=>(
                    <div key={k.label} style={{background:'#191c2b',borderRadius:8,padding:'10px 12px'}}>
                      <div style={{fontSize:10,color:'#5e6585',marginBottom:3}}>{k.label}</div>
                      <div style={{fontSize:13,fontWeight:700,color:k.color,fontFamily:'DM Mono,monospace'}}>{k.val}</div>
                    </div>
                  ))}
                </div>

                {/* 일별 입력 테이블 */}
                <div style={{padding:'12px 18px',borderBottom:'1px solid #272a3d',fontSize:12,fontWeight:600,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span>일별 근무시간 입력</span>
                  <span style={{fontSize:10,color:'#5e6585'}}>일요일에 주휴수당 자동계산</span>
                </div>
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                    <thead>
                      <tr style={{background:'#191c2b'}}>
                        <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#5e6585',textAlign:'left',width:50}}>날짜</th>
                        <th style={{padding:'8px 6px',fontSize:10,fontWeight:600,color:'#5e6585',textAlign:'left',width:30}}>요일</th>
                        <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#5e6585',textAlign:'center',width:90}}>근무시간(h)</th>
                        <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#93c5fd',textAlign:'center',width:100}}>주휴수당</th>
                        <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#5e6585',textAlign:'left'}}>비고</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({d,dd,dow,h,weeklyHoliday})=>{
                        const isWeekend = dow===0||dow===6
                        const isSun = dow===0
                        const isToday = dd===pad(new Date().getDate()) && curMonth===`${new Date().getFullYear()}-${pad(new Date().getMonth()+1)}`

                        return (
                          <tr key={dd} style={{
                            background: isSun&&weeklyHoliday>0 ? 'rgba(147,197,253,0.05)' : h>0 ? 'rgba(249,185,52,0.04)' : 'transparent',
                            borderLeft: isSun&&weeklyHoliday>0 ? '3px solid #93c5fd' : h>0 ? '3px solid #f9b934' : '3px solid transparent'
                          }}>
                            <td style={{padding:'6px 10px',borderBottom:'1px solid #1a1d2e',
                              color:isToday?'#f9b934':dow===0?'#f87171':dow===6?'#93c5fd':'#dde1f2',
                              fontWeight:isToday?700:500,fontSize:12,whiteSpace:'nowrap'}}>
                              {d}일
                            </td>
                            <td style={{padding:'6px 6px',borderBottom:'1px solid #1a1d2e',
                              color:dow===0?'#f87171':dow===6?'#93c5fd':'#5e6585',
                              fontSize:11,fontWeight:600}}>
                              {DAYS_KR[dow]}
                            </td>
                            <td style={{padding:'4px 10px',borderBottom:'1px solid #1a1d2e',textAlign:'center'}}>
                              {!isSun ? (
                                <input
                                  type="number"
                                  defaultValue={h||''}
                                  min="0" max="24" step="0.5"
                                  placeholder="0"
                                  onBlur={e=>saveWorkHours(emp.uid,dd,e.target.value)}
                                  onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                                  style={{
                                    width:70,
                                    background: h>0?'rgba(249,185,52,0.15)':'#191c2b',
                                    border: h>0?'1px solid #f9b934':'1px solid #272a3d',
                                    borderRadius:6,
                                    color: h>0?'#f9b934':'#dde1f2',
                                    padding:'6px 8px',
                                    fontSize:13,
                                    fontWeight: h>0?700:400,
                                    textAlign:'center',
                                    outline:'none',
                                    fontFamily:'DM Mono,monospace'
                                  }}
                                />
                              ) : (
                                <span style={{fontSize:11,color:'#5e6585'}}>주휴일</span>
                              )}
                            </td>
                            <td style={{padding:'6px 10px',borderBottom:'1px solid #1a1d2e',textAlign:'center',fontFamily:'DM Mono,monospace'}}>
                              {isSun && weeklyHoliday>0 ? (
                                <span style={{color:'#93c5fd',fontWeight:700,fontSize:12}}>{weeklyHoliday.toLocaleString()}원</span>
                              ) : isSun && weeklyHoliday===0 ? (
                                <span style={{color:'#3d4060',fontSize:11}}>15h 미만</span>
                              ) : (
                                <span style={{color:'#272a3d'}}>—</span>
                              )}
                            </td>
                            <td style={{padding:'4px 10px',borderBottom:'1px solid #1a1d2e'}}>
                              <input
                                type="text"
                                defaultValue={empMemos[dd]||''}
                                placeholder={isSun?'':'결석사유 등...'}
                                onBlur={e=>saveMemo(emp.uid,dd,e.target.value)}
                                onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                                style={{
                                  width:'100%',
                                  background:'transparent',
                                  border:'none',
                                  borderBottom: empMemos[dd]?'1px solid #272a3d':'1px solid transparent',
                                  color: empMemos[dd]?'#f87171':'#3d4060',
                                  padding:'4px 2px',
                                  fontSize:11,
                                  outline:'none',
                                  fontFamily:'inherit'
                                }}
                              />
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{background:'#1f2236'}}>
                        <td colSpan={2} style={{padding:'12px 10px',fontWeight:700,color:'#f9b934',fontSize:12}}>이달 합계</td>
                        <td style={{padding:'12px 10px',textAlign:'center',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>{totalHours.toFixed(1)}h</td>
                        <td style={{padding:'12px 10px',textAlign:'center',fontWeight:700,color:'#93c5fd',fontFamily:'DM Mono,monospace'}}>{totalWeeklyHoliday.toLocaleString()}원</td>
                        <td style={{padding:'12px 10px',textAlign:'left'}}>
                          <span style={{color:'#34d399',fontWeight:700,fontFamily:'DM Mono,monospace',fontSize:14}}>
                            월급 {totalPay.toLocaleString()}원
                          </span>
                          <span style={{color:'#5e6585',fontSize:10,marginLeft:8}}>
                            (기본급 {basePay.toLocaleString()} + 주휴 {totalWeeklyHoliday.toLocaleString()})
                          </span>
                        </td>
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
