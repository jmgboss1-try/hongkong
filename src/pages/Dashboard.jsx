import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, getDocs, collection } from 'firebase/firestore'
import { withSubMemos, loadSubs } from '../lib/attendance'
import { bankSummary } from '../lib/bankRecon'
import { ComposedChart, Bar, Line, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

const pad = n => String(n).padStart(2,'0')
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const mLabelShort = ym => { const[,m]=ym.split('-'); return `${+m}월` }

function getWageForMonth(emp, month) {
  const history = emp.wageHistory || []
  if(history.length === 0) return emp.wage || 10030
  const applicable = history.filter(h=>h.month<=month).sort((a,b)=>a.month>b.month?-1:1)
  return applicable.length > 0 ? applicable[0].wage : (emp.wage||10030)
}

// 해당 월에 적용되는 근무스케쥴(소정근로일/평균근무시간) 찾기 — 시급 이력과 동일한 패턴
function getScheduleForMonth(emp, month) {
  const history = emp.scheduleHistory || []
  if(history.length === 0) return { workDays: emp.workDays || [1,2,3,4,5], avgHours: emp.avgHours || 8 }
  const applicable = history.filter(h=>h.month<=month).sort((a,b)=>a.month>b.month?-1:1)
  return applicable.length > 0
    ? { workDays: applicable[0].workDays, avgHours: applicable[0].avgHours }
    : { workDays: emp.workDays || [1,2,3,4,5], avgHours: emp.avgHours || 8 }
}
const wonK   = n => n>=10000 ? (n/10000).toFixed(0)+'만' : n.toLocaleString()
const pct = (a,b) => b>0 ? Math.round(a/b*100) : 0

const CHANNELS = [
  { key:'total',    label:'전체',      color:'#C3261C' },
  { key:'kiosk',    label:'키오스크',  color:'#2B5C9E' },
  { key:'del',      label:'배달 합계', color:'#2E7D45' },
  { key:'baemin',   label:'배달의민족',color:'#2E7D45' },
  { key:'coupang',  label:'쿠팡이츠',  color:'#B42318' },
  { key:'yogiyo',   label:'요기요',    color:'#C3261C' },
  { key:'ddangyeo', label:'땡겨요',    color:'#6B4FA0' },
  { key:'pos',      label:'포스',      color:'#B45309' },
]

const CHART_TYPES = [
  { key:'bar',  label:'막대' },
  { key:'line', label:'선' },
  { key:'area', label:'면적' },
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
    <div style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:4,padding:'10px 14px',fontSize:12}}>
      <div style={{color:'#6E6A63',marginBottom:6,fontWeight:600}}>{label}</div>
      {payload.map((p,i)=>(
        <div key={i} style={{color:p.color,marginBottom:2}}>
          {p.name}: {(p.value||0).toLocaleString()}원
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
  const [exp, setExp]           = useState({total:0,bySec:{}})
  const [staff, setStaff]       = useState([])
  const [staffStats, setStaffStats] = useState({})
  const [loading, setLoading]   = useState(true)
  const [prevWH, setPrevWH]     = useState({})
  const [prevEX, setPrevEX]     = useState({})
  const [prevMemo, setPrevMemo] = useState({})

  // 차트 관련
  const [chartTab, setChartTab]         = useState('daily')   // 'daily' | 'monthly'
  const [chartType, setChartType]       = useState('bar')     // 'bar' | 'line' | 'area'
  const [chartChannel, setChartChannel] = useState('total')
  const [showCompare, setShowCompare]   = useState(false)     // 전월/전년 비교
  const [chartData, setChartData]       = useState([])        // [{label, value, compareValue}]
  const [chartLoading, setChartLoading] = useState(false)
  const [compareSummary, setCompareSummary] = useState(null)  // {curTotal, prevTotal, diffPct}

  useEffect(() => { load() }, [curMonth])
  useEffect(() => {
    if(chartTab==='daily') loadDailyChart()
    else loadMonthlyChart()
  }, [chartTab, chartChannel, curMonth, showCompare])

  async function load() {
    setLoading(true)
    try {
      // 매출·지출·직원·근무시간·대타를 한 번에 같이 불러옴 (하나씩 기다리면 몇 초씩 걸림)
      const [cy2,cm2]=curMonth.split('-').map(Number)
      const prevMonth=cm2===1?`${cy2-1}-12`:`${cy2}-${pad(cm2-1)}`
      const [revSnap,,usersSnap,whSnap,exSnap,memoSnap,prevWhSnap,prevExSnap,prevMemoSnap,subs] = await Promise.all([
        getDoc(doc(db,'revenue',curMonth)),
        loadExpenses(),
        getDocs(collection(db,'users')),
        getDoc(doc(db,'workhours',curMonth)),
        getDoc(doc(db,'workextra',curMonth)),
        getDoc(doc(db,'workmemos',curMonth)),
        getDoc(doc(db,'workhours',prevMonth)),
        getDoc(doc(db,'workextra',prevMonth)),
        getDoc(doc(db,'workmemos',prevMonth)),
        loadSubs(),
      ])
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

      const emps = []
      usersSnap.forEach(d=>{
        const data=d.data()
        if(data.status==='approved'&&data.role!=='owner')
          emps.push({uid:d.id,name:data.name,wage:data.wage||10030,
            wageHistory:data.wageHistory||[],workDays:data.workDays||[1,2,3,4,5],
            avgHours:data.avgHours||8,holidayBase:data.holidayBase||'contract',
            scheduleHistory:data.scheduleHistory||[]})
      })
      setStaff(emps)

      const whData=whSnap.exists()?whSnap.data():{}
      const extraData=exSnap.exists()?exSnap.data():{}
      // 대타 게시판에서 확정된 날은 비고 없이도 주휴 계산에서 대타로 인정 (인건비 탭과 같음)
      const memoData=withSubMemos(memoSnap.exists()?memoSnap.data():{},subs,curMonth)
      const prevWhData=prevWhSnap.exists()?prevWhSnap.data():{}
      const prevExData=prevExSnap.exists()?prevExSnap.data():{}
      const prevMemoData=withSubMemos(prevMemoSnap.exists()?prevMemoSnap.data():{},subs,prevMonth)
      setPrevWH(prevWhData); setPrevEX(prevExData); setPrevMemo(prevMemoData)

      const stats={}
      const [cy,cm]=curMonth.split('-').map(Number)
      const prevMonthDays=cm===1?new Date(cy-1,12,0).getDate():new Date(cy,cm-1,0).getDate()
      const days=new Date(cy,cm,0).getDate()
      emps.forEach(emp=>{
        const wh=whData[emp.uid]||{},ex=extraData[emp.uid]||{},empMemos=memoData[emp.uid]||{}
        const pWh=prevWhData[emp.uid]||{},pEx=prevExData[emp.uid]||{},pMemos=prevMemoData[emp.uid]||{}
        const schedule=getScheduleForMonth(emp,curMonth)
        const workDays=schedule.workDays||[1,2,3,4,5],avgHours=schedule.avgHours||8
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

  // 지출 합계 — 대시보드에서 지출을 추가하면 이 부분만 다시 불러옴
  //   카테고리 설정(expenseCategories/default)의 구분(재료비·관리비·인건비)별로도 나눔
  async function loadExpenses() {
    const [expSnap, catSnap] = await Promise.all([
      getDoc(doc(db,'expenses',curMonth)),
      getDoc(doc(db,'expenseCategories','default')).catch(()=>null),
    ])
    const secOf = Object.fromEntries((catSnap?.exists() ? (catSnap.data().list||[]) : []).map(c=>[c.id, c.sec]))
    if(expSnap.exists()) {
      const d = expSnap.data()
      let expTotal=0, dep=0
      const bySec = {}
      const carryover = d.carryover||0
      Object.entries(d).forEach(([dd,e])=>{
        if(!/^\d{2}$/.test(dd) || typeof e!=='object' || e===null) return
        dep+=e.deposit||0
        Object.entries(e).forEach(([k,v])=>{
          if(k==='deposit' || typeof v!=='number') return
          expTotal+=v
          const sec = secOf[k] || '기타'
          bySec[sec] = (bySec[sec]||0) + v
        })
      })
      setExp({total:expTotal,bySec,deposit:dep,carryover,balance:carryover+dep-expTotal,bank:bankSummary(d).bank})
    } else setExp({total:0,bySec:{},deposit:0,carryover:0,balance:0})
  }

  // 일별 차트: 이번달 vs 전월 (일자 정렬)
  async function loadDailyChart() {
    setChartLoading(true)
    try {
      const [cy,cm] = curMonth.split('-').map(Number)
      const prevYm = cm===1 ? `${cy-1}-12` : `${cy}-${pad(cm-1)}`
      const days = new Date(cy, cm, 0).getDate()

      const promises = [getDoc(doc(db,'revenue',curMonth))]
      if(showCompare) promises.push(getDoc(doc(db,'revenue',prevYm)))
      const [snap, prevSnap] = await Promise.all(promises)

      const d = snap.exists() ? snap.data() : {}
      const pd = (showCompare && prevSnap?.exists()) ? prevSnap.data() : {}

      const result = []
      let curTotal=0, prevTotal=0
      for(let i=1;i<=days;i++){
        const dd = pad(i)
        const v = getRevValue(d[dd], chartChannel)
        curTotal += v
        const row = { label:`${i}일`, value:v }
        if(showCompare) {
          const pv = getRevValue(pd[dd], chartChannel)
          prevTotal += pv
          row.compareValue = pv
        }
        result.push(row)
      }
      setChartData(result)
      setCompareSummary(showCompare ? {
        curTotal, prevTotal,
        diffPct: prevTotal>0 ? Math.round((curTotal-prevTotal)/prevTotal*100) : null,
        prevLabel: mLabelShort(prevYm)+' 동일기간',
      } : null)
    } catch(e){ console.error(e) }
    setChartLoading(false)
  }

  // 월별 차트: 최근 12개월, 비교시 전년 동월 오버레이
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

      let prevYearSnaps = []
      if(showCompare) {
        const prevYearMonths = months.map(ym=>{
          const [y,m] = ym.split('-').map(Number)
          return `${y-1}-${pad(m)}`
        })
        prevYearSnaps = await Promise.all(prevYearMonths.map(ym=>getDoc(doc(db,'revenue',ym))))
      }

      let curTotal=0, prevTotal=0
      const result = snaps.map((snap,i)=>{
        const ym = months[i]
        let total=0
        if(snap.exists()) Object.values(snap.data()).forEach(r=>{ total+=getRevValue(r, chartChannel) })
        curTotal += total
        const row = { label:mLabelShort(ym), value:total }
        if(showCompare) {
          let pTotal=0
          const pSnap = prevYearSnaps[i]
          if(pSnap?.exists()) Object.values(pSnap.data()).forEach(r=>{ pTotal+=getRevValue(r, chartChannel) })
          prevTotal += pTotal
          row.compareValue = pTotal
        }
        return row
      })
      setChartData(result)
      setCompareSummary(showCompare ? {
        curTotal, prevTotal,
        diffPct: prevTotal>0 ? Math.round((curTotal-prevTotal)/prevTotal*100) : null,
        prevLabel: '작년 동기간',
      } : null)
    } catch(e){ console.error(e) }
    setChartLoading(false)
  }

  const profit = rev.total - exp.total
  const totalLaborCost = Object.values(staffStats).reduce((a,s)=>a+s.wage,0)
  const monthOpts=[]
  for(let y=2022;y<=Math.max(2026,new Date().getFullYear());y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  const ch = CHANNELS.find(c=>c.key===chartChannel)
  const won = n => (n||0).toLocaleString('ko-KR')
  const num = { fontVariantNumeric:'tabular-nums' }
  const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', accent:'#C3261C', red:'#B42318', green:'#2E7D45', field:'#FFFFFF' }
  const monthIdx = monthOpts.indexOf(curMonth)
  const SECS = ['재료비','관리비','인건비','기타']

  // 장부 한 줄: 이름 ……… 금액 (영수증처럼 점선으로 이음)
  const line = (label, value, { strong, sub, minus, color, note } = {}) => (
    <div key={label} style={{display:'flex', alignItems:'baseline', padding: sub ? '3px 0 3px 14px' : '7px 0',
      fontSize: strong ? 17 : sub ? 13 : 15, fontWeight: strong ? 800 : sub ? 400 : 600, color: sub ? T.sub : T.ink}}>
      <span style={{whiteSpace:'nowrap'}}>{label}</span>
      {note && <span style={{fontSize:12, color:T.sub, marginLeft:6, whiteSpace:'nowrap'}}>{note}</span>}
      <span aria-hidden="true" style={{flex:1, borderBottom:`1px dotted ${T.faint}`, margin:'0 8px', minWidth:12, transform:'translateY(-4px)'}}/>
      <span style={{...num, whiteSpace:'nowrap', color: color || 'inherit'}}>{minus && value ? '− ' : ''}{won(value)}</span>
    </div>
  )
  const sectionTitle = (text, right) => (
    <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:10, borderBottom:`2px solid ${T.ink}`, paddingBottom:6, marginBottom:6}}>
      <h2 style={{fontSize:16, fontWeight:800, margin:0, fontFamily:'inherit', color:T.ink}}>{text}</h2>
      {right}
    </div>
  )
  const textTab = (on, label, onClick, key) => (
    <button key={key||label} type="button" onClick={onClick}
      style={{background:'none', border:'none', padding:'4px 0', cursor:'pointer', fontFamily:'inherit', fontSize:13,
        fontWeight: on ? 800 : 500, color: on ? T.ink : T.sub, borderBottom:`2px solid ${on ? T.accent : 'transparent'}`}}>
      {label}
    </button>
  )

  return (
    <div style={{maxWidth:1040}}>
      {/* 머리: 이 달 장부 */}
      <header style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap',
        paddingBottom:10, borderBottom:`3px double ${T.ink}`, marginBottom:22}}>
        <h1 style={{fontSize:24, fontWeight:800, margin:0, letterSpacing:'-0.01em', fontFamily:'inherit', color:T.ink}}>{mLabel(curMonth)} 장부</h1>
        <div style={{display:'flex', alignItems:'center', gap:6}}>
          <button type="button" aria-label="이전 달" disabled={monthIdx<=0} onClick={()=>setCurMonth(monthOpts[monthIdx-1])}
            style={{background:'none', border:`1px solid ${T.rule}`, borderRadius:4, padding:'6px 10px', cursor:'pointer', fontFamily:'inherit', color:T.ink}}>이전</button>
          <select value={curMonth} onChange={e=>setCurMonth(e.target.value)} aria-label="달 고르기"
            style={{background:T.field, border:`1px solid ${T.rule}`, borderRadius:4, color:T.ink, padding:'7px 10px', fontSize:13, fontFamily:'inherit', outline:'none'}}>
            {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
          </select>
          <button type="button" aria-label="다음 달" disabled={monthIdx>=monthOpts.length-1} onClick={()=>setCurMonth(monthOpts[monthIdx+1])}
            style={{background:'none', border:`1px solid ${T.rule}`, borderRadius:4, padding:'6px 10px', cursor:'pointer', fontFamily:'inherit', color:T.ink}}>다음</button>
        </div>
      </header>

      {loading ? <div style={{color:T.sub, padding:'40px 0'}}>불러오는 중...</div> : (
        <>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap:'28px 40px', marginBottom:34}}>
            {/* 손익 */}
            <section>
              {sectionTitle('이 달 손익')}
              {line('매출', rev.total)}
              {line('키오스크', rev.kiosk, { sub:true, note:`${pct(rev.kiosk,rev.total)}%` })}
              {line('배달', rev.del, { sub:true, note:`${pct(rev.del,rev.total)}%` })}
              {line('포스', rev.pos, { sub:true, note:`${pct(rev.pos,rev.total)}%` })}
              {line('지출', exp.total, { minus:true, note: rev.total>0 ? `매출의 ${pct(exp.total,rev.total)}%` : undefined })}
              {SECS.filter(sec => (exp.bySec?.[sec]||0) > 0).map(sec => line(sec, exp.bySec[sec], { sub:true, minus:true, note: rev.total>0 ? `${pct(exp.bySec[sec],rev.total)}%` : undefined }))}
              <div style={{borderTop:`3px double ${T.ink}`, marginTop:8, paddingTop:4}}>
                <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:10, padding:'6px 0'}}>
                  <span style={{fontSize:16, fontWeight:800}}>{profit >= 0 ? '남은 돈' : '모자란 돈'} <span style={{fontSize:12, fontWeight:400, color:T.sub}}>매출 − 지출</span></span>
                  <span style={{fontSize:34, fontWeight:800, letterSpacing:'-0.02em', color: profit>=0 ? T.ink : T.red, ...num}}>
                    {profit<0 ? '− ' : ''}{won(Math.abs(profit))}<span style={{fontSize:16, fontWeight:600, marginLeft:2}}>원</span>
                  </span>
                </div>
                <div style={{fontSize:12, color:T.sub, lineHeight:1.6}}>
                  인건비(근무기록 기준) {won(totalLaborCost)}원 · 매출의 {pct(totalLaborCost,rev.total)}% · {staff.length}명
                </div>
              </div>
            </section>

            {/* 통장 */}
            <section>
              {sectionTitle('통장', exp.bank?.closing!=null && (
                <span style={{fontSize:12, fontWeight:700, color: exp.bank.diff===0 ? T.green : T.red}}>
                  {exp.bank.diff===0 ? '통장과 일치해요' : `통장과 ${won(Math.abs(exp.bank.diff))}원 차이`}
                </span>
              ))}
              {line('전월 이월', exp.carryover)}
              {line('실입금', exp.deposit, { note:'수수료 빼고 들어온 돈' })}
              {line('지출', exp.total, { minus:true })}
              <div style={{borderTop:`1px solid ${T.ink}`, marginTop:6}}>
                {line('영업 잔액', exp.balance, { strong:true, color:(exp.balance||0) < 0 ? T.red : undefined })}
              </div>
              {exp.bank?.closing!=null
                ? line('실제 통장 잔액', exp.bank.closing, { note:'계좌내역 기준' })
                : <p style={{fontSize:12, color:T.sub, margin:'6px 0 0', lineHeight:1.6}}>지출관리에서 계좌내역을 올리면 실제 통장 잔액과 맞춰볼 수 있어요</p>}
            </section>
          </div>

          {/* 매출 추이 */}
          <section>
            {sectionTitle('매출 추이', (
              <div style={{display:'flex', gap:14, alignItems:'center', flexWrap:'wrap'}}>
                {[['daily','일별'],['monthly','최근 12개월']].map(([k,l]) => textTab(chartTab===k, l, ()=>setChartTab(k), k))}
                <span style={{width:1, height:14, background:T.rule}}/>
                {CHART_TYPES.map(t => textTab(chartType===t.key, t.label, ()=>setChartType(t.key), t.key))}
              </div>
            ))}
            <div style={{display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', margin:'10px 0 12px'}}>
              <select value={chartChannel} onChange={e=>setChartChannel(e.target.value)} aria-label="매출 구분"
                style={{background:T.field, border:`1px solid ${T.rule}`, borderRadius:4, color:T.ink, padding:'6px 10px', fontSize:13, fontFamily:'inherit', outline:'none'}}>
                {CHANNELS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
              <label style={{display:'flex', alignItems:'center', gap:6, fontSize:13, color:T.ink, cursor:'pointer'}}>
                <input type="checkbox" checked={showCompare} onChange={e=>setShowCompare(e.target.checked)} style={{accentColor:T.accent}}/>
                {chartTab==='daily' ? '지난달과 비교' : '작년과 비교'}
              </label>
              {showCompare && compareSummary && (
                <span style={{fontSize:13, color:T.sub, ...num}}>
                  이번 {won(compareSummary.curTotal)}원 · {compareSummary.prevLabel} {won(compareSummary.prevTotal)}원
                  {compareSummary.diffPct !== null && (
                    <b style={{marginLeft:6, color: compareSummary.diffPct>=0 ? T.green : T.red}}>
                      {compareSummary.diffPct>=0 ? '▲' : '▼'} {Math.abs(compareSummary.diffPct)}%
                    </b>
                  )}
                </span>
              )}
            </div>
            {chartLoading ? (
              <div style={{color:T.sub, padding:'40px 0'}}>불러오는 중...</div>
            ) : chartData.length === 0 ? (
              <div style={{color:T.sub, padding:'40px 0'}}>이 기간엔 매출 기록이 없어요</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={chartData} margin={{top:4,right:4,left:0,bottom:0}}>
                  <CartesianGrid stroke="#ECE8E1" vertical={false}/>
                  <XAxis dataKey="label" tick={{fill:T.sub,fontSize:11}} axisLine={{stroke:T.ink}} tickLine={false}
                    interval={chartTab==='daily'?3:0}/>
                  <YAxis tickFormatter={wonK} tick={{fill:T.sub,fontSize:11}} axisLine={false} tickLine={false} width={48}/>
                  <Tooltip content={<CustomTooltip/>} cursor={{fill:'rgba(0,0,0,0.04)'}}/>
                  {chartType==='bar' && (
                    <Bar dataKey="value" name={ch?.label||'매출'} fill={T.accent} radius={[2,2,0,0]} maxBarSize={22}/>
                  )}
                  {chartType==='line' && (
                    <Line type="monotone" dataKey="value" name={ch?.label||'매출'} stroke={T.accent} strokeWidth={2} dot={{r:3,fill:T.accent}}/>
                  )}
                  {chartType==='area' && (
                    <Area type="monotone" dataKey="value" name={ch?.label||'매출'} stroke={T.accent} fill={T.accent} fillOpacity={0.12} strokeWidth={2}/>
                  )}
                  {showCompare && (
                    <Line type="monotone" dataKey="compareValue" name={chartTab==='daily'?'지난달':'작년 같은 달'}
                      stroke={T.sub} strokeWidth={1.5} strokeDasharray="5 4" dot={false}/>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </section>
        </>
      )}
    </div>
  )
}
