import { useEffect, useState } from 'react'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Button } from '@astryxdesign/core/Button'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { TextInput } from '@astryxdesign/core/TextInput'
import { TextArea } from '@astryxdesign/core/TextArea'
import { DateInput } from '@astryxdesign/core/DateInput'
import { Selector } from '@astryxdesign/core/Selector'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { List, ListItem } from '@astryxdesign/core/List'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { AstryxPage, Legacy } from '../astryx/AstryxPage'
import TimeSelect from '../astryx/TimeSelect'
import ContractDoc from './ContractDoc'
import { STATEMENT_PRINT_CSS } from './WageStatements'
import { useBizInfo, useSeal } from '../lib/bizInfo'
import { DOW, DOW_ORDER, KIND_LABELS, draftContract, loadContracts, sendContract, deleteContract, dayMinutes, hm } from '../lib/contracts'

// 인원관리 → 직원 → 근로계약서 (사장님): 보낸 계약서 목록, 새로 만들기(직원 정보로 채운 초안 → 고쳐서 보내기), 보기·인쇄
// 창 틀(화면 전체를 덮는 바탕)만 인라인 스타일, 안은 Astryx. 계약서 문서(ContractDoc)는 인쇄물이라 Legacy
const OVERLAY = { position:'fixed', inset:0, background:'rgba(29,27,24,.45)', zIndex:1000, overflowY:'auto', padding:'24px 12px' }
const BOX = { maxWidth:780, margin:'0 auto' }
const numIn = (label, value, onChange, opts = {}) => (
  <TextInput label={label} inputMode="numeric" value={value == null ? '' : String(value)} width={opts.width}
    isLabelHidden={opts.hidden} onChange={v => onChange(+(String(v || '').replace(/[^0-9]/g, '')) || 0)}/>
)

export default function ContractManager({ member, onClose }) {
  const biz = useBizInfo(), seal = useSeal()
  const [list, setList] = useState(null)
  const [form, setForm] = useState(null)   // 새로 만드는 계약서
  const [view, setView] = useState(null)   // 보고 있는 계약서
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const reload = () => loadContracts(member.uid).then(setList).catch(e => { console.error(e); setList([]); setMsg('계약서를 불러오지 못했어요 (규칙 확인)') })
  useEffect(() => { reload() }, [member.uid]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setIn = (k, sub, v) => setForm(f => ({ ...f, [k]: { ...f[k], [sub]: v } }))
  const setDay = (d, sub, v) => setForm(f => ({ ...f, days: { ...f.days, [d]: { ...(f.days[d] || { start:'', end:'', breakMin:0 }), [sub]: v } } }))
  const toggleDay = d => setForm(f => {
    const days = { ...f.days }; if (days[d]) delete days[d]; else days[d] = { start:'', end:'', breakMin:0 }
    const workDays = f.hours.workDays.includes(d) ? f.hours.workDays.filter(x => x !== d) : [...f.hours.workDays, d]
    return { ...f, days, hours: { ...f.hours, workDays } }
  })
  const send = async () => {
    if (!form.startDate) return setMsg('근로개시일을 넣어 주세요')
    if (form.kind === 'fixed' && !form.endDate) return setMsg('기간의 정함이 있는 계약은 종료일을 넣어 주세요')
    if (!window.confirm(`${member.name}님에게 근로계약서를 보낼까요? 직원이 내 급여에서 확인하고 서명해요.`)) return
    setBusy(true)
    try { await sendContract(member.uid, form); setForm(null); setMsg('보냈어요. 직원이 서명하면 서명 완료로 바뀌어요'); reload() }
    catch (e) { console.error(e); setMsg('보내지 못했어요') }
    setBusy(false)
  }
  const remove = async c => {
    if (!window.confirm(c.status === 'signed' ? '서명까지 끝난 계약서예요. 정말 지울까요?' : '이 계약서를 지울까요?')) return
    await deleteContract(member.uid, c.id); setView(null); reload()
  }

  const doc = view ? <Legacy><ContractDoc c={view} biz={biz} seal={seal}/></Legacy> : null
  return (
    <div onClick={onClose} style={OVERLAY}>
      <style>{STATEMENT_PRINT_CSS}</style>
      <div onClick={e => e.stopPropagation()} style={BOX}>
        <AstryxPage>
          <Card>
            <VStack gap={3}>
              <div className="ws-noprint">
                <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
                  <Heading level={4}>{member.name}님 근로계약서</Heading>
                  <HStack gap={2} wrap="wrap">
                    {view && <Button label="인쇄 · PDF로 저장" onClick={() => window.print()}/>}
                    {(view || form) && <Button label="목록으로" onClick={() => { setView(null); setForm(null) }}/>}
                    <Button variant="ghost" label="닫기" onClick={onClose}/>
                  </HStack>
                </HStack>
              </div>
              {msg && <div className="ws-noprint"><Banner status="warning" title={msg}/></div>}

              {view ? doc : form ? (
                <VStack gap={4}>
                  <div className="ws-noprint">
                    <VStack gap={4}>
                      <SegmentedControl label="계약 종류" value={form.kind} onChange={v => v && set('kind', v)}>
                        {Object.entries(KIND_LABELS).map(([k, l]) => <SegmentedControlItem key={k} value={k} label={l}/>)}
                      </SegmentedControl>
                      <Grid columns={{ minWidth: 180, max: 2, repeat: 'fit' }} gap={3}>
                        <DateInput label="근로개시일" value={form.startDate || ''} onChange={v => set('startDate', v || '')}/>
                        {form.kind !== 'regular' && <DateInput label="종료일" isOptional={form.kind === 'part'} description={form.kind === 'part' ? '없으면 비워 두세요' : undefined}
                          value={form.endDate || ''} onChange={v => set('endDate', v || '')}/>}
                        <TextInput label="근무장소" value={form.place} onChange={v => set('place', v)}/>
                        <TextInput label="업무의 내용" value={form.job} onChange={v => set('job', v)}/>
                      </Grid>

                      <Card variant="muted" padding={3}>
                        <VStack gap={3}>
                          <Text type="label" weight="bold">근무 요일과 시간{form.kind === 'part' ? ' (요일마다 시업·종업·휴게)' : ''}</Text>
                          <HStack gap={1} wrap="wrap">
                            {DOW_ORDER.map(d => <Button key={d} size="sm" variant={form.days[d] ? 'primary' : 'secondary'} label={DOW[d]} onClick={() => toggleDay(d)}/>)}
                          </HStack>
                          {form.kind === 'part' ? DOW_ORDER.filter(d => form.days[d]).map(d => (
                            <HStack key={d} gap={2} vAlign="center" wrap="wrap">
                              <Text weight="bold">{DOW[d]}</Text>
                              <TimeSelect value={form.days[d].start} onChange={v => setDay(d, 'start', v)} label={`${DOW[d]} 시업`}/>
                              <Text color="secondary">~</Text>
                              <TimeSelect value={form.days[d].end} onChange={v => setDay(d, 'end', v)} label={`${DOW[d]} 종업`}/>
                              <Text color="secondary">휴게</Text>
                              {numIn(`${DOW[d]} 휴게(분)`, form.days[d].breakMin, v => setDay(d, 'breakMin', v), { hidden:true, width:72 })}
                              <Text color="secondary">분 · {hm(dayMinutes(form.days[d]))}</Text>
                            </HStack>
                          )) : (
                            <HStack gap={2} vAlign="center" wrap="wrap">
                              <Text>소정근로시간</Text>
                              <TimeSelect value={form.hours.start} onChange={v => setIn('hours', 'start', v)} label="시업"/>
                              <Text color="secondary">~</Text>
                              <TimeSelect value={form.hours.end} onChange={v => setIn('hours', 'end', v)} label="종업"/>
                              <Text color="secondary">휴게</Text>
                              {numIn('휴게(분)', form.hours.breakMin, v => setIn('hours', 'breakMin', v), { hidden:true, width:72 })}
                              <Text color="secondary">분</Text>
                            </HStack>
                          )}
                          <HStack>
                            <Selector label="주휴일 (매주)" value={String(form.hours.weeklyHoliday)} onChange={v => setIn('hours', 'weeklyHoliday', +v)}
                              options={DOW_ORDER.map(d => ({ value:String(d), label:`${DOW[d]}요일` }))}/>
                          </HStack>
                        </VStack>
                      </Card>

                      <Grid columns={{ minWidth: 180, max: 2, repeat: 'fit' }} gap={3}>
                        <Selector label="임금" value={form.wage.type} onChange={v => setIn('wage', 'type', v)}
                          options={[{ value:'hourly', label:'시간급' }, { value:'monthly', label:'월급' }]}/>
                        {numIn('금액 (원)', form.wage.amount, v => setIn('wage', 'amount', v))}
                        {numIn('임금지급일 (매월)', form.payDay, v => set('payDay', Math.min(31, v)))}
                        <Selector label="지급방법" value={form.payMethod} onChange={v => set('payMethod', v)}
                          options={[{ value:'account', label:'근로자 명의 통장 입금' }, { value:'direct', label:'직접 지급' }]}/>
                        <TextInput label="기타 수당" isOptional value={form.otherPay} onChange={v => set('otherPay', v)}/>
                      </Grid>
                      <HStack gap={4} wrap="wrap" vAlign="end">
                        <CheckboxInput label="주휴수당 지급" value={!!form.weeklyPay} onChange={v => set('weeklyPay', v)}/>
                        <CheckboxInput label="상여금 있음" value={!!form.bonus.has} onChange={v => setIn('bonus', 'has', v)}/>
                        {form.bonus.has && numIn('상여금 금액', form.bonus.amount, v => setIn('bonus', 'amount', v))}
                      </HStack>

                      <VStack gap={2}>
                        <Text type="label" weight="bold">사회보험</Text>
                        <HStack gap={4} wrap="wrap">
                          {[['employ','고용보험'],['accident','산재보험'],['pension','국민연금'],['health','건강보험']].map(([k, l]) => (
                            <CheckboxInput key={k} label={l} value={!!form.insurance[k]} onChange={v => setIn('insurance', k, v)}/>
                          ))}
                        </HStack>
                      </VStack>
                      <TextArea label="기타 (특약 사항)" isOptional rows={2} value={form.extra} onChange={v => set('extra', v)}/>
                      <Text type="supporting" color="secondary">아래는 직원이 받게 될 모습이에요. 사업장 정보·직인은 원천징수영수증 → 사업장 정보에서 바꿔요.</Text>
                    </VStack>
                  </div>
                  <Legacy><ContractDoc c={form} biz={biz} seal={seal} printId="contract-preview"/></Legacy>
                  <div className="ws-noprint">
                    <HStack gap={2}>
                      <Button variant="primary" label={busy ? '보내는 중…' : '직원에게 보내기'} isDisabled={busy} onClick={send}/>
                      <Button label="취소" onClick={() => setForm(null)}/>
                    </HStack>
                  </div>
                </VStack>
              ) : (
                <div className="ws-noprint">
                  <VStack gap={3}>
                    {list == null ? <Text color="secondary">불러오는 중…</Text>
                    : list.length === 0 ? <EmptyState title="아직 보낸 근로계약서가 없어요" isCompact/>
                    : (
                      <List hasDividers edge="flush">
                        {list.map(c => (
                          <ListItem key={c.id} label={KIND_LABELS[c.kind]}
                            description={`${c.startDate}${c.endDate ? ` ~ ${c.endDate}` : ''} · ${(c.createdAt || '').slice(0, 10)} 보냄`}
                            endContent={
                              <HStack gap={2} vAlign="center" wrap="wrap">
                                <Badge variant={c.status === 'signed' ? 'success' : 'warning'} label={c.status === 'signed' ? `서명 완료 ${(c.empSignedAt || '').slice(0, 10)}` : '서명 대기'}/>
                                <Button size="sm" label="보기" onClick={() => setView(c)}/>
                                <Button size="sm" variant="ghost" label="지우기" onClick={() => remove(c)}/>
                              </HStack>
                            }/>
                        ))}
                      </List>
                    )}
                    <HStack><Button variant="primary" label="새 근로계약서 만들기" onClick={() => { setMsg(''); setForm(draftContract(member, biz)) }}/></HStack>
                    <Text type="supporting" color="secondary">
                      고용노동부 표준근로계약서 내용으로 만들어요. 직원 정보(입사일·시급·근무 요일·포지션)로 미리 채워지고, 고친 뒤 보내면 직원이 내 급여에서 확인하고 손가락으로 서명해요.
                    </Text>
                  </VStack>
                </div>
              )}
            </VStack>
          </Card>
        </AstryxPage>
      </div>
    </div>
  )
}
