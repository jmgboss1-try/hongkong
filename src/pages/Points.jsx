import { useEffect, useState } from 'react'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { TextInput } from '@astryxdesign/core/TextInput'
import { CheckboxInput } from '@astryxdesign/core/CheckboxInput'
import { Text } from '@astryxdesign/core/Text'
import { Banner } from '@astryxdesign/core/Banner'
import { TabList, Tab } from '@astryxdesign/core/TabList'
import { Card } from '@astryxdesign/core/Card'
import { Grid } from '@astryxdesign/core/Grid'
import { Button } from '@astryxdesign/core/Button'
import { Badge } from '@astryxdesign/core/Badge'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Table } from '@astryxdesign/core/Table'
import { List, ListItem } from '@astryxdesign/core/List'
import { EmptyState } from '@astryxdesign/core/EmptyState'
import { AstryxPage, Legacy, PageHeader, LedgerCard } from '../astryx/AstryxPage'
import CountUp from '../components/CountUp'
import { db } from '../firebase'
import { collection, doc, getDoc, getDocs, setDoc, arrayUnion } from 'firebase/firestore'
import { useAuth } from '../AuthContext'
import { compressImage } from '../components/PhotoAttach'
import { DEFAULT_POINT_CONFIG, loadPointConfig, loadShop, loadPersonal, loadPointMonths, pointLedger, effectiveStock, availableStock, todayStr } from '../lib/points'

// 포인트 (직원·사장님): 내 포인트 / 포인트 상점 / 교환 이력(누가 무엇을 교환했는지만 공개)
// 사장님은 신청 처리(코드·이미지 넣고 승인, 직접 전달, 거절), 상점 관리, 직원 포인트(조정), 설정
const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', soft:'#ECE8E1', chip:'#F3F1EC', paper:'#FAF9F6', accent:'var(--hk-accent)', green:'#2E7D45', red:'#B42318', blue:'#2B5C9E', amber:'#B45309' }
const P = n => `${(+n || 0).toLocaleString('ko-KR')}P`
const sign = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('ko-KR')
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return todayStr(x) }


export default function Points() {
  const { user, userData, isOwner } = useAuth()
  const [config, setConfig] = useState(null)
  const [shop, setShop] = useState({ items:[], requests:[] })
  const [months, setMonths] = useState({})
  const [staff, setStaff] = useState([])            // 사장님: 직원 전체 / 직원: 나
  const [personal, setPersonal] = useState({})      // uid → {adjust, games, ok}
  const [tab, setTab] = useState(isOwner ? 'requests' : 'mine')
  const [msg, setMsg] = useState('')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    if (!user) return
    let off = false
    ;(async () => {
      const [cfg, sh] = await Promise.all([loadPointConfig(), loadShop()])
      let people = [{ uid:user.uid, ...userData }]
      if (isOwner) {
        const us = await getDocs(collection(db, 'users'))
        people = []
        us.forEach(d => { const u = d.data(); if (u.status === 'approved' && !['owner','store','investor'].includes(u.role)) people.push({ uid:d.id, ...u }) })
        people.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'))
      }
      const [mo, pers] = await Promise.all([loadPointMonths(cfg), Promise.all(people.map(p => loadPersonal(p.uid)))])
      if (off) return
      setConfig(cfg); setShop(sh); setMonths(mo); setStaff(people)
      setPersonal(Object.fromEntries(people.map((p, i) => [p.uid, pers[i]])))
    })().catch(e => { console.error(e); setMsg('불러오지 못했어요') })
    return () => { off = true }
  }, [user?.uid, isOwner, reload]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!config) return <div style={{color:T.sub}}>{msg || '불러오는 중...'}</div>
  const ledgerOf = u => pointLedger({ uid:u.uid, user:u, config, months, personal: personal[u.uid], requests: shop.requests })
  const refresh = () => setReload(k => k + 1)
  const tabs = isOwner
    ? [['requests', `교환 신청${shop.requests.filter(r => r.status === 'pending').length ? ` ${shop.requests.filter(r => r.status === 'pending').length}` : ''}`], ['shop','상점 관리'], ['people','직원 포인트'], ['history','교환 이력'], ['settings','설정']]
    : [['mine','내 포인트'], ['shop','포인트 상점'], ['history','교환 이력']]

  return (
    <AstryxPage>
    <VStack gap={4} maxWidth={900}>
      <PageHeader title="포인트" right={<Text color="secondary">{config.start.replace('-', '년 ').replace(/^(\d+년 )0?/, '$1')}월부터 적립</Text>}/>
      <TabList value={tab} onChange={setTab} hasDivider overflow="auto">
        {tabs.map(([k, l]) => <Tab key={k} value={k} label={l}/>)}
      </TabList>
      {msg && <Banner status={msg.includes('못') ? 'error' : 'success'} title={msg}/>}

      {tab === 'mine' && <Mine me={staff[0]} ledger={ledgerOf(staff[0])} requests={shop.requests.filter(r => r.uid === user.uid)} uid={user.uid} personalOk={personal[user.uid]?.ok}/>}
      {tab === 'shop' && !isOwner && <Shop shop={shop} balance={ledgerOf(staff[0]).balance} me={staff[0]} onDone={(m)=>{ setMsg(m); refresh() }}/>}
      {tab === 'history' && <History requests={shop.requests}/>}
      {tab === 'shop' && isOwner && <ShopAdmin shop={shop} onDone={(m)=>{ setMsg(m); refresh() }}/>}
      {tab === 'requests' && isOwner && <Requests shop={shop} onDone={(m)=>{ setMsg(m); refresh() }}/>}
      {tab === 'people' && isOwner && <People staff={staff} ledgerOf={ledgerOf} personal={personal} onDone={(m)=>{ setMsg(m); refresh() }}/>}
      {tab === 'settings' && isOwner && <Settings config={config} onDone={(m)=>{ setMsg(m); refresh() }}/>}
    </VStack>
    </AstryxPage>
  )
}

// ── 직원: 내 포인트 (Astryx) ──
function Mine({ me, ledger, requests, uid, personalOk }) {
  const [code, setCode] = useState(null)
  const entries = [...ledger.entries].reverse().map((e, i) => ({ ...e, id: i }))
  return (
    <VStack gap={4}>
      <Card variant="red">
        <VStack gap={0}>
          <Text type="label" color="inherit">{me?.name}님 포인트</Text>
          <Text type="display-2" color="inherit" hasTabularNumbers><CountUp value={ledger.balance}/>P</Text>
        </VStack>
      </Card>
      {personalOk === false && <Banner status="warning" title="사장님 조정·게임 포인트를 불러오지 못했어요" description="권한 설정 확인 중이에요"/>}

      {requests.length > 0 && (
        <LedgerCard title="내 교환">
          <List hasDividers edge="flush">
            {[...requests].reverse().map(r => (
              <ListItem key={r.id} label={r.itemName} description={`${String(r.at).slice(0,10)} · ${P(r.cost)}`}
                endContent={r.status === 'pending' ? <Badge variant="warning" label="사장님 확인 대기"/>
                  : r.status === 'rejected' ? <Badge label="취소됨 (포인트 돌려받음)"/>
                  : r.how === 'direct' ? <Badge variant="success" label="사장님이 직접 드려요"/>
                  : <Button size="sm" variant="primary" label="받기 (코드 보기)" onClick={()=>setCode(r)}/>}/>
            ))}
          </List>
        </LedgerCard>
      )}

      <LedgerCard title="포인트 내역">
        {entries.length === 0 ? <Text color="secondary">아직 내역이 없어요</Text> : (
          <Table data={entries} idKey="id" density="compact" columns={[
            { key:'date', header:'날짜', renderCell: e => <Text type="supporting" color="secondary" hasTabularNumbers>{e.date}</Text> },
            { key:'note', header:'내용', renderCell: e => <Text>{e.note}</Text> },
            { key:'amt', header:'포인트', align:'end', renderCell: e => <Text weight="bold" color={e.amount > 0 ? 'primary' : 'accent'} hasTabularNumbers>{sign(e.applied)}</Text> },
            { key:'bal', header:'잔액', align:'end', renderCell: e => <Text color="secondary" hasTabularNumbers>{P(e.balance)}</Text> },
          ]}/>
        )}
      </LedgerCard>
      {code && <CodeView uid={uid} req={code} onClose={()=>setCode(null)}/>}
    </VStack>
  )
}

function CodeView({ uid, req, onClose }) {
  const [c, setC] = useState(null)
  useEffect(() => { getDoc(doc(db, 'points', uid, 'codes', req.id)).then(s => setC(s.exists() ? s.data() : {})).catch(() => setC({ err:true })) }, [uid, req.id])
  return (
    <Dialog isOpen onOpenChange={o => { if (!o) onClose() }} width={420} maxHeight="90dvh">
      <DialogHeader title={req.itemName} onOpenChange={o => { if (!o) onClose() }}/>
      <VStack gap={3} padding={4}>
        {!c && <Text color="secondary">불러오는 중...</Text>}
        {c?.err && <Banner status="error" title="불러오지 못했어요. 사장님께 말씀해 주세요"/>}
        {c && !c.err && <>
          {c.img && <Legacy><img src={c.img} alt="상품 코드" style={{width:'100%', borderRadius:4, border:`1px solid ${T.rule}`}}/></Legacy>}
          {c.text && <Card variant="muted" padding={3}><HStack hAlign="center"><Text type="large" weight="bold" textWrap="wrap" hasTabularNumbers>{c.text}</Text></HStack></Card>}
          {c.note && <Text color="secondary">{c.note}</Text>}
          {!c.img && !c.text && !c.note && <Text color="secondary">아직 코드가 없어요. 사장님께 말씀해 주세요</Text>}
        </>}
        <HStack><Button label="닫기" onClick={onClose}/></HStack>
      </VStack>
    </Dialog>
  )
}

// ── 직원: 포인트 상점 ──
function Shop({ shop, balance, me, onDone }) {
  const [busy, setBusy] = useState(false)
  const today = todayStr()
  async function exchange(item) {
    if (balance < item.cost) return alert('포인트가 모자라요')
    if (availableStock(item, shop.requests, today) <= 0) return alert('지금은 품절이에요')
    if (!window.confirm(`${item.name}을(를) ${P(item.cost)}로 교환할까요? 사장님이 확인하면 받을 수 있어요`)) return
    setBusy(true)
    try {
      await setDoc(doc(db, 'rewards', 'shop'), { requests: arrayUnion({ id:newId(), uid:me.uid, name:me.name || '', itemId:item.id, itemName:item.name, cost:+item.cost, at:new Date().toISOString(), status:'pending' }) }, { merge:true })
      onDone('교환 신청했어요. 사장님이 확인하면 내 포인트에서 받을 수 있어요')
    } catch(e) { console.error(e); onDone('신청하지 못했어요. 다시 시도해 주세요') }
    setBusy(false)
  }
  const items = shop.items.filter(i => !i.hidden)
  return (
    <VStack gap={4}>
      <Text type="large">내 포인트 <Text type="inherit" weight="bold" color="accent" hasTabularNumbers>{P(balance)}</Text></Text>
      {items.length === 0 ? <EmptyState title="아직 상품이 없어요" isCompact/> : (
        <Grid columns={{ minWidth: 200, max: 4, repeat: 'fit' }} gap={3}>
          {items.map(it => {
            const left = availableStock(it, shop.requests, today)
            return (
              <Card key={it.id}>
                <VStack gap={2}>
                  {it.img && <Legacy><img src={it.img} alt="" style={{width:'100%', aspectRatio:'4/3', objectFit:'cover', borderRadius:10, display:'block'}}/></Legacy>}
                  <Text type="large" weight="bold">{it.name}</Text>
                  {it.desc && <Text type="supporting" color="secondary">{it.desc}</Text>}
                  <Text type="large" weight="bold" color="accent" hasTabularNumbers>{P(it.cost)}</Text>
                  <Text type="supporting" color={left ? 'secondary' : 'accent'}>{left ? `남은 수량 ${left}개` : it.restockAt && it.restockAt > today ? `품절 · ${it.restockAt} 재입고` : '품절'}</Text>
                  <Button variant="primary" size="sm" label={balance < it.cost ? '포인트 모자람' : '교환하기'} isDisabled={busy || !left || balance < it.cost} onClick={()=>exchange(it)}/>
                </VStack>
              </Card>
            )
          })}
        </Grid>
      )}
    </VStack>
  )
}

// ── 공개: 교환 이력 (누가 어떤 상품을) ──
function History({ requests }) {
  const done = requests.filter(r => r.status === 'approved').sort((a, b) => String(b.decidedAt || b.at).localeCompare(String(a.decidedAt || a.at)))
  return done.length === 0 ? <EmptyState title="아직 교환한 사람이 없어요" isCompact/> : (
    <Card>
      <Table data={done} idKey="id" density="compact" columns={[
        { key:'d', header:'날짜', renderCell: r => <Text type="supporting" color="secondary" hasTabularNumbers>{String(r.decidedAt || r.at).slice(0,10)}</Text> },
        { key:'n', header:'이름', renderCell: r => <Text weight="bold">{r.name}</Text> },
        { key:'i', header:'상품', renderCell: r => <Text>{r.itemName}</Text> },
      ]}/>
    </Card>
  )
}

// ── 사장님: 교환 신청 처리 ──
function Requests({ shop, onDone }) {
  const [open, setOpen] = useState(null)      // 승인 폼 { req, img, text, note }
  const [busy, setBusy] = useState(false)
  const pending = shop.requests.filter(r => r.status === 'pending')
  async function decide(req, status, extra = {}) {
    setBusy(true)
    try {
      const fresh = await loadShop()
      const r = fresh.requests.find(x => x.id === req.id)
      if (!r || r.status !== 'pending') { setBusy(false); return onDone('이미 처리된 신청이에요') }
      let items = fresh.items
      if (status === 'approved') {
        const today = todayStr()
        items = fresh.items.map(it => {
          if (it.id !== r.itemId) return it
          const stock = Math.max(0, effectiveStock(it, today) - 1)
          return { ...it, stock, restockAt: stock === 0 && (+it.restockDays || 0) > 0 ? addDays(new Date(), +it.restockDays) : stock === 0 ? null : it.restockAt || null }
        })
        if (extra.how === 'code') await setDoc(doc(db, 'points', r.uid, 'codes', r.id), { img: extra.img || '', text: extra.text || '', note: extra.note || '', at: new Date().toISOString() })
      }
      const requests = fresh.requests.map(x => x.id === r.id ? { ...x, status, decidedAt: new Date().toISOString(), ...(extra.how ? { how: extra.how } : {}) } : x)
      await setDoc(doc(db, 'rewards', 'shop'), { items, requests })
      setOpen(null)
      onDone(status === 'approved' ? `${r.name}님 ${r.itemName} 교환을 승인했어요` : `${r.name}님 신청을 거절했어요 (포인트는 돌아가요)`)
    } catch(e) { console.error(e); onDone('저장하지 못했어요. (points 규칙이 필요할 수 있어요)') }
    setBusy(false)
  }
  return (
    <LedgerCard title="교환 신청">
      {pending.length === 0 && <EmptyState title="기다리는 신청이 없어요"/>}
      <List hasDividers edge="flush">
        {pending.map(r => (
          <ListItem key={r.id} align="start"
            label={<HStack gap={2} vAlign="center" wrap="wrap"><Text weight="bold">{r.name}</Text><Text>{r.itemName}</Text><Text color="accent" hasTabularNumbers>{P(r.cost)}</Text></HStack>}
            description={<VStack gap={2}>
              <Text type="supporting" color="secondary" hasTabularNumbers>{String(r.at).slice(0,16).replace('T',' ')}</Text>
              <HStack gap={2} wrap="wrap">
                <Button size="sm" variant="primary" label="코드·이미지 넣고 승인" isDisabled={busy} onClick={()=>setOpen({ req:r, img:'', text:'', note:'' })}/>
                <Button size="sm" label="직접 전달로 승인" isDisabled={busy} onClick={()=>decide(r, 'approved', { how:'direct' })}/>
                <Button size="sm" variant="destructive" label="거절" isDisabled={busy} onClick={()=>{ if (window.confirm('이 신청을 거절할까요? 포인트는 돌아가요')) decide(r, 'rejected') }}/>
              </HStack>
              {open?.req.id === r.id && (
                <Card variant="muted" padding={3}>
                  <VStack gap={2}>
                    <Text type="label">상품권 바코드·QR 이미지 (선택)</Text>
                    <Legacy>
                      <input type="file" accept="image/*" aria-label="상품권 이미지" onChange={async e => { const f = e.target.files?.[0]; if (f) { const img = await compressImage(f, 900, 160); setOpen(o => ({ ...o, img })) } }}/>
                      {open.img && <img src={open.img} alt="" style={{maxWidth:240, display:'block', marginTop:6}}/>}
                    </Legacy>
                    <TextInput label="선물 코드·바코드 번호" isOptional value={open.text} onChange={v=>setOpen(o=>({ ...o, text:v }))}/>
                    <TextInput label="안내" isOptional placeholder="예: 유효기간 2027-01-31" value={open.note} onChange={v=>setOpen(o=>({ ...o, note:v }))}/>
                    <HStack gap={2}>
                      <Button variant="primary" label="승인하고 보내기" isDisabled={busy || (!open.img && !open.text.trim())} onClick={()=>decide(r, 'approved', { how:'code', img:open.img, text:open.text.trim(), note:open.note.trim() })}/>
                      <Button label="취소" onClick={()=>setOpen(null)}/>
                    </HStack>
                  </VStack>
                </Card>
              )}
            </VStack>}/>
        ))}
      </List>
    </LedgerCard>
  )
}

// ── 사장님: 상점 관리 ──
function ShopAdmin({ shop, onDone }) {
  const [edit, setEdit] = useState(null)
  const [busy, setBusy] = useState(false)
  const today = todayStr()
  async function saveItems(fn, okMsg) {
    setBusy(true)
    try {
      const fresh = await loadShop()
      await setDoc(doc(db, 'rewards', 'shop'), { items: fn(fresh.items), requests: fresh.requests })
      setEdit(null); onDone(okMsg)
    } catch(e) { console.error(e); onDone('저장하지 못했어요') }
    setBusy(false)
  }
  const save = () => {
    const e = edit
    if (!e.name.trim()) return alert('상품 이름을 넣어 주세요')
    const clean = { ...e, name:e.name.trim(), cost:+e.cost || 0, qty:+e.qty || 0, stock:+e.stock || 0, restockDays:+e.restockDays || 0, restockAt: (+e.stock || 0) > 0 ? null : e.restockAt || null }
    saveItems(items => items.some(i => i.id === e.id) ? items.map(i => i.id === e.id ? clean : i) : [...items, clean], '상품을 저장했어요')
  }
  const field = (k, l, numeric) => (
    <TextInput key={k} label={l} inputMode={numeric ? 'numeric' : undefined} value={String(edit[k] ?? '')} onChange={v=>setEdit(x=>({ ...x, [k]: numeric ? v.replace(/[^0-9]/g, '') : v }))}/>
  )
  return (
    <LedgerCard title="상점 관리" right={<Button size="sm" variant="primary" label="+ 상품 추가" onClick={()=>setEdit({ id:newId(), name:'', cost:100, qty:1, stock:1, restockDays:30, desc:'', img:'' })}/>}>
      <Text type="supporting" color="secondary">재고가 0이 되면 재입고 기간이 지난 뒤 '입고 수량'만큼 다시 열려요</Text>
      {edit && (
        <Card variant="muted" padding={3}>
          <VStack gap={3}>
            <Grid columns={{ minWidth: 160 }} gap={2}>
              {field('name', '상품 이름')}
              {field('cost', '필요 포인트', true)}
              {field('stock', '지금 재고', true)}
              {field('qty', '입고 수량 (다시 들어올 때)', true)}
              {field('restockDays', '재입고까지 (일)', true)}
            </Grid>
            <TextInput label="설명" isOptional placeholder="예: 스타벅스 아메리카노 T" value={edit.desc} onChange={v=>setEdit(x=>({ ...x, desc:v }))}/>
            <Text type="label">상품 사진 (선택, 상점에 보이는 그림)</Text>
            <Legacy>
              <input type="file" accept="image/*" aria-label="상품 사진" onChange={async e => { const f = e.target.files?.[0]; if (f) { const img = await compressImage(f, 600, 70); setEdit(x => ({ ...x, img })) } }}/>
              {edit.img && <img src={edit.img} alt="" style={{maxWidth:160, display:'block', marginTop:6}}/>}
            </Legacy>
            <CheckboxInput label="직원 화면에서 숨김" value={!!edit.hidden} onChange={v=>setEdit(x=>({ ...x, hidden:v }))}/>
            <HStack gap={2}><Button variant="primary" label="저장" isDisabled={busy} onClick={save}/><Button label="취소" onClick={()=>setEdit(null)}/></HStack>
          </VStack>
        </Card>
      )}
      {shop.items.length === 0 && <EmptyState title="아직 상품이 없어요"/>}
      <List hasDividers edge="flush">
        {shop.items.map(it => (
          <ListItem key={it.id}
            startContent={it.img ? <Legacy><img src={it.img} alt="" style={{width:44, height:33, objectFit:'cover', borderRadius:3, display:'block'}}/></Legacy> : undefined}
            label={<HStack gap={2} vAlign="center"><Text weight="bold" color={it.hidden ? 'secondary' : 'primary'}>{it.name}</Text>{it.hidden && <Badge label="숨김"/>}<Text color="accent" hasTabularNumbers>{P(it.cost)}</Text></HStack>}
            description={<Text type="supporting" color="secondary" hasTabularNumbers>재고 {effectiveStock(it, today)} · 대기 {shop.requests.filter(r => r.itemId === it.id && r.status === 'pending').length}{it.restockAt && effectiveStock(it, today) === 0 ? ` · ${it.restockAt} 재입고` : ''}</Text>}
            endContent={<HStack gap={1}>
              <Button size="sm" variant="ghost" label="수정" onClick={()=>setEdit({ ...it, desc: it.desc || '', img: it.img || '' })}/>
              <Button size="sm" variant="ghost" label="삭제" onClick={()=>{ if (window.confirm(`${it.name}을(를) 지울까요?`)) saveItems(items => items.filter(i => i.id !== it.id), '상품을 지웠어요') }}/>
            </HStack>}/>
        ))}
      </List>
    </LedgerCard>
  )
}

// ── 사장님: 직원 포인트 ──
function People({ staff, ledgerOf, personal, onDone }) {
  const [open, setOpen] = useState(null)
  const [adj, setAdj] = useState({ amount:'', note:'' })
  async function addAdjust(u) {
    const amount = parseInt(String(adj.amount).replace(/[^0-9-]/g, ''), 10)
    if (!amount) return alert('더하거나 뺄 포인트를 넣어 주세요 (빼려면 -10 처럼)')
    try {
      await setDoc(doc(db, 'points', u.uid), { adjust: arrayUnion({ id:newId(), date:todayStr(), amount, note: adj.note.trim() || (amount > 0 ? '사장님 지급' : '사장님 차감') }) }, { merge:true })
      setAdj({ amount:'', note:'' }); onDone(`${u.name}님 ${amount > 0 ? '+' : ''}${amount}P 반영했어요`)
    } catch(e) { console.error(e); onDone('저장하지 못했어요. Firestore 규칙에 points 를 추가해 주세요') }
  }
  return (
    <LedgerCard title="직원 포인트">
      <List hasDividers edge="flush">
        {staff.map(u => {
          const l = ledgerOf(u)
          const isOpen = open === u.uid
          return (
            <ListItem key={u.uid} align="start" onClick={isOpen ? undefined : ()=>setOpen(u.uid)}
              label={<HStack gap={2} vAlign="center"><Text weight="bold">{u.name}</Text>{personal[u.uid]?.ok === false && <Badge variant="warning" label="개인 포인트 못 읽음"/>}</HStack>}
              description={isOpen ? (
                <VStack gap={2}>
                  <HStack gap={2} vAlign="end" wrap="wrap">
                    <TextInput label="포인트" placeholder="+20 또는 -10" width={120} value={adj.amount} onChange={v=>setAdj(a=>({ ...a, amount:v }))}/>
                    <TextInput label="사유" placeholder="예: 대청소 도움" value={adj.note} onChange={v=>setAdj(a=>({ ...a, note:v }))}/>
                    <Button variant="primary" label="포인트 조정" onClick={()=>addAdjust(u)}/>
                  </HStack>
                  <Table density="compact" idKey="i" data={[...l.entries].reverse().slice(0, 60).map((e, i) => ({ ...e, i }))}
                    columns={[
                      { key:'date', header:'날짜', renderCell: e => <Text color="secondary" hasTabularNumbers>{e.date}</Text> },
                      { key:'note', header:'내용', renderCell: e => <Text>{e.note}</Text> },
                      { key:'applied', header:'변동', align:'end', renderCell: e => <Text weight="bold" color={e.amount > 0 ? 'accent' : 'secondary'} hasTabularNumbers>{sign(e.applied)}</Text> },
                      { key:'balance', header:'잔액', align:'end', renderCell: e => <Text hasTabularNumbers>{P(e.balance)}</Text> },
                    ]}/>
                </VStack>
              ) : undefined}
              endContent={<HStack gap={2} vAlign="center">
                <Text type="large" weight="bold" color="accent" hasTabularNumbers>{P(l.balance)}</Text>
                <Button size="sm" variant="ghost" label={isOpen ? '접기' : '내역'} onClick={()=>setOpen(isOpen ? null : u.uid)}/>
              </HStack>}/>
          )
        })}
      </List>
    </LedgerCard>
  )
}

// ── 사장님: 설정 ──
function Settings({ config, onDone }) {
  const [c, setC] = useState({ ...DEFAULT_POINT_CONFIG, ...config })
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      const clean = { ...c, monthly:+c.monthly||0, boost:+c.boost||0, late:+c.late||0, absent:+c.absent||0, streakExtra:+c.streakExtra||0, lateHalf:+c.lateHalf||0, lateHalfPct:Math.min(100, Math.max(1, +c.lateHalfPct||50)) }
      await setDoc(doc(db, 'rewards', 'points'), clean); onDone('설정을 저장했어요')
    } catch(e) { console.error(e); onDone('저장하지 못했어요') }
    setBusy(false)
  }
  const row = (k, label, hint, type = 'number') => (
    <ListItem key={k} label={label} description={hint}
      endContent={<TextInput label={label} isLabelHidden width={type === 'month' ? 130 : 100} placeholder={type === 'month' ? 'YYYY-MM' : undefined}
        inputMode={type === 'number' ? 'numeric' : undefined} value={String(c[k] ?? '')}
        onChange={v=>setC(x=>({ ...x, [k]: type === 'number' ? v.replace(/[^0-9]/g, '') : v }))}/>}/>
  )
  return (
    <LedgerCard title="포인트 설정">
      <List hasDividers edge="flush">
        {row('start', '적립 시작 달', '이 달부터 매달 기본 포인트가 쌓여요 (예: 2026-10)', 'month')}
        {row('monthly', '매달 기본 포인트', '모든 직원 (입사한 달부터)')}
        {row('boost', '개근 부스트', '개근한 다음 달에 더 줘요')}
        {row('late', '지각 감점', '한 번마다')}
        {row('absent', '결근 감점', '한 번마다 (결근 아님 처리한 날은 빼요)')}
        {row('streakExtra', '연속 추가 감점', '바로 앞 근무일도 지각·결근이면 더 빼요')}
        {row('lateHalf', '지각 잦은 달 감점', '한 달이 끝났을 때 아래 비율 이상 지각했으면 그 달 마지막 날 한 번 더 빼요 (0이면 안 함)')}
        {row('lateHalfPct', '지각 비율 기준 (%)', '그 달 출근한 날 중 지각한 날의 비율. 50 = 절반 이상')}
      </List>
      <TextInput label="개근 게임 상품 (룰렛·사다리에 들어갈 칸, 쉼표로)" description="예: 30포인트, 20포인트, 10포인트, 꽝 · 게임 결과는 근무관리의 개근 포상에서 '포인트 지급'으로 넣어요"
        value={c.prizes} onChange={v=>setC(x=>({ ...x, prizes:v }))}/>
      <Text type="supporting" color="secondary">잔액은 0 아래로 내려가지 않아요. 포인트는 퇴사하면 사라져요. 바꾼 숫자는 지난 내역에도 다시 계산돼서 적용돼요.</Text>
      <HStack><Button variant="primary" label={busy ? '저장 중...' : '저장'} isDisabled={busy} onClick={save}/></HStack>
    </LedgerCard>
  )
}
