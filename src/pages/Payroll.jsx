import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, getDocs, collection } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }

function calcWeeklyHoliday(totalHours, wage) {
  if(totalHours < 15) return 0
  return Math.round((totalHours/40)*8*wage)
}

export default function Payroll() {
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

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        // users 컬렉션에서 승인된 직원
        const usersSnap = await getDocs(collection(db,'users'))
        const emps = []
        usersSnap.forEach(d => {
          const data = d.data()
          if(data.status==='approved' && data.role!=='owner') {
            emps.push({uid:d.id, name:data.name, wage:data.wage||10030})
          }
        })
        setEmployees(emps)

        // workhours
        const whSnap = await getDoc(doc(db,'workhours',curMonth))
        setWorkHours(whSnap.exists() ? whSnap.data() : {})
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [curMonth])

  function getStats(emp) {
    const wh = workHours[emp.uid] || {}
    const wage = emp.wage || 10030
    let totalHours = 0
    const dayList = []

    Object.keys(wh).forEach(dd => {
      const h = wh[dd] || 0
      if(h > 0) {
        totalHours += h
        dayList.push({dd, h})
      }
    })

    let weeklyHoliday = 0
    let weekStart = 1
    while(weekStart <= 31) {
      let weekH = 0
      for(let d=weekStart;d<weekStart+7&&d<=31;d++) weekH += wh[pad(d)]||0
      weeklyHoliday += calcWeeklyHoliday(weekH, wage)
      weekStart += 7
    }

    const basePay = Math.round(totalHours * wage)
    return { totalHours, basePay, weeklyHoliday, totalPay: basePay+weeklyHoliday, dayList: dayList.sort((a,b)=>a.dd>b.dd?1:-1) }
  }

  const allStats = employees.map(e => ({emp:e, ...getStats(e)}))
  const grandBase = allStats.reduce((a,s)=>a+s.basePay,0)
  const grandHoliday = allStats.reduce((a,s)=>a+s.weeklyHoliday,0)
  const grandTotal = allStats.reduce((a,s)=>a+s.totalPay,0)

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

      {/* 요약 카드 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:20}}>
        {[
          {label:'기본급 합계', val:grandBase, color:'#f9b934'},
          {label:'주휴수당 합계', val:grandHoliday, color:'#93c5fd'},
          {label:'총 지급액', val:grandTotal, color:'#34d399'},
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
          전체
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
          {/* 전체 보기 */}
          {activeEmp===null && (
            <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden',marginBottom:18}}>
              <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>전체 급여 내역</div>
              <div style={{overflowX:'auto'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                  <thead>
                    <tr style={{background:'#191c2b'}}>
                      {['직원','시급','근무시간','기본급','주휴수당','총 지급액'].map(h=>(
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

          {/* 개인 상세 */}
          {activeEmp!==null && (()=>{
            const s = allStats.find(x=>x.emp.uid===activeEmp)
            if(!s) return null
            const {emp, totalHours, basePay, weeklyHoliday, totalPay, dayList} = s
            return (
              <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden',marginBottom:18}}>
                <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,display:'flex',justifyContent:'space-between'}}>
                  <span>{emp.name} 급여 상세</span>
                  <span style={{fontSize:11,color:'#5e6585'}}>{mLabel(curMonth)}</span>
                </div>
                <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
                  {[
                    {label:'총 근무시간', val:`${totalHours.toFixed(1)}h`, color:'#f9b934'},
                    {label:'기본급', val:`${basePay.toLocaleString()}원`, color:'#dde1f2'},
                    {label:'주휴수당', val:`${weeklyHoliday.toLocaleString()}원`, color:'#93c5fd'},
                  ].map(k=>(
                    <div key={k.label} style={{background:'#191c2b',borderRadius:8,padding:'12px 14px'}}>
                      <div style={{fontSize:10,color:'#5e6585',marginBottom:4}}>{k.label}</div>
                      <div style={{fontSize:14,fontWeight:700,color:k.color,fontFamily:'DM Mono,monospace'}}>{k.val}</div>
                    </div>
                  ))}
                </div>
                <div style={{background:'rgba(52,211,153,0.08)',border:'1px solid rgba(52,211,153,0.2)',margin:'14px 18px',borderRadius:8,padding:'14px 16px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                  <div style={{fontSize:12,color:'#5e6585'}}>총 지급액 (기본급 + 주휴수당)</div>
                  <div style={{fontSize:20,fontWeight:700,color:'#34d399',fontFamily:'DM Mono,monospace'}}>{totalPay.toLocaleString()}원</div>
                </div>
                <div style={{padding:'0 18px 18px'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
                    <thead>
                      <tr style={{background:'#191c2b'}}>
                        {['날짜','근무시간','일급'].map(h=>(
                          <th key={h} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:'#5e6585',
                            textAlign:h==='날짜'?'left':'right'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {dayList.map(({dd,h})=>(
                        <tr key={dd}>
                          <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',color:'#dde1f2'}}>{+dd}일</td>
                          <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace',color:'#f9b934'}}>{h}h</td>
                          <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace',color:'#34d399'}}>{Math.round(h*(emp.wage||10030)).toLocaleString()}원</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{background:'#1f2236'}}>
                        <td style={{padding:'10px 14px',fontWeight:700,color:'#f9b934'}}>합 계</td>
                        <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>{totalHours.toFixed(1)}h</td>
                        <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>{basePay.toLocaleString()}원</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )
          })()}

          {/* 인쇄용 문서 */}
          <div style={{background:'#fff',color:'#111',borderRadius:12,padding:'40px 44px',maxWidth:760,margin:'0 auto',fontFamily:'Noto Sans KR,sans-serif',boxShadow:'0 8px 40px rgba(0,0,0,.5)'}}>
            <div style={{fontSize:13,color:'#555',marginBottom:3}}>홍콩반점 중앙대점</div>
            <div style={{fontSize:24,fontWeight:900,color:'#0d0d0d',marginBottom:4}}>인건비 지급 내역서</div>
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
                {allStats.map(({emp,totalHours,basePay,weeklyHoliday,totalPay},i)=>(
                  <tr key={emp.uid} style={{background:i%2===0?'#fafafa':'#fff'}}>
                    <td style={{padding:'12px 14px',borderBottom:'1px solid #e8e8e8',fontWeight:600}}>{emp.name}</td>
                    <td style={{padding:'12px 14px',borderBottom:'1px solid #e8e8e8',textAlign:'center',fontFamily:'DM Mono,monospace'}}>{(emp.wage||10030).toLocaleString()}원</td>
                    <td style={{padding:'12px 14px',borderBottom:'1px solid #e8e8e8',textAlign:'center',fontFamily:'DM Mono,monospace'}}>{totalHours.toFixed(1)}h</td>
                    <td style={{padding:'12px 14px',borderBottom:'1px solid #e8e8e8',textAlign:'center',fontFamily:'DM Mono,monospace'}}>{basePay.toLocaleString()}원</td>
                    <td style={{padding:'12px 14px',borderBottom:'1px solid #e8e8e8',textAlign:'center',fontFamily:'DM Mono,monospace'}}>{weeklyHoliday.toLocaleString()}원</td>
                    <td style={{padding:'12px 14px',borderBottom:'1px solid #e8e8e8',textAlign:'center',fontFamily:'DM Mono,monospace',fontWeight:700}}>{totalPay.toLocaleString()}원</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{background:'#111'}}>
                  <td style={{padding:'13px 14px',color:'#fff',fontWeight:700}}>합 계</td>
                  <td style={{padding:'13px 14px',color:'#fff',textAlign:'center'}}>—</td>
                  <td style={{padding:'13px 14px',color:'#fff',textAlign:'center',fontFamily:'DM Mono,monospace'}}>{allStats.reduce((a,s)=>a+s.totalHours,0).toFixed(1)}h</td>
                  <td style={{padding:'13px 14px',color:'#fff',textAlign:'center',fontFamily:'DM Mono,monospace'}}>{grandBase.toLocaleString()}원</td>
                  <td style={{padding:'13px 14px',color:'#fff',textAlign:'center',fontFamily:'DM Mono,monospace'}}>{grandHoliday.toLocaleString()}원</td>
                  <td style={{padding:'13px 14px',color:'#fff',textAlign:'center',fontFamily:'DM Mono,monospace',fontSize:15}}>{grandTotal.toLocaleString()}원</td>
                </tr>
              </tfoot>
            </table>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:24,marginTop:28,paddingTop:20,borderTop:'1px solid #ddd'}}>
              {['작 성 자','확 인 자','세무 담당'].map(label=>(
                <div key={label} style={{display:'flex',flexDirection:'column',gap:6}}>
                  <div style={{fontSize:10,color:'#888',fontWeight:700,letterSpacing:.8,textTransform:'uppercase'}}>{label}</div>
                  <div style={{borderBottom:'1px solid #bbb',height:34}}></div>
                  <div style={{fontSize:10,color:'#aaa'}}>서명 / 날인</div>
                </div>
              ))}
            </div>
            <div style={{fontSize:10,color:'#aaa',textAlign:'right',marginTop:14}}>출력일: {dateStr}</div>
          </div>
        </>
      )}
    </div>
  )
}
