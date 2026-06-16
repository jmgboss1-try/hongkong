import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, getDocs, collection } from 'firebase/firestore'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from 'recharts'

const pad = n => String(n).padStart(2,'0')
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const mLabelShort = ym => { const[,m]=ym.split('-'); return `${+m}월` }

function getWageForMonth(emp, month) {
  const history = emp.wageHistory || []
  if(history.length === 0) return emp.wage || 10030
  const applicable = history.filter(h=>h.month<=month).sort((a,b)=>a.month>b.month?-1:1)
  return applicable.length > 0 ? applicable[0].wage : (emp.wage||10030)
}
const wonFmt = n => n ? n.toLocaleString('ko-KR')+'원' : '—'
const wonK   = n => n>=10000 ? (n/10000).toFixed(0)+'만' : n.toLocaleString()
const pct = (a,b) => b>0 ? Math.round(a/b*100) : 0

const CHANNELS = [
  { key:'total',    label:'전체',      color:'#f9b934' },
  { key:'kiosk',    label:'키오스크',  color:'#93c5fd' },
  { key:'del',      label:'배달 합계', color:'#34d399' },
  { key:'baemin',   label:'배달의민족',color:'#34d399' },
  { key:'coupang',  label:'쿠팡이츠',  color:'#f87171' },
  { key:'yogiyo',   label:'요기요',    color:'#f9b934' },
  { key:'ddangyeo', label:'땡겨요',    color:'#a78bfa' },
  { key:'pos',      label:'포스',      color:'#fb923c' },
]

function getRevValue(r, channel) {
  if(!r || typeof r !== 'object') return 0
  const kk = (r.close?.kiosk||0)>0 ? r.close.kiosk : (r.kiosk||0)
  const dd = (r.close?.del||0)>0   ? r.close.del   : (r.del||0)
  const pp = (r.close?.pos||0)>0   ? r.close.pos   : (r.pos||0)
  switch(channel) {
    case 'total':    return kk+dd+pp
    case 'kiosk':    return kk
    case 'del':      return dd
    case 'pos':      return pp
    case 'baemin':   return r.baemin||0
    case 'coupang':  return r.coupang||0
    case 'yogiyo':   return r.yogiyo||0
    case 'ddangyeo': return r.ddangyeo||0
    default: return 0
  }
}

const CustomTooltip = ({active,payload,label}) => {
  if(!active||!payload?.length) return null
  return (
    <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:8,padding:'10px 14px',fontSize:12}}>
      <div style={{color:'#5e6585',marginBottom:6,fontWeight:600}}>{label}</div>
      {payload.map((p,i)=>(
        <div key={i} style={{color:p.color,marginBottom:2}}>
          {p.name}: {p.value.toLocaleString()}원
        </div>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const [curMonth, setCurMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [rev, setRev]           = useState({kiosk:0,del:0,pos:0,total:0})
  const [exp, setExp]           = useState({total:0,mat:0,mgmt:0,sal:0})
  const [staff, setStaff]       = useState([])
  const [staffStats, setStaffStats] = useState({})
  const [loading, setLoading]   = useState(true)
  const [prevWH, setPrevWH]     = useState({})
  const [prevEX, setPrevEX]     = useState({})
  const [prevMemo, setPrevMemo] = useState({})

  // 차트 관련
  const [chartTab, setChartTab]         = useState('daily')   // 'daily' | 'monthly'
  const [chartChannel, setChartChannel] = useState('total')
  const [dailyData, setDailyData]       = useState([])        // [{day, value}]
  const [monthlyData, setMonthlyData]   = useState([])        // [{month, value}]
  const [chartLoading, setChartLoading] = useState(false)

  useEffect(() => { load() }, [curMonth])
  useEffect(() => {
    if(chartTab==='daily') loadDailyChart()
    else loadMonthlyChart()
  }, [chartTab, chartChannel, curMonth])

  async function load() {
    setLoading(true)
    try {
      const revSnap = await getDoc(doc(db,'revenue',curMonth))
      if(revSnap.exists()) {
        const d = revSnap.data()
        let k=0,dl=0,p=0
        Object.values(d).forEach(r=>{
          if(typeof r!=='object'||r===null) return
          const kk=(r.close?.kiosk||0)>0?r.close.kiosk:(r.kiosk||0)
          const dd=(r.close?.del||0)>0?r.close.del:(r.del||0)
          const pp=(r.close?.pos||0)>0?r.close.pos:(r.pos||0)
          k+=kk;dl+=dd;p+=pp
        })
        setRev({kiosk:k,del:dl,pos:p,total:k+dl+p})
      } else setRev({kiosk:0,del:0,pos:0,total:0})

      const expSnap = await getDoc(doc(db,'expenses',curMonth))
      if(expSnap.exists()) {
        const d = expSnap.data()
        let expTotal=0, dep=0
        const carryover = d.carryover||0
        Object.values(d).forEach(e=>{
          if(typeof e!=='object'||e===null) return
          dep+=e.deposit||0
          Object.entries(e).forEach(([k,v])=>{
            if(!['deposit','carryover'].includes(k) && typeof v==='number') expTotal+=v
          })
        })
        setExp({total:expTotal,mat:0,mgmt:0,sal:0,deposit:dep,carryover,balance:carryover+dep-expTotal})
      } else setExp({total:0,mat:0,mgmt:0,sal:0,deposit:0,carryover:0,balance:0})

      const usersSnap = await getDocs(collection(db,'users'))
      const emps = []
      usersSnap.forEach(d=>{
        const data=d.data()
        if(data.status==='approved'&&data.role!=='owner')
          emps.push({uid:d.id,name:data.name,wage:data.wage||10030,
            wageHistory:data.wageHistory||[],workDays:data.workDays||[1,2,3,4,5],
            avgHours:data.avgHours||8,holidayBase:data.holidayBase||'contract'})
      })
      setStaff(emps)

      const [cy2,cm2]=curMonth.split('-').map(Number)
      const prevMonth=cm2===1?`${cy2-1}-12`:`${cy2}-${pad(cm2-1)}`
      const [whSnap,exSnap,memoSnap,prevWhSnap,prevExSnap,prevMemoSnap] = await Promise.all([
        getDoc(doc(db,'workhours',curMonth)),
        getDoc(doc(db,'workextra',curMonth)),
        getDoc(doc(db,'workmemos',curMonth)),
        getDoc(doc(db,'workhours',prevMonth)),
        getDoc(doc(db,'workextra',prevMonth)),
        getDoc(doc(db,'workmemos',prevMonth)),
      ])
      const whData=whSnap.exists()?whSnap.data():{}
      const extraData=exSnap.exists()?exSnap.data():{}
      const memoData=memoSnap.exists()?memoSnap.data():{}
      const prevWhData=prevWhSnap.exists()?prevWhSnap.data():{}
      const prevExData=prevExSnap.exists()?prevExSnap.data():{}
      const prevMemoData=prevMemoSnap.exists()?prevMemoSnap.data():{}
      setPrevWH(prevWhData); setPrevEX(prevExData); setPrevMemo(prevMemoData)

      const stats={}
      const [cy,cm]=curMonth.split('-').map(Number)
      const prevMonthDays=cm===1?new Date(cy-1,12,0).getDate():new Date(cy,cm-1,0).getDate()
      const days=new Date(cy,cm,0).getDate()
      emps.forEach(emp=>{
        const wh=whData[emp.uid]||{},ex=extraData[emp.uid]||{},empMemos=memoData[emp.uid]||{}
        const pWh=prevWhData[emp.uid]||{},pEx=prevExData[emp.uid]||{},pMemos=prevMemoData[emp.uid]||{}
        const workDays=emp.workDays||[1,2,3,4,5],avgHours=emp.avgHours||8
        const wage=getWageForMonth(emp,curMonth)
        let totalHours=0,totalMins=0,totalWeeklyHoliday=0
        for(let d=1;d<=days;d++){
          const dd=String(d).padStart(2,'0'),dow=new Date(cy,cm-1,d).getDay()
          totalHours+=wh[dd]||0; totalMins+=ex[dd]||0
          if(dow===0){
            let weekH=0;const weekAttendance={},weekMemos={}
            for(let wd=1;wd<=6;wd++){
              const prevD=d-wd
              if(prevD>=1){
                const prevDD=String(prevD).padStart(2,'0'),prevDow=new Date(cy,cm-1,prevD).getDay()
                const prevH=(wh[prevDD]||0)+(ex[prevDD]||0)/60
                weekH+=prevH;weekAttendance[prevDow]=(weekAttendance[prevDow]||0)+prevH
                if(empMemos[prevDD]) weekMemos[prevDD]=empMemos[prevDD]
              } else {
                const prevMonthD=prevMonthDays+prevD
                if(prevMonthD>=1){
                  const prevDD=String(prevMonthD).padStart(2,'0'),prevDow=new Date(cy,cm-2,prevMonthD).getDay()
                  const prevH=(pWh[prevDD]||0)+(pEx[prevDD]||0)/60
                  weekH+=prevH;weekAttendance[prevDow]=(weekAttendance[prevDow]||0)+prevH
                  if(pMemos[prevDD]) weekMemos[`prev_${prevDD}`]=pMemos[prevDD]
                }
              }
            }
            if(weekH>=15){
              const absentDays=workDays.filter(d=>(weekAttendance[d]||0)===0)
              const subCount=Object.values(weekMemos).filter(m=>m&&m.includes('대타')).length
              if(absentDays.length===0||subCount>=absentDays.length){
                const holidayHours=emp.holidayBase==='actual'?weekH:avgHours*workDays.length
                totalWeeklyHoliday+=Math.round((holidayHours/40)*8*wage)
              }
            }
          }
        }
        const basePay=Math.round((totalHours+totalMins/60)*wage)
        stats[emp.uid]={hours:totalHours,mins:totalMins,wage:basePay+totalWeeklyHoliday,basePay,weeklyHoliday:totalWeeklyHoliday}
      })
      setStaffStats(stats)
    } catch(e){ console.error(e) }
    setLoading(false)
  }

  async function loadDailyChart() {
    setChartLoading(true)
    try {
      const snap = await getDoc(doc(db,'revenue',curMonth))
      if(!snap.exists()) { setDailyData([]); setChartLoading(false); return }
      const d = snap.data()
      const [,cm] = curMonth.split('-').map(Number)
      const days = new Date(curMonth.split('-')[0], cm, 0).getDate()
      const result = []
      for(let i=1;i<=days;i++){
        const dd = pad(i)
        const r = d[dd]
        result.push({ day:`${i}일`, value: getRevValue(r, chartChannel) })
      }
      setDailyData(result)
    } catch(e){ console.error(e) }
    setChartLoading(false)
  }

  async function loadMonthlyChart() {
    setChartLoading(true)
    try {
      const [cy,cm] = curMonth.split('-').map(Number)
      const months = []
      for(let i=11;i>=0;i--){
        let y=cy,m=cm-i
        while(m<=0){m+=12;y--}
        months.push(`${y}-${pad(m)}`)
      }
      const snaps = await Promise.all(months.map(ym=>getDoc(doc(db,'revenue',ym))))
      const result = snaps.map((snap,i)=>{
        const ym = months[i]
        if(!snap.exists()) return { month:mLabelShort(ym), value:0 }
        const d = snap.data()
        let total=0
        Object.values(d).forEach(r=>{ total+=getRevValue(r, chartChannel) })
        return { month:mLabelShort(ym), value:total }
      })
      setMonthlyData(result)
    } catch(e){ console.error(e) }
    setChartLoading(false)
  }

  const profit = rev.total - exp.total
  const totalLaborCost = Object.values(staffStats).reduce((a,s)=>a+s.wage,0)
  const monthOpts=[]
  for(let y=2022;y<=2026;y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  const ch = CHANNELS.find(c=>c.key===chartChannel)
  const chartData = chartTab==='daily' ? dailyData : monthlyData
  const xKey = chartTab==='daily' ? 'day' : 'month'

  const KPI = ({label,value,note,color}) => (
    <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'18px 20px',position:'relative',overflow:'hidden'}}>
      <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:color}}/>
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
          style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,color:'#dde1f2',
            padding:'8px 12px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
          {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
        </select>
      </div>

      {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:60}}>로딩 중...</div> : (
        <>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:14}}>
            <KPI label="월 총 매출" value={wonFmt(rev.total)} note={`배달 ${pct(rev.del,rev.total)}% · 포스 ${pct(rev.pos,rev.total)}% · 키오스크 ${pct(rev.kiosk,rev.total)}%`} color="#f9b934"/>
            <KPI label="월 총 지출" value={wonFmt(exp.total)} note={`재료비 ${wonFmt(exp.mat)} · 관리비 ${wonFmt(exp.mgmt)}`} color="#f87171"/>
            <KPI label="인건비" value={wonFmt(totalLaborCost)} note={`인건비율 ${pct(totalLaborCost,rev.total)}% · ${staff.length}명`} color="#93c5fd"/>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:20}}>
            <KPI label="총 실입금액" value={wonFmt(exp.deposit||0)} note="수수료 제외 계좌 실입금" color="#34d399"/>
            <KPI label="현재 계좌 잔액" value={wonFmt(Math.abs(exp.balance||0))} note={`이월 ${wonFmt(exp.carryover||0)} + 입금 - 지출`} color={(exp.balance||0)>=0?'#f9b934':'#f87171'}/>
            <KPI label="매출 기준 순이익" value={wonFmt(Math.abs(profit))} note={profit>=0?'흑자 ▲':'적자 ▼'} color={profit>=0?'#5e6585':'#f87171'}/>
          </div>

          {/* ── 매출 추이 그래프 ── */}
          <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:18,marginBottom:20}}>
            {/* 헤더 */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14,flexWrap:'wrap',gap:10}}>
              <div style={{fontSize:13,fontWeight:600}}>📈 매출 추이</div>
              {/* 일별/월별 탭 */}
              <div style={{display:'flex',gap:6}}>
                {[['daily','일별'],['monthly','월별(12개월)']].map(([key,label])=>(
                  <button key={key} onClick={()=>setChartTab(key)}
                    style={{padding:'5px 12px',borderRadius:6,border:'none',fontSize:11,fontWeight:600,
                      cursor:'pointer',fontFamily:'inherit',
                      background:chartTab===key?'#f9b934':'#191c2b',
                      color:chartTab===key?'#000':'#5e6585',
                      outline:chartTab===key?'none':'1px solid #272a3d'}}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* 채널 필터 */}
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:16}}>
              {CHANNELS.map(c=>(
                <button key={c.key} onClick={()=>setChartChannel(c.key)}
                  style={{padding:'4px 10px',borderRadius:5,border:'none',fontSize:11,fontWeight:600,
                    cursor:'pointer',fontFamily:'inherit',
                    background:chartChannel===c.key?c.color:'#191c2b',
                    color:chartChannel===c.key?'#000':'#5e6585',
                    outline:chartChannel===c.key?'none':'1px solid #272a3d'}}>
                  {c.label}
                </button>
              ))}
            </div>

            {/* 그래프 */}
            {chartLoading ? (
              <div style={{textAlign:'center',color:'#5e6585',padding:40}}>로딩 중...</div>
            ) : chartData.length === 0 ? (
              <div style={{textAlign:'center',color:'#5e6585',padding:40}}>데이터가 없습니다</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{top:4,right:4,left:0,bottom:0}}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#272a3d" vertical={false}/>
                  <XAxis dataKey={xKey} tick={{fill:'#5e6585',fontSize:10}} axisLine={false} tickLine={false}
                    interval={chartTab==='daily'?3:0}/>
                  <YAxis tickFormatter={wonK} tick={{fill:'#5e6585',fontSize:10}} axisLine={false} tickLine={false} width={50}/>
                  <Tooltip content={<CustomTooltip/>}/>
                  <Bar dataKey="value" name={ch?.label||'매출'} fill={ch?.color||'#f9b934'} radius={[4,4,0,0]}/>
                </BarChart>
              </ResponsiveContainer>
            )}
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
                    const s=staffStats[e.uid]||{hours:0,mins:0,wage:0}
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
