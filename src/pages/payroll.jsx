import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }

export default function Payroll() {
  const [curMonth, setCurMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [employees, setEmployees] = useState([])
  const [schData, setSchData] = useState({})
  const [loading, setLoading] = useState(true)

  const monthOpts = []
  for(let y=2022;y<=2026;y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const empSnap = await getDoc(doc(db,'meta','employees'))
        const emps = empSnap.exists() ? empSnap.data().list || [] : []
        setEmployees(emps)
        const schSnap = await getDoc(doc(db,'schedule',curMonth))
        setSchData(schSnap.exists() ? schSnap.data() : {})
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [curMonth])

  const schedTotals = employees.reduce((acc,e) => {
    const es = schData[e.uid]||{}
    const h = Object.values(es).reduce((a,b)=>a+b,0)
    const wdays = Object.keys(es).filter(d=>es[d]>0).length
    acc[e.uid] = { hours:h, wage:Math.round(h*e.wage), wdays }
    return acc
  }, {})

  const totalHours = Object.values(schedTotals).reduce((a,b)=>a+b.hours,0)
  const totalWage  = Object.values(schedTotals).reduce((a,b)=>a+b.wage,0)
  const today = new Date()
  const dateStr = `${today.getFullYear()}년 ${today.getMonth()+1}월 ${today.getDate()}일`

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>📄 인건비 보고서</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>{mLabel(curMonth)} — 세무서 제출용</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <button onClick={()=>window.print()}
            style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'9px 18px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',display:'flex',alignItems:'center',gap:6}}>
            🖨️ 인쇄 / PDF
          </button>
          <select value={curMonth} onChange={e=>setCurMonth(e.target.value)}
            style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,color:'#dde1f2',padding:'8px 12px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
            {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
          </select>
        </div>
      </div>

      {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:60}}>로딩 중...</div> : (
        /* 인쇄용 문서 */
        <div id="printArea" style={{background:'#fff',color:'#111',borderRadius:12,padding:'40px 44px',maxWidth:760,margin:'0 auto',fontFamily:'Noto Sans KR, sans-serif',boxShadow:'0 8px 40px rgba(0,0,0,.5)'}}>
          <div style={{fontSize:13,color:'#555',fontWeight:500,marginBottom:3}}>홍콩반점 중앙대점</div>
          <div style={{fontSize:24,fontWeight:900,color:'#0d0d0d',letterSpacing:'-.5px',marginBottom:4}}>인건비 지급 내역서</div>
          <div style={{fontSize:13,color:'#444',marginBottom:26,paddingBottom:16,borderBottom:'2.5px solid #111'}}>
            {mLabel(curMonth)} 귀속 &nbsp;|&nbsp; 작성일: {dateStr}
          </div>

          {/* 요약 테이블 */}
          <table style={{width:'100%',borderCollapse:'collapse',marginBottom:28}}>
            <thead>
              <tr style={{background:'#111'}}>
                {['성 명','시 급','근무일수','총 근무시간','지 급 액'].map((h,i)=>(
                  <th key={h} style={{color:'#fff',padding:'11px 14px',fontSize:12,fontWeight:700,textAlign:i===0?'left':'center',letterSpacing:.5}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((e,i)=>{
                const s=schedTotals[e.uid]||{hours:0,wage:0,wdays:0}
                return(
                  <tr key={e.uid} style={{background:i%2===0?'#fafafa':'#fff'}}>
                    <td style={{padding:'12px 14px',borderBottom:'1px solid #e8e8e8',fontWeight:600}}>{e.name}</td>
                    <td style={{padding:'12px 14px',borderBottom:'1px solid #e8e8e8',textAlign:'center',fontFamily:'DM Mono, monospace'}}>{e.wage.toLocaleString()}원</td>
                    <td style={{padding:'12px 14px',borderBottom:'1px solid #e8e8e8',textAlign:'center',fontFamily:'DM Mono, monospace'}}>{s.wdays}일</td>
                    <td style={{padding:'12px 14px',borderBottom:'1px solid #e8e8e8',textAlign:'center',fontFamily:'DM Mono, monospace'}}>{s.hours}시간</td>
                    <td style={{padding:'12px 14px',borderBottom:'1px solid #e8e8e8',textAlign:'center',fontFamily:'DM Mono, monospace',fontWeight:700}}>{s.wage.toLocaleString()}원</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{background:'#111'}}>
                <td style={{padding:'13px 14px',color:'#fff',fontWeight:700}}>합 계</td>
                <td style={{padding:'13px 14px',color:'#fff',textAlign:'center'}}>—</td>
                <td style={{padding:'13px 14px',color:'#fff',textAlign:'center'}}>—</td>
                <td style={{padding:'13px 14px',color:'#fff',textAlign:'center',fontFamily:'DM Mono, monospace'}}>{totalHours}시간</td>
                <td style={{padding:'13px 14px',color:'#fff',textAlign:'center',fontFamily:'DM Mono, monospace',fontSize:15}}>{totalWage.toLocaleString()}원</td>
              </tr>
            </tfoot>
          </table>

          {/* 상세 내역 */}
          <div style={{fontSize:12,fontWeight:700,color:'#333',marginBottom:10,paddingBottom:6,borderBottom:'1px solid #e0e0e0'}}>근무일별 상세 내역</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:10,marginBottom:28}}>
            {employees.map(e=>{
              const es=schData[e.uid]||{}
              const wdays=Object.keys(es).filter(d=>es[d]>0).sort((a,b)=>+a-+b)
              return(
                <div key={e.uid} style={{background:'#f5f5f5',border:'1px solid #e0e0e0',borderRadius:6,padding:'11px 12px'}}>
                  <div style={{fontSize:12,fontWeight:700,color:'#111',marginBottom:7,paddingBottom:5,borderBottom:'1px solid #e0e0e0'}}>
                    {e.name} <span style={{fontWeight:400,fontSize:10,color:'#888'}}>({wdays.length}일/{schedTotals[e.uid]?.hours||0}h)</span>
                  </div>
                  <div style={{display:'flex',flexWrap:'wrap',gap:3}}>
                    {wdays.length
                      ? wdays.map(d=><span key={d} style={{background:'#222',color:'#fff',fontSize:9,padding:'2px 6px',borderRadius:3,fontFamily:'DM Mono, monospace'}}>{+d}일·{es[d]}h</span>)
                      : <span style={{fontSize:10,color:'#aaa'}}>근무 없음</span>}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 서명란 */}
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
      )}
    </div>
  )
}