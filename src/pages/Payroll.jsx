import { useEffect, useState } from 'react'
import { VStack } from '@astryxdesign/core/Layout'
import { Button } from '@astryxdesign/core/Button'
import { Badge } from '@astryxdesign/core/Badge'
import { Selector } from '@astryxdesign/core/Selector'
import { HStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { List, ListItem } from '@astryxdesign/core/List'
import { TextInput } from '@astryxdesign/core/TextInput'
import { DateInput } from '@astryxdesign/core/DateInput'
import { AstryxPage, Legacy, PageHeader, LedgerCard, Ledger, LedgerRow } from '../astryx/AstryxPage'
import CountUp from '../components/CountUp'
import { db } from '../firebase'
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore'
import { withSubMemos, loadSubs } from '../lib/attendance'
import { loadPrivateMap, syncPayslipsQuiet } from '../lib/privateInfo'
import { Statement, STATEMENT_PRINT_CSS } from '../components/WageStatements'
import { useAuth } from '../AuthContext'
import { calcDeduction, insuranceFor, splitDeduction } from '../lib/payDeduction'
import WithholdingReceipt from '../components/WithholdingReceipt'
import { useBizInfo, useSeal } from '../lib/bizInfo'

const pad = n => String(n).padStart(2,'0')
const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const wonFmt = n => (n||0).toLocaleString('ko-KR')
const nextYm = ym => { const[y,m]=ym.split('-').map(Number); return m===12 ? `${y+1}-01` : `${y}-${pad(m+1)}` }
const todayStr = () => { const n=new Date(); return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}` }

function getWageForMonth(emp, month) {
  const history = emp.wageHistory || []
  if(!history.length) return emp.wage || 10030
  const applicable = history.filter(h=>h.month<=month).sort((a,b)=>a.month>b.month?-1:1)
  return applicable.length ? applicable[0].wage : (emp.wage||10030)
}

// 해당 월에 적용되는 근무스케쥴(소정근로일/평균근무시간) 찾기 — 시급 이력과 동일한 패턴
function getScheduleForMonth(emp, month) {
  const history = emp.scheduleHistory || []
  if(!history.length) return { workDays: emp.workDays || [1,2,3,4,5], avgHours: emp.avgHours || 8 }
  const applicable = history.filter(h=>h.month<=month).sort((a,b)=>a.month>b.month?-1:1)
  return applicable.length
    ? { workDays: applicable[0].workDays, avgHours: applicable[0].avgHours }
    : { workDays: emp.workDays || [1,2,3,4,5], avgHours: emp.avgHours || 8 }
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
  // 고정급 직원 처리
  if (emp.payType === 'fixed') {
    const totalPay = emp.fixedSalary || 0
    const deduction = calcDeduction(totalPay, emp.employType || 'part', insuranceFor(emp.insuranceHistory, curMonth))
    const netPay = totalPay - deduction.total
    return { basePay: totalPay, weeklyHoliday: 0, totalPay, netPay, deduction,
             totalHours: 0, totalMins: 0, wage: 0, isFixed: true }
  }

  const wage = getWageForMonth(emp, curMonth)
  const schedule = getScheduleForMonth(emp, curMonth)
  const workDays = schedule.workDays || [1,2,3,4,5]
  const avgHours = schedule.avgHours || 8
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
  const deduction = calcDeduction(totalPay, emp.employType||'part', insuranceFor(emp.insuranceHistory, curMonth))
  const netPay = totalPay - deduction.total
  return { basePay, weeklyHoliday: totalWeeklyHoliday, totalPay, netPay, deduction, totalHours, totalMins, wage }
}

// ── 초과 가불 넘기기 (급여관리) ──
// month 의 넘긴 금액을 total 로: payroll/{month}[uid].carriedOut, advances/{다음 달}[uid] 의 'carry-<month>' 기록 (0이면 기록 삭제)
async function setCarry(uid, month, total) {
  const next = nextYm(month)
  const as = await getDoc(doc(db,'advances',next))
  const ad = as.exists() ? as.data() : {}
  const list = (ad[uid]||[]).filter(r=>r.carryFrom!==month)
  if(total > 0) list.push({ id:`carry-${month}`, date:`${next}-01`, amount:total, memo:`${+month.slice(5)}월 초과 가불 이월`, carryFrom:month })
  list.sort((a,b)=>a.date>b.date?1:-1)
  await setDoc(doc(db,'advances',next), { ...ad, [uid]: list })
  const ps = await getDoc(doc(db,'payroll',month))
  const pd = ps.exists() ? ps.data() : {}
  await setDoc(doc(db,'payroll',month), { ...pd, [uid]: { ...(pd[uid]||{}), carriedOut: total, carriedTo: total > 0 ? next : null } })
  syncPayslipsQuiet(month)   // 직원이 보는 급여 복사본도 맞춤
}
// month 로 넘어온 가불이 delta 만큼 바뀌었을 때: month 가 이미 다음 달로 넘긴 게 있으면 그 금액도 같이 바꾸고 계속 이어감
async function chainCarry(uid, month, delta) {
  for(let i=0; i<24 && delta; i++) {
    const ps = await getDoc(doc(db,'payroll',month))
    const cur = (ps.exists() ? ps.data()[uid]?.carriedOut : 0) || 0
    if(!cur) return
    const total = Math.max(0, cur + delta)
    await setCarry(uid, month, total)
    delta = total - cur
    month = nextYm(month)
  }
}

const STATUS = {
  unconfirmed: { label:'미확정',   color:'#6E6A63', bg:'rgba(94,101,133,0.15)' },
  confirmed:   { label:'확인대기', color:'var(--hk-accent)', bg:'rgba(var(--hk-accent-rgb),0.15)' },
  checked:     { label:'직원확인', color:'#2E7D45', bg:'rgba(46,125,69,0.15)' },
  inquiry:     { label:'문의중',   color:'#B42318', bg:'rgba(180,35,24,0.15)' },
  paid:        { label:'지급완료', color:'#2B5C9E', bg:'rgba(43,92,158,0.15)' },
}

// 세무 보고서 모달
function TaxReportModal({ month, curMonth, employees, payroll, getComputed, ssnMap, ownerConfig, setOwnerConfig, ownerConfigFrom, setOwnerConfigFrom, severance, nameMap, bonuses, onClose }) {
  const [showOwnerConfig, setShowOwnerConfig] = useState(false)
const [editOwner, setEditOwner] = useState(ownerConfig)
const [estNote, setEstNote] = useState('')   // '공제합계로 나눠 보기' 결과 안내

useEffect(() => {
  setEditOwner(ownerConfig)
}, [ownerConfig])

  function handlePrint() { window.print() }

  const rows = employees.map(emp => {
    const p       = payroll[emp.uid]
    const computed = getComputed(emp)
    const basePay  = p?.confirmedByOwner ? p.totalPay : computed.totalPay
    const bonusTotal = (bonuses?.[emp.uid]||[]).reduce((a,r)=>a+(r.amount||0),0)
    const salary   = basePay + bonusTotal
    const tax      = Math.round(salary * 0.033)
    const net      = salary - tax
    return { uid: emp.uid, name: emp.name, ssn: ssnMap[emp.uid] || '—', salary, tax, net }
  })

  // 이달 퇴직금 지급 내역 (별도 행으로 추가)
  const severanceRows = Object.entries(severance||{}).map(([uid,s])=>({
    uid, name: (nameMap?.[uid]||'—') + ' (퇴직금)',
    ssn: ssnMap[uid] || '—',
    salary: s.amount, tax: s.tax, net: s.net,
    isSeverance: true,
  }))

  const ownerRow = ownerConfig.salary > 0 ? {
    name:   '정민규',
    ssn:    ownerConfig.ssn || '—',
    salary: ownerConfig.salary,
    tax:    ownerConfig.deduction,
    net:    ownerConfig.salary - ownerConfig.deduction,
    isOwner: true,
  } : null

  const allRows = [...(ownerRow ? [ownerRow] : []), ...rows, ...severanceRows]
  const totalSalary = allRows.reduce((a,r)=>a+r.salary,0)
  const totalTax    = allRows.reduce((a,r)=>a+r.tax,0)
  const totalNet    = allRows.reduce((a,r)=>a+r.net,0)

  const tdBase = {
    border:'1px solid #999',
    padding:'7px 10px',
    fontSize:13,
    background:'#fff',
    color:'#000',
    whiteSpace:'nowrap',
  }

  return (
    <div style={{position:'fixed',inset:0,zIndex:1000,background:'rgba(0,0,0,0.7)',
      display:'flex',alignItems:'flex-start',justifyContent:'center',
      overflowY:'auto',padding:'30px 16px'}}>
      <div style={{background:'#fff',color:'#000',borderRadius:6,width:'100%',maxWidth:800,
        boxShadow:'0 20px 60px rgba(0,0,0,0.4)'}}>

        {/* 모달 헤더 — 인쇄 시 숨김 */}
        <div className="no-print" style={{padding:'16px 20px',borderBottom:'1px solid #e0e0e0',
          display:'flex',justifyContent:'space-between',alignItems:'center',
          background:'#f8f9fa',borderRadius:'12px 12px 0 0'}}>
          <div>
            <div style={{fontSize:15,fontWeight:700,color:'#000'}}>
              {mLabel(month)} 임금내역 보고서
            </div>
            <div style={{fontSize:11,color:'#666',marginTop:2}}>세무사 제출용</div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>setShowOwnerConfig(v=>!v)}
              style={{background:'#e8f4fd',border:'1px solid #aac',color:'#336',
                borderRadius:6,padding:'6px 12px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
              내 급여 설정
            </button>
            <button onClick={handlePrint}
              style={{background:'#1a56db',color:'#fff',border:'none',
                borderRadius:6,padding:'6px 14px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              인쇄 / 저장
            </button>
            <button onClick={onClose}
              style={{background:'transparent',border:'1px solid #ccc',color:'#666',
                borderRadius:6,padding:'6px 12px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
              닫기
            </button>
          </div>
        </div>

        {/* 내 급여 설정 — 인쇄 시 숨김 */}
        {showOwnerConfig && (
          <div className="no-print" style={{padding:'14px 20px',background:'#f0f7ff',borderBottom:'1px solid #cce0f5'}}>
            <div style={{fontSize:12,fontWeight:700,color:'#336',marginBottom:10}}>
              정민규 급여 설정 (한 번 적용하면 다음 달부터 자동 적용)
            </div>
            {ownerConfigFrom && ownerConfigFrom !== curMonth && (
              <div style={{fontSize:11,color:'#b45309',marginBottom:10}}>
                {mLabel(ownerConfigFrom)} 설정을 불러왔어요. 금액이 바뀌었으면 수정 후 적용하세요.
              </div>
            )}
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
              {[
                ['주민등록번호','text','ssn'],
                ['급여 (원)','number','salary'],
                ['공제합계 (원)','number','deduction'],
                ['국민연금','number','pension'], ['건강보험','number','health'], ['장기요양','number','care'],
                ['고용보험','number','employ'], ['소득세','number','incomeTax'], ['지방소득세','number','localTax'],
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
            <div style={{fontSize:11,color:'#555',marginTop:6}}>국민연금~지방소득세를 적으면 공제합계는 그 합으로 자동으로 맞춰지고, 원천징수영수증에 항목별로 나와요 (안 적으면 공제합계만 써요)</div>
            <div style={{marginTop:8,display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
              <button type="button" onClick={()=>{
                  if(!(editOwner.salary>0) || !(editOwner.deduction>0)) { setEstNote('급여와 공제합계를 먼저 넣어 주세요'); return }
                  const est = splitDeduction(editOwner.salary, editOwner.deduction)
                  setEditOwner(prev=>({ ...prev, pension:est.pension, health:est.health, care:est.care, employ:est.employ, incomeTax:est.incomeTax, localTax:est.localTax }))
                  setEstNote(est.scaled ? '추정한 4대보험이 공제합계보다 커서 비율대로 줄였어요. 고지서와 맞춰 보고 고친 뒤 적용하세요' : '2026년 요율로 추정해서 채웠어요. 고지서와 다를 수 있으니 확인하고 고친 뒤 적용하세요')
                }}
                style={{background:'#FFFFFF',border:'1px solid #aac',borderRadius:5,padding:'5px 12px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit',color:'#1a56db'}}>
                공제합계로 나눠 보기 (추정)
              </button>
              <span style={{fontSize:11,color: estNote ? '#b45309' : '#888'}}>{estNote || '공제합계만 알면 4대보험(국민연금 4.75%·건강 3.595%·장기요양 13.14%·고용 0.9%)을 추정하고 나머지를 소득세·지방소득세로 나눠 채워요'}</span>
            </div>
            <div style={{marginTop:10,display:'flex',gap:8,alignItems:'center'}}>
              <button onClick={async ()=>{
  const parts = ['pension','health','care','employ','incomeTax','localTax'].reduce((a,k)=>a+(+editOwner[k]||0),0)
  const cfg = parts > 0 ? { ...editOwner, deduction: parts } : editOwner
  setEditOwner(cfg)
  setOwnerConfig(cfg)
  await setDoc(doc(db,'payrollOwner', curMonth), cfg)
  setOwnerConfigFrom(curMonth)
  setShowOwnerConfig(false)
}}
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

        {/* 보고서 본문 — 인쇄 시 이것만 출력 */}
        <div id="tax-report-print" style={{padding:'28px 32px'}}>
          <div style={{textAlign:'center',marginBottom:22}}>
            <div style={{fontSize:17,fontWeight:700,color:'#000',marginBottom:4}}>
              홍콩반점 중앙대점 — {mLabel(month)} 임금내역
            </div>
            <div style={{fontSize:12,color:'#555'}}>근로소득 원천징수 내역서</div>
          </div>

          <table style={{width:'100%',borderCollapse:'collapse',marginBottom:16,tableLayout:'fixed'}}>
            <colgroup>
              <col style={{width:'12%'}}/>
              <col style={{width:'22%'}}/>
              <col style={{width:'22%'}}/>
              <col style={{width:'22%'}}/>
              <col style={{width:'22%'}}/>
            </colgroup>
            <thead>
              <tr style={{background:'#dce6f1'}}>
                {['이름','주민등록번호','급여','원천징수','최종급여'].map((h,i)=>(
                  <th key={h} style={{...tdBase,fontWeight:700,fontSize:12,
                    textAlign: i<=1 ? 'left' : 'right',
                    background:'#dce6f1'}}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allRows.map((row, i) => {
                const rowBg = row.isOwner ? '#fffde7' : row.isSeverance ? '#fff3e0' : (i%2===0?'#fff':'#fafafa')
                return (
                <tr key={i} style={{background: rowBg}}>
                  <td style={{...tdBase,textAlign:'left',fontWeight:600, background: rowBg}}>
                    {row.name}
                  </td>
                  <td style={{...tdBase,textAlign:'left',letterSpacing:0.5, background: rowBg}}>
                    {row.ssn}
                  </td>
                  <td style={{...tdBase,textAlign:'right', background: rowBg}}>
                    {row.salary.toLocaleString()}
                  </td>
                  <td style={{...tdBase,textAlign:'right',color:'#c00', background: rowBg}}>
                    {row.tax > 0
                      ? <>{row.tax.toLocaleString()}{!row.isOwner && <span style={{fontSize:10,color:'#999',marginLeft:4}}>(3.3%)</span>}</>
                      : '—'}
                  </td>
                  <td style={{...tdBase,textAlign:'right',fontWeight:700,color:'#003399',
                    background: row.isOwner?'#e8f4fd':row.isSeverance?'#ffe8cc':(i%2===0?'#f0f8ff':'#e8f4fd')}}>
                    {row.net.toLocaleString()}
                  </td>
                </tr>
              )})}
            </tbody>
            <tfoot>
              <tr style={{background:'#dce6f1'}}>
                <td colSpan={2} style={{...tdBase,textAlign:'center',fontWeight:700,background:'#dce6f1'}}>
                  합 계
                </td>
                <td style={{...tdBase,textAlign:'right',fontWeight:700,background:'#dce6f1'}}>
                  {totalSalary.toLocaleString()}
                </td>
                <td style={{...tdBase,textAlign:'right',fontWeight:700,color:'#c00',background:'#dce6f1'}}>
                  {totalTax.toLocaleString()}
                </td>
                <td style={{...tdBase,textAlign:'right',fontWeight:700,color:'#003399',background:'#dce6f1'}}>
                  {totalNet.toLocaleString()}
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

      <style>{`
        .no-print { }
        @media print {
          /* 화면의 모든 요소 숨기기 */
          body * { visibility: hidden !important; }
          /* 보고서 본문만 표시 */
          #tax-report-print,
          #tax-report-print * { visibility: visible !important; }
          #tax-report-print {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            padding: 20px 28px !important;
            background: white !important;
          }
          /* 표 테두리/배경색 강제 인쇄 */
          table { border-collapse: collapse !important; width: 100% !important; }
          td, th {
            border: 1px solid #999 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
            white-space: nowrap !important;
          }
          /* 페이지 나눔 방지 */
          table { page-break-inside: avoid !important; }
          @page {
            margin: 10mm;
            size: A4 landscape;
          }
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
  const [showMyStatement, setShowMyStatement] = useState(false) // 사장님 본인 임금명세서
  const [showWithholding, setShowWithholding] = useState(false) // 원천징수영수증 (사장님·직원, 연도별)
  const { userData: me } = useAuth()
  const biz = useBizInfo()
  const seal = useSeal()
  const [ownerConfig, setOwnerConfig]     = useState({ ssn:'', salary:0, deduction:0 })
  const [ownerConfigFrom, setOwnerConfigFrom] = useState(null) // 설정을 불러온 월 (이번 달에 없으면 가장 최근 달)
  const [severance, setSeverance]         = useState({}) // {uid:{amount,tax,net,paidDate}}
  const [nameMap, setNameMap]             = useState({}) // uid → name (퇴직자 포함 전체)
  const [severanceInput, setSeveranceInput] = useState({}) // uid → 입력중인 금액

  // 가불 관리
  const [advances, setAdvances]       = useState({}) // {uid: [{id,date,amount,memo}]}
  const [advanceUid, setAdvanceUid]   = useState(null) // 가불 패널 펼친 직원
  const [advanceForm, setAdvanceForm] = useState({ date: todayStr(), amount:'', memo:'' })

  // 상여/보너스 관리
  const [bonuses, setBonuses]       = useState({}) // {uid: [{id,date,amount,memo}]}
  const [bonusUid, setBonusUid]     = useState(null) // 상여 패널 펼친 직원
  const [bonusForm, setBonusForm]   = useState({ date: todayStr(), amount:'', memo:'' })

  const monthOpts=[]
  for(let y=2022;y<=Math.max(2026,new Date().getFullYear());y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  async function load() {
    setLoading(true)
    try {
      const [cy,cm] = curMonth.split('-').map(Number)
      const prev = cm===1?`${cy-1}-12`:`${cy}-${pad(cm-1)}`
      // 한 번에 같이 받기 (예전엔 직원 목록 → 이번 달 자료 → 대타 순서로 세 번 기다렸음)
      const [usersSnap,wh,ex,me,pwh,pex,pme,pr,ownerSnap,sevSnap,advSnap,bonusSnap,subs, privMap] = await Promise.all([
        getDocs(collection(db,'users')),
        getDoc(doc(db,'workhours',curMonth)),
        getDoc(doc(db,'workextra',curMonth)),
        getDoc(doc(db,'workmemos',curMonth)),
        getDoc(doc(db,'workhours',prev)),
        getDoc(doc(db,'workextra',prev)),
        getDoc(doc(db,'workmemos',prev)),
        getDoc(doc(db,'payroll',curMonth)),
        getDocs(collection(db,'payrollOwner')),
        getDoc(doc(db,'severance', curMonth)),
        getDoc(doc(db,'advances', curMonth)),
        getDoc(doc(db,'bonuses', curMonth)),
        loadSubs(),
        loadPrivateMap(),
      ])
      const emps = []
      const ssnData = {}
      const nameData = {}
      usersSnap.forEach(d=>{
        const data=({ ...d.data(), ...(privMap[d.id] || {}) })
        nameData[d.id] = data.name
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
            scheduleHistory:data.scheduleHistory||[],
            payType:data.payType||'hourly', fixedSalary:data.fixedSalary||0, insuranceHistory:data.insuranceHistory||[],
            isRetired, leaveDate:data.leaveDate||null})
        if(data.ssn) ssnData[d.id] = data.ssn
      })
      setEmployees(emps)
      setSsnMap(ssnData)
      setNameMap(nameData)

      setWorkHours(wh.exists()?wh.data():{})
      setWorkExtra(ex.exists()?ex.data():{})
      // 대타 게시판에서 확정된 날은 비고 없이도 주휴 계산에서 대타로 인정
      setMemos(withSubMemos(me.exists()?me.data():{}, subs, curMonth))
      setPrevWorkHours(pwh.exists()?pwh.data():{})
      setPrevWorkExtra(pex.exists()?pex.data():{})
      setPrevMemos(withSubMemos(pme.exists()?pme.data():{}, subs, prev))
      setPayroll(pr.exists()?pr.data():{})
      // 이번 달 설정이 없으면 가장 최근 이전 달 설정을 이어서 사용
      const ownerDoc = ownerSnap.docs.filter(d=>d.id<=curMonth).sort((a,b)=>a.id<b.id?1:-1)[0]
      setOwnerConfig(ownerDoc ? ownerDoc.data() : { ssn:'', salary:0, deduction:0 })
      setOwnerConfigFrom(ownerDoc ? ownerDoc.id : null)
      setSeverance(sevSnap.exists()?sevSnap.data():{})
      setAdvances(advSnap.exists()?advSnap.data():{})
      setBonuses(bonusSnap.exists()?bonusSnap.data():{})
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
    syncPayslipsQuiet(curMonth)   // 직원이 보는 급여 복사본도 맞춤
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

  // ── 퇴직금 지급 처리 ──
  async function saveSeverance(uid) {
    const raw = severanceInput[uid]
    const amount = +String(raw||'').replace(/[^0-9]/g,'') || 0
    if(amount <= 0) return alert('퇴직금 금액을 입력해주세요')
    setSaving(true)
    try {
      const tax = Math.round(amount * 0.033)
      const net = amount - tax
      const newSev = { ...severance, [uid]: { amount, tax, net, paidDate: new Date().toISOString() } }
      await setDoc(doc(db,'severance',curMonth), newSev)
      setSeverance(newSev)
      setSeveranceInput(prev=>({ ...prev, [uid]: '' }))
    } catch(e){ console.error(e) }
    setSaving(false)
  }

  async function deleteSeverance(uid) {
    if(!window.confirm('퇴직금 지급 기록을 삭제하시겠습니까?')) return
    setSaving(true)
    try {
      const newSev = { ...severance }
      delete newSev[uid]
      await setDoc(doc(db,'severance',curMonth), newSev)
      setSeverance(newSev)
    } catch(e){ console.error(e) }
    setSaving(false)
  }

  // ── 가불 관리 ──
  function advanceListOf(uid) {
    return advances[uid] || []
  }
  function advanceTotalOf(uid) {
    return advanceListOf(uid).reduce((a,r)=>a+(r.amount||0),0)
  }
  async function saveAdvances(newAdvances) {
    await setDoc(doc(db,'advances',curMonth), newAdvances)
    setAdvances(newAdvances)
  }
  async function addAdvance(uid) {
    const amount = +String(advanceForm.amount||'').replace(/[^0-9]/g,'') || 0
    if(amount <= 0) return alert('가불 금액을 입력해주세요')
    if(!advanceForm.date) return alert('날짜를 입력해주세요')
    setSaving(true)
    try {
      const newRec = { id: Date.now().toString(), date: advanceForm.date, amount, memo: advanceForm.memo||'' }
      const newList = [...advanceListOf(uid), newRec].sort((a,b)=>a.date>b.date?1:-1)
      const newAdvances = { ...advances, [uid]: newList }
      await saveAdvances(newAdvances)
      setAdvanceForm({ date: todayStr(), amount:'', memo:'' })
    } catch(e){ console.error(e) }
    setSaving(false)
  }
  async function deleteAdvance(uid, id) {
    const rec = advanceListOf(uid).find(r=>r.id===id)
    if(!window.confirm(rec?.carryFrom
      ? `${mLabel(rec.carryFrom)}에서 넘어온 초과 가불이에요. 삭제하면 ${mLabel(rec.carryFrom)} 급여가 다시 마이너스로 보여요. 삭제할까요?`
      : '이 가불 기록을 삭제하시겠습니까?')) return
    setSaving(true)
    try {
      if(rec?.carryFrom) {
        // 넘어온 초과 가불: 원래 달의 '넘김'을 0으로 (이 기록도 같이 지워짐), 이 달이 또 넘긴 게 있으면 그만큼 줄임
        await setCarry(uid, rec.carryFrom, 0)
        await chainCarry(uid, curMonth, -(rec.amount||0))
        await load()
      } else {
        const newList = advanceListOf(uid).filter(r=>r.id!==id)
        await saveAdvances({ ...advances, [uid]: newList })
      }
    } catch(e){ console.error(e) }
    setSaving(false)
  }

  // ── 가불이 급여보다 많을 때: 넘친 금액을 다음 달 가불로 넘김 ──
  // 이번 달 payroll[uid].carriedOut 에 넘긴 금액, 다음 달 advances 에 { id:'carry-<이번 달>', carryFrom } 가불 기록
  async function carryOver(emp, extra) {
    const next = nextYm(curMonth)
    if(!window.confirm(`${emp.name}: 가불이 급여보다 ${extra.toLocaleString()}원 많아요.\n이 금액을 ${mLabel(next)} 가불로 넘겨서 ${mLabel(next)} 급여에서 빼고, ${mLabel(curMonth)} 급여는 0원으로 끝낼까요?`)) return
    setSaving(true)
    try {
      const ps = await getDoc(doc(db,'payroll',curMonth))
      const cur = (ps.exists() ? ps.data()[emp.uid]?.carriedOut : 0) || 0
      // 이미 넘긴 게 있으면 더해서 넘김 (예: 지난달 초과분이 뒤늦게 이 달로 넘어온 경우)
      await setCarry(emp.uid, curMonth, cur + extra)
      // 다음 달도 이미 그다음 달로 넘겼다면 늘어난 만큼 계속 넘김
      await chainCarry(emp.uid, next, extra)
      await load()
    } catch(e){ console.error(e); alert('저장 중 오류가 발생했어요. 다시 시도해 주세요.') }
    setSaving(false)
  }
  async function undoCarry(emp) {
    const next = nextYm(curMonth)
    if(!window.confirm(`${mLabel(next)}로 넘긴 초과 가불을 되돌릴까요?`)) return
    setSaving(true)
    try {
      const ps = await getDoc(doc(db,'payroll',curMonth))
      const cur = (ps.exists() ? ps.data()[emp.uid]?.carriedOut : 0) || 0
      await setCarry(emp.uid, curMonth, 0)
      await chainCarry(emp.uid, next, -cur)
      await load()
    } catch(e){ console.error(e); alert('저장 중 오류가 발생했어요. 다시 시도해 주세요.') }
    setSaving(false)
  }

  // 직원 한 명의 이달 돈 계산 (카드와 위 요약이 같은 값을 씀)
  //   finalPay : 세후 급여(+상여) − 가불      carriedOut: 다음 달로 넘긴 초과 가불
  //   remain   : 아직 줄 돈 (finalPay + carriedOut, 0 미만이면 아직 안 넘긴 초과 가불)
  //   advPaid  : 이 달에 실제로 내보낸 가불 (지난달에서 넘어온 기록은 지난달에 이미 준 돈이라 뺌)
  function payOf(emp) {
    const p = payroll[emp.uid]
    const display = p?.confirmedByOwner ? p : getComputed(emp)
    const advTotal = advanceTotalOf(emp.uid)
    const advPaid = advanceListOf(emp.uid).filter(r=>!r.carryFrom).reduce((a,r)=>a+(r.amount||0),0)
    const bonusTotal = bonusTotalOf(emp.uid)
    const grossWithBonus = (display.totalPay||0) + bonusTotal
    const deductionWithBonus = bonusTotal>0 ? calcDeduction(grossWithBonus, emp.employType||'part', insuranceFor(emp.insuranceHistory, curMonth)) : display.deduction
    const netWithBonus = grossWithBonus - (deductionWithBonus?.total||0)
    const finalPay = (bonusTotal>0 ? netWithBonus : (display.netPay||display.totalPay||0)) - advTotal
    const carriedOut = p?.carriedOut || 0
    const remain = finalPay + carriedOut
    const paid = getStatus(emp.uid)==='paid'
    return { display, advTotal, advPaid, bonusTotal, deductionWithBonus, finalPay, carriedOut, remain, paid,
      net: finalPay + advTotal, carryIn: advTotal - advPaid,
      paidOut: advPaid + (paid ? Math.max(remain,0) : 0),
      unpaid: paid ? 0 : Math.max(remain,0),
      over: Math.max(-remain,0) }
  }

  // ── 상여/보너스 관리 (세금 부과 대상 — 세전 급여에 합산 후 원천징수 재계산) ──
  function bonusListOf(uid) {
    return bonuses[uid] || []
  }
  function bonusTotalOf(uid) {
    return bonusListOf(uid).reduce((a,r)=>a+(r.amount||0),0)
  }
  async function saveBonuses(newBonuses) {
    await setDoc(doc(db,'bonuses',curMonth), newBonuses)
    syncPayslipsQuiet(curMonth)   // 직원이 보는 급여 복사본도 맞춤
    setBonuses(newBonuses)
  }
  async function addBonus(uid) {
    const amount = +String(bonusForm.amount||'').replace(/[^0-9]/g,'') || 0
    if(amount <= 0) return alert('상여 금액을 입력해주세요')
    if(!bonusForm.date) return alert('날짜를 입력해주세요')
    setSaving(true)
    try {
      const newRec = { id: Date.now().toString(), date: bonusForm.date, amount, memo: bonusForm.memo||'' }
      const newList = [...bonusListOf(uid), newRec].sort((a,b)=>a.date>b.date?1:-1)
      const newBonuses = { ...bonuses, [uid]: newList }
      await saveBonuses(newBonuses)
      setBonusForm({ date: todayStr(), amount:'', memo:'' })
    } catch(e){ console.error(e) }
    setSaving(false)
  }
  async function deleteBonus(uid, id) {
    if(!window.confirm('이 상여 기록을 삭제하시겠습니까?')) return
    setSaving(true)
    try {
      const newList = bonusListOf(uid).filter(r=>r.id!==id)
      const newBonuses = { ...bonuses, [uid]: newList }
      await saveBonuses(newBonuses)
    } catch(e){ console.error(e) }
    setSaving(false)
  }

  const inquiryCount = employees.filter(e=>getStatus(e.uid)==='inquiry').length
  const paidCount    = employees.filter(e=>getStatus(e.uid)==='paid').length
  const pays = employees.map(payOf)
  const paidOutTotal = pays.reduce((a,x)=>a+x.paidOut,0)
  const unpaidTotal  = pays.reduce((a,x)=>a+x.unpaid,0)
  const overTotal    = pays.reduce((a,x)=>a+x.over,0)
  const carriedTotal = pays.reduce((a,x)=>a+x.carriedOut,0)
  const netTotal     = pays.reduce((a,x)=>a+x.net,0)
  const carryInTotal = pays.reduce((a,x)=>a+x.carryIn,0)
  const severanceTotal = Object.values(severance).reduce((a,s)=>a+s.net,0)
  const bonusGrandTotal = Object.values(bonuses).reduce((a,list)=>a+(list||[]).reduce((b,r)=>b+(r.amount||0),0),0)

  return (
    <AstryxPage>
    <VStack gap={4}>
      <PageHeader title="급여관리" sub={`${mLabel(curMonth)} — 사장 전용`} right={<>
        {inquiryCount>0 && <Badge variant="error" label={`문의 ${inquiryCount}건`}/>}
        <Button size="sm" label="세무 보고서" onClick={()=>setShowTaxReport(true)}/>
        <Button size="sm" label="내 임금명세서" onClick={()=>setShowMyStatement(true)}/>
        <Button size="sm" label="원천징수영수증" onClick={()=>setShowWithholding(true)}/>
        <Button size="sm" variant="primary" label="전체 급여 확정" isLoading={saving} onClick={confirmAll}/>
        <Selector label="달 고르기" isLabelHidden size="sm" value={curMonth} onChange={v => v && setCurMonth(v)} options={monthOpts.map(m => ({ value:m, label:mLabel(m) }))}/>
      </>}/>

      {/* 이달 인건비 요약 (장부) */}
      {(()=>{
        const unpaidN = pays.filter(x=>x.unpaid>0).length
        return (
          <LedgerCard title="이달 인건비" right={<Text type="supporting" color="secondary">{bonusGrandTotal>0 ? `세후, 상여 ${bonusGrandTotal.toLocaleString()} 포함` : '세후'}</Text>}>
            <Ledger rows={<>
              <LedgerRow label="지급한 돈" note={`이달 가불 포함 · ${paidCount}명 지급 완료`} value={paidOutTotal}/>
              <LedgerRow label="아직 줄 돈" note={unpaidN ? `${unpaidN}명` : '없음'} value={unpaidTotal} tone={unpaidTotal ? 'accent' : undefined}/>
              {carryInTotal>0 && <LedgerRow label="지난달에 미리 준 돈" note="지난달 초과 가불" value={carryInTotal} sub/>}
              {carriedTotal>0 && <LedgerRow label="다음 달로 넘긴 가불" note="다음 달 급여에서 뺌" value={-carriedTotal} sub/>}
              {overTotal>0 && <LedgerRow label="급여보다 많이 준 가불" note="아래에서 다음 달로 넘겨주세요" value={-overTotal} tone="bad"/>}
            </>} total={<LedgerRow label="이달 인건비" value={netTotal} strong/>}/>
            {severanceTotal>0 && <LedgerRow label="퇴직금 지급" note="인건비와 별도" value={severanceTotal}/>}
          </LedgerCard>
        )
      })()}

      {loading ? <Text color="secondary">불러오는 중...</Text> : (
        <VStack gap={3}>
          {employees.map(emp=>{
            const status  = getStatus(emp.uid)
            const p       = payroll[emp.uid]
            const st      = STATUS[status]
            const hasInquiry = p?.inquiry && !p.inquiry.resolved
            const isOpen  = activeUid === emp.uid
            // 상여는 과세 대상 — 세전 급여에 합산 후 원천징수 재계산 (payOf)
            const { display, advTotal, bonusTotal, deductionWithBonus, carriedOut, remain } = payOf(emp)
            const carryIn = advanceListOf(emp.uid).filter(r=>r.carryFrom).reduce((a,r)=>a+(r.amount||0),0)
            const isAdvanceOpen = advanceUid === emp.uid
            const isBonusOpen = bonusUid === emp.uid
            const badgeOf = { unconfirmed:'neutral', confirmed:'warning', checked:'success', inquiry:'error', paid:'info' }

            return (
              <Card key={emp.uid}>
                <VStack gap={3}>
                <HStack hAlign="between" vAlign="start" gap={3} wrap="wrap">
                  <VStack gap={2}>
                    <HStack gap={2} vAlign="center" wrap="wrap">
                      <Heading level={4}>{emp.name}</Heading>
                      {emp.isRetired && <Badge label={`퇴직 ${emp.leaveDate?.slice(0,10) || ''}`}/>}
                      <Badge variant={badgeOf[status]} label={st.label}/>
                    </HStack>
                    <HStack gap={2} wrap="wrap">
                      {hasInquiry && <Button size="sm" variant="destructive" label={`문의 ${isOpen ? '닫기' : '확인'}`} onClick={()=>{ setActiveUid(isOpen?null:emp.uid); setReplyText('') }}/>}
                      <Button size="sm" label={`가불${advTotal>0 ? ` ${advTotal.toLocaleString()}원` : ''}${isAdvanceOpen ? ' 닫기' : ''}`} onClick={()=>{ setAdvanceUid(isAdvanceOpen?null:emp.uid); setAdvanceForm({date:todayStr(),amount:'',memo:''}) }}/>
                      <Button size="sm" label={`상여${bonusTotal>0 ? ` ${bonusTotal.toLocaleString()}원` : ''}${isBonusOpen ? ' 닫기' : ''}`} onClick={()=>{ setBonusUid(isBonusOpen?null:emp.uid); setBonusForm({date:todayStr(),amount:'',memo:''}) }}/>
                    </HStack>
                  </VStack>
                  <HStack gap={3} vAlign="center" wrap="wrap">
                    <VStack gap={0} hAlign="end">
                      {display.isFixed
                        ? <Text type="supporting" weight="semibold">고정급 직원</Text>
                        : <>
                            <Text type="supporting" color="secondary" hasTabularNumbers>{display.totalHours}h {display.totalMins>0?display.totalMins+'m':''} · 시급 {(display.wage||10030).toLocaleString()}원</Text>
                            <Text type="supporting" color="secondary" hasTabularNumbers>기본 {(display.basePay||0).toLocaleString()} + 주휴 {(display.weeklyHoliday||0).toLocaleString()}</Text>
                          </>}
                      <Text type="supporting" color="secondary" hasTabularNumbers>세전 {(display.totalPay||0).toLocaleString()}원{(display.deduction?.total||0)>0 ? ` · 공제 −${(display.deduction?.total||0).toLocaleString()}원` : ''}</Text>
                      {bonusTotal>0 && <Text type="supporting" color="secondary" hasTabularNumbers>상여 +{bonusTotal.toLocaleString()}원 (세금 −{(deductionWithBonus?.total||0).toLocaleString()}원)</Text>}
                      {advTotal>0 && <Text type="supporting" color="accent" hasTabularNumbers>가불 차감 −{advTotal.toLocaleString()}원{carryIn>0 ? ` (지난달에서 넘어온 ${carryIn.toLocaleString()}원 포함)` : ''}</Text>}
                      {carriedOut>0 && <HStack gap={1} vAlign="center"><Text type="supporting" color="secondary" hasTabularNumbers>초과 가불 {carriedOut.toLocaleString()}원 → {mLabel(p?.carriedTo||nextYm(curMonth))}로 넘김</Text><Button size="sm" variant="ghost" label="되돌리기" isDisabled={saving} onClick={()=>undoCarry(emp)}/></HStack>}
                      <Text type="large" weight="bold" color={remain<0 ? 'accent' : 'primary'} hasTabularNumbers>{advTotal>0 || bonusTotal>0 ? '최종 지급' : '실수령'} {remain.toLocaleString()}원</Text>
                      {remain<0 && <VStack gap={1} hAlign="end">
                        <Text type="supporting" color="accent">가불이 급여보다 {(-remain).toLocaleString()}원 많아요</Text>
                        <Button size="sm" variant="destructive" label={`${mLabel(nextYm(curMonth)).slice(6)} 급여에서 빼기`} isDisabled={saving} onClick={()=>carryOver(emp, -remain)}/>
                      </VStack>}
                    </VStack>
                    <VStack gap={1} hAlign="end">
                      {status==='unconfirmed' && <Button variant="primary" label="급여 확정" isDisabled={saving} onClick={()=>confirmOne(emp.uid)}/>}
                      {(status==='confirmed' || status==='inquiry') && <Button size="sm" label="재확정" isDisabled={saving} onClick={()=>confirmOne(emp.uid)}/>}
                      {(status==='confirmed' || status==='inquiry') && <Button size="sm" variant="ghost" label="강제 지급" isDisabled={saving} onClick={()=>markPaid(emp.uid)}/>}
                      {status==='checked' && <Button variant="primary" label="지급 완료" isDisabled={saving} onClick={()=>markPaid(emp.uid)}/>}
                      {status==='paid' && <Text type="supporting" color="secondary" hasTabularNumbers>{p.paidAt?.slice(0,10)} 지급</Text>}
                    </VStack>
                  </HStack>
                </HStack>

                {/* 가불 관리 */}
                {isAdvanceOpen && (
                  <Card variant="muted" padding={3}>
                    <VStack gap={2}>
                      <Heading level={5}>{emp.name} 가불 내역</Heading>
                      {advanceListOf(emp.uid).length > 0 && (
                        <List hasDividers edge="flush">
                          {advanceListOf(emp.uid).map(r=>(
                            <ListItem key={r.id} label={<Text weight="bold" hasTabularNumbers>{r.amount.toLocaleString()}원</Text>}
                              description={<Text type="supporting" color="secondary" hasTabularNumbers>{r.date} · {r.memo||'—'}{r.carryFrom && ' (지난달에 이미 준 돈)'}</Text>}
                              endContent={<Button size="sm" variant="ghost" label="삭제" onClick={()=>deleteAdvance(emp.uid, r.id)}/>}/>
                          ))}
                        </List>
                      )}
                      {advanceListOf(emp.uid).length > 0 && <LedgerRow label="이번달 가불 합계" value={advTotal} strong/>}
                      <HStack gap={2} vAlign="end" wrap="wrap">
                        <DateInput label="날짜" value={advanceForm.date} onChange={v=>setAdvanceForm(f=>({...f,date:v||''}))}/>
                        <TextInput label="가불 금액" inputMode="numeric" width={140} value={advanceForm.amount ? (+advanceForm.amount).toLocaleString('ko-KR') : ''} onChange={v=>setAdvanceForm(f=>({...f,amount:v.replace(/[^0-9]/g,'')}))}/>
                        <TextInput label="메모" isOptional value={advanceForm.memo} onChange={v=>setAdvanceForm(f=>({...f,memo:v}))}/>
                        <Button variant="primary" label="+ 가불 추가" isDisabled={saving} onClick={()=>addAdvance(emp.uid)}/>
                      </HStack>
                    </VStack>
                  </Card>
                )}

                {/* 상여·보너스 */}
                {isBonusOpen && (
                  <Card variant="muted" padding={3}>
                    <VStack gap={2}>
                      <Heading level={5}>{emp.name} 상여·보너스 내역</Heading>
                      {bonusListOf(emp.uid).length > 0 && (
                        <List hasDividers edge="flush">
                          {bonusListOf(emp.uid).map(r=>(
                            <ListItem key={r.id} label={<Text weight="bold" hasTabularNumbers>{r.amount.toLocaleString()}원</Text>}
                              description={<Text type="supporting" color="secondary" hasTabularNumbers>{r.date} · {r.memo||'—'}</Text>}
                              endContent={<Button size="sm" variant="ghost" label="삭제" onClick={()=>deleteBonus(emp.uid, r.id)}/>}/>
                          ))}
                        </List>
                      )}
                      {bonusListOf(emp.uid).length > 0 && <LedgerRow label="이번달 상여 합계" value={bonusTotal} strong/>}
                      <HStack gap={2} vAlign="end" wrap="wrap">
                        <DateInput label="날짜" value={bonusForm.date} onChange={v=>setBonusForm(f=>({...f,date:v||''}))}/>
                        <TextInput label="상여 금액" inputMode="numeric" width={140} value={bonusForm.amount ? (+bonusForm.amount).toLocaleString('ko-KR') : ''} onChange={v=>setBonusForm(f=>({...f,amount:v.replace(/[^0-9]/g,'')}))}/>
                        <TextInput label="사유" placeholder="예: 추석 보너스" value={bonusForm.memo} onChange={v=>setBonusForm(f=>({...f,memo:v}))}/>
                        <Button variant="primary" label="+ 상여 추가" isDisabled={saving} onClick={()=>addBonus(emp.uid)}/>
                      </HStack>
                      <Text type="supporting" color="secondary">상여는 세전 급여에 합산되어 원천징수(3.3% 또는 4대보험)가 다시 계산돼요.</Text>
                    </VStack>
                  </Card>
                )}

                {/* 퇴직금 처리 (퇴직자 전용) */}
                {emp.isRetired && (
                  <Card variant="muted" padding={3}>
                    {severance[emp.uid] ? (
                      <HStack gap={3} vAlign="center" hAlign="between" wrap="wrap">
                        <HStack gap={2} vAlign="center"><Badge variant="success" label="퇴직금 지급완료"/><Text type="supporting" color="secondary" hasTabularNumbers>{severance[emp.uid].paidDate?.slice(0,10)}</Text></HStack>
                        <HStack gap={3} vAlign="center" wrap="wrap">
                          <Text type="supporting" color="secondary" hasTabularNumbers>지급액 {severance[emp.uid].amount.toLocaleString()}원 · 원천징수(3.3%) −{severance[emp.uid].tax.toLocaleString()}원</Text>
                          <Text weight="bold" hasTabularNumbers>최종 {severance[emp.uid].net.toLocaleString()}원</Text>
                          <Button size="sm" variant="ghost" label="취소" onClick={()=>deleteSeverance(emp.uid)}/>
                        </HStack>
                      </HStack>
                    ) : (
                      <HStack gap={2} vAlign="end" wrap="wrap">
                        <TextInput label="퇴직금 지급 처리" placeholder="퇴직금 총액" inputMode="numeric" width={180}
                          value={severanceInput[emp.uid] ? (+severanceInput[emp.uid]).toLocaleString('ko-KR') : ''}
                          onChange={v=>setSeveranceInput(prev=>({...prev,[emp.uid]:v.replace(/[^0-9]/g,'')}))}/>
                        <Button variant="primary" label="지급 기록" isDisabled={saving} onClick={()=>saveSeverance(emp.uid)}/>
                        {(+severanceInput[emp.uid]||0) > 0 && (
                          <Text type="supporting" color="secondary" hasTabularNumbers>3.3% 제외 → 최종 {Math.round((+severanceInput[emp.uid])*(1-0.033)).toLocaleString()}원</Text>
                        )}
                      </HStack>
                    )}
                  </Card>
                )}

                {/* 직원 문의 */}
                {isOpen && p?.inquiry && (
                  <Card variant="muted" padding={3}>
                    <VStack gap={3}>
                      <Heading level={5}>직원 문의 내용</Heading>
                      <VStack gap={1}>
                        <Text type="supporting" color="secondary">{emp.name} · {p.inquiry.createdAt?.slice(0,10)}</Text>
                        <Card padding={3}><Text>{p.inquiry.message}</Text></Card>
                      </VStack>
                      {p.inquiry.ownerReply && (
                        <VStack gap={1}>
                          <Text type="supporting" color="secondary">사장님 답변 · {p.inquiry.repliedAt?.slice(0,10)}</Text>
                          <Card padding={3}><Text>{p.inquiry.ownerReply}</Text></Card>
                        </VStack>
                      )}
                      {!p.inquiry.ownerReply && (
                        <HStack gap={2} vAlign="end">
                          <TextInput label="답변" isLabelHidden placeholder="답변을 입력하고 Enter..." value={replyText} onChange={v=>setReplyText(v)}
                            onKeyDown={e=>e.key==='Enter'&&sendReply(emp.uid)}/>
                          <Button variant="primary" label="전송" isDisabled={saving} onClick={()=>sendReply(emp.uid)}/>
                        </HStack>
                      )}
                      {p.inquiry.ownerReply && (
                        <HStack gap={2} wrap="wrap">
                          <Button label="문의 해결 완료" isDisabled={saving} onClick={()=>resolveInquiry(emp.uid)}/>
                          <Button variant="primary" label="지급 완료 처리" isDisabled={saving} onClick={()=>markPaid(emp.uid)}/>
                        </HStack>
                      )}
                    </VStack>
                  </Card>
                )}
                </VStack>
              </Card>
            )
          })}
          {employees.length===0 && <EmptyState title="승인된 직원이 없습니다" isCompact/>}
        </VStack>
      )}

      <Legacy>
      {/* 세무 보고서 모달 */}
      {/* 사장님 본인 임금명세서: 세무 보고서의 '급여 설정'(payrollOwner, 다음 달로 이어짐)으로 이 달 명세서 */}
      {showMyStatement && (
        <div onClick={()=>setShowMyStatement(false)} style={{position:'fixed', inset:0, background:'rgba(29,27,24,.45)', zIndex:1000, overflowY:'auto', padding:'24px 12px'}}>
          <style>{STATEMENT_PRINT_CSS}</style>
          <div onClick={e=>e.stopPropagation()} style={{maxWidth:560, margin:'0 auto', background:'#FAF9F6', color:'#1D1B18', borderRadius:6, padding:'14px 16px'}}>
            <div className="ws-noprint" style={{display:'flex', alignItems:'center', gap:8, marginBottom:6}}>
              <b style={{fontSize:15}}>내 임금명세서 · {mLabel(curMonth)}</b>
              <span style={{flex:1}}/>
              <button type="button" onClick={()=>setShowMyStatement(false)} style={{fontFamily:'inherit', fontSize:13, padding:'5px 12px', borderRadius:4, border:'1px solid #DCD7CE', background:'#FFFFFF', cursor:'pointer'}}>닫기</button>
            </div>
            {(ownerConfig.salary || 0) > 0 ? (
              <Statement
                r={{ ym: curMonth, days: null, bonuses: [],
                  p: { isFixed:true, basePay:ownerConfig.salary, totalPay:ownerConfig.salary, netPay:ownerConfig.salary - (ownerConfig.deduction||0),
                    deduction:{ total: ownerConfig.deduction || 0, pension:+ownerConfig.pension||0, health:+ownerConfig.health||0, care:+ownerConfig.care||0,
                      employ:+ownerConfig.employ||0, incomeTax:+ownerConfig.incomeTax||0, localTax:+ownerConfig.localTax||0 }, paid:true } }}
                userData={{ name: '정민규', joinDate: me?.joinDate }} ssn={ownerConfig.ssn || ''} biz={biz} seal={seal}/>
            ) : (
              <div style={{fontSize:13, color:'#6E6A63', padding:'16px 0', lineHeight:1.7}}>
                {mLabel(curMonth)}에 적용된 급여 설정이 없어요. 세무 보고서 → 정민규 급여 설정에서 급여·공제를 넣고 적용하면 여기에 명세서가 나와요.
              </div>
            )}
            <div className="ws-noprint" style={{fontSize:12, color:'#6E6A63', marginTop:6, lineHeight:1.6}}>
              세무 보고서의 '정민규 급여 설정' 값으로 만들어요{ownerConfigFrom && ownerConfigFrom !== curMonth ? ` (${mLabel(ownerConfigFrom)}에 적용한 값이 이어진 것)` : ''}. 다른 달은 위에서 달을 바꾸고 다시 열어 주세요.
            </div>
          </div>
        </div>
      )}
      {showWithholding && <WithholdingReceipt defaultYear={curMonth.slice(0,4)} onClose={()=>setShowWithholding(false)}/>}
      {showTaxReport && (
        <TaxReportModal
  month={curMonth}
  curMonth={curMonth}
          employees={employees}
          payroll={payroll}
          getComputed={getComputed}
          ssnMap={ssnMap}
          ownerConfig={ownerConfig}
setOwnerConfig={setOwnerConfig}
          ownerConfigFrom={ownerConfigFrom}
          setOwnerConfigFrom={setOwnerConfigFrom}
          severance={severance}
          nameMap={nameMap}
          bonuses={bonuses}
          onClose={()=>setShowTaxReport(false)}
        />
      )}
      </Legacy>
    </VStack>
    </AstryxPage>
  )
}
