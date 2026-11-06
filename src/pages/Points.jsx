import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { collection, doc, getDoc, getDocs, setDoc, arrayUnion } from 'firebase/firestore'
import { useAuth } from '../AuthContext'
import { compressImage } from '../components/PhotoAttach'
import { DEFAULT_POINT_CONFIG, loadPointConfig, loadShop, loadPersonal, loadPointMonths, pointLedger, effectiveStock, availableStock, todayStr } from '../lib/points'

// 포인트 (직원·사장님): 내 포인트 / 포인트 상점 / 교환 이력(누가 무엇을 교환했는지만 공개)
// 사장님은 신청 처리(코드·이미지 넣고 승인, 직접 전달, 거절), 상점 관리, 직원 포인트(조정), 설정
const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', soft:'#ECE8E1', chip:'#F3F1EC', paper:'#FAF9F6', accent:'#C3261C', green:'#2E7D45', red:'#B42318', blue:'#2B5C9E', amber:'#B45309' }
const num = { fontVariantNumeric:'tabular-nums' }
const P = n => `${(+n || 0).toLocaleString('ko-KR')}P`
const sign = n => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toLocaleString('ko-KR')
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return todayStr(x) }

function Btn({ children, onClick, kind = 'plain', disabled, small }) {
  const solid = kind === 'primary' || kind === 'ok'
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{fontFamily:'inherit', cursor: disabled ? 'default' : 'pointer', borderRadius:4, whiteSpace:'nowrap', fontSize: small ? 12 : 13, padding: small ? '4px 9px' : '7px 14px',
        fontWeight: solid ? 700 : 500, opacity: disabled ? 0.5 : 1, background: kind === 'primary' ? T.accent : kind === 'ok' ? T.green : '#FFFFFF',
        color: solid ? '#FFFFFF' : kind === 'danger' ? T.red : T.ink, border: solid ? 'none' : `1px solid ${kind === 'danger' ? '#E8C4BF' : T.rule}`}}>{children}</button>
  )
}
const inp = { fontFamily:'inherit', fontSize:14, padding:'6px 8px', border:`1px solid ${T.rule}`, borderRadius:4, background:'#FFFFFF', color:T.ink }
const h2 = t => <h2 style={{fontSize:16, fontWeight:800, margin:'18px 0 6px', fontFamily:'inherit', borderBottom:`2px solid ${T.ink}`, paddingBottom:4}}>{t}</h2>

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
    <div style={{maxWidth:900}}>
      <header style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:12, flexWrap:'wrap', paddingBottom:10, borderBottom:`3px double ${T.ink}`, marginBottom:8}}>
        <h1 style={{fontSize:24, fontWeight:800, margin:0, fontFamily:'inherit'}}>포인트</h1>
        <div style={{fontSize:13, color:T.sub}}>{config.start.replace('-', '년 ').replace(/^(\d+년 )0?/, '$1')}월부터 적립</div>
      </header>
      <div style={{display:'flex', gap:16, borderBottom:`1px solid ${T.rule}`, marginBottom:10, flexWrap:'wrap'}}>
        {tabs.map(([k, l]) => (
          <button key={k} type="button" onClick={()=>setTab(k)}
            style={{background:'none', border:'none', borderBottom:`2px solid ${tab===k ? T.accent : 'transparent'}`, padding:'8px 0', fontFamily:'inherit', fontSize:15,
              fontWeight: tab===k ? 800 : 500, color: tab===k ? T.ink : T.sub, cursor:'pointer'}}>{l}</button>
        ))}
      </div>
      {msg && <div style={{fontSize:13, color: msg.includes('못') ? T.red : T.green, margin:'4px 0'}}>{msg}</div>}

      {tab === 'mine' && <Mine me={staff[0]} ledger={ledgerOf(staff[0])} requests={shop.requests.filter(r => r.uid === user.uid)} uid={user.uid} personalOk={personal[user.uid]?.ok}/>}
      {tab === 'shop' && !isOwner && <Shop shop={shop} balance={ledgerOf(staff[0]).balance} me={staff[0]} onDone={(m)=>{ setMsg(m); refresh() }}/>}
      {tab === 'shop' && isOwner && <ShopAdmin shop={shop} onDone={(m)=>{ setMsg(m); refresh() }}/>}
      {tab === 'requests' && isOwner && <Requests shop={shop} onDone={(m)=>{ setMsg(m); refresh() }}/>}
      {tab === 'people' && isOwner && <People staff={staff} ledgerOf={ledgerOf} personal={personal} onDone={(m)=>{ setMsg(m); refresh() }}/>}
      {tab === 'history' && <History requests={shop.requests}/>}
      {tab === 'settings' && isOwner && <Settings config={config} onDone={(m)=>{ setMsg(m); refresh() }}/>}
    </div>
  )
}

// ── 직원: 내 포인트 ──
function Mine({ me, ledger, requests, uid, personalOk }) {
  const [code, setCode] = useState(null)
  return (
    <div>
      <div style={{display:'flex', alignItems:'baseline', gap:10, padding:'10px 0'}}>
        <span style={{fontSize:14, color:T.sub}}>{me?.name}님 포인트</span>
        <span style={{fontSize:30, fontWeight:900, color:T.accent, ...num}}>{P(ledger.balance)}</span>
      </div>
      {personalOk === false && <div style={{fontSize:12, color:T.amber}}>사장님 조정·게임 포인트를 불러오지 못했어요 (권한 설정 확인 중)</div>}

      {requests.length > 0 && <>
        {h2('내 교환')}
        {[...requests].reverse().map(r => (
          <div key={r.id} style={{display:'flex', alignItems:'center', gap:10, padding:'7px 0', borderBottom:`1px solid ${T.soft}`, fontSize:14, flexWrap:'wrap'}}>
            <span style={{color:T.sub, ...num, minWidth:84}}>{String(r.at).slice(0,10)}</span>
            <b style={{flex:1}}>{r.itemName}</b>
            <span style={{...num}}>{P(r.cost)}</span>
            {r.status === 'pending' && <span style={{color:T.amber, fontWeight:700, fontSize:13}}>사장님 확인 대기</span>}
            {r.status === 'rejected' && <span style={{color:T.sub, fontSize:13}}>취소됨 (포인트 돌려받음)</span>}
            {r.status === 'approved' && (r.how === 'direct'
              ? <span style={{color:T.green, fontWeight:700, fontSize:13}}>사장님이 직접 드려요</span>
              : <Btn kind="ok" small onClick={()=>setCode(r)}>받기 (코드 보기)</Btn>)}
          </div>
        ))}
      </>}

      {h2('포인트 내역')}
      {ledger.entries.length === 0 && <div style={{fontSize:13, color:T.sub}}>아직 내역이 없어요</div>}
      {[...ledger.entries].reverse().map((e, i) => (
        <div key={i} style={{display:'flex', alignItems:'baseline', gap:10, padding:'6px 0', borderBottom:`1px solid ${T.soft}`, fontSize:13}}>
          <span style={{color:T.sub, ...num, minWidth:84}}>{e.date}</span>
          <span style={{flex:1}}>{e.note}</span>
          <span style={{...num, fontWeight:700, color: e.amount > 0 ? T.green : T.red}}>{sign(e.applied)}</span>
          <span style={{...num, color:T.sub, minWidth:64, textAlign:'right'}}>{P(e.balance)}</span>
        </div>
      ))}
      {code && <CodeView uid={uid} req={code} onClose={()=>setCode(null)}/>}
    </div>
  )
}

function CodeView({ uid, req, onClose }) {
  const [c, setC] = useState(null)
  useEffect(() => { getDoc(doc(db, 'points', uid, 'codes', req.id)).then(s => setC(s.exists() ? s.data() : {})).catch(() => setC({ err:true })) }, [uid, req.id])
  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, zIndex:50, background:'rgba(29,27,24,0.55)', display:'flex', alignItems:'center', justifyContent:'center', padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'#FFFFFF', borderRadius:8, padding:'18px 18px 14px', width:'100%', maxWidth:420, maxHeight:'90vh', overflowY:'auto'}}>
        <div style={{fontSize:18, fontWeight:900}}>{req.itemName}</div>
        {!c && <div style={{color:T.sub, padding:'20px 0'}}>불러오는 중...</div>}
        {c?.err && <div style={{color:T.red, padding:'20px 0'}}>불러오지 못했어요. 사장님께 말씀해 주세요</div>}
        {c && !c.err && <>
          {c.img && <img src={c.img} alt="상품 코드" style={{width:'100%', marginTop:12, borderRadius:4, border:`1px solid ${T.rule}`}}/>}
          {c.text && <div style={{marginTop:12, fontSize:20, fontWeight:800, letterSpacing:1, textAlign:'center', padding:'10px', background:T.chip, borderRadius:4, wordBreak:'break-all', ...num}}>{c.text}</div>}
          {c.note && <div style={{marginTop:10, fontSize:14, color:T.sub, lineHeight:1.6}}>{c.note}</div>}
          {!c.img && !c.text && !c.note && <div style={{color:T.sub, padding:'20px 0'}}>아직 코드가 없어요. 사장님께 말씀해 주세요</div>}
        </>}
        <div style={{marginTop:14}}><Btn onClick={onClose}>닫기</Btn></div>
      </div>
    </div>
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
    <div>
      <div style={{fontSize:14, padding:'6px 0 10px'}}>내 포인트 <b style={{color:T.accent, ...num}}>{P(balance)}</b></div>
      {items.length === 0 && <div style={{fontSize:13, color:T.sub}}>아직 상품이 없어요</div>}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(min(100%, 200px), 1fr))', gap:12}}>
        {items.map(it => {
          const left = availableStock(it, shop.requests, today)
          return (
            <div key={it.id} style={{background:'#FFFFFF', border:`1px solid ${T.rule}`, borderRadius:6, overflow:'hidden', display:'flex', flexDirection:'column'}}>
              {it.img ? <img src={it.img} alt="" style={{width:'100%', aspectRatio:'4/3', objectFit:'cover', background:T.chip}}/> : <div style={{aspectRatio:'4/3', background:T.chip}}/>}
              <div style={{padding:'10px 12px', display:'flex', flexDirection:'column', gap:4, flex:1}}>
                <b style={{fontSize:15}}>{it.name}</b>
                {it.desc && <span style={{fontSize:12, color:T.sub}}>{it.desc}</span>}
                <span style={{fontSize:16, fontWeight:800, color:T.accent, ...num}}>{P(it.cost)}</span>
                <span style={{fontSize:12, color: left ? T.sub : T.red}}>{left ? `남은 수량 ${left}개` : it.restockAt && it.restockAt > today ? `품절 · ${it.restockAt} 재입고` : '품절'}</span>
                <div style={{marginTop:'auto', paddingTop:6}}><Btn kind="primary" small onClick={()=>exchange(it)} disabled={busy || !left || balance < it.cost}>{balance < it.cost ? '포인트 모자람' : '교환하기'}</Btn></div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── 공개: 교환 이력 (누가 어떤 상품을) ──
function History({ requests }) {
  const done = requests.filter(r => r.status === 'approved').sort((a, b) => String(b.decidedAt || b.at).localeCompare(String(a.decidedAt || a.at)))
  return (
    <div>
      {done.length === 0 && <div style={{fontSize:13, color:T.sub, padding:'8px 0'}}>아직 교환한 사람이 없어요</div>}
      {done.map(r => (
        <div key={r.id} style={{display:'flex', gap:10, padding:'7px 0', borderBottom:`1px solid ${T.soft}`, fontSize:14}}>
          <span style={{color:T.sub, ...num, minWidth:84}}>{String(r.decidedAt || r.at).slice(0,10)}</span>
          <b style={{minWidth:64}}>{r.name}</b>
          <span>{r.itemName}</span>
        </div>
      ))}
    </div>
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
    <div>
      {pending.length === 0 && <div style={{fontSize:13, color:T.sub, padding:'8px 0'}}>기다리는 신청이 없어요</div>}
      {pending.map(r => (
        <div key={r.id} style={{padding:'10px 0', borderBottom:`1px solid ${T.soft}`}}>
          <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', fontSize:14}}>
            <span style={{color:T.sub, ...num}}>{String(r.at).slice(0,16).replace('T',' ')}</span>
            <b>{r.name}</b><span>{r.itemName}</span><span style={{...num, color:T.accent}}>{P(r.cost)}</span>
            <span style={{flex:1}}/>
            <Btn kind="ok" small onClick={()=>setOpen({ req:r, img:'', text:'', note:'' })} disabled={busy}>코드·이미지 넣고 승인</Btn>
            <Btn small onClick={()=>decide(r, 'approved', { how:'direct' })} disabled={busy}>직접 전달로 승인</Btn>
            <Btn kind="danger" small onClick={()=>{ if (window.confirm('이 신청을 거절할까요? 포인트는 돌아가요')) decide(r, 'rejected') }} disabled={busy}>거절</Btn>
          </div>
          {open?.req.id === r.id && (
            <div style={{background:T.chip, borderRadius:6, padding:'10px 12px', marginTop:8, display:'flex', flexDirection:'column', gap:8}}>
              <label style={{fontSize:13}}>상품권 바코드·QR 이미지 (선택)
                <input type="file" accept="image/*" style={{display:'block', marginTop:4}} onChange={async e => { const f = e.target.files?.[0]; if (f) { const img = await compressImage(f, 900, 160); setOpen(o => ({ ...o, img })) } }}/>
              </label>
              {open.img && <img src={open.img} alt="" style={{maxWidth:240, border:`1px solid ${T.rule}`}}/>}
              <input value={open.text} onChange={e=>setOpen(o=>({ ...o, text:e.target.value }))} placeholder="선물 코드·바코드 번호 (선택)" style={inp}/>
              <input value={open.note} onChange={e=>setOpen(o=>({ ...o, note:e.target.value }))} placeholder="안내 (선택) 예: 유효기간 2027-01-31" style={inp}/>
              <div style={{display:'flex', gap:8}}>
                <Btn kind="ok" onClick={()=>decide(r, 'approved', { how:'code', img:open.img, text:open.text.trim(), note:open.note.trim() })} disabled={busy || (!open.img && !open.text.trim())}>승인하고 보내기</Btn>
                <Btn onClick={()=>setOpen(null)}>취소</Btn>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
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
  return (
    <div>
      <div style={{display:'flex', gap:8, alignItems:'center', margin:'4px 0 10px'}}>
        <Btn kind="primary" onClick={()=>setEdit({ id:newId(), name:'', cost:100, qty:1, stock:1, restockDays:30, desc:'', img:'' })}>+ 상품 추가</Btn>
        <span style={{fontSize:12, color:T.sub}}>재고가 0이 되면 재입고 기간이 지난 뒤 '입고 수량'만큼 다시 열려요</span>
      </div>
      {edit && (
        <div style={{background:T.chip, borderRadius:6, padding:'12px 14px', marginBottom:12, display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:8, alignItems:'end'}}>
          {[['name','상품 이름','text'],['cost','필요 포인트','number'],['stock','지금 재고','number'],['qty','입고 수량 (다시 들어올 때)','number'],['restockDays','재입고까지 (일)','number']].map(([k, l, t]) => (
            <label key={k} style={{fontSize:12, color:T.sub, display:'flex', flexDirection:'column', gap:4}}>{l}
              <input type={t} value={edit[k]} onChange={e=>setEdit(x=>({ ...x, [k]: e.target.value }))} style={inp}/>
            </label>
          ))}
          <label style={{fontSize:12, color:T.sub, display:'flex', flexDirection:'column', gap:4, gridColumn:'1 / -1'}}>설명 (선택)
            <input value={edit.desc} onChange={e=>setEdit(x=>({ ...x, desc:e.target.value }))} placeholder="예: 스타벅스 아메리카노 T" style={inp}/>
          </label>
          <label style={{fontSize:12, color:T.sub, gridColumn:'1 / -1'}}>상품 사진 (선택, 상점에 보이는 그림)
            <input type="file" accept="image/*" style={{display:'block', marginTop:4}} onChange={async e => { const f = e.target.files?.[0]; if (f) { const img = await compressImage(f, 600, 70); setEdit(x => ({ ...x, img })) } }}/>
          </label>
          {edit.img && <img src={edit.img} alt="" style={{maxWidth:160, gridColumn:'1 / -1'}}/>}
          <label style={{fontSize:13, display:'flex', gap:6, alignItems:'center', gridColumn:'1 / -1'}}><input type="checkbox" checked={!!edit.hidden} onChange={e=>setEdit(x=>({ ...x, hidden:e.target.checked }))}/> 직원 화면에서 숨김</label>
          <div style={{display:'flex', gap:8, gridColumn:'1 / -1'}}><Btn kind="primary" onClick={save} disabled={busy}>저장</Btn><Btn onClick={()=>setEdit(null)}>취소</Btn></div>
        </div>
      )}
      {shop.items.length === 0 && <div style={{fontSize:13, color:T.sub}}>아직 상품이 없어요</div>}
      {shop.items.map(it => (
        <div key={it.id} style={{display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:`1px solid ${T.soft}`, fontSize:14, flexWrap:'wrap', opacity: it.hidden ? 0.5 : 1}}>
          {it.img ? <img src={it.img} alt="" style={{width:44, height:33, objectFit:'cover', borderRadius:3}}/> : <span style={{width:44, height:33, background:T.chip, borderRadius:3}}/>}
          <b style={{flex:1, minWidth:120}}>{it.name}{it.hidden ? ' (숨김)' : ''}</b>
          <span style={{...num, color:T.accent}}>{P(it.cost)}</span>
          <span style={{...num, fontSize:13, color:T.sub}}>재고 {effectiveStock(it, today)} · 대기 {shop.requests.filter(r => r.itemId === it.id && r.status === 'pending').length}{it.restockAt && effectiveStock(it, today) === 0 ? ` · ${it.restockAt} 재입고` : ''}</span>
          <Btn small onClick={()=>setEdit({ ...it, desc: it.desc || '', img: it.img || '' })}>수정</Btn>
          <Btn kind="danger" small onClick={()=>{ if (window.confirm(`${it.name}을(를) 지울까요?`)) saveItems(items => items.filter(i => i.id !== it.id), '상품을 지웠어요') }}>삭제</Btn>
        </div>
      ))}
    </div>
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
    <div>
      {staff.map(u => {
        const l = ledgerOf(u)
        return (
          <div key={u.uid} style={{borderBottom:`1px solid ${T.soft}`}}>
            <button type="button" onClick={()=>setOpen(o => o === u.uid ? null : u.uid)}
              style={{display:'flex', width:'100%', alignItems:'baseline', gap:10, padding:'9px 0', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', color:T.ink, textAlign:'left'}}>
              <b style={{minWidth:72, fontSize:14}}>{u.name}</b>
              {personal[u.uid]?.ok === false && <span style={{fontSize:12, color:T.amber}}>개인 포인트 못 읽음</span>}
              <span style={{flex:1}}/>
              <span style={{fontSize:16, fontWeight:800, color:T.accent, ...num}}>{P(l.balance)}</span>
              <span style={{fontSize:12, color:T.blue}}>{open === u.uid ? '접기' : '내역'}</span>
            </button>
            {open === u.uid && (
              <div style={{padding:'0 0 12px 12px'}}>
                <div style={{display:'flex', gap:6, alignItems:'center', flexWrap:'wrap', margin:'4px 0 8px'}}>
                  <input value={adj.amount} onChange={e=>setAdj(a=>({ ...a, amount:e.target.value }))} placeholder="+20 또는 -10" style={{...inp, width:110}}/>
                  <input value={adj.note} onChange={e=>setAdj(a=>({ ...a, note:e.target.value }))} placeholder="사유 (예: 대청소 도움)" style={{...inp, flex:'1 1 160px'}}/>
                  <Btn kind="primary" small onClick={()=>addAdjust(u)}>포인트 조정</Btn>
                </div>
                {[...l.entries].reverse().slice(0, 60).map((e, i) => (
                  <div key={i} style={{display:'flex', gap:10, padding:'4px 0', fontSize:13, borderBottom:`1px dotted ${T.rule}`}}>
                    <span style={{color:T.sub, ...num, minWidth:84}}>{e.date}</span>
                    <span style={{flex:1}}>{e.note}</span>
                    <span style={{...num, fontWeight:700, color: e.amount > 0 ? T.green : T.red}}>{sign(e.applied)}</span>
                    <span style={{...num, color:T.sub, minWidth:60, textAlign:'right'}}>{P(e.balance)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── 사장님: 설정 ──
function Settings({ config, onDone }) {
  const [c, setC] = useState({ ...DEFAULT_POINT_CONFIG, ...config })
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      const clean = { ...c, monthly:+c.monthly||0, boost:+c.boost||0, late:+c.late||0, absent:+c.absent||0, streakExtra:+c.streakExtra||0 }
      await setDoc(doc(db, 'rewards', 'points'), clean); onDone('설정을 저장했어요')
    } catch(e) { console.error(e); onDone('저장하지 못했어요') }
    setBusy(false)
  }
  const row = (k, label, hint, type = 'number') => (
    <label style={{display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:`1px solid ${T.soft}`, fontSize:14, flexWrap:'wrap'}}>
      <span style={{minWidth:180}}>{label}</span>
      <input type={type} value={c[k]} onChange={e=>setC(x=>({ ...x, [k]: e.target.value }))} style={{...inp, width: type === 'month' ? 150 : 90, textAlign: type === 'number' ? 'right' : 'left'}}/>
      <span style={{fontSize:12, color:T.sub}}>{hint}</span>
    </label>
  )
  return (
    <div>
      {row('start', '적립 시작 달', '이 달부터 매달 기본 포인트가 쌓여요', 'month')}
      {row('monthly', '매달 기본 포인트', '모든 직원 (입사한 달부터)')}
      {row('boost', '개근 부스트', '개근한 다음 달에 더 줘요')}
      {row('late', '지각 감점', '한 번마다')}
      {row('absent', '결근 감점', '한 번마다 (결근 아님 처리한 날은 빼요)')}
      {row('streakExtra', '연속 추가 감점', '바로 앞 근무일도 지각·결근이면 더 빼요')}
      <label style={{display:'flex', flexDirection:'column', gap:6, padding:'8px 0', fontSize:14}}>
        개근 게임 상품 (룰렛·사다리에 들어갈 칸, 쉼표로)
        <input value={c.prizes} onChange={e=>setC(x=>({ ...x, prizes:e.target.value }))} style={inp}/>
        <span style={{fontSize:12, color:T.sub}}>예: 30포인트, 20포인트, 10포인트, 꽝 · 게임 결과는 근무관리의 개근 포상에서 '포인트 지급'으로 넣어요</span>
      </label>
      <div style={{fontSize:12, color:T.sub, margin:'4px 0 10px', lineHeight:1.6}}>잔액은 0 아래로 내려가지 않아요. 포인트는 퇴사하면 사라져요. 바꾼 숫자는 지난 내역에도 다시 계산돼서 적용돼요.</div>
      <Btn kind="primary" onClick={save} disabled={busy}>{busy ? '저장 중...' : '저장'}</Btn>
    </div>
  )
}
