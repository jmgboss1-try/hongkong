import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')
const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const wonFmt = n => (n||0).toLocaleString('ko-KR')

function getWageForMonth(emp, month) {
  const history = emp.wageHistory || []
  if(!history.length) return emp.wage || 10030
  const applicable = history.filter(h=>h.month<=month).sort((a,b)=>a.month>b.month?-1:1)
  return applicable.length ? applicable[0].wage : (emp.wage||10030)
}

function calcDeduction(totalPay, employType) {
  if(employType === 'none') return { tax:0, pension:0, health:0, employ:0, care:0, total:0 }
  if(employType === 'part') {
    const tax = Math.round(totalPay * 0.033)
    return { tax, pension:0, health:0, employ:0, care:0, total:tax }
  }
  const pension = Math.round(totalPay * 0.045)
  const health  = Math.round(totalPay * 0.03545)
  const employ  = Math.round(totalPay * 0.009)
  const care    = Math.round(health   * 0.1295)
  const total   = pension + health + employ + care
  return { tax:0, pension, health, employ, care, total }
}

function calcWeeklyHoliday(weekHours, wage, workDays, weekAttendance, weekMemos, holidayHours) {
  if(weekHours < 15) return 0
  const absentDays = workDays.filter(dow => (weekAttendance[dow]||0) === 0)
  if(absentDays.length === 0) return Math.round((holidayHours/40)*8*wage)
  const subCount = Object.values(weekMemos).filter(m=>m&&m.includes('대타')).length
  if(subCount >= absentDays.length) return Math.round((holidayHours/40)*8*wage)
  return 0
}

function computeSalary(emp, wh, ex, empMemos, prevWh, prevEx, prevEmpMemos, curMonth) {
  const wage = getWageForMonth(emp, curMonth)
  const workDays = emp.workDays || [1,2,3,4,5]
  const avgHours = emp.avgHours || 8
  const holidayBase = emp.holidayBase || 'contract'
  const days = daysIn(curMonth)
  const [cy,cm] = curMonth.split('-').map(Number)
  const prevMonthDays = cm===1 ? new Date(cy-1,12,0).getDate() : new Date(cy,cm-1,0).getDate()
  let totalHours=0, totalMins=0, totalWeeklyHoliday=0

  for(let d=1; d<=days; d++) {
    const dd = pad(d)
    const dow = new Date(cy,cm-1,d).getDay()
    totalHours += wh[dd]||0
    totalMins  += ex[dd]||0
    if(dow === 0) {
      let weekH=0
      const weekAttendance={}, weekMemos={}
      for(let wd=1; wd<=6; wd++) {
        const prevD = d - wd
        if(prevD >= 1) {
          const prevDD=pad(prevD), prevDow=new Date(cy,cm-1,prevD).getDay()
          const prevH=(wh[prevDD]||0)+(ex[prevDD]||0)/60
          weekH+=prevH; weekAttendance[prevDow]=(weekAttendance[prevDow]||0)+prevH
          if(empMemos[prevDD]) weekMemos[prevDD]=empMemos[prevDD]
        } else {
          const prevMonthD=prevMonthDays+prevD
          if(prevMonthD>=1) {
            const prevDD=pad(prevMonthD), prevDow=new Date(cy,cm-2,prevMonthD).getDay()
            const prevH=(prevWh[prevDD]||0)+(prevEx[prevDD]||0)/60
            weekH+=prevH; weekAttendance[prevDow]=(weekAttendance[prevDow]||0)+prevH
            if(prevEmpMemos[prevDD]) weekMemos[`prev_${prevDD}`]=prevEmpMemos[prevDD]
          }
        }
      }
      const holidayHours = holidayBase==='actual' ? weekH : avgHours * workDays.length
      totalWeeklyHoliday += calcWeeklyHoliday(weekH, wage, workDays, weekAttendance, weekMemos, holidayHours)
    }
  }
  const totalH = totalHours + totalMins/60
  const basePay = Math.round(totalH * wage)
  const totalPay = basePay + totalWeeklyHoliday
  const deduction = calcDeduction(totalPay, emp.employType||'part')
  const netPay = totalPay - deduction.total
  return { basePay, weeklyHoliday: totalWeeklyHoliday, totalPay, netPay, deduction, totalHours, totalMins, wage }
}

const STATUS = {
  unconfirmed: { label:'미확정',   color:'#5e6585', bg:'rgba(94,101,133,0.15)' },
  confirmed:   { label:'확인대기', color:'#f9b934', bg:'rgba(249,185,52,0.15)' },
  checked:     { label:'직원확인', color:'#34d399', bg:'rgba(52,211,153,0.15)' },
  inquiry:     { label:'문의중',   color:'#f87171', bg:'rgba(248,113,113,0.15)' },
  paid:        { label:'지급완료', color:'#93c5fd', bg:'rgba(147,197,253,0.15)' },
}

// 세무 보고서 모달
function TaxReportModal({ month, employees, payroll, getComputed, ssnMap, ownerConfig, onClose }) {
  const [showOwnerConfig, setShowOwnerConfig] = useState(false)
  const [editOwner, setEditOwner] = useState(ownerConfig)

  // 인쇄
  function handlePrint() {
    window.print()
  }

  const rows = employees.map(emp => {
    const p       = payroll[emp.uid]
    const computed = getComputed(emp)
    const salary   = p?.confirmedByOwner ? p.totalPay : computed.totalPay
    const tax      = Math.round(salary * 0.033)
    const net      = salary - tax
    return { name: emp.name, ssn: ssnMap[emp.uid] || '—', salary, tax, net }
  })

  // 정민규 행 추가
  const ownerRow = ownerConfig.salary > 0 ? {
    name:   '정민규',
    ssn:    ownerConfig.ssn || '—',
    salary: ownerConfig.salary,
    tax:    ownerConfig.deduction,
    net:    ownerConfig.salary - ownerConfig.deduction,
    isOwner: true,
  } : null

  const allRows = ownerRow ? [ownerRow, ...rows] : rows
  const totalSalary = allRows.reduce((a,r)=>a+r.salary,0)
  const totalTax    = allRows.reduce((a,r)=>a+r.tax,0)
  const totalNet    = allRows.reduce((a,r)=>a+r.net,0)

  const tdStyle = {
    border:'1px solid #999',
    padding:'6px 10px',
    fontSize:13,
    textAlign:'right',
    fontFamily:'monospace',
    background:'#fff',
    color:'#000',
  }
  const thStyle = {
    border:'1px solid #999',
    padding:'7px 10px',
    fontSize:12,
    fontWeight:700,
    background:'#dce6f1',
    color:'#000',
    textAlign:'center',
  }

  return (
    <div style={{position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,0.7)',
      display:'flex',alignItems:'flex-start',justifyContent:'center',
      overflowY:'auto',padding:'30px 16px'}}>
      <div style={{background:'#fff',borderRadius:12,width:'100%',maxWidth:760,
        boxShadow:'0 20px 60px rgba(0,0,0,0.4)'}}>

        {/* 모달 헤더 */}
        <div style={{padding:'16px 20px',borderBottom:'1px solid #e0e0e0',
          display:'flex',justifyContent:'space-between',alignItems:'center',
          background:'#f8f9fa',borderRadius:'12px 12px 0 0'}}>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:'#000'}}>
              📄 {mLabel(month)} 임금내역 보고서
            </div>
            <div style={{fontSize:11,color:'#666',marginTop:2}}>세무사 제출용</div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>setShowOwnerConfig(v=>!v)}
              style={{background:'#e8f4fd',border:'1px solid #aac',color:'#336',
                borderRadius:6,padding:'6px 12px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
              ⚙️ 내 급여 설정
            </button>
            <button onClick={handlePrint}
              style={{background:'#1a56db',color:'#fff',border:'none',
                borderRadius:6,padding:'6px 14px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              🖨️ 인쇄 / 저장
            </button>
            <button onClick={onClose}
              style={{background:'transparent',border:'1px solid #ccc',color:'#666',
                borderRadius:6,padding:'6px 12px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
              ✕ 닫기
            </button>
          </div>
        </div>

        {/* 정민규 급여 설정 */}
        {showOwnerConfig && (
          <div style={{padding:'14px 20px',background:'#f0f7ff',borderBottom:'1px solid #cce0f5'}}>
            <div style={{fontSize:12,fontWeight:700,color:'#336',marginBottom:10}}>
              ⚙️ 정민규 급여 설정 (매달 수동 입력)
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
              {[
                ['주민등록번호','text','ssn'],
                ['급여 (원)','number','salary'],
                ['공제합계 (원)','number','deduction'],
              ].map(([label,type,key])=>(
                <div key={key}>
                  <label style={{fontSize:10,color:'#555',display:'block',marginBottom:3}}>{label}</label>
                  <input type={type} value={editOwner[key]||''}
                    onChange={e=>setEditOwner(prev=>({...prev,[key]:type==='number'?+e.target.value:e.target.value}))}
                    style={{width:'100%',border:'1px solid #aac',borderRadius:5,padding:'6px 8px',
                      fontSize:12,outline:'none',fontFamily:'monospace'}}/>
                </div>
              ))}
            </div>
            <div style={{marginTop:10,display:'flex',gap:8,alignItems:'center'}}>
              <button onClick={()=>{ Object.assign(ownerConfig, editOwner); setShowOwnerConfig(false) }}
                style={{background:'#1a56db',color:'#fff',border:'none',borderRadius:5,
                  padding:'6px 14px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                적용
              </button>
              <span style={{fontSize:11,color:'#888'}}>
                최종급여: {((editOwner.salary||0)-(editOwner.deduction||0)).toLocaleString()}원
              </span>
            </div>
          </div>
        )}

        {/* 보고서 본문 */}
        <div id="tax-report-print" style={{padding:'24px'}}>
          <div style={{textAlign:'center',marginBottom:20}}>
            <div style={{fontSize:16,fontWeight:700,color:'#000',marginBottom:4}}>
              홍콩반점 중앙대점 — {mLabel(month)} 임금내역
            </div>
            <div style={{fontSize:12,color:'#555'}}>
              근로소득 원천징수 내역서
            </div>
          </div>

          <table style={{width:'100%',borderCollapse:'collapse',marginBottom:16}}>
            <thead>
              <tr>
                <th style={{...thStyle,textAlign:'left',width:'12%'}}>이름</th>
                <th style={{...thStyle,textAlign:'left',width:'20%'}}>주민등록번호</th>
                <th style={{...thStyle,width:'22%'}}>급여</th>
                <th style={{...thStyle,width:'22%'}}>원천징수</th>
                <th style={{...thStyle,width:'24%'}}>최종급여</th>
              </tr>
            </thead>
            <tbody>
              {allRows.map((row, i) => (
                <tr key={i}>
                  <td style={{...tdStyle,textAlign:'left',fontWeight:600,background:row.isOwner?'#fffde7':'#fff'}}>
                    {row.name}
                  </td>
                  <td style={{...tdStyle,textAlign:'left',letterSpacing:1,background:row.isOwner?'#fffde7':'#fff'}}>
                    {row.ssn}
                  </td>
                  <td style={{...tdStyle,background:row.isOwner?'#fffde7':'#fff'}}>
                    {wonFmt(row.salary)}
                  </td>
                  <td style={{...tdStyle,color:'#c00',background:row.isOwner?'#fffde7':'#fff'}}>
                    {row.tax > 0 ? wonFmt(row.tax) : '—'}
                    {!row.isOwner && row.tax > 0 && (
                      <span style={{fontSize:10,color:'#999',marginLeft:4}}>(3.3%)</span>
                    )}
                  </td>
                  <td style={{...tdStyle,fontWeight:700,color:'#003399',
                    background:row.isOwner?'#e8f4fd':'#f0f8ff'}}>
                    {wonFmt(row.net)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{background:'#dce6f1'}}>
                <td colSpan={2} style={{...tdStyle,textAlign:'center',fontWeight:700,background:'#dce6f1',color:'#000'}}>
                  합 계
                </td>
                <td style={{...tdStyle,fontWeight:700,background:'#dce6f1',color:'#000'}}>
                  {wonFmt(totalSalary)}
                </td>
                <td style={{...tdStyle,fontWeight:700,color:'#c00',background:'#dce6f1'}}>
                  {wonFmt(totalTax)}
                </td>
                <td style={{...tdStyle,fontWeight:700,color:'#003399',background:'#dce6f1'}}>
                  {wonFmt(totalNet)}
                </td>
              </tr>
            </tfoot>
          </table>

          <div style={{fontSize:11,color:'#888',borderTop:'1px solid #ddd',paddingTop:10,
            display:'flex',justifyContent:'space-between'}}>
            <span>* 아르바이트 사업소득 원천징수세율 3.3% (소득세 3% + 지방소득세 0.3%)</span>
            <span>출력일: {new Date().toLocaleDateString('ko-KR')}</span>
          </div>
        </div>
      </div>

      {/* 인쇄 전용 스타일 */}
      <style>{`
        @media print {
          body > * { display: none !important; }
          #tax-report-print { display: block !important; position: fixed; top:0; left:0; width:100%; }
        }
      `}</style>
    </div>
  )
}

export default function Payroll() {
  const [curMonth, setCurMonth] = useState(()=>{
    const now=new Date(); return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [employees, setEmployees]         = useState([])
  const [workHours, setWorkHours]         = useState({})
  const [workExtra, setWorkExtra]         = useState({})
  const [memos, setMemos]                 = useState({})
  const [prevWorkHours, setPrevWorkHours] = useState({})
  const [prevWorkExtra, setPrevWorkExtra] = useState({})
  const [prevMemos, setPrevMemos]         = useState({})
  const [payroll, setPayroll]             = useState({})
  const [ssnMap, setSsnMap]               = useState({}) // uid → ssn
  const [loading, setLoading]             = useState(true)
  const [activeUid, setActiveUid]         = useState(null)
  const [replyText, setReplyText]         = useState('')
  const [saving, setSaving]               = useState(false)
  const [showTaxReport, setShowTaxReport] = useState(false)
  const [ownerConfig, setOwnerConfig]     = useState({ ssn:'', salary:0, deduction:0 })

  const monthOpts=[]
  for(let y=2022;y<=2026;y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  async function load() {
    setLoading(true)
    try {
      const usersSnap = await getDocs(collection(db,'users'))
      const emps = []
      const ssnData = {}
      usersSnap.forEach(d=>{
        const data=d.data()
        if(data.role==='owner') return
        const isActive  = data.status === 'approved'
        const isRetired = data.status === 'retired'
        if(isRetired && (!data.leaveDate || data.leaveDate < curMonth+'-01')) return
        if(data.role === 'investor' || data.role === 'store') return
if(!isActive && !isRetired) return
        emps.push({uid:d.id, name:data.name, wage:data.wage||10030,
            wageHistory:data.wageHistory||[], workDays:data.workDays||[1,2,3,4,5],
            avgHours:data.avgHours||8, employType:data.employType||'part',
            holidayBase:data.holidayBase||'contract',
            isRetired, leaveDate:data.leaveDate||null})
        if(data.ssn) ssnData[d.id] = data.ssn
      })
      setEmployees(emps)
      setSsnMap(ssnData)

      const [cy,cm] = curMonth.split('-').map(Number)
      const prev = cm===1?`${cy-1}-12`:`${cy}-${pad(cm-1)}`

      const [wh,ex,me,pwh,pex,pme,pr] = await Promise.all([
        getDoc(doc(db,'workhours',curMonth)),
        getDoc(doc(db,'workextra',curMonth)),
        getDoc(doc(db,'workmemos',curMonth)),
        getDoc(doc(db,'workhours',prev)),
        getDoc(doc(db,'workextra',prev)),
        getDoc(doc(db,'workmemos',prev)),
        getDoc(doc(db,'payroll',curMonth)),
      ])
      setWorkHours(wh.exists()?wh.data():{})
      setWorkExtra(ex.exists()?ex.data():{})
      setMemos(me.exists()?me.data():{})
      setPrevWorkHours(pwh.exists()?pwh.data():{})
      setPrevWorkExtra(pex.exists()?pex.data():{})
      setPrevMemos(pme.exists()?pme.data():{})
      setPayroll(pr.exists()?pr.data():{})
    } catch(e){ console.error(e) }
    setLoading(false)
  }

  useEffect(()=>{ load() },[curMonth])

  function getStatus(uid) {
    const p = payroll[uid]
    if(!p?.confirmedByOwner) return 'unconfirmed'
    if(p.paid) return 'paid'
    if(p.inquiry && !p.inquiry.resolved) return 'inquiry'
    if(p.checkedByEmp) return 'checked'
    return 'confirmed'
  }

  function getComputed(emp) {
    return computeSalary(
      emp,
      workHours[emp.uid]||{}, workExtra[emp.uid]||{}, memos[emp.uid]||{},
      prevWorkHours[emp.uid]||{}, prevWorkExtra[emp.uid]||{}, prevMemos[emp.uid]||{},
      curMonth
    )
  }

  async function savePayroll(newPayroll) {
    await setDoc(doc(db,'payroll',curMonth), newPayroll)
    setPayroll(newPayroll)
  }

  async function confirmOne(uid) {
    const emp = employees.find(e=>e.uid===uid)
    if(!emp) return
    setSaving(true)
    try {
      const computed = getComputed(emp)
      const newPayroll = { ...payroll, [uid]: {
        ...(payroll[uid]||{}), ...computed,
        confirmedByOwner:true, confirmedAt:new Date().toISOString(),
        checkedByEmp: payroll[uid]?.checkedByEmp||false,
        inquiry: payroll[uid]?.inquiry||null,
        paid: payroll[uid]?.paid||false, paidAt: payroll[uid]?.paidAt||null,
      }}
      await savePayroll(newPayroll)
    } catch(e){ console.error(e) }
    setSaving(false)
  }

  async function confirmAll() {
    if(!window.confirm('전체 직원 급여를 확정하시겠습니까?\n직원들에게 급여 내역이 공개됩니다.')) return
    setSaving(true)
    try {
      const newPayroll = { ...payroll }
      for(const emp of employees) {
        const computed = getComputed(emp)
        newPayroll[emp.uid] = {
          ...(newPayroll[emp.uid]||{}), ...computed,
          confirmedByOwner:true, confirmedAt:new Date().toISOString(),
          checkedByEmp: payroll[emp.uid]?.checkedByEmp||false,
          inquiry: payroll[emp.uid]?.inquiry||null,
          paid: payroll[emp.uid]?.paid||false, paidAt: payroll[emp.uid]?.paidAt||null,
        }
      }
      await savePayroll(newPayroll)
    } catch(e){ console.error(e) }
    setSaving(false)
  }

  async function markPaid(uid) {
    if(!window.confirm('지급 완료로 처리하시겠습니까?')) return
    setSaving(true)
    try {
      await savePayroll({ ...payroll, [uid]: { ...(payroll[uid]||{}), paid:true, paidAt:new Date().toISOString() }})
    } catch(e){ console.error(e) }
    setSaving(false)
  }

  async function sendReply(uid) {
    if(!replyText.trim()) return
    setSaving(true)
    try {
      await savePayroll({ ...payroll, [uid]: {
        ...(payroll[uid]||{}),
        inquiry: { ...(payroll[uid]?.inquiry||{}), ownerReply:replyText.trim(), repliedAt:new Date().toISOString() }
      }})
      setReplyText('')
    } catch(e){ console.error(e) }
    setSaving(false)
  }

  async function resolveInquiry(uid) {
    setSaving(true)
    try {
      await savePayroll({ ...payroll, [uid]: {
        ...(payroll[uid]||{}),
        inquiry: { ...(payroll[uid]?.inquiry||{}), resolved:true, resolvedAt:new Date().toISOString() }
      }})
      setActiveUid(null)
    } catch(e){ console.error(e) }
    setSaving(false)
  }

  const inquiryCount = employees.filter(e=>getStatus(e.uid)==='inquiry').length
  const paidCount    = employees.filter(e=>getStatus(e.uid)==='paid').length
  const checkedCount = employees.filter(e=>['checked','paid'].includes(getStatus(e.uid))).length
  const grandTotal   = employees.reduce((a,emp)=>{
    const p=payroll[emp.uid]
    const computed = getComputed(emp)
    const netPay = p?.netPay || computed.netPay
    return a + netPay
  },0)

  return (
    <div>
      {/* 헤더 */}
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>💸 급여관리</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>
            {mLabel(curMonth)} — 사장 전용
            {inquiryCount>0 && (
              <span style={{marginLeft:8,background:'rgba(248,113,113,0.2)',color:'#f87171',
                fontSize:11,padding:'2px 8px',borderRadius:4,fontWeight:600}}>
                📨 문의 {inquiryCount}건
              </span>
            )}
          </div>
        </div>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <button onClick={()=>setShowTaxReport(true)}
            style={{background:'#191c2b',border:'1px solid #272a3d',color:'#dde1f2',borderRadius:8,
              padding:'8px 14px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
            📄 세무 보고서
          </button>
          <button onClick={confirmAll} disabled={saving}
            style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,
              padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
            전체 급여 확정
          </button>
          <select value={curMonth} onChange={e=>setCurMonth(e.target.value)}
            style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,color:'#dde1f2',
              padding:'8px 12px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
            {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
          </select>
        </div>
      </div>

      {/* 요약 카드 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:20}}>
        {[
          {label:'이달 인건비 합계', val:`${grandTotal.toLocaleString()}원`,       color:'#f9b934'},
          {label:'직원 확인 완료',   val:`${checkedCount} / ${employees.length}명`, color:'#34d399'},
          {label:'문의 건수',        val:`${inquiryCount}건`,                       color:'#f87171'},
          {label:'지급 완료',        val:`${paidCount}명`,                          color:'#93c5fd'},
        ].map(k=>(
          <div key={k.label} style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'14px 16px',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:2,background:k.color,opacity:.5}}/>
            <div style={{fontSize:10,color:'#5e6585',marginBottom:5}}>{k.label}</div>
            <div style={{fontSize:16,fontWeight:700,color:k.color,fontFamily:'DM Mono,monospace'}}>{k.val}</div>
          </div>
        ))}
      </div>

      {loading ? (
        <div style={{textAlign:'center',color:'#5e6585',padding:60}}>로딩 중...</div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {employees.map(emp=>{
            const status  = getStatus(emp.uid)
            const p       = payroll[emp.uid]
            const computed = getComputed(emp)
            const display = p?.confirmedByOwner ? p : computed
            const st      = STATUS[status]
            const hasInquiry = p?.inquiry && !p.inquiry.resolved
            const isOpen  = activeUid === emp.uid

            return (
              <div key={emp.uid} style={{background:'#12141f',
                border:`1px solid ${hasInquiry?'rgba(248,113,113,0.4)':'#272a3d'}`,
                borderRadius:12,overflow:'hidden'}}>

                <div style={{padding:'14px 18px',display:'flex',alignItems:'center',
                  justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
                  <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                    <div style={{fontSize:14,fontWeight:700}}>{emp.name}</div>
                    {emp.isRetired && (
                      <span style={{fontSize:10,fontWeight:700,padding:'2px 8px',borderRadius:4,
                        background:'rgba(94,101,133,0.2)',color:'#5e6585'}}>
                        📤 퇴직 {emp.leaveDate?.slice(0,10)}
                      </span>
                    )}
                    <span style={{fontSize:11,fontWeight:700,padding:'3px 9px',borderRadius:5,
                      background:st.bg,color:st.color}}>{st.label}</span>
                    {hasInquiry && (
                      <button onClick={()=>{ setActiveUid(isOpen?null:emp.uid); setReplyText('') }}
                        style={{background:'rgba(248,113,113,0.12)',border:'1px solid rgba(248,113,113,0.3)',
                          color:'#f87171',borderRadius:6,padding:'4px 10px',fontSize:11,
                          cursor:'pointer',fontFamily:'inherit',fontWeight:600}}>
                        📨 문의 {isOpen?'닫기':'확인'}
                      </button>
                    )}
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
                    <div style={{textAlign:'right'}}>
                      <div style={{fontSize:10,color:'#5e6585',marginBottom:2}}>
                        {display.totalHours}h {display.totalMins>0?display.totalMins+'m':''} · 시급 {(display.wage||10030).toLocaleString()}원
                      </div>
                      <div style={{fontSize:10,color:'#5e6585',marginBottom:2}}>
                        기본 {(display.basePay||0).toLocaleString()} + 주휴 {(display.weeklyHoliday||0).toLocaleString()}
                      </div>
                      <div style={{fontSize:11,color:'#5e6585',marginBottom:2}}>
                        세전 {(display.totalPay||0).toLocaleString()}원
                        {(display.deduction?.total||0)>0 && (
                          <span style={{color:'#f87171',marginLeft:6}}>
                            -{(display.deduction?.total||0).toLocaleString()}원
                          </span>
                        )}
                      </div>
                      <div style={{fontSize:16,fontWeight:700,color:'#34d399',fontFamily:'DM Mono,monospace'}}>
                        실수령 {(display.netPay||display.totalPay||0).toLocaleString()}원
                      </div>
                    </div>
                    {status==='unconfirmed' && (
                      <button onClick={()=>confirmOne(emp.uid)} disabled={saving}
                        style={{background:'#f9b934',color:'#000',border:'none',borderRadius:7,
                          padding:'8px 14px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                        급여 확정
                      </button>
                    )}
                    {(status==='confirmed' || status==='inquiry') && (
                      <button onClick={()=>confirmOne(emp.uid)} disabled={saving}
                        style={{background:'transparent',border:'1px solid #3d4060',color:'#5e6585',
                          borderRadius:7,padding:'8px 12px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
                        재확정
                      </button>
                    )}
                    {status==='checked' && (
                      <button onClick={()=>markPaid(emp.uid)} disabled={saving}
                        style={{background:'#93c5fd',color:'#000',border:'none',borderRadius:7,
                          padding:'8px 14px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                        지급 완료
                      </button>
                    )}
                    {status==='inquiry' && (
                      <button onClick={()=>markPaid(emp.uid)} disabled={saving}
                        style={{background:'transparent',border:'1px solid rgba(147,197,253,0.4)',color:'#93c5fd',
                          borderRadius:7,padding:'8px 12px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
                        강제 지급
                      </button>
                    )}
                    {status==='paid' && (
                      <div style={{fontSize:11,color:'#93c5fd',fontWeight:600}}>
                        ✅ {p.paidAt?.slice(0,10)}
                      </div>
                    )}
                  </div>
                </div>

                {isOpen && p?.inquiry && (
                  <div style={{borderTop:'1px solid rgba(248,113,113,0.2)',
                    background:'rgba(248,113,113,0.03)',padding:'16px 18px',
                    display:'flex',flexDirection:'column',gap:12}}>
                    <div style={{fontSize:11,fontWeight:600,color:'#f87171'}}>📨 직원 문의 내용</div>
                    <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                      <div style={{width:30,height:30,borderRadius:'50%',background:'rgba(94,101,133,0.25)',
                        display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,flexShrink:0}}>👤</div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:10,color:'#5e6585',marginBottom:5}}>
                          {emp.name} · {p.inquiry.createdAt?.slice(0,10)}
                        </div>
                        <div style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,
                          padding:'10px 14px',fontSize:12,color:'#dde1f2',lineHeight:1.7}}>
                          {p.inquiry.message}
                        </div>
                      </div>
                    </div>
                    {p.inquiry.ownerReply && (
                      <div style={{display:'flex',gap:10,alignItems:'flex-start',justifyContent:'flex-end'}}>
                        <div style={{flex:1,maxWidth:'82%'}}>
                          <div style={{fontSize:10,color:'#5e6585',marginBottom:5,textAlign:'right'}}>
                            사장님 답변 · {p.inquiry.repliedAt?.slice(0,10)}
                          </div>
                          <div style={{background:'rgba(249,185,52,0.08)',border:'1px solid rgba(249,185,52,0.2)',
                            borderRadius:8,padding:'10px 14px',fontSize:12,color:'#dde1f2',lineHeight:1.7}}>
                            {p.inquiry.ownerReply}
                          </div>
                        </div>
                        <div style={{width:30,height:30,borderRadius:'50%',background:'rgba(249,185,52,0.2)',
                          display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,flexShrink:0}}>👑</div>
                      </div>
                    )}
                    {!p.inquiry.ownerReply && (
                      <div style={{display:'flex',gap:8}}>
                        <input value={replyText} onChange={e=>setReplyText(e.target.value)}
                          placeholder="답변을 입력하고 Enter..."
                          onKeyDown={e=>e.key==='Enter'&&sendReply(emp.uid)}
                          style={{flex:1,background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,
                            color:'#dde1f2',padding:'8px 12px',fontSize:12,outline:'none',fontFamily:'inherit'}}/>
                        <button onClick={()=>sendReply(emp.uid)} disabled={saving}
                          style={{background:'#f9b934',color:'#000',border:'none',borderRadius:7,
                            padding:'8px 16px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                          전송
                        </button>
                      </div>
                    )}
                    {p.inquiry.ownerReply && (
                      <div style={{display:'flex',gap:8,justifyContent:'flex-end',flexWrap:'wrap'}}>
                        <button onClick={()=>resolveInquiry(emp.uid)} disabled={saving}
                          style={{background:'rgba(52,211,153,0.12)',border:'1px solid rgba(52,211,153,0.3)',
                            color:'#34d399',borderRadius:7,padding:'7px 14px',fontSize:11,
                            fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>
                          ✓ 문의 해결 완료
                        </button>
                        <button onClick={()=>markPaid(emp.uid)} disabled={saving}
                          style={{background:'rgba(147,197,253,0.12)',border:'1px solid rgba(147,197,253,0.3)',
                            color:'#93c5fd',borderRadius:7,padding:'7px 14px',fontSize:11,
                            fontWeight:600,cursor:'pointer',fontFamily:'inherit'}}>
                          지급 완료 처리
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {employees.length===0 && (
            <div style={{textAlign:'center',color:'#5e6585',padding:40}}>승인된 직원이 없습니다</div>
          )}
        </div>
      )}

      {/* 세무 보고서 모달 */}
      {showTaxReport && (
        <TaxReportModal
          month={curMonth}
          employees={employees}
          payroll={payroll}
          getComputed={getComputed}
          ssnMap={ssnMap}
          ownerConfig={ownerConfig}
          onClose={()=>setShowTaxReport(false)}
        />
      )}
    </div>
  )
}
