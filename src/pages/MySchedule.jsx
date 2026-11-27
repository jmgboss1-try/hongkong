import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, collection, query, where, getDocs } from 'firebase/firestore'
import { useAuth, GradeBadge } from '../AuthContext'
import MyAttendance from '../components/MyAttendance'
import MyRewardSpin from '../components/MyRewardSpin'
import AvatarEditor from '../components/AvatarEditor'
import { loadMyPayslip, loadMyPrivate, writeMyPayFields } from '../lib/privateInfo'
import { calcDeduction, insuranceFor } from '../lib/payDeduction'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Selector } from '@astryxdesign/core/Selector'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { AstryxPage, Legacy, PageHeader, LedgerCard, Ledger, LedgerRow } from '../astryx/AstryxPage'

const pad = n => String(n).padStart(2,'0')
const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const DAYS_KR = ['일','월','화','수','목','금','토']

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
const [insHistory, setInsHistory] = useState([])   // 4대보험 고지 금액 이력 (내 개인 문서)
  const [payroll, setPayroll] = useState(null)
  const [loading, setLoading] = useState(true)

  const now = new Date()
  const curYM = `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  const isThisMonth = curMonth === curYM

  const monthOpts = []
  for(let y=2022;y<=Math.max(2026,new Date().getFullYear());y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  useEffect(()=>{
    async function load() {
      setLoading(true)
      try {
        // 시급·근무시간·추가근무·매장 일정·급여 확인을 한 번에 같이 불러옴
        const [userSnap, whSnap, exSnap, evSnap, mine, priv] = await Promise.all([
          getDoc(doc(db,'users',user.uid)),
          getDoc(doc(db,'workhours',curMonth)),
          getDoc(doc(db,'workextra',curMonth)),
          getDoc(doc(db,'events',curMonth)),
          loadMyPayslip(user.uid, curMonth),
          loadMyPrivate(user.uid, userData),
        ])
        if(userSnap.exists()) {
          setWage(priv.wage||10030)
          setInsHistory(priv.insuranceHistory||[])
          setEmployType(userSnap.data().employType||'part')
        }
        setWorkHours((whSnap.exists() ? whSnap.data() : {})[user.uid] || {})
        setWorkExtra((exSnap.exists() ? exSnap.data() : {})[user.uid] || {})
        setEvents(evSnap.exists() ? evSnap.data() : {})
        setPayroll(mine.pay)

      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  },[curMonth, user.uid]) // eslint-disable-line react-hooks/exhaustive-deps

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
  const deduction = calcDeduction(totalPay, employType, insuranceFor(insHistory, curMonth))
  const netPay = totalPay - deduction.total

  async function checkPayroll() {
    if(!payroll?.confirmedByOwner) return
    try {
      await writeMyPayFields(user.uid, curMonth, { checkedByEmp:true, checkedAt:new Date().toISOString() })
      setPayroll(p=>({...p, checkedByEmp:true}))
      alert('급여 내역을 확인했습니다!')
    } catch(e) { console.error(e) }
  }

  async function sendInquiry(msg) {
    if(!msg.trim()) return
    try {
      const inquiry = { message:msg.trim(), createdAt:new Date().toISOString(), resolved:false }
      await writeMyPayFields(user.uid, curMonth, { inquiry })
      setPayroll(p=>({...p, inquiry}))
      alert('문의가 전송됐습니다!')
    } catch(e) { console.error(e) }
  }

  const askInquiry = () => { const msg = window.prompt('문의 내용을 입력해주세요'); if (msg) sendInquiry(msg) }
  const calCells = (() => { const c = []; for (let i=0;i<firstDow;i++) c.push(null); for (let d=1; d<=days; d++) c.push(d); while (c.length % 7) c.push(null); return c })()

  return (
    <AstryxPage>
    <VStack gap={4}>
      {/* 지난달 개근이면 포상 룰렛 (사장님이 열었을 때) · 우리 매장 화면에 나오는 내 캐릭터 */}
      <MyRewardSpin uid={user.uid} name={userData?.name || ''}/>
      <AvatarEditor uid={user.uid} userData={userData}/>

      <PageHeader title="내 스케쥴" sub={userData?.name}
        right={<Selector label="달 고르기" isLabelHidden size="sm" value={curMonth} onChange={v => v && setCurMonth(v)} options={monthOpts.map(m => ({ value:m, label:mLabel(m) }))}/>}/>

      <HStack gap={2} vAlign="center" wrap="wrap">
        <Legacy><GradeBadge joinDate={userData?.joinDate} size={10}/></Legacy>
        <Badge label={`${wage.toLocaleString()}원/h`}/>
      </HStack>

      {/* 요약 */}
      <Grid columns={{ minWidth: 150, max: 4, repeat: 'fit' }} gap={3}>
        {[
          ['근무일수', `${workDays.length}일`],
          ['총 근무시간', `${totalHours}h`],
          ['기본급', `${totalWage.toLocaleString()}원`],
          ['주휴수당', `${weeklyHoliday.toLocaleString()}원`],
        ].map(([label, val]) => (
          <Card key={label} padding={4}>
            <VStack gap={1}>
              <Text type="label" color="secondary">{label}</Text>
              <Text type="large" weight="bold" hasTabularNumbers>{val}</Text>
            </VStack>
          </Card>
        ))}
      </Grid>

      {/* 이번달 예상 급여 */}
      <LedgerCard title="이번달 예상 급여">
        <Ledger rows={<>
          <LedgerRow label="세전 총액" note={`기본급 ${totalWage.toLocaleString()} + 주휴수당 ${weeklyHoliday.toLocaleString()}`} value={totalPay}/>
          {deduction.total > 0 && <LedgerRow label={`공제 (${employType==='part'?'3.3% 원천징수':'4대보험'})`} value={deduction.total} minus/>}
        </>} total={<LedgerRow label="실수령액" value={netPay} strong/>}/>
      </LedgerCard>

      {/* NFC 출퇴근: 지각·조퇴·결근 (인정 시간은 안 보여 줌) */}
      <MyAttendance curMonth={curMonth} uid={user.uid}/>

      {/* 급여 확인 */}
      {payroll?.confirmedByOwner && (
        <LedgerCard title={`${mLabel(curMonth)} 확정 급여`} right={payroll.checkedByEmp ? <Badge variant="success" label="확인 완료"/> : payroll.inquiry && !payroll.inquiry.resolved ? <Badge variant="warning" label="문의 중"/> : null}>
          <Ledger rows={<>
            <LedgerRow label="세전" note={`기본급 ${(payroll.basePay||0).toLocaleString()} + 주휴 ${(payroll.weeklyHoliday||0).toLocaleString()}`} value={payroll.totalPay||0}/>
            {(payroll.deduction?.total||0) > 0 && <LedgerRow label="공제" value={payroll.deduction.total} minus/>}
          </>} total={<LedgerRow label="실수령" value={payroll.netPay||payroll.totalPay||0} strong/>}/>
          {payroll.inquiry?.ownerReply && !payroll.inquiry.resolved && (
            <Card variant="muted" padding={3}><Text>사장님 답변: {payroll.inquiry.ownerReply}</Text></Card>
          )}
          {!payroll.checkedByEmp && (!payroll.inquiry || payroll.inquiry.resolved) && (
            <HStack gap={2}>
              <Button variant="primary" label="급여 확인" onClick={checkPayroll}/>
              {!payroll.inquiry && <Button label="문의하기" onClick={askInquiry}/>}
            </HStack>
          )}
        </LedgerCard>
      )}

      {loading ? <Text color="secondary">불러오는 중...</Text> : <>
        {/* 근무 달력: 날짜별 시간·일급은 안 보여 주고 근무한 날인지만 */}
        <LedgerCard title={`${mLabel(curMonth)} 근무 달력`}>
          <Grid columns={7} gap={1}>
            {DAYS_KR.map((d, i) => <Text key={d} type="supporting" weight="bold" color={i === 0 ? 'accent' : 'secondary'} justify="center">{d}</Text>)}
            {calCells.map((d, idx) => {
              if (!d) return <span key={idx}/>
              const dd = pad(d), isToday = isThisMonth && d === now.getDate()
              const worked = (workHours[dd]||0) > 0 || (workExtra[dd]||0) > 0
              return (
                <Card key={idx} variant={isToday ? 'red' : worked ? 'default' : 'muted'} padding={1.5}>
                  <VStack gap={0.5} minHeight={56}>
                    <Text type="supporting" weight="bold" color={isToday ? 'inherit' : idx % 7 === 0 ? 'accent' : 'secondary'} hasTabularNumbers>{d}</Text>
                    {events[dd] && <Text type="supporting" color={isToday ? 'inherit' : 'accent'} maxLines={2}>{events[dd]}</Text>}
                    <Text type="supporting" weight={worked ? 'bold' : undefined} color={isToday ? 'inherit' : worked ? 'primary' : 'disabled'} justify="center">{worked ? '근무' : '휴무'}</Text>
                  </VStack>
                </Card>
              )
            })}
          </Grid>
        </LedgerCard>
        {workDays.length === 0 && <EmptyState title={`${mLabel(curMonth)}에 입력된 근무 일정이 없습니다`} isCompact/>}
      </>}
    </VStack>
    </AstryxPage>
  )
}
