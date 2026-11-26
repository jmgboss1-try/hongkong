import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { collection, doc, getDocs, setDoc } from 'firebase/firestore'
import Avatar from '../components/Avatar'
import { AVATAR_CSS, defaultLook } from '../lib/avatar'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Badge } from '@astryxdesign/core/Badge'
import { Button } from '@astryxdesign/core/Button'
import { Selector } from '@astryxdesign/core/Selector'
import { TextInput } from '@astryxdesign/core/TextInput'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { List, ListItem } from '@astryxdesign/core/List'
import { AstryxPage, Legacy, PageHeader, LedgerCard } from '../astryx/AstryxPage'
import { ITEM_GROUPS, TIERS, WHENS, LINE_POS, itemKey, tierOf, defaultTier, loadAvatarRules, perfectStreaks, tenureMonths, canUse, linesOf, lineEveryOf } from '../lib/avatarRules'

const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', soft:'#ECE8E1', chip:'#F3F1EC', accent:'var(--hk-accent)', green:'#2E7D45', red:'#B42318', blue:'#2B5C9E', amber:'#B45309' }

// 이 아이템을 입은 모습 (미리보기용)
function itemLook(group, id) {
  const base = { ...defaultLook('미리보기'), hair:'short', hairColor:'#1D1B18', shirt:'#E8E4DC', skin:'#EBC29B', hold:'none' }
  if (group === 'acc') return { ...base, acc:[id] }
  if (group === 'deco') return { ...base, deco:[id] }
  if (group === 'special') return { ...base, special:[id] }
  return { ...base, [group]: id }
}


// 사장님 '아바타' 탭: 아이템별 지급 기준(기본 / 개근 N개월 / 근속 N개월 / 직접 줄 때만)과 직원별로 직접 주기
export default function AvatarManage() {
  const [rules, setRules] = useState(null)
  const [saved, setSaved] = useState(null)
  const [staff, setStaff] = useState([])
  const [streaks, setStreaks] = useState({})
  const [open, setOpen] = useState(null)       // 펼친 직원 uid
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let off = false
    Promise.all([loadAvatarRules(), getDocs(collection(db,'users'))]).then(([r, us]) => {
      if (off) return
      const list = []
      us.forEach(d => { const u = d.data(); if (u.status === 'approved' && !['owner','store','investor'].includes(u.role)) list.push({ uid:d.id, ...u }) })
      list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'))
      setRules(r); setSaved(JSON.stringify(r)); setStaff(list)
      perfectStreaks(list).then(st => { if (!off) setStreaks(st) }).catch(() => {})
    }).catch(e => { console.error(e); setMsg('불러오지 못했어요') })
    return () => { off = true }
  }, [])

  if (!rules) return <AstryxPage><Text color="secondary">{msg || '불러오는 중...'}</Text></AstryxPage>
  const dirty = JSON.stringify(rules) !== saved
  const setTier = (key, t) => setRules(r => {
    const tiers = { ...r.tiers }
    if (t === defaultTier(key)) delete tiers[key]; else tiers[key] = t
    return { ...r, tiers }
  })
  async function save() {
    setBusy(true); setMsg('')
    try { await setDoc(doc(db,'rewards','avatar'), { tiers: rules.tiers, showLocked: rules.showLocked !== false, lines: linesOf(rules).filter(l => l.text?.trim()), lineEvery: lineEveryOf(rules), updatedAt: new Date().toISOString() }); setSaved(JSON.stringify(rules)); setMsg('저장했어요. 직원 꾸미기 화면과 우리 매장에 바로 적용돼요') }
    catch(e) { console.error(e); setMsg(e.code === 'permission-denied' ? '저장할 권한이 없어요 (Firestore 규칙에서 rewards 쓰기 확인)' : '저장하지 못했어요. 다시 시도해 주세요') }
    setBusy(false)
  }
  // 직접 주기·거두기 (users/{uid}.unlocks)
  async function give(u, key, on) {
    const next = on ? [...new Set([...(u.unlocks || []), key])] : (u.unlocks || []).filter(x => x !== key)
    setStaff(list => list.map(x => x.uid === u.uid ? { ...x, unlocks: next } : x))
    try { await setDoc(doc(db,'users',u.uid), { unlocks: next }, { merge:true }) }
    catch(e) { console.error(e); setStaff(list => list.map(x => x.uid === u.uid ? { ...x, unlocks: u.unlocks } : x)); setMsg('직접 주기를 저장하지 못했어요') }
  }
  const rewardItems = [
    ...ITEM_GROUPS.flatMap(g => g.items.map(it => ({ ...it, group:g.key, groupLabel:g.label, key:itemKey(g.key, it.id) }))),
    ...linesOf(rules).filter(l => l.pos !== 'boss').map(l => ({ id:l.id, label:`"${l.text}"`, group:'line', groupLabel:'대사', key:'line:' + l.id })),
  ].filter(it => tierOf(rules, it.key) !== 'base')
  // 대사 고치기
  const lines = linesOf(rules)
  const setLines = f => setRules(r => ({ ...r, lines: f(linesOf(r)) }))
  const patchLine = (id, p) => setLines(ls => ls.map(l => l.id === id ? { ...l, ...p } : l))
  const addLine = when => setLines(ls => [...ls, { id:'n' + Date.now().toString(36), when, pos:'any', tier:'base', text:'' }])
  const tierName = id => TIERS.find(t => t.id === id)?.label
  const tierOpts = TIERS.map(t => ({ value:t.id, label:t.label }))
  // 색 아이템은 색 네모 (그림이라 예전 칸)
  const swatch = it => it.color ? <Legacy><span title={it.label} style={{display:'inline-block', width:16, height:16, background:it.color, border:`1px solid ${T.rule}`, borderRadius:3, verticalAlign:-3}}/></Legacy> : <Text>{it.label}</Text>

  return (
    <AstryxPage>
    <VStack gap={4}>
      <Legacy><style>{AVATAR_CSS}</style></Legacy>
      <PageHeader title="아바타" sub="꾸미기 아이템을 개근·근속 포상으로 나눠 줘요 · 사장님만 보는 화면"/>
      <Card variant="muted" padding={3}>
        <HStack gap={3} vAlign="center" wrap="wrap">
          <Button variant="primary" label={busy ? '저장 중...' : '저장'} isDisabled={busy || !dirty} onClick={save}/>
          {dirty && <Badge variant="warning" label="바꾼 기준·대사가 아직 저장 안 됐어요"/>}
          <CheckboxInput label="못 쓰는 아이템도 직원에게 자물쇠로 보여 주기" value={rules.showLocked !== false} onChange={v=>setRules(r => ({ ...r, showLocked: v }))}/>
          {msg && <Text type="supporting" color={msg.includes('못') || msg.includes('권한') ? 'accent' : 'secondary'}>{msg}</Text>}
        </HStack>
      </Card>

      {/* 직원별 현황 + 직접 주기 */}
      <LedgerCard title="직원별">
        <Text type="supporting" color="secondary">연속 개근은 지난 달까지 끝난 달만 세요 (집계 시작 전 달은 빼고). 조건이 안 돼도 '직접 주기'로 열 수 있어요.</Text>
        {staff.length === 0 && <Text color="secondary">직원이 없어요</Text>}
        <List hasDividers edge="flush">
          {staff.map(u => {
            const tenure = tenureMonths(u.joinDate), streak = streaks[u.uid] || 0
            const usable = rewardItems.filter(it => canUse(it.key, { rules, user:u, streak, tenure }))
            const isOpen = open === u.uid
            return (
              <ListItem key={u.uid} align="start"
                startContent={<Legacy><svg width="30" height="40" viewBox="-3 -6 36 46" aria-hidden="true"><Avatar look={{ ...defaultLook(u.uid), ...(u.avatar || {}) }} size={30}/></svg></Legacy>}
                label={<HStack gap={2} vAlign="center" wrap="wrap">
                  <Text weight="bold">{u.name}</Text>
                  <Text type="supporting" color="secondary" hasTabularNumbers>근속 {tenure}개월{!u.joinDate && ' (입사일 없음)'}</Text>
                  {streak > 0 ? <Badge variant="warning" label={`연속 개근 ${streak}개월`}/> : <Text type="supporting" color="secondary">연속 개근 0개월</Text>}
                </HStack>}
                description={isOpen ? (
                  rewardItems.length === 0 ? <Text type="supporting" color="secondary">아래 지급 기준에서 포상 아이템을 먼저 정해 주세요</Text> : (
                    <VStack gap={1}>
                      {rewardItems.map(it => {
                        const given = (u.unlocks || []).includes(it.key)
                        const earned = canUse(it.key, { rules, user:{ ...u, unlocks:[] }, streak, tenure })
                        return (
                          <HStack key={it.key} gap={2} vAlign="center" wrap="wrap">
                            <Text type="supporting" color="secondary">{it.groupLabel}</Text>{swatch(it)}
                            <Text type="supporting" color="secondary">{tierName(tierOf(rules, it.key))}</Text>
                            {earned ? <Badge variant="success" label="조건 충족"/> : <CheckboxInput label="직접 주기" value={given} onChange={v=>give(u, it.key, v)}/>}
                          </HStack>
                        )
                      })}
                    </VStack>
                  )
                ) : undefined}
                endContent={<HStack gap={2} vAlign="center">
                  <Text type="supporting" hasTabularNumbers>포상 아이템 {usable.length}/{rewardItems.length} 열림</Text>
                  <Button size="sm" variant="ghost" label={isOpen ? '접기' : '보기'} onClick={()=>setOpen(o => o === u.uid ? null : u.uid)}/>
                </HStack>}/>
            )
          })}
        </List>
      </LedgerCard>

      {/* 지급 기준 */}
      <LedgerCard title="지급 기준" right={<Text type="supporting" color="secondary">정하지 않은 건 기본(모두)이고, 특별 아이템은 기본이 '직접 줄 때만'이에요</Text>}>
        {ITEM_GROUPS.map(g => (
          <VStack key={g.key} gap={2}>
            <HStack gap={2} vAlign="center">
              <Heading level={5}>{g.label}</Heading>
              <Selector label={`${g.label} 한꺼번에`} isLabelHidden size="sm" placeholder="한꺼번에 바꾸기" value={undefined}
                onChange={t => { if (t) g.items.forEach(it => setTier(itemKey(g.key, it.id), t)) }} options={tierOpts}/>
            </HStack>
            <Grid columns={{ minWidth: 250, repeat: 'fill' }} gap={2}>
              {g.items.map(it => {
                const key = itemKey(g.key, it.id), t = tierOf(rules, key)
                return (
                  <Card key={key} variant={t === 'base' ? 'transparent' : 'muted'} padding={1.5}>
                    <HStack gap={2} vAlign="center" hAlign="between">
                      <HStack gap={2} vAlign="center">
                        <Legacy><svg width="28" height="38" viewBox="-4 -8 36 48" aria-hidden="true"><Avatar look={itemLook(g.key, it.id)} size={28} role="kitchen"/></svg></Legacy>
                        {swatch(it)}
                      </HStack>
                      <Selector label={`${g.label} ${it.label} 지급 기준`} isLabelHidden size="sm" value={t} onChange={v=>v && setTier(key, v)} options={tierOpts}/>
                    </HStack>
                  </Card>
                )
              })}
            </Grid>
          </VStack>
        ))}
      </LedgerCard>

      {/* 대사 */}
      <LedgerCard title="대사">
        <Text type="supporting" color="secondary">우리 매장에서 캐릭터가 말풍선으로 해요. '/'를 넣으면 두 줄. 기준이 '기본'이 아니면 그 조건이 되는 직원만 해요. 저장은 위의 '저장'</Text>
        <HStack gap={2} vAlign="center" wrap="wrap">
          <Text>일하면서 한마디 간격</Text>
          <Selector label="한마디 간격" isLabelHidden size="sm" value={String(lineEveryOf(rules))} onChange={v=>v != null && setRules(r => ({ ...r, lineEvery: +v }))}
            options={[[30,'30초마다'],[50,'50초마다'],[90,'1분 30초마다'],[120,'2분마다'],[300,'5분마다'],[0,'안 함']].map(([v,l]) => ({ value:String(v), label:l }))}/>
          <Text type="supporting" color="secondary">(한 번에 5초 동안, 사람마다 다른 때)</Text>
        </HStack>
        {WHENS.map(w => (
          <VStack key={w.id} gap={2}>
            <HStack gap={2} vAlign="center"><Heading level={5}>{w.label}</Heading><Button size="sm" label="+ 대사 추가" onClick={()=>addLine(w.id)}/></HStack>
            {lines.filter(l => l.when === w.id).map(l => (
              <HStack key={l.id} gap={2} vAlign="end" wrap="wrap">
                <TextInput label={`${w.label} 대사`} isLabelHidden placeholder="대사 (예: 짬뽕 나갑니다!)" value={l.text} onChange={v=>patchLine(l.id, { text:v })}/>
                {(w.id === 'work' || w.id === 'busy' || w.id === 'rest') && (
                  <Selector label="누가 (자리)" isLabelHidden size="sm" value={l.pos || 'any'} onChange={v=>v && patchLine(l.id, { pos:v })} options={LINE_POS.map(x => ({ value:x.id, label:x.label }))}/>
                )}
                {l.pos !== 'boss' && <Selector label="지급 기준" isLabelHidden size="sm" value={l.tier || 'base'} onChange={v=>v && patchLine(l.id, { tier:v })} options={tierOpts}/>}
                <Button size="sm" variant="ghost" label="삭제" onClick={()=>setLines(ls => ls.filter(x => x.id !== l.id))}/>
              </HStack>
            ))}
            {!lines.some(l => l.when === w.id) && <Text type="supporting" color="secondary">대사 없음 (이때는 말풍선이 안 떠요)</Text>}
          </VStack>
        ))}
      </LedgerCard>
    </VStack>
    </AstryxPage>
  )
}
