import { useEffect, useState } from 'react'
import { loadMyPayslip, writeMyPayFields } from '../lib/privateInfo'
import { useAuth } from '../AuthContext'
import WageStatements from '../components/WageStatements'
import MyContracts from '../components/MyContracts'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Selector } from '@astryxdesign/core/Selector'
import { TextArea } from '@astryxdesign/core/TextArea'
import { List, ListItem } from '@astryxdesign/core/List'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { AstryxPage, Legacy, PageHeader, LedgerCard } from '../astryx/AstryxPage'

const pad = n => String(n).padStart(2,'0')
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }

export default function MyPayroll() {
  const { user, userData } = useAuth()
  const [curMonth, setCurMonth] = useState(()=>{
    const now=new Date(); return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [payroll, setPayroll]           = useState(null)
  const [myBonuses, setMyBonuses]       = useState([])
  const [loading, setLoading]           = useState(true)
  const [showInquiryForm, setShowInquiryForm] = useState(false)
  const [inquiryText, setInquiryText]   = useState('')
  const [saving, setSaving]             = useState(false)

  const monthOpts=[]
  for(let y=2022;y<=Math.max(2026,new Date().getFullYear());y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  async function load() {
    if(!user) return
    setLoading(true)
    try {
      // 내 급여 복사본만 읽음 (다른 직원 급여는 읽을 수 없음)
      const mine = await loadMyPayslip(user.uid, curMonth)
      setPayroll(mine.pay)
      setMyBonuses(mine.bonuses)
    } catch(e){ console.error(e) }
    setLoading(false)
  }

  useEffect(()=>{ load() },[curMonth, user])

  // 바꾸는 항목만 원본·복사본의 내 칸에 씀
  async function updatePayroll(fields) {
    await writeMyPayFields(user.uid, curMonth, fields)
    setPayroll(p => ({ ...(p || {}), ...fields }))
  }

  async function checkPayroll() {
    if(!window.confirm('급여 내역을 확인하셨습니까?')) return
    setSaving(true)
    try {
      await updatePayroll({ checkedByEmp:true, checkedAt:new Date().toISOString() })
    } catch(e){ console.error(e) }
    setSaving(false)
  }

  async function submitInquiry() {
    if(!inquiryText.trim()) return alert('문의 내용을 입력해주세요')
    setSaving(true)
    try {
      await updatePayroll({
        inquiry: {
          message: inquiryText.trim(),
          createdAt: new Date().toISOString(),
          ownerReply: null, repliedAt: null, resolved: false,
        }
      })
      setShowInquiryForm(false)
      setInquiryText('')
    } catch(e){ console.error(e) }
    setSaving(false)
  }

  const p = payroll
  const myBonusTotal = myBonuses.reduce((a,r)=>a+(r.amount||0),0)

  // 상태 계산
  const isPending  = !p?.confirmedByOwner
  const isInquiry  = p?.inquiry && !p.inquiry.resolved
  const isChecked  = p?.checkedByEmp
  const isPaid     = p?.paid

  return (
    <AstryxPage>
    <VStack gap={4}>
      <PageHeader title="내 급여" sub={mLabel(curMonth)}
        right={<Selector label="달 고르기" isLabelHidden size="sm" value={curMonth} onChange={v => v && setCurMonth(v)} options={monthOpts.map(m => ({ value:m, label:mLabel(m) }))}/>}/>

      {/* 사장님이 보낸 근로계약서 (서명할 게 있으면 맨 위에) */}
      {user && <Legacy><MyContracts uid={user.uid}/></Legacy>}

      {loading ? <Text color="secondary">불러오는 중...</Text> : isPending ? (
        <EmptyState title="급여 집계 중" description="사장님이 이달 급여를 확정하면 여기에 표시됩니다"/>
      ) : <>
        {/* 급여 내역 */}
        <LedgerCard title={`${mLabel(curMonth)} 급여 내역`} right={
          isPaid ? <Badge variant="info" label={`지급완료 (${p.paidAt?.slice(0,10)})`}/>
          : isInquiry ? <Badge variant="error" label="문의 처리중"/>
          : isChecked ? <Badge variant="success" label="확인 완료 · 지급 대기중"/> : null}>
          <Grid columns={{ minWidth: 140, max: 3, repeat: 'fit' }} gap={2}>
            {[
              ['총 근무시간', `${p.totalHours}h ${p.totalMins>0?p.totalMins+'m':''}`],
              ['기본급', `${(p.basePay||0).toLocaleString()}원`],
              ['주휴수당', `${(p.weeklyHoliday||0).toLocaleString()}원`],
            ].map(([label, val]) => (
              <Card key={label} variant="muted" padding={3}>
                <VStack gap={1}><Text type="supporting" color="secondary">{label}</Text><Text weight="bold" hasTabularNumbers>{val}</Text></VStack>
              </Card>
            ))}
          </Grid>
          <HStack gap={3} vAlign="end" hAlign="between" wrap="wrap">
            <VStack gap={0}>
              <Text type="supporting" color="secondary">이달 월급</Text>
              <Text type="display-3" color="accent" hasTabularNumbers>{(p.totalPay||0).toLocaleString()}원</Text>
            </VStack>
            <VStack gap={0}>
              <Text type="supporting" color="secondary" hasTabularNumbers>시급 {(p.wage||10030).toLocaleString()}원/h</Text>
              <Text type="supporting" color="secondary" hasTabularNumbers>확정일 {p.confirmedAt?.slice(0,10)}</Text>
            </VStack>
          </HStack>
        </LedgerCard>

        {/* 상여·보너스 */}
        {myBonuses.length > 0 && (
          <LedgerCard title="이달 상여·보너스" right={<Text weight="bold" hasTabularNumbers>{myBonusTotal.toLocaleString()}원</Text>}>
            <List hasDividers edge="flush">
              {myBonuses.map(r => (
                <ListItem key={r.id} label={<Text weight="bold" hasTabularNumbers>{r.amount.toLocaleString()}원</Text>}
                  description={<Text type="supporting" color="secondary" hasTabularNumbers>{r.date} · {r.memo||'—'}</Text>}/>
              ))}
            </List>
            <Text type="supporting" color="secondary">상여는 이달 급여에 합산되어 세금이 함께 계산돼요.</Text>
          </LedgerCard>
        )}

        {/* 문의 */}
        {p.inquiry && (
          <LedgerCard title={p.inquiry.resolved ? '문의 해결 완료' : '문의 진행중'} right={<Text type="supporting" color="secondary">{p.inquiry.createdAt?.slice(0,10)}</Text>}>
            <VStack gap={1}>
              <Text type="supporting" color="secondary">내 문의</Text>
              <Card variant="muted" padding={3}><Text>{p.inquiry.message}</Text></Card>
            </VStack>
            {p.inquiry.ownerReply ? (
              <VStack gap={1}>
                <Text type="supporting" color="secondary">사장님 답변 · {p.inquiry.repliedAt?.slice(0,10)}</Text>
                <Card variant="muted" padding={3}><Text>{p.inquiry.ownerReply}</Text></Card>
              </VStack>
            ) : <Text type="supporting" color="secondary">사장님이 문의를 확인 중입니다...</Text>}
          </LedgerCard>
        )}

        {/* 확인 / 문의 */}
        {!isPaid && !isChecked && !p.inquiry && (
          <Grid columns={2} gap={2}>
            <Button variant="primary" width="100%" label="확인했습니다" isDisabled={saving} onClick={checkPayroll}/>
            <Button width="100%" label="문의하기" onClick={()=>setShowInquiryForm(v=>!v)}/>
          </Grid>
        )}

        {showInquiryForm && !p.inquiry && (
          <LedgerCard title="급여 문의">
            <Text type="supporting" color="secondary">근무시간이나 급여 내역에 다른 부분이 있으면 아래에 상세히 적어주세요. 사장님이 확인 후 답변드립니다.</Text>
            <TextArea label="문의 내용" isLabelHidden rows={5} placeholder="예: 5월 3일(토) 근무시간이 8시간인데 7시간으로 입력되어 있습니다." value={inquiryText} onChange={v=>setInquiryText(v)}/>
            <HStack gap={2}>
              <Button variant="primary" label={saving?'전송 중...':'문의 전송'} isDisabled={saving} onClick={submitInquiry}/>
              <Button label="취소" onClick={()=>{setShowInquiryForm(false);setInquiryText('')}}/>
            </HStack>
          </LedgerCard>
        )}
      </>}

      {/* 확정된 달의 임금명세서 (출력 문서라 예전 모양 그대로) */}
      <Legacy><WageStatements uid={user?.uid} userData={userData}/></Legacy>
    </VStack>
    </AstryxPage>
  )
}
