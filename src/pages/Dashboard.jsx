import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, getDocs, collection } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const wonFmt = n => n ? n.toLocaleString('ko-KR')+'원' : '—'
const pct = (a,b) => b>0 ? Math.round(a/b*100) : 0

export default function Dashboard() {
  const [curMonth, setCurMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [rev, setRev] = useState({kiosk:0,del:0,pos:0,total:0})
  const [exp, setExp] = useState({total:0,mat:0,mgmt:0,sal:0})
  const [staff, setStaff] = useState([])
  const [staffStats, setStaffStats] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        // 매출
        const revSnap = await getDoc(doc(db,'revenue',curMonth))
        if(revSnap.exists()) {
          const d = revSnap.data()
          let k=0,dl=0,p=0
          Object.values(d).forEach(r=>{k+=r.kiosk||0;dl+=r.del||0;p+=r.pos||0})
          setRev({kiosk:k,del:dl,pos:p,total:k+dl+p})
        } else setRev({kiosk:0,del:0,pos:0,total:0})

        // 지출
        const expSnap = await getDoc(doc(db,'expenses',curMonth))
        if(expSnap.exists()) {
          const d = expSnap.data()
          let hq=0,veg=0,oil=0,box=0,gas=0,elec=0,omg=0,rent=0,dfee=0,meal=0,sal=0
          Object.values(d).forEach(e=>{hq+=e.hq||0;veg+=e.veg||0;oil+=e.oil||0;box+=e.box||0;gas+=e.gas||0;elec+=e.elec||0;omg+=e.omg||0;rent+=e.rent||0;dfee+=e.dfee||0;meal+=e.meal||0;sal+=e.sal||0})
          setExp({total:hq+veg+oil+box+gas+elec+omg+rent+dfee+meal+sal, mat:hq+veg+oil+box, mgmt:gas+elec+omg+rent+dfee, sal})
        } else setExp({total:0,mat:0,mgmt:0,sal:0})

        // 직원 목록 — users 컬렉션 기반
        const usersSnap = await getDocs(collection(db,'users'))
        const emps = []
usersSnap.forEach(d => {
          const data = d.data()
          if(data.status==='approved' && data.role!=='owner') {
            emps.push({
              uid:d.id,
              name:data.name,
              wage:data.wage||10030,
              workDays:data.workDays||[1,2,3,4,5]
            })
          }
        })
        setStaff(emps)

        // workhours 기반 근무시간/인건비 계산
        const whSnap = await getDoc(doc(db,'workhours',curMonth))
        const whData = whSnap.exists() ? whSnap.data() : {}
        const extraSnap = await getDoc(doc(db,'workextra',curMonth))
        const extraData = extraSnap.exists() ? extraSnap.data() : {}

const memoSnap = await getDoc(doc(db,'workmemos',curMonth))
        const memoData = memoSnap.exists() ? memoSnap.data() : {}

        const stats = {}
        emps.forEach(emp => {
          const wh = whData[emp.uid] || {}
          const ex = extraData[emp.uid] || {}
          const empMemos = memoData[emp.uid] || {}
          const workDays = emp.workDays || [1,2,3,4,5]
          const wage = emp.wage || 10030

          let totalHours = 0
          let totalMins = 0
          let totalWeeklyHoliday = 0

          const [cy,cm] = curMonth.split('-').map(Number)
          const days = new Date(cy,cm,0).getDate()

          for(let d=1; d<=days; d++) {
            const dd = String(d).padStart(2,'0')
            const dow = new Date(cy,cm-1,d).getDay()
            totalHours += wh[dd]||0
            totalMins += ex[dd]||0

            if(dow === 0) {
              let weekH = 0
              const weekAttendance = {}
              const weekMemos = {}
              for(let wd=1; wd<=6; wd++) {
                const prevD = d - wd
                if(prevD >= 1) {
                  const prevDD = String(prevD).padStart(2,'0')
                  const prevDow = new Date(cy,cm-1,prevD).getDay()
                  const prevH = (wh[prevDD]||0) + (ex[prevDD]||0)/60
                  weekH += prevH
                  weekAttendance[prevDow] = prevH
                  if(empMemos[prevDD]) weekMemos[prevDD] = empMemos[prevDD]
                }
              }

              // 주휴수당 계산
              if(weekH >= 15) {
                const absentDays = workDays.filter(d => (weekAttendance[d]||0) === 0)
                const subCount = Object.values(weekMemos).filter(m => m&&m.includes('대타')).length
                if(absentDays.length === 0 || subCount >= absentDays.length) {
                  totalWeeklyHoliday += Math.round((weekH/40)*8*wage)
                }
              }
            }
          }

          const totalH = totalHours + totalMins/60
          const basePay = Math.round(totalH * wage)
          const totalWage = basePay + totalWeeklyHoliday
          stats[emp.uid] = { hours: totalHours, mins: totalMins, totalH, wage: totalWage, basePay, weeklyHoliday: totalWeeklyHoliday }
        })
        setStaffStats(stats)

      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [curMonth])

  const profit = rev.total - exp.total
  const totalLaborCost = Object.values(staffStats).reduce((a,s)=>a+s.wage,0)
  const monthOpts = []
  for(let y=2022;y<=2026;y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  const KPI = ({label,value,note,color}) => (
    <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'18px 20px',position:'relative',overflow:'hidden'}}>
      <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:color}}></div>
      <div style={{fontSize:10,fontWeight:600,color:'#5e6585',textTransform:'uppercase',letterSpacing:.8,marginBottom:6}}>{label}</div>
      <div style={{fontSize:20,fontWeight:700,color,fontFamily:'DM Mono, monospace'}}>{value}</div>
      <div style={{fontSize:10,color:'#5e6585',marginTop:4,lineHeight:1.6}}>{note}</div>
    </div>
  )

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>📊 대시보드</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>{mLabel(curMonth)} 전체 현황</div>
        </div>
        <select value={curMonth} onChange={e=>setCurMonth(e.target.value)}
          style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,color:'#dde1f2',padding:'8px 12px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
          {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
        </select>
      </div>

      {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:60}}>로딩 중...</div> : (
        <>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,marginBottom:20}}>
            <KPI label="월 총 매출" value={wonFmt(rev.total)} note={`배달 ${pct(rev.del,rev.total)}% · 포스 ${pct(rev.pos,rev.total)}% · 키오스크 ${pct(rev.kiosk,rev.total)}%`} color="#f9b934"/>
            <KPI label="월 총 지출" value={wonFmt(exp.total)} note={`재료비 ${wonFmt(exp.mat)} · 관리비 ${wonFmt(exp.mgmt)}`} color="#f87171"/>
            <KPI label="순이익" value={wonFmt(Math.abs(profit))} note={profit>=0?'흑자 ▲':'적자 ▼'} color={profit>=0?'#34d399':'#f87171'}/>
            <KPI label="인건비" value={wonFmt(totalLaborCost)} note={`인건비율 ${pct(totalLaborCost,rev.total)}% · ${staff.length}명`} color="#93c5fd"/>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:14}}>
            <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden'}}>
              <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>채널별 매출 요약</div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <tbody>
                  {[['🖥️ 키오스크',rev.kiosk],['🛵 배달',rev.del],['🧾 포스(현장)',rev.pos]].map(([label,val])=>(
                    <tr key={label}>
                      <td style={{padding:'10px 18px',borderBottom:'1px solid #272a3d',color:'#dde1f2'}}>{label}</td>
                      <td style={{padding:'10px 18px',borderBottom:'1px solid #272a3d',textAlign:'right',color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{val.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{background:'#1f2236'}}>
                    <td style={{padding:'10px 18px',fontWeight:700,color:'#f9b934'}}>합 계</td>
                    <td style={{padding:'10px 18px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{rev.total.toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden'}}>
              <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>이번달 인원 현황</div>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                <thead>
                  <tr style={{background:'#191c2b'}}>
                    {['직원','근무시간','인건비'].map(h=>(
                      <th key={h} style={{padding:'8px 18px',fontSize:10,fontWeight:600,color:'#5e6585',textAlign:h==='직원'?'left':'right'}}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {staff.map(e=>{
                    const s = staffStats[e.uid]||{hours:0,mins:0,totalH:0,wage:0}
                    return(
                      <tr key={e.uid}>
                        <td style={{padding:'9px 18px',borderBottom:'1px solid #272a3d',color:'#dde1f2'}}>{e.name}</td>
                        <td style={{padding:'9px 18px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace',color:'#dde1f2'}}>
                          {s.hours}h{s.mins>0?` ${s.mins}m`:''}
                        </td>
                        <td style={{padding:'9px 18px',borderBottom:'1px solid #272a3d',textAlign:'right',color:'#34d399',fontFamily:'DM Mono, monospace'}}>{s.wage.toLocaleString()}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr style={{background:'#1f2236'}}>
                    <td style={{padding:'10px 18px',fontWeight:700,color:'#f9b934'}}>합 계</td>
                    <td style={{padding:'10px 18px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono, monospace'}}>
                      {Object.values(staffStats).reduce((a,s)=>a+s.hours,0)}h
                    </td>
                    <td style={{padding:'10px 18px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{totalLaborCost.toLocaleString()}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
