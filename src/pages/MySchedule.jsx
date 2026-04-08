import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore'
import { useAuth, GradeBadge } from '../AuthContext'

const pad = n => String(n).padStart(2,'0')
const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const DAYS_KR = ['일','월','화','수','목','금','토']

const SHIFT_TYPES = {
  morning:   { label:'오전근무', color:'#3b82f6', bg:'rgba(59,130,246,0.15)', text:'#93c5fd' },
  afternoon: { label:'오후근무', color:'#ef4444', bg:'rgba(239,68,68,0.15)',  text:'#f87171' },
  sub:       { label:'대타근무', color:'#e5e7eb', bg:'rgba(229,231,235,0.15)',text:'#e5e7eb' },
}

function calcWeeklyHoliday(weekShifts, wage) {
  const hours = weekShifts * 8
  if (hours < 15) return 0
  return Math.round((hours / 40) * 8 * wage)
}

export default function MySchedule() {
  const { user, userData } = useAuth()
  const [curMonth, setCurMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [schData, setSchData] = useState({})
  const [events, setEvents] = useState({})
  const [allEmpSch, setAllEmpSch] = useState({})
  const [employees, setEmployees] = useState([])
  const [wage, setWage] = useState(10030)
  const [loading, setLoading] = useState(true)
  const [checkInData, setCheckInData] = useState(null)
  const [monthCheckins, setMonthCheckins] = useState([])

  const now = new Date()
  const todayDD = pad(now.getDate())
  const curYM = `${now.getFullYear()}-${pad(now.getMonth()+1)}`

  const monthOpts = []
  for(let y=2022;y<=2026;y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  useEffect(()=>{
    async function load() {
      setLoading(true)
      try {
        const schSnap = await getDoc(doc(db,'schedule',curMonth))
        const schAll = schSnap.exists() ? schSnap.data() : {}
        setSchData(schAll[user.uid]||{})
        setAllEmpSch(schAll)

        const evSnap = await getDoc(doc(db,'events',curMonth))
        setEvents(evSnap.exists() ? evSnap.data() : {})

        const empSnap = await getDoc(doc(db,'meta','employees'))
        setEmployees(empSnap.exists() ? empSnap.data().list||[] : [])

        const userSnap = await getDoc(doc(db,'users',user.uid))
        if(userSnap.exists()) setWage(userSnap.data().wage||10030)

        // 오늘 출퇴근
        const checkSnap = await getDoc(doc(db,'checkin',`${curYM}_${todayDD}_${user.uid}`))
        if(checkSnap.exists()) setCheckInData(checkSnap.data())

        // 이번달 출퇴근 기록
        const q = query(
          collection(db,'checkin'),
          where('uid','==',user.uid),
          where('month','==',curMonth)
        )
        const qSnap = await getDocs(q)
        const list = []
        qSnap.forEach(d => list.push(d.data()))
        setMonthCheckins(list.sort((a,b)=>a.date>b.date?1:-1))

      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  },[curMonth, user.uid])

  async function handleCheckIn() {
    const time = now.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})
    const data = {
      uid: user.uid, name: userData?.name,
      date: todayDD, month: curYM,
      checkinTime: time, status: 'checkin'
    }
    await setDoc(doc(db,'checkin',`${curYM}_${todayDD}_${user.uid}`), data)
    setCheckInData(data)
  }

  async function handleCheckOut() {
    const time = now.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})
    const data = { ...checkInData, checkoutTime: time, status: 'checkout' }
    await setDoc(doc(db,'checkin',`${curYM}_${todayDD}_${user.uid}`), data, {merge:true})
    setCheckInData(data)
  }

  const days = daysIn(curMonth)
  const [cy,cm] = curMonth.split('-').map(Number)
  const firstDow = new Date(cy,cm-1,1).getDay()
  const isThisMonth = curMonth === curYM

  const workDays = Object.keys(schData).filter(d=>schData[d]).length
  const totalHours = workDays * 8
  const totalWage = Math.round(totalHours * wage)

  let weeklyHoliday = 0
  let weekStart = 1
  while(weekStart <= 31) {
    const weekShifts = Object.keys(schData).filter(d=>{
      const day=+d; return day>=weekStart&&day<=weekStart+6&&schData[pad(day)]
    }).length
    weeklyHoliday += calcWeeklyHoliday(weekShifts, wage)
    weekStart += 7
  }

  const todayStatus = checkInData?.status || null
  const EMP_COLORS = ['#f9b934','#93c5fd','#34d399','#c4b5fd','#fb923c','#f87171']

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>📅 내 스케쥴</div>
          <div style={{display:'flex',alignItems:'center',gap:8,marginTop:4,flexWrap:'wrap'}}>
  <span style={{fontSize:12,color:'#dde1f2'}}>{userData?.name}</span>
  <GradeBadge joinDate={userData?.joinDate} size={10}/>
  <span style={{fontSize:11,color:'#f9b934',fontFamily:'DM Mono, monospace',background:'rgba(249,185,52,0.12)',padding:'2px 7px',borderRadius:4}}>
    {wage.toLocaleString()}원/h
  </span>
</div>
        </div>
        <select value={curMonth} onChange={e=>setCurMonth(e.target.value)}
          style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,color:'#dde1f2',padding:'8px 12px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
          {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
        </select>
      </div>

      {/* 출퇴근 버튼 */}
      {isThisMonth && (
        <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'18px 20px',marginBottom:18}}>
          <div style={{fontSize:12,fontWeight:600,marginBottom:4}}>
            오늘 출퇴근 — {now.getMonth()+1}월 {now.getDate()}일 ({DAYS_KR[now.getDay()]})
          </div>

          {/* 출퇴근 시간 표시 */}
          <div style={{display:'flex',gap:16,marginBottom:14}}>
            <div style={{display:'flex',flexDirection:'column',gap:3}}>
              <div style={{fontSize:10,color:'#5e6585'}}>출근 시각</div>
              <div style={{fontSize:14,fontWeight:700,fontFamily:'DM Mono, monospace',
                color:checkInData?.checkinTime?'#34d399':'#272a3d'}}>
                {checkInData?.checkinTime || '—'}
              </div>
            </div>
            <div style={{width:1,background:'#272a3d'}}></div>
            <div style={{display:'flex',flexDirection:'column',gap:3}}>
              <div style={{fontSize:10,color:'#5e6585'}}>퇴근 시각</div>
              <div style={{fontSize:14,fontWeight:700,fontFamily:'DM Mono, monospace',
                color:checkInData?.checkoutTime?'#f87171':'#272a3d'}}>
                {checkInData?.checkoutTime || '—'}
              </div>
            </div>
            {checkInData?.checkinTime && checkInData?.checkoutTime && (
              <>
                <div style={{width:1,background:'#272a3d'}}></div>
                <div style={{display:'flex',flexDirection:'column',gap:3}}>
                  <div style={{fontSize:10,color:'#5e6585'}}>근무시간</div>
                  <div style={{fontSize:14,fontWeight:700,fontFamily:'DM Mono, monospace',color:'#f9b934'}}>
                    {(()=>{
                      const [ih,im] = checkInData.checkinTime.split(':').map(Number)
                      const [oh,om] = checkInData.checkoutTime.split(':').map(Number)
                      const diff = (oh*60+om)-(ih*60+im)
                      if(diff<0) return '—'
                      return `${Math.floor(diff/60)}h ${diff%60}m`
                    })()}
                  </div>
                </div>
              </>
            )}
          </div>

          <div style={{display:'flex',gap:10}}>
            <button onClick={handleCheckIn}
              disabled={!!todayStatus}
              style={{flex:1,background:todayStatus?'#191c2b':'#3b82f6',
                color:todayStatus?'#5e6585':'#fff',border:'none',borderRadius:8,
                padding:'12px',fontSize:13,fontWeight:700,
                cursor:todayStatus?'not-allowed':'pointer',fontFamily:'inherit',transition:'.15s'}}>
              {todayStatus?'✅ 출근 완료':'🏃 출근'}
            </button>
            <button onClick={handleCheckOut}
              disabled={todayStatus!=='checkin'}
              style={{flex:1,background:todayStatus==='checkin'?'#ef4444':'#191c2b',
                color:todayStatus==='checkin'?'#fff':'#5e6585',border:'none',borderRadius:8,
                padding:'12px',fontSize:13,fontWeight:700,
                cursor:todayStatus==='checkin'?'pointer':'not-allowed',fontFamily:'inherit',transition:'.15s'}}>
              {todayStatus==='checkout'?'✅ 퇴근 완료':'🏠 퇴근'}
            </button>
          </div>
        </div>
      )}

      {/* 요약 카드 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:20}}>
        {[
          {label:'근무일수', val:`${workDays}일`, color:'#f9b934'},
          {label:'예상 기본급', val:`${totalWage.toLocaleString()}원`, color:'#93c5fd'},
          {label:'주휴수당', val:`${weeklyHoliday.toLocaleString()}원`, color:'#34d399'},
        ].map(k=>(
          <div key={k.label} style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'16px 18px',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:k.color}}></div>
            <div style={{fontSize:10,fontWeight:600,color:'#5e6585',textTransform:'uppercase',letterSpacing:.8,marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:16,fontWeight:700,color:k.color,fontFamily:'DM Mono, monospace'}}>{k.val}</div>
            {k.label==='주휴수당'&&<div style={{fontSize:10,color:'#5e6585',marginTop:3}}>총 {(totalWage+weeklyHoliday).toLocaleString()}원</div>}
          </div>
        ))}
      </div>

      {/* 이번달 출퇴근 기록 */}
      {monthCheckins.length > 0 && (
        <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,marginBottom:20,overflow:'hidden'}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>
            🕐 {mLabel(curMonth)} 출퇴근 기록
          </div>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead>
              <tr style={{background:'#191c2b'}}>
                {['날짜','출근','퇴근','근무시간'].map(h=>(
                  <th key={h} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:'#5e6585',
                    textAlign:h==='날짜'?'left':'right',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {monthCheckins.map(c=>{
                let workTime = '—'
                if(c.checkinTime && c.checkoutTime) {
                  try {
  const parseTime = (t) => {
    if(!t) return 0
    const isPM = t.includes('오후')
    const clean = t.replace('오전 ','').replace('오후 ','')
    const [h,m] = clean.split(':').map(Number)
    return (h%12 + (isPM?12:0))*60 + m
  }
  const diff = parseTime(c.checkoutTime) - parseTime(c.checkinTime)
  if(diff>0) workTime = `${Math.floor(diff/60)}h ${diff%60}m`
} catch(e) {}
                }
                return(
                  <tr key={c.date}>
                    <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',color:'#dde1f2'}}>{+c.date}일</td>
                    <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace',color:'#34d399'}}>{c.checkinTime||'—'}</td>
                    <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace',color:'#f87171'}}>{c.checkoutTime||'—'}</td>
                    <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace',color:'#f9b934'}}>{workTime}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* 달력 */}
      <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontSize:13,fontWeight:600}}>{mLabel(curMonth)} 전체 스케쥴</span>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {Object.entries(SHIFT_TYPES).map(([k,v])=>(
              <div key={k} style={{display:'flex',alignItems:'center',gap:3,fontSize:9}}>
                <div style={{width:8,height:8,borderRadius:2,background:v.color}}></div>
                <span style={{color:'#5e6585'}}>{v.label}</span>
              </div>
            ))}
          </div>
        </div>

        {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:40}}>로딩 중...</div> : (
          <div style={{padding:14}}>
            <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:10}}>
              {employees.map((e,idx)=>(
                <div key={e.uid} style={{display:'flex',alignItems:'center',gap:4,fontSize:10}}>
                  <div style={{width:8,height:8,borderRadius:2,background:EMP_COLORS[idx%EMP_COLORS.length]}}></div>
                  <span style={{color:e.uid===user.uid?'#f9b934':'#5e6585',fontWeight:e.uid===user.uid?700:400}}>
                    {e.name}{e.uid===user.uid?' (나)':''}
                  </span>
                </div>
              ))}
            </div>

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
                  const myShift=schData[dd]
                  const event=events[dd]
                  const checkin=monthCheckins.find(c=>c.date===dd)

                  const dayShifts=employees.map((e,ei)=>{
                    const shift=(allEmpSch[e.uid]||{})[dd]
                    if(!shift) return null
                    return {emp:e,idx:ei,shift,isMe:e.uid===user.uid}
                  }).filter(Boolean)

                  return(
                    <div key={idx} style={{
                      background:myShift?SHIFT_TYPES[myShift]?.bg||'rgba(100,100,100,0.1)':'#191c2b',
                      border:isToday?'2px solid #f9b934':myShift?`1px solid ${SHIFT_TYPES[myShift]?.color||'#444'}`:'1px solid #272a3d',
                      borderRadius:8,padding:'6px',minHeight:90
                    }}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:3}}>
                        <div style={{fontSize:11,fontWeight:700,fontFamily:'DM Mono, monospace',
                          color:dow===0?'#f87171':dow===6?'#93c5fd':isToday?'#f9b934':'#dde1f2'}}>{d}</div>
                        {isToday&&<div style={{width:5,height:5,borderRadius:'50%',background:'#f9b934'}}></div>}
                      </div>

                      {event&&(
                        <div style={{background:'rgba(249,185,52,0.15)',color:'#f9b934',fontSize:8,padding:'2px 4px',borderRadius:3,marginBottom:3,lineHeight:1.4}}>
                          📌 {event}
                        </div>
                      )}

                      {/* 출퇴근 시간 표시 */}
                      {checkin && (
                        <div style={{background:'rgba(52,211,153,0.1)',borderRadius:3,padding:'2px 4px',marginBottom:3}}>
                          <div style={{fontSize:8,color:'#34d399',fontFamily:'DM Mono, monospace'}}>
                            {checkin.checkinTime&&`↑${checkin.checkinTime}`}
                          </div>
                          <div style={{fontSize:8,color:'#f87171',fontFamily:'DM Mono, monospace'}}>
                            {checkin.checkoutTime&&`↓${checkin.checkoutTime}`}
                          </div>
                        </div>
                      )}

                      <div style={{display:'flex',flexDirection:'column',gap:2}}>
                        {dayShifts.map(({emp,idx:ei,shift,isMe})=>(
                          <div key={emp.uid} style={{
                            background:SHIFT_TYPES[shift]?.bg||'rgba(100,100,100,0.2)',
                            borderLeft:`2px solid ${EMP_COLORS[ei%EMP_COLORS.length]}`,
                            borderRadius:3,padding:'2px 4px',fontSize:8,fontWeight:700,
                            color:SHIFT_TYPES[shift]?.text||'#dde1f2',
                            outline:isMe?`1px solid ${EMP_COLORS[ei%EMP_COLORS.length]}`:'none',
                          }}>
                            {isMe?'나':emp.name.charAt(0)} · {SHIFT_TYPES[shift]?.label.replace('근무','')||shift}
                          </div>
                        ))}
                        {dayShifts.length===0&&<div style={{fontSize:8,color:'#272a3d'}}>휴무</div>}
                      </div>
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
