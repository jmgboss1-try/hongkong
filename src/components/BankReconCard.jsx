import { useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { bankSummary, offBankDetail, NONOP_LABELS, INVEST_OPTIONS, investOption, appendInvestmentRecords } from '../lib/bankRecon'
import BankTxList from './BankTxList'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Selector } from '@astryxdesign/core/Selector'
import { List, ListItem } from '@astryxdesign/core/List'
import { LedgerCard, Ledger, LedgerRow } from '../astryx/AstryxPage'
import OffBankList from './OffBankList'

const wonFmt = n => (n||0).toLocaleString('ko-KR')
const sign = n => n > 0 ? `+${wonFmt(n)}` : n < 0 ? `−${wonFmt(-n)}` : '0'
const md = d => d ? `${+d.slice(5,7)}/${+d.slice(8,10)}` : ''

// 영업 외 종류 → 연결되는 대여금 장부 (BankImport와 같음)
const LEDGER_OF = { loan:'hyung' }

// 통장 거래 키 '날짜|시간|출금|입금|잔액|내용|순번'
const parseKey = k => { const [date, time, out, inn, , desc] = String(k).split('|'); return { key:k, date, time, out:+out||0, in:+inn||0, desc } }

// 지출관리: 영업 잔액(이월+실입금−지출)과 실제 통장 잔액의 차이를 영업 외 거래로 설명
//  + 아직 정리 안 된 출금을 여기서 바로 분류 (PDF를 다시 올리지 않아도 됨)
export default function BankReconCard({ ym, data, categories, onChanged }) {
  const [showList, setShowList] = useState(false)
  const [picks, setPicks] = useState({})   // key → 카테고리 id | 'nonop:<kind>' | 'ack'
  const [saving, setSaving] = useState(false)
  const [showOff, setShowOff] = useState(false)
  const s = bankSummary(data, categories)
  const b = s.bank
  const nonOp = (data?.nonOp || []).slice().sort((a,b)=>a.date.localeCompare(b.date))

  const kinds = Object.entries(s.byKind)

  // 아직 정리 안 된 출금: 통장에는 있는데 지출(importedKeys)에도 영업 외(nonOp)에도 없는 것
  const handled = new Set([...(data?.importedKeys||[]), ...(data?.nonOp||[]).map(x=>x.key)])
  const unhandled = (data?.bankSeen||[]).map(parseKey).filter(t=>t.out && !handled.has(t.key))
    .sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))
  const secs = ['재료비','관리비','인건비']

  async function savePicks() {
    const chosen = unhandled.filter(t=>picks[t.key])
    if (!chosen.length) return alert('분류할 출금을 골라주세요')
    setSaving(true)
    try {
      // 저장 직전 최신 데이터 다시 읽기
      const snap = await getDoc(doc(db,'expenses',ym))
      const d = snap.exists() ? snap.data() : {}
      const keys = [...(d.importedKeys||[])], keySet = new Set(keys)
      const bankCls = { ...(d.bankCls||{}) }
      const nonOp = [...(d.nonOp||[])], nonOpKeys = new Set(nonOp.map(x=>x.key))
      const loans = {}, invs = []
      for (const t of chosen) {
        if (keySet.has(t.key) || nonOpKeys.has(t.key)) continue
        const v = picks[t.key]
        const inv = investOption(v)
        if (inv) {
          nonOp.push({ key:t.key, date:t.date, dir:'out', amount:t.out, kind:'invest', desc:t.desc, investor:inv.investor, category:inv.category })
          nonOpKeys.add(t.key)
          invs.push({ key:t.key, date:t.date, amount:t.out, desc:t.desc, investor:inv.investor, category:inv.category })
        } else if (v.startsWith('nonop:')) {
          const kind = v.slice(6)
          nonOp.push({ key:t.key, date:t.date, dir:'out', amount:t.out, kind, desc:t.desc })
          nonOpKeys.add(t.key)
          if (LEDGER_OF[kind]) (loans[LEDGER_OF[kind]] ||= []).push(t)
        } else {
          // 'ack' = 이미 다른 곳(직접 입력·고정지출 납부 등)에서 지출로 적은 출금 → 금액은 더하지 않고 연결만
          if (v !== 'ack') {
            const dd = t.date.slice(8,10)
            const entry = { ...(d[dd]||{}) }
            categories.forEach(c=>{ if(entry[c.id]===undefined) entry[c.id]=0 })
            entry[v] = (entry[v]||0) + t.out
            d[dd] = entry
          }
          keys.push(t.key); keySet.add(t.key); bankCls[t.key] = v
        }
      }
      d.importedKeys = keys
      d.bankCls = bankCls
      if (nonOp.length) d.nonOp = nonOp
      await setDoc(doc(db,'expenses',ym), d)
      // 대여금 장부(형·상암점)에도 기록 — 같은 은행 거래는 한 번만
      let n = Date.now()
      for (const [id, list] of Object.entries(loans)) {
        const ls = await getDoc(doc(db,'loans',id))
        const cur = ls.exists() ? (ls.data().list||[]) : []
        const have = new Set(cur.map(x=>x.bankKey).filter(Boolean))
        for (const t of list) if (!have.has(t.key))
          cur.push({ id:String(n++), date:t.date, type:'lent', amount:t.out, memo:`계좌내역 자동 기록 (${t.desc})`, bankKey:t.key })
        cur.sort((a,b)=>a.date.localeCompare(b.date))
        await setDoc(doc(db,'loans',id), { list: cur })
      }
      await appendInvestmentRecords(invs)
      setPicks({})
      onChanged?.()
    } catch(e) { console.error(e); alert('저장 중 오류가 발생했어요. 다시 시도해 주세요.') }
    setSaving(false)
  }

  const pickedCount = Object.values(picks).filter(Boolean).length

  const pickOptions = [
    ...secs.map(sec => ({ type:'section', title:sec, options: categories.filter(c=>c.sec===sec).map(c=>({ value:c.id, label:c.label })) })),
    { type:'section', title:'영업 외 (지출 아님)', options: Object.entries(NONOP_LABELS).map(([k,l])=>({ value:`nonop:${k}`, label:l })) },
    { type:'section', title:'투자관리 회수로 기록 (영업 외)', options: INVEST_OPTIONS.map(o=>({ value:o.value, label:o.label })) },
    { value:'ack', label:'이미 지출에 있음 (금액 안 더함)' },
  ]
  const reasons = b && b.diff ? [
    [b.reasons.carryover, `통장 시작 잔액은 ${wonFmt(b.opening)}원인데 전월 이월은 ${wonFmt(s.carryover)}원이에요. 전월 이월을 ${wonFmt(b.opening)}원으로 고치면 맞아요.`],
    [b.reasons.unhandledIn, '아직 정리 안 된 입금이 있어요. 계좌내역 탭에서 다시 올려 실입금으로 맞추거나 영업 외 입금으로 기록하세요.'],
    [b.reasons.unhandledOut, '아직 정리 안 된 출금이 있어요. 아래 목록에서 바로 골라주세요.'],
    [b.reasons.offBank, '통장이 아닌 곳에서 낸 지출이에요(현금·직접 입력·고정지출 납부 등). 이 중 통장에서 나간 건은 정리 안 된 출금과 서로 상쇄돼요.'],
  ].map(([v,text],i)=>({ v, text, i })).filter(x=>x.v) : []

  return (
    <LedgerCard title="통장 잔액 맞추기" right={b && b.diff !== null && (
      <Badge variant={b.diff===0 ? 'success' : 'warning'} label={b.diff===0 ? '통장과 일치해요' : `통장과 ${wonFmt(Math.abs(b.diff))}원 차이`}/>
    )}>
      <Grid columns={{ minWidth: 320, max: 2, repeat: 'fit' }} gap={6}>
        <Ledger rows={<>
          <LedgerRow label="영업 잔액" note="이월 + 실입금 − 지출" value={s.operating} tone={s.operating<0 ? 'bad' : undefined}/>
          <LedgerRow label="영업 외 입금" value={s.nonOpIn} plus/>
          {kinds.filter(([,v])=>v.in).map(([k,v])=><LedgerRow key={'i'+k} label={NONOP_LABELS[k]||k} value={v.in} sub/>)}
          <LedgerRow label="영업 외 출금" value={s.nonOpOut} minus/>
          {kinds.filter(([,v])=>v.out).map(([k,v])=><LedgerRow key={'o'+k} label={NONOP_LABELS[k]||k} value={v.out} sub/>)}
        </>} total={<>
          <LedgerRow label="계산상 통장 잔액" value={s.expected} strong/>
          {b && b.closing !== null && <LedgerRow label="실제 통장 잔액" note={`${md(b.to)} 기준`} value={b.closing} tone="accent"/>}
        </>}/>

        <VStack gap={2}>
          {!b ? (
            <Text color="secondary">아래 <b>계좌내역 엑셀·PDF</b> 탭에서 이 달 통장 거래내역을 올리면 실제 통장 잔액과 비교해 드려요.
              영업 잔액은 장사 성적(실입금 − 지출)이고, 통장에는 형 대여금·투자금 같은 영업 외 거래도 있어서 둘은 다를 수 있어요.</Text>
          ) : b.closing === null ? (
            <Text color="secondary">이 은행 파일에는 잔액 칸이 없어서 실제 통장 잔액을 계산할 수 없어요. 잔액이 있는 PDF로 올려주세요.</Text>
          ) : b.diff === 0 ? (
            <Banner status="success" title="장부가 통장과 정확히 맞아요." description={`${md(b.from)}~${md(b.to)} 통장 거래 ${b.count}건 기준이에요.`}/>
          ) : (
            <>
              <HStack gap={2} vAlign="center" wrap="wrap"><Heading level={5}>차이가 나는 이유</Heading><Text type="supporting" color="secondary">({md(b.from)}~{md(b.to)} 통장 거래 {b.count}건 기준)</Text></HStack>
              <List hasDividers edge="flush">
                {reasons.map(({ v, text, i }) => (
                  <ListItem key={i} align="start" startContent={<Text weight="bold" color={v>0 ? 'accent' : 'primary'} hasTabularNumbers>{sign(v)}</Text>}
                    label={<Text>{text}</Text>}
                    description={i===3 ? <Button size="sm" variant="ghost" label={showOff ? '접기' : '어느 지출인지 찾아보기'} onClick={()=>setShowOff(v=>!v)}/> : undefined}/>
                ))}
              </List>
            </>
          )}
        </VStack>
      </Grid>

      {b && showOff && !!b.reasons.offBank && (
        <OffBankList ym={ym} data={data} categories={categories} detail={offBankDetail(data, categories)} total={b.reasons.offBank} onChanged={onChanged}/>
      )}

      {b && unhandled.length > 0 && (
        <Card variant="muted" padding={3}>
          <VStack gap={2}>
            <HStack gap={2} vAlign="center" hAlign="between" wrap="wrap">
              <Heading level={5}>아직 정리 안 된 출금 {unhandled.length}건</Heading>
              <Text weight="bold" hasTabularNumbers>{wonFmt(unhandled.reduce((a,t)=>a+t.out,0))}원</Text>
            </HStack>
            <Text type="supporting" color="secondary">여기서 골라 저장하면 돼요 (PDF를 다시 올리지 않아도 돼요). 임대료처럼 이미 고정지출·직접 입력으로 적어둔 지출이면 '이미 지출에 있음'을 고르세요. 금액은 더하지 않고 연결만 해요.</Text>
            <List hasDividers edge="flush">
              {unhandled.map(t=>(
                <ListItem key={t.key} label={<Text>{t.desc || '—'}</Text>}
                  description={<Text type="supporting" color="secondary" hasTabularNumbers>{md(t.date)} {t.time.slice(0,5)}</Text>}
                  endContent={<HStack gap={2} vAlign="center">
                    <Text weight="bold" hasTabularNumbers>{wonFmt(t.out)}</Text>
                    <Selector label="분류" isLabelHidden size="sm" placeholder="골라주세요" value={picks[t.key] || undefined} onChange={v=>setPicks(p=>({ ...p, [t.key]: v || '' }))} options={pickOptions}/>
                  </HStack>}/>
              ))}
            </List>
            <HStack><Button variant="primary" label={saving ? '저장 중...' : `고른 ${pickedCount}건 저장`} isDisabled={saving || !pickedCount} onClick={savePicks}/></HStack>
          </VStack>
        </Card>
      )}

      <BankTxList ym={ym} data={data} categories={categories} onChanged={onChanged}/>

      {nonOp.length > 0 && (
        <VStack gap={1}>
          <HStack gap={2} vAlign="center" wrap="wrap">
            <Button size="sm" variant="ghost" label={showList ? '영업 외 거래 접기' : `영업 외 거래 ${nonOp.length}건 보기`} onClick={()=>setShowList(v=>!v)}/>
            <Text type="supporting" color="secondary">투자·정산은 투자관리 탭에 옮겨 적을 때 참고하세요</Text>
          </HStack>
          {showList && (
            <List hasDividers edge="flush">
              {nonOp.map(x=>(
                <ListItem key={x.key} label={<Text>{x.desc}</Text>}
                  description={<Text type="supporting" color="secondary" hasTabularNumbers>{md(x.date)} · {NONOP_LABELS[x.kind==='loan_sangam'?'loan':x.kind]||x.kind}</Text>}
                  endContent={<Text weight="bold" hasTabularNumbers color={x.dir==='in' ? 'accent' : 'primary'}>{x.dir==='in'?'+ ':'− '}{wonFmt(x.amount)}</Text>}/>
              ))}
            </List>
          )}
        </VStack>
      )}
    </LedgerCard>
  )
}
