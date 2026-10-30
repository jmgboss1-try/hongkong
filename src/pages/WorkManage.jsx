import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore'
import AttendancePanel from '../components/AttendancePanel'

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

// 해당 월에 적용되는 근무스케쥴(소정근로일/평균근무시간) 찾기 — 시급 이력과 동일한 패턴
function getScheduleForMonth(emp, month) {
  const history = emp.scheduleHistory || []
  if(history.length === 0) return { workDays: emp.workDays || [1,2,3,4,5], avgHours: emp.avgHours || 8 }
  const applicable = history
    .filter(h => h.month <= month)
    .sort((a,b) => a.month > b.month ? -1 : 1)
  return applicable.length > 0
    ? { workDays: applicable[0].workDays, avgHours: applicable[0].avgHours }
    : { workDays: emp.workDays || [1,2,3,4,5], avgHours: emp.avgHours || 8 }
}

const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const DAYS_KR = ['일','월','화','수','목','금','토']

function calcWeeklyHoliday(weekHours, wage, workDays, weekAttendance, weekMemos) {
  // 그 주 실제 근무시간이 15시간 미만이면 미지급 (매주 독립 판단)
  if(weekHours < 15) return 0

  // 소정근로일 중 결근일 계산
  const absentDays = workDays.filter(dow => {
    const h = weekAttendance[dow] || 0
    return h === 0
  })

  if(absentDays.length === 0) {
    // 개근 → 주휴 지급
    // 주휴수당 = (그 주 실제근무시간 / 40) × 8 × 시급
    return Math.round((weekHours / 40) * 8 * wage)
  }

  // 결근이 있는 경우 → 대타로 메꿨는지 확인
  const subCount = Object.values(weekMemos).filter(memo =>
    memo && memo.includes('대타')
  ).length

  if(subCount >= absentDays.length) {
    return Math.round((weekHours / 40) * 8 * wage)
  }

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
  const [showTodayOnly, setShowTodayOnly] = useState(false)
  const [severance, setSeverance] = useState({}) // {uid:{amount,tax,net,paidDate}}
  const [nameMap, setNameMap] = useState({}) // uid → name (퇴직자 포함)

  const monthOpts = []
  for(let y=2022;y<=Math.max(2026,new Date().getFullYear());y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  async function load() {
    setLoading(true)
    try {
      const usersSnap = await getDocs(collection(db,'users'))
      const finalEmps = []
      const nameData = {}
usersSnap.forEach(d => {
        const data = d.data()
        nameData[d.id] = data.name
        if(data.status==='approved'
  && data.role!=='owner'
  && data.role!=='store'
  && data.role!=='investor'
  && data.payType!=='fixed') {
          finalEmps.push({
            uid:d.id,
            name:data.name,
            wage:data.wage||10030,
            wageHistory:data.wageHistory||[],
            workDays:data.workDays||[1,2,3,4,5],
            avgHours:data.avgHours||8,
            scheduleHistory:data.scheduleHistory||[]
          })
        }
      })
      setEmployees(finalEmps)
      setNameMap(nameData)

      const sevSnap = await getDoc(doc(db,'severance',curMonth))
      setSeverance(sevSnap.exists() ? sevSnap.data() : {})

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

const prevMemoSnap = await getDoc(doc(db,'workmemos',prevMonth))
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
    const schedule = getScheduleForMonth(emp, curMonth)
    const workDays = schedule.workDays || [1,2,3,4,5]
    const avgHours = schedule.avgHours || 8
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
  // 오늘 근무 인원 계산
  const todayDow = new Date().getDay()
  const todayDD  = pad(new Date().getDate())
  const todayEmps = allStats.filter(s => s.emp.workDays.includes(todayDow))

  const todayContent = (
    <div style={{background:'#FFFFFF',border:'1px solid #2E7D45',borderRadius:6,overflow:'hidden',marginBottom:18}}>
      <div style={{padding:'14px 18px',borderBottom:'1px solid #DCD7CE',fontSize:13,fontWeight:600,color:'#2E7D45'}}>
        오늘 ({+todayDD}일) 근무 인원 — {todayEmps.length}명
      </div>
      {todayEmps.length === 0 ? (
        <div style={{padding:24,textAlign:'center',color:'#6E6A63',fontSize:12}}>오늘 근무 예정 인원이 없습니다</div>
      ) : (
        <div>
          <div style={{display:'flex',alignItems:'center',gap:14,padding:'8px 18px',
            background:'#F3F1EC',fontSize:10,fontWeight:600,color:'#6E6A63'}}>
            <div style={{minWidth:80}}>이름</div>
            <div style={{minWidth:120}}>근무시간 (h)</div>
            <div style={{minWidth:120}}>추가근무 (분)</div>
            <div style={{flex:1}}>비고</div>
          </div>
          {todayEmps.map(({emp})=>{
            const wh = workHours[emp.uid]||{}
            const ex = workExtra[emp.uid]||{}
            const empMemos = memos[emp.uid]||{}
            const missing = []
            const hasMissing = missing.length > 0
            const hasToday = (wh[todayDD]||0) > 0
            return (
              <div key={emp.uid} style={{display:'flex',alignItems:'center',gap:14,padding:'10px 18px',
                borderBottom:'1px solid #ECE8E1',
                background:hasToday?'rgba(195,38,28,0.04)':'transparent'}}>
                <div style={{minWidth:80,fontSize:13,fontWeight:700,
                  color:hasMissing?'#B42318':hasToday?'#C3261C':'#1D1B18'}}>
                  {emp.name}
                  {hasMissing && <span style={{fontSize:9,marginLeft:4}}>⚠{missing.length}</span>}
                </div>
                <input type="number" defaultValue={wh[todayDD]||''} min="0" max="24" step="0.5" placeholder="0"
                  onBlur={e=>saveWorkHours(emp.uid,todayDD,e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                  style={{width:100,background:wh[todayDD]>0?'rgba(195,38,28,0.15)':'#F3F1EC',
                    border:wh[todayDD]>0?'1px solid #C3261C':'1px solid #DCD7CE',
                    borderRadius:6,color:wh[todayDD]>0?'#C3261C':'#1D1B18',
                    padding:'7px 8px',fontSize:13,fontWeight:wh[todayDD]>0?700:400,
                    textAlign:'center',outline:'none',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}/>
                <input type="number" defaultValue={ex[todayDD]||''} min="0" max="180" step="5" placeholder="0"
                  onBlur={e=>saveWorkExtra(emp.uid,todayDD,e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                  style={{width:100,background:ex[todayDD]>0?'rgba(195,38,28,0.15)':'#F3F1EC',
                    border:ex[todayDD]>0?'1px solid #C3261C':'1px solid #DCD7CE',
                    borderRadius:6,color:ex[todayDD]>0?'#C3261C':'#1D1B18',
                    padding:'7px 8px',fontSize:13,fontWeight:ex[todayDD]>0?700:400,
                    textAlign:'center',outline:'none',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}/>
                <input type="text" defaultValue={empMemos[todayDD]||''} placeholder="비고..."
                  onBlur={e=>saveMemo(emp.uid,todayDD,e.target.value)}
                  onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                  style={{flex:1,background:'transparent',border:'none',
                    borderBottom:empMemos[todayDD]?'1px solid #DCD7CE':'1px solid transparent',
                    color:empMemos[todayDD]?'#B42318':'#A8A39A',
                    padding:'4px 2px',fontSize:11,outline:'none',fontFamily:'inherit'}}/>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )

  const grandBase = allStats.reduce((a,s)=>a+s.basePay,0)
  const grandHoliday = allStats.reduce((a,s)=>a+s.totalWeeklyHoliday,0)
  const grandTotal = allStats.reduce((a,s)=>a+s.totalPay,0)

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>근무관리</div>
          <div style={{fontSize:12,color:'#6E6A63',marginTop:2}}>{mLabel(curMonth)} — 사장 전용</div>
        </div>
        <select value={curMonth} onChange={e=>setCurMonth(e.target.value)}
          style={{background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,color:'#1D1B18',padding:'8px 12px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
          {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
        </select>
      </div>

      {/* NFC 출퇴근: 승인 대기·퇴근 누락·설정 (찍힌 시간은 아래 근무시간에 자동 반영) */}
      <AttendancePanel curMonth={curMonth} nameMap={nameMap} onApplied={load}/>

      {/* 월 합계 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:20}}>
        {[
          {label:'기본급 합계', val:grandBase, color:'#C3261C'},
          {label:'주휴수당 합계', val:grandHoliday, color:'#2B5C9E'},
          {label:'총 인건비', val:grandTotal, color:'#2E7D45'},
        ].map(k=>(
          <div key={k.label} style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,padding:'18px 20px',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:k.color}}></div>
            <div style={{fontSize:10,fontWeight:600,color:'#6E6A63',textTransform:'uppercase',letterSpacing:.8,marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:20,fontWeight:700,color:k.color,fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{k.val.toLocaleString()}원</div>
          </div>
        ))}
      </div>

      {/* 이번달 퇴직금 지급 내역 */}
      {Object.keys(severance).length > 0 && (
        <div style={{background:'#FFFFFF',border:'1px solid rgba(180,83,9,0.3)',borderRadius:6,
          overflow:'hidden',marginBottom:18}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #DCD7CE',fontSize:13,fontWeight:600,color:'#B45309'}}>
            {mLabel(curMonth)} 퇴직금 지급 내역
          </div>
          <div style={{padding:'8px 0'}}>
            {Object.entries(severance).map(([uid,s])=>(
              <div key={uid} style={{display:'flex',alignItems:'center',gap:14,padding:'10px 18px',
                borderBottom:'1px solid #ECE8E1',flexWrap:'wrap'}}>
                <div style={{minWidth:80,fontSize:13,fontWeight:700,color:'#1D1B18'}}>
                  {nameMap[uid]||'—'}
                </div>
                <div style={{fontSize:11,color:'#6E6A63'}}>
                  {s.paidDate?.slice(0,10)} 지급
                </div>
                <div style={{flex:1}}/>
                <div style={{fontSize:11,color:'#6E6A63'}}>
                  총액 {s.amount.toLocaleString()}원
                </div>
                <div style={{fontSize:11,color:'#B42318'}}>
                  원천징수 -{s.tax.toLocaleString()}원
                </div>
                <div style={{fontSize:13,fontWeight:700,color:'#2E7D45',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>
                  실지급 {s.net.toLocaleString()}원
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 직원 탭 */}
      <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
        <button onClick={()=>{ setShowTodayOnly(v=>!v); setActiveEmp(null) }}
          style={{padding:'7px 14px',borderRadius:4,border:'none',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
            background:showTodayOnly?'#2E7D45':'#F3F1EC',color:showTodayOnly?'#FFFFFF':'#6E6A63'}}>
          오늘 근무
        </button>
        <button onClick={()=>{ setActiveEmp(null); setShowTodayOnly(false) }}
          style={{padding:'7px 14px',borderRadius:4,border:'none',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
            background:activeEmp===null&&!showTodayOnly?'#C3261C':'#F3F1EC',color:activeEmp===null&&!showTodayOnly?'#FFFFFF':'#6E6A63'}}>
          전체 요약
        </button>
        {employees.map(e=>(
          <button key={e.uid} onClick={()=>setActiveEmp(e.uid)}
            style={{padding:'7px 14px',borderRadius:4,border:'none',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
              background:activeEmp===e.uid?'#C3261C':'#F3F1EC',color:activeEmp===e.uid?'#FFFFFF':'#6E6A63'}}>
            {e.name}
          </button>
        ))}
      </div>

      {loading ? <div style={{textAlign:'center',color:'#6E6A63',padding:60}}>로딩 중...</div> : (
        <>
          {showTodayOnly && todayContent}

          {/* 전체 요약 */}
          {activeEmp===null && !showTodayOnly && (
            <div style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,overflow:'hidden',marginBottom:18}}>
              <div style={{padding:'14px 18px',borderBottom:'1px solid #DCD7CE',fontSize:13,fontWeight:600}}>직원별 급여 요약</div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead>
                    <tr style={{background:'#F3F1EC'}}>
                      {['직원','시급','근무시간','추가(분)','기본급','주휴수당','총 지급액'].map(h=>(
                        <th key={h} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:'#6E6A63',
                          textAlign:h==='직원'?'left':'right',whiteSpace:'nowrap'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allStats.map(({emp,totalHours,totalMins,basePay,totalWeeklyHoliday,totalPay})=>(
                      <tr key={emp.uid} onClick={()=>setActiveEmp(emp.uid)} style={{cursor:'pointer'}}>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #DCD7CE',color:'#1D1B18',fontWeight:600}}>{emp.name}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #DCD7CE',textAlign:'right',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',color:'#1D1B18'}}>{(emp.wage||10030).toLocaleString()}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #DCD7CE',textAlign:'right',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',color:'#1D1B18'}}>{totalHours}h</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #DCD7CE',textAlign:'right',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',color:totalMins>0?'#C3261C':'#6E6A63'}}>{totalMins>0?`${totalMins}m`:'—'}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #DCD7CE',textAlign:'right',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',color:'#1D1B18'}}>{basePay.toLocaleString()}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #DCD7CE',textAlign:'right',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',color:'#2B5C9E'}}>{totalWeeklyHoliday.toLocaleString()}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #DCD7CE',textAlign:'right',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',color:'#2E7D45',fontWeight:700}}>{totalPay.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{background:'#ECE8E1'}}>
                      <td style={{padding:'10px 14px',fontWeight:700,color:'#C3261C'}}>합 계</td>
                      <td></td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#C3261C',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{allStats.reduce((a,s)=>a+s.totalHours,0)}h</td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#C3261C',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{allStats.reduce((a,s)=>a+s.totalMins,0)}m</td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#C3261C',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{grandBase.toLocaleString()}</td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#C3261C',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{grandHoliday.toLocaleString()}</td>
                      <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#C3261C',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{grandTotal.toLocaleString()}</td>
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
              <div style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,overflow:'hidden'}}>
                <div style={{padding:'14px 18px',borderBottom:'1px solid #DCD7CE',fontSize:13,fontWeight:600,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span>{emp.name} 근무 상세</span>
                  <span style={{fontSize:11,color:'#6E6A63'}}>시급 {(emp.wage||10030).toLocaleString()}원/h</span>
                </div>

                {/* 급여 요약 */}
                <div style={{padding:'14px 18px',borderBottom:'1px solid #DCD7CE',display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:10}}>
                  {[
                    {label:'총 근무시간', val:`${totalHours}h ${totalMins>0?totalMins+'m':''}`, color:'#C3261C'},
                    {label:'기본급', val:`${basePay.toLocaleString()}원`, color:'#1D1B18'},
                    {label:'주휴수당', val:`${totalWeeklyHoliday.toLocaleString()}원`, color:'#2B5C9E'},
                    {label:'이달 월급', val:`${totalPay.toLocaleString()}원`, color:'#2E7D45'},
                  ].map(k=>(
                    <div key={k.label} style={{background:'#F3F1EC',borderRadius:4,padding:'10px 12px'}}>
                      <div style={{fontSize:10,color:'#6E6A63',marginBottom:3}}>{k.label}</div>
                      <div style={{fontSize:13,fontWeight:700,color:k.color,fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{k.val}</div>
                    </div>
                  ))}
                </div>

                {/* 테이블 */}
                <div style={{padding:'12px 18px',borderBottom:'1px solid #DCD7CE',fontSize:12,fontWeight:600,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span>일별 근무시간 입력</span>
                  <span style={{fontSize:10,color:'#6E6A63'}}>일요일에 주휴수당 자동계산</span>
                </div>
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                    <thead>
                      <tr style={{background:'#F3F1EC'}}>
                        <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#6E6A63',textAlign:'left',width:45}}>날짜</th>
                        <th style={{padding:'8px 6px',fontSize:10,fontWeight:600,color:'#6E6A63',textAlign:'left',width:28}}>요일</th>
                        <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#6E6A63',textAlign:'center',width:110}}>근무시간(h)</th>
                        <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#C3261C',textAlign:'center',width:110}}>추가근무(분)</th>
                        <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#2B5C9E',textAlign:'center',width:110}}>주휴수당</th>
                        <th style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#6E6A63',textAlign:'left'}}>비고</th>
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
                            background: isSun&&weeklyHoliday>0?'rgba(43,92,158,0.05)':h>0||m>0?'rgba(195,38,28,0.04)':'transparent',
                            borderLeft: isSun&&weeklyHoliday>0?'3px solid #2B5C9E':h>0||m>0?'3px solid #C3261C':'3px solid transparent'
                          }}>
                            <td style={{padding:'6px 10px',borderBottom:'1px solid #ECE8E1',
                              color:isToday?'#C3261C':dow===0?'#B42318':dow===6?'#2B5C9E':'#1D1B18',
                              fontWeight:isToday?700:500,fontSize:12}}>
                              {d}일
                            </td>
                            <td style={{padding:'6px 6px',borderBottom:'1px solid #ECE8E1',
                              color:dow===0?'#B42318':dow===6?'#2B5C9E':'#6E6A63',fontSize:11,fontWeight:600}}>
                              {DAYS_KR[dow]}
                            </td>
                            {/* 근무시간 */}
                            <td style={{padding:'4px 10px',borderBottom:'1px solid #ECE8E1',textAlign:'center'}}>
                              {!isSun ? (
<input key={`${activeEmp}_${dd}_h`} type="number" defaultValue={h||''} min="0" max="24" step="0.5" placeholder="0"
  onBlur={e=>saveWorkHours(emp.uid,dd,e.target.value)}
  onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                                  style={{
                                    width:80, background:h>0?'rgba(195,38,28,0.15)':'#F3F1EC',
                                    border:h>0?'1px solid #C3261C':'1px solid #DCD7CE',
                                    borderRadius:6, color:h>0?'#C3261C':'#1D1B18',
                                    padding:'6px 8px', fontSize:13, fontWeight:h>0?700:400,
                                    textAlign:'center', outline:'none', fontFamily:'inherit',fontVariantNumeric:'tabular-nums'
                                  }}/>
                              ) : (
                                <span style={{fontSize:11,color:'#6E6A63'}}>주휴일</span>
                              )}
                            </td>
                            {/* 추가근무(분) */}
                            <td style={{padding:'4px 10px',borderBottom:'1px solid #ECE8E1',textAlign:'center'}}>
                              {!isSun ? (
<input key={`${activeEmp}_${dd}_m`} type="number" defaultValue={m||''} min="0" max="180" step="5" placeholder="0"
  onBlur={e=>saveWorkExtra(emp.uid,dd,e.target.value)}
  onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                                  style={{
                                    width:80, background:m>0?'rgba(195,38,28,0.15)':'#F3F1EC',
                                    border:m>0?'1px solid #C3261C':'1px solid #DCD7CE',
                                    borderRadius:6, color:m>0?'#C3261C':'#1D1B18',
                                    padding:'6px 8px', fontSize:13, fontWeight:m>0?700:400,
                                    textAlign:'center', outline:'none', fontFamily:'inherit',fontVariantNumeric:'tabular-nums'
                                  }}/>
                              ) : <span style={{color:'#DCD7CE'}}>—</span>}
                            </td>
                            {/* 주휴수당 */}
                            <td style={{padding:'6px 10px',borderBottom:'1px solid #ECE8E1',textAlign:'center',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>
{isSun && weeklyHoliday>0 ? (
  <span style={{color:'#2B5C9E',fontWeight:700,fontSize:12}}>{weeklyHoliday.toLocaleString()}원</span>
) : isSun ? (
  <span style={{color:'#A8A39A',fontSize:11}}>미지급</span>
) : (
  <span style={{color:'#DCD7CE'}}>—</span>
)}
                            </td>
                            {/* 비고 */}
                            <td style={{padding:'4px 10px',borderBottom:'1px solid #ECE8E1'}}>
<input key={`${activeEmp}_${dd}_memo`} type="text" defaultValue={empMemos[dd]||''}
  placeholder={isSun?'':'결석사유 등...'}
  onBlur={e=>saveMemo(emp.uid,dd,e.target.value)}
  onKeyDown={e=>e.key==='Enter'&&e.target.blur()}
                                style={{
                                  width:'100%', background:'transparent', border:'none',
                                  borderBottom:empMemos[dd]?'1px solid #DCD7CE':'1px solid transparent',
                                  color:empMemos[dd]?'#B42318':'#A8A39A',
                                  padding:'4px 2px', fontSize:11, outline:'none', fontFamily:'inherit'
                                }}/>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{background:'#ECE8E1'}}>
                        <td colSpan={2} style={{padding:'12px 10px',fontWeight:700,color:'#C3261C',fontSize:12}}>이달 합계</td>
                        <td style={{padding:'12px 10px',textAlign:'center',fontWeight:700,color:'#C3261C',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{totalHours}h</td>
                        <td style={{padding:'12px 10px',textAlign:'center',fontWeight:700,color:'#C3261C',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{totalMins>0?`${totalMins}m`:'—'}</td>
                        <td style={{padding:'12px 10px',textAlign:'center',fontWeight:700,color:'#2B5C9E',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{totalWeeklyHoliday.toLocaleString()}원</td>
                        <td style={{padding:'12px 10px'}}>
                          <span style={{color:'#2E7D45',fontWeight:700,fontFamily:'inherit',fontVariantNumeric:'tabular-nums',fontSize:14}}>
                            월급 {totalPay.toLocaleString()}원
                          </span>
                          <span style={{color:'#6E6A63',fontSize:10,marginLeft:8}}>
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
