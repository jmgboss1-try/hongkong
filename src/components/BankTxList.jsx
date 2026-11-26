import { useState } from 'react'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Selector } from '@astryxdesign/core/Selector'
import { TextInput } from '@astryxdesign/core/TextInput'
import { List, ListItem } from '@astryxdesign/core/List'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { parseTxKey, currentClass, classLabel, classOptions, reclassify, guessFromCat } from '../lib/bankReclass'

const wonFmt = n => (n||0).toLocaleString('ko-KR')
const norm = s => String(s??'').replace(/\s+/g,'')

// 통장 잔액 맞추기 안: 이 달 통장 거래 전체와 지금 분류를 보여주고, 한 건씩 분류를 바꿀 수 있게
// day='09' 처럼 주면 그날 거래만 펼친 채로 보여줌 (지출 내역 표에서 날짜 줄을 펼칠 때)
export default function BankTxList({ ym, data, categories, onChanged, day }) {
  const [openState, setOpen] = useState(false)
  const open = !!day || openState
  const [dir, setDir]     = useState('out')   // 'out' | 'in'
  const [q, setQ]         = useState('')
  const [edit, setEdit]   = useState({})      // key → { to, fromCat }
  const [busyKey, setBusyKey] = useState(null)
  const [status, setStatus]   = useState({})      // key → { ok, msg } 바꾼 결과를 그 줄에 표시

  const txs = (data?.bankSeen||[]).map(parseTxKey)
    .filter(t => day ? t.date === `${ym}-${day}` : (dir==='out' ? t.out : t.in))
    .filter(t => !q || norm(t.desc).includes(norm(q)) || String(t.out||t.in).includes(q.replace(/[^0-9]/g,'') || '__'))
    .sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))
  if (!(data?.bankSeen||[]).length) return null

  async function apply(t) {
    const e = edit[t.key] || {}
    const cur = currentClass(data, t).value
    const fromCat = cur === '?expense' ? (e.fromCat ?? guessFromCat(data, t, categories)) : undefined
    const to = e.to ?? (cur === '?expense' ? fromCat : cur)
    const say = (ok, msg) => setStatus(p=>({ ...p, [t.key]: { ok, msg } }))
    if (!to || to === cur) return
    if (cur === '?expense' && !fromCat) return say(false, '이 출금이 지금 어느 칸에 들어가 있는지 먼저 골라주세요 (왼쪽 칸)')
    setBusyKey(t.key)
    try {
      const fromLabel = classLabel(cur === '?expense' ? fromCat : cur, categories)
      await reclassify({ ym, tx:t, to, fromCat, categories })
      setEdit(p=>{ const n = { ...p }; delete n[t.key]; return n })
      say(true, fromLabel === classLabel(to, categories) ? `'${fromLabel}'(으)로 확인했어요` : `${fromLabel} → ${classLabel(to, categories)}(으)로 바꿨어요`)
      await onChanged?.()
    } catch(err) { console.error(err); say(false, err.message || '바꾸는 중 오류가 발생했어요. 다시 시도해 주세요.') }
    setBusyKey(null)
  }

  const selOptions = t => {
    const opts = classOptions(t, categories)
    const groups = [...new Set(opts.map(o=>o.group||''))]
    return [{ value:'', label:'— 미분류 —' }, ...groups.flatMap(g => g
      ? [{ type:'section', title:g, options: opts.filter(o=>o.group===g).map(o=>({ value:o.value, label:o.label })) }]
      : opts.filter(o=>!o.group).map(o=>({ value:o.value, label:o.label })))]
  }

  return (
    <VStack gap={2}>
      {!day && <HStack><Button size="sm" variant="ghost" label={open ? '통장 거래 분류 접기' : `통장 거래 분류 보기·바꾸기 (${(data.bankSeen||[]).length}건)`} onClick={()=>setOpen(v=>!v)}/></HStack>}
      {open && <>
        {day ? <Text type="supporting" color="secondary">{+day}일 통장 거래 — 한 건씩 분류를 바꿀 수 있어요. 바꾸면 위 표의 칸 금액도 같이 바뀌어요.</Text> : (
          <HStack gap={2} vAlign="end" wrap="wrap">
            <SegmentedControl label="출금·입금" size="sm" value={dir} onChange={v=>v && setDir(v)}>
              <SegmentedControlItem value="out" label="출금"/>
              <SegmentedControlItem value="in" label="입금"/>
            </SegmentedControl>
            <TextInput label="검색" isLabelHidden size="sm" placeholder="이름·금액 검색" width={170} value={q} onChange={v=>setQ(v)}/>
            <Text type="supporting" color="secondary">분류를 바꾸면 원래 들어간 곳(지출 칸·실입금·대여금 장부·투자관리)에서 빼고 새 곳에 넣어요</Text>
          </HStack>
        )}
        {!txs.length ? <Text color="secondary">해당하는 거래가 없어요</Text> : (
          <List hasDividers edge="flush">
            {txs.map(t => {
              const cur = currentClass(data, t).value
              const e = edit[t.key] || {}
              const fromCat = e.fromCat ?? (cur === '?expense' ? guessFromCat(data, t, categories) : '')
              const to = e.to ?? (cur === '?expense' ? fromCat : cur)
              const changed = cur === '?expense' ? !!(to && fromCat) : (e.to !== undefined && e.to !== cur)
              const confirmOnly = cur === '?expense' && to === fromCat
              const st = status[t.key]
              return (
                <ListItem key={t.key} align="start"
                  label={<HStack gap={2} vAlign="center" wrap="wrap"><Text>{t.desc||'—'}</Text><Text weight="bold" hasTabularNumbers>{wonFmt(t.out||t.in)}</Text>{!t.out && <Badge variant="success" label="입금"/>}</HStack>}
                  description={<VStack gap={1}>
                    <Text type="supporting" color="secondary" hasTabularNumbers>{t.date.slice(5)} {t.time.slice(0,5)} · 지금: {classLabel(cur, categories)}</Text>
                    <HStack gap={1} vAlign="center" wrap="wrap">
                      {cur === '?expense' && <>
                        <Selector label="지금 칸" isLabelHidden size="sm" placeholder="지금 어느 칸?" value={fromCat || undefined}
                          onChange={v=>setEdit(p=>({ ...p, [t.key]: { ...e, fromCat: v || '' } }))} options={categories.map(c=>({ value:c.id, label:c.label }))}/>
                        <Text type="supporting" color="secondary">→</Text>
                      </>}
                      <Selector label="바꿀 분류" isLabelHidden size="sm" value={to || ''} onChange={v=>setEdit(p=>({ ...p, [t.key]: { ...e, to: v ?? '' } }))} options={selOptions(t)}/>
                      <Button size="sm" variant={changed ? 'primary' : 'secondary'} label={busyKey===t.key ? '...' : confirmOnly ? '맞아요' : '바꾸기'} isDisabled={!changed || busyKey===t.key} onClick={()=>apply(t)}/>
                    </HStack>
                    {st && <Text type="supporting" color={st.ok ? 'secondary' : 'accent'}>{st.msg}</Text>}
                  </VStack>}/>
              )
            })}
          </List>
        )}
      </>}
    </VStack>
  )
}
