import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')

// 해당 월의 시급 찾기
function getWageForMonth(emp, month) {
  const history = emp.wageHistory || []
  if(history.length === 0) return emp.wage || 10030
  const applicable = history
    .filter(h => h.month <= month)
    .sort((a,b) => a.month > b.month ? -1 : 1)
  return applicable.length > 0 ? applicable[0].wage : (emp.wage || 10030)
}

const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const DAYS_KR = ['일','월','화','수','목','금','토']

function calcWeeklyHoliday(weekHours, wage, workDays, weekAttendance, weekMemos) {
  // 15시간 미만이면 무조건 미지급
  if(weekHours < 15) return 0

  // 소정근로일 중 결근일 계산
  const absentDays = workDays.filter(dow => {
    const h = weekAttendance[dow] || 0
    return h === 0
  })

  if(absentDays.length === 0) {
    // 개근 → 주휴 지급
    return Math.round((weekHours/40)*8*wage)
  }

  // 결근이 있는 경우 → 대타로 메꿨는지 확인
  const subCount = Object.values(weekMemos).filter(memo =>
    memo && memo.includes('대타')
  ).length

  if(subCount >= absentDays.length) {
    // 대타로 결근 메꿈 → 주휴 지급
    return Math.round((weekHours/40)*8*wage)
  }

  // 결근 > 대타 → 주휴 미지급
  return 0
}

export default function WorkManage() {
  const [curMonth, setCurMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [employees, setEmployees] = useState([])
  const [workHours, setWorkHours] = useState({})   // {uid: {dd: hours}}
  const [workExtra, setWorkExtra] = useState({})   // {uid: {dd: minutes}}
  const [memos, setMemos] = useState({})           // {uid: {dd: memo}}
  const [prevWorkHours, setPrevWorkHours] = useState({})
  const [prevWorkExtra, setPrevWorkExtra] = useState({})
  const [prevMemos, setPrevMemos] = useState({})
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
          finalEmps.push({
            uid:d.id,
            name:data.name,
            wage:data.wage||10030,
            wageHistory:data.wageHistory||[],
            workDays:data.workDays||[1,2,3,4,5]
          })
        }
      })
      setEmployees(finalEmps)

const whSnap = await getDoc(doc(db,'workhours',curMonth))
      setWorkHours(whSnap.exists() ? whSnap.data() : {})

      const exSnap = await getDoc(doc(db,'workextra',curMonth))
      setWorkExtra(exSnap.exists() ? exSnap.data() : {})

const memoSnap = await getDoc(doc(db,'workmemos',curMonth))
      setMemos(memoSnap.exists() ? memoSnap.data() : {})

      // 이전달 데이터 불러오기
      const [cy,cm] = curMonth.split('-').map(Number)
      const prevMonth = cm===1 ? `${cy-1}-12` : `${cy}-${pad(cm-1)}`
      const prevWhSnap = await getDoc(doc(db,'workhours',prevMonth))
      setPrevWorkHours(prevWhSnap.exists() ? prevWhSnap.data() : {})
      const prevExSnap = await getDoc(doc(db,'workextra',prevMonth))
      setPrevWorkExtra(prevExSnap.exists() ? prevExSnap.data() : {})
      setPrevMemos(prevMemoSnap.exists() ? prevMemoSnap.data() : {})

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

  async function saveWorkExtra(uid, dd, mins) {
    const m = +mins || 0
    const newEx = { ...workExtra, [uid]: { ...(workExtra[uid]||{}), [dd]: m } }
    if(!m) delete newEx[uid][dd]
    await setDoc(doc(db,'workextra',curMonth), newEx)
    setWorkExtra(newEx)
  }

  async function saveMemo(uid, dd, memo) {
    const newMemos = { ...memos, [uid]: { ...(memos[uid]||{}), [dd]: memo } }
    if(!memo) delete newMemos[uid][dd]
    await setDoc(doc(db,'workmemos',curMonth), newMemos)
    setMemos(newMemos)
  }

function getEmpStats(emp) {
    const wh = workHours[emp.uid] || {}
    const ex = workExtra[emp.uid] || {}
    const empMemos = memos[emp.uid] || {}
    const prevWh = prevWorkHours[emp.uid] || {}
    const prevEx = prevWorkExtra[emp.uid] || {}
    const prevEmpMemos = prevMemos[emp.uid] || {}
    const wage = getWageForMonth(emp, curMonth)
    const workDays = emp.workDays || [1,2,3,4,5]
    const days = daysIn(curMonth)
    const [cy,cm] = curMonth.split('-').map(Number)

    // 이전달 마지막 날 계산
    const prevMonthDays = cm===1 ? new Date(cy-1,12,0).getDate() : new Date(cy,cm-1,0).getDate()

    let totalHours = 0
    let totalMins = 0
    let totalWeeklyHoliday = 0
    const rows = []

    for(let d=1; d<=days; d++) {
      const dd = pad(d)
      const dow = new Date(cy,cm-1,d).getDay()
      const h = wh[dd] || 0
      const m = ex[dd] || 0
      totalHours += h
      totalMins += m

      let weeklyHoliday = 0
      if(dow === 0) {
        let weekH = 0
        const weekAttendance = {}
        const weekMemos = {}

        for(let wd=1; wd<=6; wd++) {
          const prevD = d - wd

          if(prevD >= 1) {
            // 이번달 데이터
            const prevDD = pad(prevD)
            const prevDow = new Date(cy,cm-1,prevD).getDay()
            const prevH = (wh[prevDD]||0) + (ex[prevDD]||0)/60
            weekH += prevH
            weekAttendance[prevDow] = (weekAttendance[prevDow]||0) + prevH
            if(empMemos[prevDD]) weekMemos[prevDD] = empMemos[prevDD]
          } else {
            // 이전달 데이터
            const prevMonthD = prevMonthDays + prevD // prevD는 음수이므로 더하기
            if(prevMonthD >= 1) {
              const prevDD = pad(prevMonthD)
              const prevDow = new Date(cy,cm-2,prevMonthD).getDay()
              const prevH = (prevWh[prevDD]||0) + (prevEx[prevDD]||0)/60
              weekH += prevH
              weekAttendance[prevDow] = (weekAttendance[prevDow]||0) + prevH
              if(prevEmpMemos[prevDD]) weekMemos[`prev_${prevDD}`] = prevEmpMemos[prevDD]
            }
          }
        }

        weeklyHoliday = calcWeeklyHoliday(weekH, wage, workDays, weekAttendance, weekMemos)
        totalWeeklyHoliday += weeklyHoliday
      }

      rows.push({ d, dd, dow, h, m, weeklyHoliday })
    }

    const totalH = totalHours + totalMins/60
    const basePay = Math.round(totalH * wage)
    const totalPay = basePay + totalWeeklyHoliday

    return { totalHours, totalMins, totalH, basePay, totalWeeklyHoliday, totalPay, rows }
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
                      {['직원','시급','근무시간','추가(분)','기본급','주휴수당','총 지급액'].map(h=>(
                        <th key={h} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:'#5e6585',
                          textAlign:h==='직원'?'left':'right',whiteSpace:'nowrap'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allStats.map(({emp,totalHours,totalMins,basePay,totalWeeklyHoliday,totalPay})=>(
                      <tr key={emp.uid} onClick={()=>setActiveEmp(emp.uid)} style={{cursor:'pointer'}}>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',color:'#dde1f2',fontWeight:600}}>{emp.name}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace',color:'#dde1f2'}}>{(emp.wage||10030).toLocaleString()}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace',color:'#dde1f2'}}>{totalHours}h</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace',color:totalMins>0?'#f9b934':'#5e6585'}}>{totalMins>0?`${totalMins}m`:'—'}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace',color:'#dde1f2'}}>{basePay.toLocaleString()}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace',color:'#93c5fd'}}>{totalWeeklyHoliday.toLocaleString()}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace',color:'#34d399',fontWeight:700}}>{totalPay.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{background:'#1f2236'}}>
                      <td style={{padding:'10px 14px',fontWeight:700,color:'#f9b934'}}>합 계</td>
                      <td></td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>{allStats.reduce((a,s)=>a+s.totalHours,0)}h</td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>{allStats.reduce((a,s)=>a+s.totalMins,0)}m</td>
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
            if(!empData) return null
            const {emp, totalHours, totalMins, totalH, basePay, totalWeeklyHoliday, totalPay, rows} = empData
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
                    {label:'총 근무시간', val:`${totalHours}h ${totalMins>0?totalMins+'m':''}`, color:'#f9b934'},
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

                {/* 테이블 */}
                <div style={{padding:'12px 18px',borderBottom:'1px solid #272a3d',fontSize:12,fontWeight:600,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span>일별 근무시간 입력</span>
                  <span style={{fontSize:10,color:'#5e6585'}}>일요일에 주휴수당 자동계산</span>
                </div>
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                    <thead>
                      <tr style={{background:'#191c2b'}}>
                        <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#5e6585',textAlign:'left',width:45}}>날짜</th>
                        <th style={{padding:'8px 6px',fontSize:10,fontWeight:600,color:'#5e6585',textAlign:'left',width:28}}>요일</th>
                        <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#5e6585',textAlign:'center',width:110}}>근무시간(h)</th>
                        <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#f9b934',textAlign:'center',width:110}}>추가근무(분)</th>
                        <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#93c5fd',textAlign:'center',width:110}}>주휴수당</th>
                        <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#5e6585',textAlign:'left'}}>비고</th>
                      </tr>
                    </thead>
<tbody key={activeEmp}>
  {rows.map(({d,dd,dow,h,m,weeklyHoliday})=>{
                        const isWeekend = dow===0||dow===6
                        const isSun = dow===0
                        const now = new Date()
                        const isToday = curMonth===`${now.getFullYear()}-${pad(now.getMonth()+1)}` && d===now.getDate()

                        return (
                          <tr key={dd} style={{
                            background: isSun&&weeklyHoliday>0?'rgba(147,197,253,0.05)':h>0||m>0?'rgba(249,185,52,0.04)':'transparent',
                            borderLeft: isSun&&weeklyHoliday>0?'3px solid #93c5fd':h>0||m>0?'3px solid #f9b934':'3px solid transparent'
                          }}>
                            <td style={{padding:'6px 10px',borderBottom:'1px solid #1a1d2e',
                              color:isToday?'#f9b934':dow===0?'#f87171':dow===6?'#93c5fd':'#dde1f2',
                              fontWeight:isToday?700:500,fontSize:12}}>
                              {d}일
                            </td>
                            <td style={{padding:'6px 6px',borderBottom:'1px solid #1a1d2e',
                              color:dow===0?'#f87171':dow===6?'#93c5fd':'#5e6585',fontSize:11,fontWeight:600}}>
                              {DAYS_KR[dow]}
                            </td>
                            {/* 근무시간 */}
                            <td style={{padding:'4px 10px',borderBottom:'1px solid #1a1d2e',textAlign:'center'}}>
                              {!isSun ? (
<input key={`${activeEmp}_${dd}_h`} type="number" defaultValue={h||''} min="0" max="24" step="0.5" placeholder="0"
  onBlur={e=>saveWorkHours(emp.uid,dd,e.target.value)}
  onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                                  style={{
                                    width:80, background:h>0?'rgba(249,185,52,0.15)':'#191c2b',
                                    border:h>0?'1px solid #f9b934':'1px solid #272a3d',
                                    borderRadius:6, color:h>0?'#f9b934':'#dde1f2',
                                    padding:'6px 8px', fontSize:13, fontWeight:h>0?700:400,
                                    textAlign:'center', outline:'none', fontFamily:'DM Mono,monospace'
                                  }}/>
                              ) : (
                                <span style={{fontSize:11,color:'#5e6585'}}>주휴일</span>
                              )}
                            </td>
                            {/* 추가근무(분) */}
                            <td style={{padding:'4px 10px',borderBottom:'1px solid #1a1d2e',textAlign:'center'}}>
                              {!isSun ? (
<input key={`${activeEmp}_${dd}_m`} type="number" defaultValue={m||''} min="0" max="180" step="5" placeholder="0"
  onBlur={e=>saveWorkExtra(emp.uid,dd,e.target.value)}
  onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                                  style={{
                                    width:80, background:m>0?'rgba(249,185,52,0.15)':'#191c2b',
                                    border:m>0?'1px solid #f9b934':'1px solid #272a3d',
                                    borderRadius:6, color:m>0?'#f9b934':'#dde1f2',
                                    padding:'6px 8px', fontSize:13, fontWeight:m>0?700:400,
                                    textAlign:'center', outline:'none', fontFamily:'DM Mono,monospace'
                                  }}/>
                              ) : <span style={{color:'#272a3d'}}>—</span>}
                            </td>
                            {/* 주휴수당 */}
                            <td style={{padding:'6px 10px',borderBottom:'1px solid #1a1d2e',textAlign:'center',fontFamily:'DM Mono,monospace'}}>
{isSun && weeklyHoliday>0 ? (
  <span style={{color:'#93c5fd',fontWeight:700,fontSize:12}}>{weeklyHoliday.toLocaleString()}원</span>
) : isSun ? (
  <span style={{color:'#3d4060',fontSize:11}}>미지급</span>
) : (
  <span style={{color:'#272a3d'}}>—</span>
)}
                            </td>
                            {/* 비고 */}
                            <td style={{padding:'4px 10px',borderBottom:'1px solid #1a1d2e'}}>
<input key={`${activeEmp}_${dd}_memo`} type="text" defaultValue={empMemos[dd]||''}
  placeholder={isSun?'':'결석사유 등...'}
  onBlur={e=>saveMemo(emp.uid,dd,e.target.value)}
  onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                                style={{
                                  width:'100%', background:'transparent', border:'none',
                                  borderBottom:empMemos[dd]?'1px solid #272a3d':'1px solid transparent',
                                  color:empMemos[dd]?'#f87171':'#3d4060',
                                  padding:'4px 2px', fontSize:11, outline:'none', fontFamily:'inherit'
                                }}/>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{background:'#1f2236'}}>
                        <td colSpan={2} style={{padding:'12px 10px',fontWeight:700,color:'#f9b934',fontSize:12}}>이달 합계</td>
                        <td style={{padding:'12px 10px',textAlign:'center',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>{totalHours}h</td>
                        <td style={{padding:'12px 10px',textAlign:'center',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>{totalMins>0?`${totalMins}m`:'—'}</td>
                        <td style={{padding:'12px 10px',textAlign:'center',fontWeight:700,color:'#93c5fd',fontFamily:'DM Mono,monospace'}}>{totalWeeklyHoliday.toLocaleString()}원</td>
                        <td style={{padding:'12px 10px'}}>
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
