import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore'
import { useAuth, GradeBadge } from '../AuthContext'

const pad = n => String(n).padStart(2,'0')
const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const DAYS_KR = ['일','월','화','수','목','금','토']

function calcDeduction(totalPay, employType) {
  if(employType === 'none') return { total:0 }
  if(employType === 'part') return { total: Math.round(totalPay * 0.033) }
  const pension = Math.round(totalPay * 0.045)
  const health  = Math.round(totalPay * 0.03545)
  const employ  = Math.round(totalPay * 0.009)
  const care    = Math.round(health   * 0.1295)
  return { total: pension + health + employ + care }
}
function calcWeeklyHoliday(totalHours, wage) {
  if(totalHours < 15) return 0
  return Math.round((totalHours/40)*8*wage)
}

export default function MySchedule() {
  const { user, userData } = useAuth()
  const [curMonth, setCurMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [workHours, setWorkHours] = useState({}) // 사장이 입력한 근무시간
  const [workExtra, setWorkExtra] = useState({}) // 추가근무(분)
  const [events, setEvents] = useState({})
  const [wage, setWage] = useState(10030)
const [employType, setEmployType] = useState('part')
  const [payroll, setPayroll] = useState(null)
  const [loading, setLoading] = useState(true)

  const now = new Date()
  const curYM = `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  const isThisMonth = curMonth === curYM

  const monthOpts = []
  for(let y=2022;y<=2026;y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  useEffect(()=>{
    async function load() {
      setLoading(true)
      try {
        // 시급
        const userSnap = await getDoc(doc(db,'users',user.uid))
        if(userSnap.exists()) {
          setWage(userSnap.data().wage||10030)
          setEmployType(userSnap.data().employType||'part')
        }

        // 사장이 입력한 근무시간
        const whSnap = await getDoc(doc(db,'workhours',curMonth))
        const whData = whSnap.exists() ? whSnap.data() : {}
        setWorkHours(whData[user.uid] || {})

        // 추가근무(분)
        const exSnap = await getDoc(doc(db,'workextra',curMonth))
        const exData = exSnap.exists() ? exSnap.data() : {}
        setWorkExtra(exData[user.uid] || {})

        // 매장 이벤트
        const evSnap = await getDoc(doc(db,'events',curMonth))
        setEvents(evSnap.exists() ? evSnap.data() : {})

        // 급여 확인
        const prSnap = await getDoc(doc(db,'payroll',curMonth))
        if(prSnap.exists()) setPayroll(prSnap.data()[user.uid]||null)
        else setPayroll(null)

      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  },[curMonth, user.uid])

  const days = daysIn(curMonth)
  const [cy,cm] = curMonth.split('-').map(Number)
  const firstDow = new Date(cy,cm-1,1).getDay()

  // 통계 계산 (추가근무 포함)
  const allDays = new Set([
    ...Object.keys(workHours).filter(d=>workHours[d]>0),
    ...Object.keys(workExtra).filter(d=>workExtra[d]>0)
  ])
  const workDays = [...allDays].sort()
  const totalHours = workDays.reduce((a,d)=>a+(workHours[d]||0),0)
  const totalMins = workDays.reduce((a,d)=>a+(workExtra[d]||0),0)
  const totalH = totalHours + totalMins/60
  const totalWage = Math.round(totalH * wage)

  // 주휴수당
  let weeklyHoliday = 0
  let weekStart = 1
  while(weekStart <= 31) {
    let weekH = 0
    for(let d=weekStart;d<weekStart+7&&d<=31;d++) {
      weekH += workHours[pad(d)] || 0
    }
    weeklyHoliday += calcWeeklyHoliday(weekH, wage)
    weekStart += 7
  }

  const totalPay = totalWage + weeklyHoliday
  const deduction = calcDeduction(totalPay, employType)
  const netPay = totalPay - deduction.total

  // 근무 강도에 따른 색상
  function getHourColor(h) {
    if(!h || h===0) return null
    if(h <= 4) return { bg:'rgba(147,197,253,0.2)', border:'#93c5fd', text:'#93c5fd' }
    if(h <= 6) return { bg:'rgba(249,185,52,0.2)', border:'#f9b934', text:'#f9b934' }
    return { bg:'rgba(52,211,153,0.2)', border:'#34d399', text:'#34d399' }
  }

  async function checkPayroll() {
    if(!payroll?.confirmedByOwner) return
    try {
      const prSnap = await getDoc(doc(db,'payroll',curMonth))
      if(prSnap.exists()) {
        const newPayroll = { ...prSnap.data(), [user.uid]: { ...(prSnap.data()[user.uid]||{}), checkedByEmp:true, checkedAt:new Date().toISOString() }}
        await setDoc(doc(db,'payroll',curMonth), newPayroll)
        setPayroll(p=>({...p, checkedByEmp:true}))
        alert('급여 내역을 확인했습니다!')
      }
    } catch(e) { console.error(e) }
  }

  async function sendInquiry(msg) {
    if(!msg.trim()) return
    try {
      const prSnap = await getDoc(doc(db,'payroll',curMonth))
      if(prSnap.exists()) {
        const newPayroll = { ...prSnap.data(), [user.uid]: {
          ...(prSnap.data()[user.uid]||{}),
          inquiry: { message:msg.trim(), createdAt:new Date().toISOString(), resolved:false }
        }}
        await setDoc(doc(db,'payroll',curMonth), newPayroll)
        setPayroll(p=>({...p, inquiry:{message:msg.trim(), createdAt:new Date().toISOString(), resolved:false}}))
        alert('문의가 전송됐습니다!')
      }
    } catch(e) { console.error(e) }
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>📅 내 스케쥴</div>
          <div style={{display:'flex',alignItems:'center',gap:8,marginTop:4,flexWrap:'wrap'}}>
            <span style={{fontSize:12,color:'#dde1f2'}}>{userData?.name}</span>
            <GradeBadge joinDate={userData?.joinDate} size={10}/>
            <span style={{fontSize:11,color:'#f9b934',fontFamily:'DM Mono,monospace',
              background:'rgba(249,185,52,0.12)',padding:'2px 7px',borderRadius:4}}>
              {wage.toLocaleString()}원/h
            </span>
          </div>
        </div>
        <select value={curMonth} onChange={e=>setCurMonth(e.target.value)}
          style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,color:'#dde1f2',padding:'8px 12px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
          {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
        </select>
      </div>

      {/* 요약 카드 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
        {[
          {label:'근무일수', val:`${workDays.length}일`, color:'#f9b934'},
          {label:'총 근무시간', val:`${totalHours}h`, color:'#93c5fd'},
          {label:'기본급', val:`${totalWage.toLocaleString()}원`, color:'#dde1f2'},
          {label:'주휴수당', val:`${weeklyHoliday.toLocaleString()}원`, color:'#34d399'},
        ].map(k=>(
          <div key={k.label} style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'16px 18px',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:k.color}}></div>
            <div style={{fontSize:10,fontWeight:600,color:'#5e6585',textTransform:'uppercase',letterSpacing:.8,marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:16,fontWeight:700,color:k.color,fontFamily:'DM Mono,monospace'}}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* 총 지급 예상액 */}
      <div style={{background:'rgba(52,211,153,0.08)',border:'1px solid rgba(52,211,153,0.2)',borderRadius:12,padding:'16px 20px',marginBottom:20}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
          <div style={{flex:1}}>
            <div style={{fontSize:11,color:'#5e6585',marginBottom:6}}>💰 이번달 예상 급여</div>
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:11,color:'#5e6585'}}>세전 총액</span>
                <span style={{fontSize:13,color:'#dde1f2',fontFamily:'DM Mono,monospace'}}>{totalPay.toLocaleString()}원</span>
              </div>
              {deduction.total > 0 && (
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <span style={{fontSize:11,color:'#5e6585'}}>
                    공제 ({employType==='part'?'3.3% 원천징수':'4대보험'})
                  </span>
                  <span style={{fontSize:13,color:'#f87171',fontFamily:'DM Mono,monospace'}}>-{deduction.total.toLocaleString()}원</span>
                </div>
              )}
              <div style={{borderTop:'1px solid rgba(52,211,153,0.2)',paddingTop:6,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                <span style={{fontSize:12,fontWeight:700,color:'#34d399'}}>실수령액</span>
                <span style={{fontSize:22,fontWeight:700,color:'#34d399',fontFamily:'DM Mono,monospace'}}>{netPay.toLocaleString()}원</span>
              </div>
              <div style={{fontSize:10,color:'#5e6585'}}>
                기본급 {totalWage.toLocaleString()} + 주휴수당 {weeklyHoliday.toLocaleString()}
              </div>
            </div>
          </div>
          <div style={{fontSize:32,marginLeft:16}}>💵</div>
        </div>
      </div>

      {/* 급여 확인 섹션 */}
      {payroll?.confirmedByOwner && (
        <div style={{background:'#12141f',border:`1px solid ${payroll.checkedByEmp?'#34d399':'#f9b934'}`,borderRadius:12,padding:'18px',marginBottom:20}}>
          <div style={{fontSize:13,fontWeight:600,marginBottom:12}}>
            💸 {mLabel(curMonth)} 확정 급여
          </div>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10}}>
            <div>
              <div style={{fontSize:11,color:'#5e6585',marginBottom:4}}>
                기본급 {(payroll.basePay||0).toLocaleString()} + 주휴 {(payroll.weeklyHoliday||0).toLocaleString()}
              </div>
              <div style={{fontSize:11,color:'#5e6585',marginBottom:4}}>
                세전 {(payroll.totalPay||0).toLocaleString()}원
                {(payroll.deduction?.total||0)>0 && (
                  <span style={{color:'#f87171',marginLeft:6}}>-{(payroll.deduction?.total||0).toLocaleString()}원</span>
                )}
              </div>
              <div style={{fontSize:20,fontWeight:700,color:'#34d399',fontFamily:'DM Mono,monospace'}}>
                실수령 {(payroll.netPay||payroll.totalPay||0).toLocaleString()}원
              </div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:8,alignItems:'flex-end'}}>
              {!payroll.checkedByEmp && !payroll.inquiry && (
                <button onClick={checkPayroll}
                  style={{background:'#34d399',color:'#000',border:'none',borderRadius:8,
                    padding:'10px 20px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                  ✅ 급여 확인
                </button>
              )}
              {!payroll.checkedByEmp && !payroll.inquiry && (
                <button onClick={()=>{
                  const msg = window.prompt('문의 내용을 입력해주세요')
                  if(msg) sendInquiry(msg)
                }}
                  style={{background:'transparent',border:'1px solid #f87171',color:'#f87171',borderRadius:8,
                    padding:'8px 16px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
                  📨 문의하기
                </button>
              )}
              {payroll.checkedByEmp && (
                <span style={{fontSize:11,color:'#34d399',fontWeight:600}}>✅ 확인 완료</span>
              )}
              {payroll.inquiry && !payroll.inquiry.resolved && (
                <div style={{textAlign:'right'}}>
                  <div style={{fontSize:11,color:'#f87171',marginBottom:4}}>📨 문의 중...</div>
                  {payroll.inquiry.ownerReply && (
                    <div style={{background:'rgba(249,185,52,0.08)',border:'1px solid rgba(249,185,52,0.2)',
                      borderRadius:8,padding:'8px 12px',fontSize:11,color:'#dde1f2',maxWidth:200,textAlign:'left'}}>
                      사장님 답변: {payroll.inquiry.ownerReply}
                    </div>
                  )}
                </div>
              )}
              {payroll.inquiry?.resolved && !payroll.checkedByEmp && (
                <button onClick={checkPayroll}
                  style={{background:'#34d399',color:'#000',border:'none',borderRadius:8,
                    padding:'10px 20px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                  ✅ 급여 확인
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:40}}>로딩 중...</div> : (
        <>
          {/* 달력 */}
          <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,marginBottom:20}}>
            <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
              <span style={{fontSize:13,fontWeight:600}}>{mLabel(curMonth)} 근무 달력</span>
              <div style={{display:'flex',gap:10}}>
                {[
                  {color:'#93c5fd',label:'4h 이하'},
                  {color:'#f9b934',label:'4~6h'},
                  {color:'#34d399',label:'6h 이상'},
                ].map(c=>(
                  <div key={c.label} style={{display:'flex',alignItems:'center',gap:4,fontSize:10}}>
                    <div style={{width:8,height:8,borderRadius:2,background:c.color}}></div>
                    <span style={{color:'#5e6585'}}>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{padding:14}}>
              <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3,marginBottom:3}}>
                {DAYS_KR.map((d,i)=>(
                  <div key={d} style={{textAlign:'center',fontSize:10,fontWeight:700,padding:'6px 0',
                    color:i===0?'#f87171':i===6?'#93c5fd':'#5e6585'}}>{d}</div>
                ))}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3}}>
                {(()=>{
                  const cells=[]
                  for(let i=0;i<firstDow;i++) cells.push(null)
                  for(let d=1;d<=days;d++) cells.push(d)
                  while(cells.length%7!==0) cells.push(null)
                  return cells.map((d,idx)=>{
                    if(!d) return <div key={idx}></div>
                    const dd=pad(d)
                    const dow=idx%7
                    const isToday=isThisMonth&&d===now.getDate()
                    const h=workHours[dd]||0
                    const event=events[dd]
                    const colors=getHourColor(h)

                    return(
                      <div key={idx} style={{
                        background:colors?colors.bg:'#191c2b',
                        border:isToday?'2px solid #f9b934':colors?`1px solid ${colors.border}`:'1px solid #272a3d',
                        borderRadius:8,padding:'6px',minHeight:76,
                        display:'flex',flexDirection:'column',gap:2
                      }}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start'}}>
                          <div style={{fontSize:11,fontWeight:700,fontFamily:'DM Mono,monospace',
                            color:dow===0?'#f87171':dow===6?'#93c5fd':isToday?'#f9b934':colors?colors.text:'#5e6585'}}>
                            {d}
                          </div>
                          {isToday&&<div style={{width:5,height:5,borderRadius:'50%',background:'#f9b934',flexShrink:0}}></div>}
                        </div>

                        {event&&(
                          <div style={{background:'rgba(249,185,52,0.15)',color:'#f9b934',fontSize:7,padding:'2px 3px',borderRadius:3,lineHeight:1.4}}>
                            📌 {event}
                          </div>
                        )}

                        {(()=>{
                          const ex = workExtra[dd]||0
                          const totalDayH = h + ex/60
                          return h>0||ex>0 ? (
                            <div style={{marginTop:'auto'}}>
                              <div style={{fontSize:12,fontWeight:700,color:colors?.text,fontFamily:'DM Mono,monospace',textAlign:'center'}}>
                                {h}h{ex>0?` ${ex}m`:''}
                              </div>
                              <div style={{fontSize:9,color:'#5e6585',textAlign:'center'}}>{Math.round(totalDayH*wage).toLocaleString()}원</div>
                            </div>
                          ) : (
                            <div style={{fontSize:8,color:'#272a3d',marginTop:'auto',textAlign:'center'}}>휴무</div>
                          )
                        })()}
                      </div>
                    )
                  })
                })()}
              </div>
            </div>
          </div>

          {/* 근무 상세 목록 */}
          {workDays.length > 0 && (
            <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden'}}>
              <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>
                📋 {mLabel(curMonth)} 근무 상세
              </div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead>
                  <tr style={{background:'#191c2b'}}>
                    {['날짜','요일','근무시간','일급'].map(h=>(
                      <th key={h} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:'#5e6585',
                        textAlign:h==='날짜'||h==='요일'?'left':'right',whiteSpace:'nowrap'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {workDays.map(dd=>{
                    const h = workHours[dd]||0
                    const ex = workExtra[dd]||0
                    const totalDayH = h + ex/60
                    const [y2,m2] = curMonth.split('-').map(Number)
                    const dow = new Date(y2,m2-1,+dd).getDay()
                    const dowLabel = DAYS_KR[dow]
                    const colors = getHourColor(h)
                    return(
                      <tr key={dd}>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',color:'#dde1f2',fontFamily:'DM Mono,monospace'}}>{+dd}일</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',
                          color:dow===0?'#f87171':dow===6?'#93c5fd':'#5e6585',fontWeight:600}}>{dowLabel}</td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'right'}}>
                          <span style={{background:colors?.bg,color:colors?.text,fontFamily:'DM Mono,monospace',
                            fontWeight:700,padding:'3px 10px',borderRadius:20,fontSize:12}}>
                            {h}h{ex>0?` ${ex}m`:''}
                          </span>
                        </td>
                        <td style={{padding:'10px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',
                          fontFamily:'DM Mono,monospace',color:'#f9b934',fontWeight:700}}>
                          {Math.round(totalDayH*wage).toLocaleString()}원
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{background:'#1f2236'}}>
                    <td colSpan={2} style={{padding:'10px 14px',fontWeight:700,color:'#f9b934'}}>합 계</td>
                    <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>{totalHours}h{totalMins>0?` ${totalMins}m`:''}</td>
                    <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>{totalWage.toLocaleString()}원</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {workDays.length === 0 && (
            <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:40,textAlign:'center',color:'#5e6585'}}>
              {mLabel(curMonth)}에 입력된 근무 일정이 없습니다
            </div>
          )}
        </>
      )}
    </div>
  )
}
