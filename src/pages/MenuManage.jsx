import { useEffect, useRef, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, collection, query, orderBy, limit, onSnapshot, updateDoc, serverTimestamp } from 'firebase/firestore'
import { MODES, CATS, DEFAULT_ITEMS, DEFAULT_SETTINGS, won } from '../lib/menuData'
import { toDate, hm } from '../lib/attendance'
import { EVENTS, PRESETS, loadSound, saveSound, unlockAudio, audioReady, playEvent } from '../lib/orderSounds'

// 사장님·매장 계정: QR 주문 받기 + 메뉴(가격·옵션·품절) 고치기
// 주문은 orders 를 실시간으로 보고(onSnapshot) 새 주문이 오면 소리를 냄 — 포스에 이 화면을 띄워 두면 됨
const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', soft:'#ECE8E1', chip:'#F3F1EC', red:'#C3261C', green:'#2E7D45', blue:'#2B5C9E', amber:'#B45309' }
const num = { fontVariantNumeric:'tabular-nums' }
const STATUS = { new:['새 주문', T.red], accepted:['접수함', T.blue], done:['완료', T.green], canceled:['취소', T.faint] }

function Btn({ children, onClick, kind = 'plain', disabled, small }) {
  const solid = kind === 'primary' || kind === 'ok' || kind === 'blue'
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{fontFamily:'inherit', cursor:'pointer', borderRadius:4, whiteSpace:'nowrap', fontSize: small ? 12 : 13, padding: small ? '4px 9px' : '7px 13px',
        fontWeight: solid ? 700 : 500, opacity: disabled ? 0.55 : 1,
        background: kind==='primary' ? T.red : kind==='ok' ? T.green : kind==='blue' ? T.blue : '#FFFFFF',
        color: solid ? '#FFFFFF' : kind==='danger' ? T.red : T.ink, border: solid ? 'none' : `1px solid ${kind==='danger' ? '#E8C4BF' : T.rule}`}}>
      {children}
    </button>
  )
}

export default function MenuManage() {
  const [tab, setTab] = useState('orders')
  return (
    <div style={{maxWidth:980}}>
      <div style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:12, flexWrap:'wrap', borderBottom:`3px double ${T.ink}`, paddingBottom:8, marginBottom:14}}>
        <h1 style={{fontSize:22, fontWeight:800, margin:0, fontFamily:'inherit'}}>메뉴 · 주문</h1>
        <div style={{display:'flex', gap:16}}>
          {[['orders','QR 주문'],['menu','메뉴 고치기'],['settings','배달 설정']].map(([k,l]) => (
            <button key={k} type="button" onClick={()=>setTab(k)}
              style={{background:'none', border:'none', padding:'4px 0', cursor:'pointer', fontFamily:'inherit', fontSize:15,
                fontWeight: tab===k ? 800 : 500, color: tab===k ? T.ink : T.sub, borderBottom:`2px solid ${tab===k ? T.red : 'transparent'}`}}>{l}</button>
          ))}
        </div>
      </div>
      {tab === 'orders' ? <Orders/> : <MenuEditor tab={tab}/>}
    </div>
  )
}

// ── QR 주문 받기 ──
function Orders() {
  const [orders, setOrders] = useState(null)
  const [err, setErr] = useState('')
  const [sound, setSound] = useState(audioReady)     // 이 기기에서 소리 켰는지 (다른 화면에서 이미 눌렀으면 켜져 있음)
  const [snd, setSnd] = useState(loadSound)          // 소리 설정 (기기마다)
  const [showSnd, setShowSnd] = useState(false)
  const [showOld, setShowOld] = useState(false)
  const sndRef = useRef(snd)
  const seen = useRef(null)
  const ordersRef = useRef([])
  const lastRemind = useRef(0)
  useEffect(() => { sndRef.current = snd; saveSound(snd) }, [snd])

  useEffect(() => {
    const q = query(collection(db,'orders'), orderBy('createdAt','desc'), limit(80))
    return onSnapshot(q, s => {
      const list = s.docs.map(d => ({ id:d.id, ...d.data() }))
      // 처음 불러온 것 말고 새로 들어온 '새 주문'이 있으면 소리
      const ids = new Set(list.map(o=>o.id))
      if (seen.current && list.some(o => o.status === 'new' && !seen.current.has(o.id))) {
        playEvent(sndRef.current, 'new')
        try { navigator.vibrate?.(400) } catch { /* 진동 없어도 됨 */ }
      }
      seen.current = ids
      ordersRef.current = list
      setOrders(list)
    }, e => { console.error(e); setErr(e.code === 'permission-denied' ? '주문을 읽을 권한이 없어요. Firestore 규칙에 orders 를 추가해 주세요.' : '주문을 불러오지 못했어요.') })
  }, [])

  // 새 주문이 있으면 탭 제목에 표시
  const fresh = (orders||[]).filter(o => o.status === 'new').length
  useEffect(() => { document.title = fresh ? `(${fresh}) 새 주문 · 홍콩반점` : '홍콩반점 중앙대점' ; return () => { document.title = '홍콩반점 중앙대점' } }, [fresh])

  // 접수 안 한 주문이 정한 시간(분) 넘게 남아 있으면 경고 소리를 몇 초마다
  useEffect(() => {
    if (!sound) return
    const id = setInterval(() => {
      const s = sndRef.current, now = Date.now()
      const late = ordersRef.current.some(o => o.status === 'new' && toDate(o.createdAt) && now - toDate(o.createdAt).getTime() > s.remindMin * 60000)
      if (late && now - lastRemind.current > s.remindEvery * 1000) { lastRemind.current = now; playEvent(s, 'remind') }
    }, 5000)
    return () => clearInterval(id)
  }, [sound])

  function enableSound() {
    try {
      if (!unlockAudio()) throw new Error('no audio')
      setSound(true); setTimeout(() => playEvent(sndRef.current, 'new'), 50)
    } catch { alert('이 기기에서는 소리를 낼 수 없어요') }
  }
  async function setStatus(o, status, eta) {
    if (status === 'canceled' && !window.confirm(`주문 ${o.code}을(를) 취소할까요? 손님께는 전화로 알려 주세요.`)) return
    try {
      await updateDoc(doc(db,'orders',o.id), { status, [`${status}At`]: serverTimestamp(), ...(eta ? { eta } : {}) })
      playEvent(sndRef.current, status === 'accepted' ? 'accept' : status === 'done' ? 'done' : status === 'canceled' ? 'cancel' : 'none')
    } catch(e) { console.error(e); alert('바꾸지 못했어요. 다시 시도해 주세요.') }
  }

  if (err) return <div style={{color:T.red, fontSize:14}}>{err}</div>
  if (!orders) return <div style={{color:T.sub}}>주문을 불러오고 있어요...</div>
  const active = orders.filter(o => o.status === 'new' || o.status === 'accepted')
  const old = orders.filter(o => o.status === 'done' || o.status === 'canceled')

  return (
    <div>
      <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', fontSize:13, color:T.sub, marginBottom:10}}>
        {!sound ? <Btn kind="primary" onClick={enableSound}>주문 소리 켜기</Btn> : <span style={{color:T.green, fontWeight:700}}>소리 켜짐</span>}
        <Btn onClick={()=>setShowSnd(v=>!v)}>{showSnd ? '소리 설정 닫기' : '소리 설정'}</Btn>
        <span>이 화면을 포스에 띄워 두면 손님이 QR로 주문할 때 바로 떠요. 접수하고 배달은 기사님을 불러 주세요.</span>
      </div>
      {showSnd && <SoundSettings snd={snd} setSnd={setSnd} ready={sound} onUnlock={enableSound}/>}
      {!active.length && <div style={{padding:'24px 0', color:T.sub, borderTop:`1px solid ${T.rule}`}}>지금 들어온 주문이 없어요</div>}
      {active.map(o => <OrderCard key={o.id} o={o} onStatus={setStatus}/>)}
      {old.length > 0 && (
        <div style={{marginTop:18}}>
          <button type="button" onClick={()=>setShowOld(v=>!v)} style={{background:'none', border:'none', borderBottom:`1px solid ${T.blue}`, color:T.blue, padding:0, cursor:'pointer', fontFamily:'inherit', fontSize:13}}>
            {showOld ? '지난 주문 접기' : `지난 주문 ${old.length}건 보기`}
          </button>
          {showOld && old.map(o => <OrderCard key={o.id} o={o} onStatus={setStatus}/>)}
        </div>
      )}
    </div>
  )
}

// 소리 설정: 음량, 상황마다 소리 고르기(들어보기), 경고 간격, 내 소리 파일
function SoundSettings({ snd, setSnd, ready, onUnlock }) {
  const set = p => setSnd(s => ({ ...s, ...p }))
  const test = ev => { if (!ready) onUnlock(); setTimeout(() => playEvent(snd, ev), 80) }
  function pickFile(ev, file) {
    if (!file) return
    if (file.size > 400 * 1024) return alert('소리 파일은 400KB 이하로 골라 주세요 (짧은 mp3·wav)')
    const r = new FileReader()
    r.onload = () => setSnd(s => ({ ...s, files:{ ...s.files, [ev]: r.result }, sounds:{ ...s.sounds, [ev]:'custom' } }))
    r.readAsDataURL(file)
  }
  const sel = { padding:'6px 8px', border:`1px solid ${T.rule}`, borderRadius:4, fontFamily:'inherit', fontSize:13, background:'#FFFFFF' }
  return (
    <div style={{background:T.chip, borderRadius:6, padding:'12px 14px', marginBottom:12, fontSize:13}}>
      <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
        <b style={{minWidth:70}}>음량</b>
        <input type="range" min="0" max="1" step="0.05" value={snd.volume} onChange={e=>set({ volume:+e.target.value })} aria-label="음량" style={{width:200}}/>
        <span style={{...num, minWidth:40}}>{Math.round(snd.volume*100)}%</span>
        <span style={{color:T.sub}}>그래도 작으면 포스 컴퓨터(스피커) 음량도 올려 주세요</span>
      </div>
      <div style={{borderTop:`1px solid ${T.rule}`, marginTop:10}}>
        {EVENTS.map(ev => (
          <div key={ev.id} style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', padding:'7px 0', borderBottom:`1px solid ${T.soft}`}}>
            <span style={{minWidth:210}}>{ev.label}</span>
            <select value={snd.sounds[ev.id]} onChange={e=>set({ sounds:{ ...snd.sounds, [ev.id]: e.target.value } })} aria-label={`${ev.label} 소리`} style={sel}>
              {Object.entries(PRESETS).filter(([k]) => k !== 'custom' || snd.files?.[ev.id]).map(([k,p]) => <option key={k} value={k}>{p.label}</option>)}
            </select>
            <Btn small onClick={()=>test(ev.id)}>들어보기</Btn>
            <label style={{color:T.blue, cursor:'pointer', fontSize:12}}>
              내 소리 파일 고르기
              <input type="file" accept="audio/*" style={{display:'none'}} onChange={e=>{ pickFile(ev.id, e.target.files?.[0]); e.target.value='' }}/>
            </label>
          </div>
        ))}
      </div>
      <div style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginTop:10}}>
        <span>접수 안 한 주문이</span>
        <select value={snd.remindMin} onChange={e=>set({ remindMin:+e.target.value })} aria-label="경고까지 시간" style={sel}>
          {[1,2,3,5,10].map(m => <option key={m} value={m}>{m}분</option>)}
        </select>
        <span>넘게 남아 있으면</span>
        <select value={snd.remindEvery} onChange={e=>set({ remindEvery:+e.target.value })} aria-label="경고 간격" style={sel}>
          {[15,30,60,120].map(s => <option key={s} value={s}>{s < 60 ? `${s}초` : `${s/60}분`}</option>)}
        </select>
        <span>마다 경고 소리</span>
      </div>
      <div style={{color:T.sub, fontSize:12, marginTop:8}}>소리 설정은 이 기기에만 저장돼요 (포스와 사장님 폰을 따로 정할 수 있어요). 화면을 새로 열면 '주문 소리 켜기'를 한 번 눌러 주세요.</div>
    </div>
  )
}

function OrderCard({ o, onStatus }) {
  const at = toDate(o.createdAt)
  const [label, color] = STATUS[o.status] || STATUS.new
  const phone = String(o.phone||'')
  const phoneFmt = phone.length === 11 ? `${phone.slice(0,3)}-${phone.slice(3,7)}-${phone.slice(7)}` : phone
  return (
    <div style={{borderLeft:`5px solid ${color}`, background: o.status==='new' ? '#C3261C0D' : '#FFFFFF', border:`1px solid ${T.rule}`, borderLeftWidth:5, borderLeftColor:color,
      borderRadius:'0 6px 6px 0', padding:'12px 14px', marginTop:10, opacity: o.status==='canceled' ? 0.6 : 1}}>
      <div style={{display:'flex', alignItems:'baseline', gap:10, flexWrap:'wrap'}}>
        <b style={{fontSize:20, color:T.red, ...num}}>{o.code}</b>
        <b style={{fontSize:15}}>{MODES[o.mode]}</b>
        <span style={{fontSize:13, color, fontWeight:700}}>{label}</span>
        <span style={{fontSize:13, color:T.sub, ...num}}>{at ? `${at.getMonth()+1}/${at.getDate()} ${hm(at)}` : ''}</span>
        {o.eta && o.status !== 'new' && <span style={{fontSize:13, color:T.blue, fontWeight:700}}>손님께 {o.eta}분 안내함</span>}
        {o.mode === 'pickup' && o.pickupIn && <span style={{fontSize:13, color:T.amber, fontWeight:700}}>{o.pickupIn}분 뒤 방문{at ? ` (${hm(new Date(at.getTime() + o.pickupIn*60000))})` : ''}</span>}
        <span style={{flex:1}}/>
        <b style={{fontSize:17, ...num}}>{won(o.total)}</b>
        <span style={{fontSize:12, color:T.sub}}>{o.pay === 'cash' ? '현금' : '카드'} · 만나서 결제</span>
      </div>
      <div style={{marginTop:8, fontSize:14, lineHeight:1.7}}>
        {(o.items||[]).map((l,i) => (
          <div key={i} style={{display:'flex', gap:8}}>
            <span style={{flex:1}}><b>{l.name}</b>{l.options?.length ? <span style={{color:T.sub}}> ({l.options.map(x=>x.name).join(', ')})</span> : ''}</span>
            <span style={num}>× {l.qty}</span><span style={{minWidth:76, textAlign:'right', ...num}}>{won(l.total)}</span>
          </div>
        ))}
        {o.deliveryFee > 0 && <div style={{display:'flex', color:T.sub}}><span style={{flex:1}}>배달비</span><span style={num}>{won(o.deliveryFee)}</span></div>}
      </div>
      <div style={{marginTop:8, fontSize:14, display:'flex', flexDirection:'column', gap:2}}>
        <div><span style={{color:T.sub}}>연락처 </span><a href={`tel:${phone}`} style={{color:T.ink, fontWeight:700, ...num}}>{phoneFmt}</a></div>
        {o.address && <div><span style={{color:T.sub}}>주소 </span><b>{o.address}</b></div>}
        {o.request && <div><span style={{color:T.sub}}>요청 </span>{o.request}</div>}
      </div>
      <div style={{display:'flex', gap:8, marginTop:10, flexWrap:'wrap'}}>
        {o.status === 'new' && <>
          <span style={{fontSize:13, color:T.sub, alignSelf:'center'}}>접수 ({o.mode === 'delivery' ? '도착' : '준비'}까지)</span>
          {(o.mode === 'delivery' ? [30,40,50,60] : [10,15,20,30]).map(m => <Btn key={m} kind="primary" onClick={()=>onStatus(o,'accepted',m)}>{m}분</Btn>)}
        </>}
        {(o.status === 'new' || o.status === 'accepted') && <Btn kind="ok" onClick={()=>onStatus(o,'done')}>{o.mode === 'delivery' ? '배달 보냄 (완료)' : '전달함 (완료)'}</Btn>}
        {(o.status === 'new' || o.status === 'accepted') && <Btn kind="danger" onClick={()=>onStatus(o,'canceled')}>취소</Btn>}
        {(o.status === 'done' || o.status === 'canceled') && <Btn small onClick={()=>onStatus(o,'accepted')}>다시 진행 중으로</Btn>}
      </div>
    </div>
  )
}

// ── 메뉴 고치기 / 배달 설정 ──
function MenuEditor({ tab }) {
  const [items, setItems] = useState(null)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [saved, setSaved] = useState(true)
  const [fromDefault, setFromDefault] = useState(false)
  const [mode, setMode] = useState('pickup')
  const [edit, setEdit] = useState(null)   // 고치는 메뉴 (사본)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    getDoc(doc(db,'menu','public')).then(s => {
      const d = s.exists() ? s.data() : null
      setItems(d?.items?.length ? d.items : DEFAULT_ITEMS)
      setFromDefault(!d?.items?.length)
      setSettings({ ...DEFAULT_SETTINGS, ...(d?.settings||{}) })
    }).catch(e => { console.error(e); setItems(DEFAULT_ITEMS); setFromDefault(true) })
  }, [])

  async function save(nextItems = items, nextSettings = settings) {
    setBusy(true); setMsg('')
    try {
      await setDoc(doc(db,'menu','public'), { items: nextItems, settings: nextSettings, updatedAt: new Date().toISOString() })
      setSaved(true); setFromDefault(false); setMsg('저장했어요. 손님 메뉴 화면에 바로 나와요')
    } catch(e) { console.error(e); setMsg(e.code === 'permission-denied' ? '저장할 권한이 없어요. Firestore 규칙에 menu 를 추가해 주세요.' : '저장하지 못했어요. 다시 시도해 주세요.') }
    setBusy(false)
  }
  const change = next => { setItems(next); setSaved(false) }
  const patch = (id, p) => change(items.map(i => i.id === id ? { ...i, ...p } : i))
  function remove(i) {
    if (!window.confirm(`${MODES[i.mode]} 메뉴 '${i.name}'을(를) 지울까요? (저장해야 반영돼요)`)) return
    change(items.filter(x => x.id !== i.id))
  }
  function saveEdit() {
    const e = edit
    if (!e.name.trim()) return alert('메뉴 이름을 넣어 주세요')
    const clean = { ...e, name:e.name.trim(), price: +String(e.price).replace(/[^0-9]/g,'') || 0,
      options: (e.options||[]).filter(g => g.name.trim() && g.choices.some(c=>c.name.trim()))
        .map(g => ({ ...g, name:g.name.trim(), choices: g.choices.filter(c=>c.name.trim()).map(c=>({ name:c.name.trim(), price:+String(c.price).replace(/[^0-9-]/g,'')||0 })) })) }
    change(items.some(i => i.id === e.id) ? items.map(i => i.id === e.id ? clean : i) : [...items, clean])
    setEdit(null)
  }
  function copyToOther(i) {
    const other = i.mode === 'pickup' ? 'delivery' : 'pickup'
    if (items.some(x => x.mode === other && x.name === i.name)) return alert(`${MODES[other]} 메뉴에 '${i.name}'이(가) 이미 있어요`)
    change([...items, { ...i, id:`${other[0]}${Date.now().toString(36)}`, mode:other }])
    setMsg(`${MODES[other]} 메뉴에 복사했어요. 가격을 확인하고 저장해 주세요`)
  }

  if (!items) return <div style={{color:T.sub}}>메뉴를 불러오고 있어요...</div>

  const saveBar = (
    <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', margin:'4px 0 12px', fontSize:13}}>
      <Btn kind="primary" onClick={()=>save()} disabled={busy || (saved && !fromDefault)}>{busy ? '저장 중...' : '저장'}</Btn>
      {!saved && <span style={{color:T.amber, fontWeight:700}}>고친 내용이 아직 저장 안 됐어요</span>}
      {fromDefault && saved && <span style={{color:T.amber}}>포스 사진으로 만든 기본 메뉴예요. 한 번 저장하면 손님 화면에 이 메뉴가 쓰여요</span>}
      {msg && <span style={{color: msg.includes('못') || msg.includes('권한') ? T.red : T.green}}>{msg}</span>}
      <a href="/menu" target="_blank" rel="noreferrer" style={{marginLeft:'auto', color:T.blue, fontSize:13}}>손님 화면 보기</a>
    </div>
  )

  if (tab === 'settings') {
    const set = (k, v) => { setSettings(s => ({ ...s, [k]: v })); setSaved(false) }
    const money = (k, label) => (
      <label style={{display:'flex', alignItems:'center', gap:10, fontSize:14, padding:'8px 0', borderBottom:`1px solid ${T.soft}`}}>
        <span style={{minWidth:150}}>{label}</span>
        <input inputMode="numeric" value={(settings[k]||0).toLocaleString('ko-KR')} onChange={e=>set(k, +e.target.value.replace(/[^0-9]/g,'')||0)}
          style={{width:120, textAlign:'right', padding:'6px 8px', border:`1px solid ${T.rule}`, borderRadius:4, fontFamily:'inherit', fontSize:14, ...num}}/>
        <span style={{color:T.sub}}>원</span>
      </label>
    )
    return (
      <div style={{maxWidth:560}}>
        {saveBar}
        <label style={{display:'flex', alignItems:'center', gap:10, fontSize:14, padding:'8px 0', borderBottom:`1px solid ${T.soft}`}}>
          <input type="checkbox" checked={settings.open !== false} onChange={e=>set('open', e.target.checked)}/>
          <span><b>QR 주문 받기</b> <span style={{color:T.sub}}>(끄면 손님 화면에 메뉴만 보이고 전화 주문 안내가 나와요)</span></span>
        </label>
        {money('minDelivery','배달 최소 주문 금액')}
        {money('freeDelivery','무료배달 기준 금액')}
        {money('deliveryFee','배달비 (기준 미만일 때)')}
        <label style={{display:'flex', alignItems:'center', gap:10, fontSize:14, padding:'8px 0', borderBottom:`1px solid ${T.soft}`}}>
          <span style={{minWidth:150}}>매장 전화번호</span>
          <input value={settings.phone} onChange={e=>set('phone', e.target.value)} style={{width:160, padding:'6px 8px', border:`1px solid ${T.rule}`, borderRadius:4, fontFamily:'inherit', fontSize:14}}/>
        </label>
        <label style={{display:'flex', flexDirection:'column', gap:6, fontSize:14, padding:'8px 0'}}>
          <span>손님 화면 맨 위 안내 (선택) <span style={{color:T.sub}}>예: 오늘은 탕수육 재료 소진으로 주문이 안 돼요</span></span>
          <input value={settings.notice||''} onChange={e=>set('notice', e.target.value)} style={{padding:'8px 10px', border:`1px solid ${T.rule}`, borderRadius:4, fontFamily:'inherit', fontSize:14}}/>
        </label>
      </div>
    )
  }

  const list = items.filter(i => i.mode === mode)
  const cats = [...CATS, ...[...new Set(list.map(i=>i.cat))].filter(c => !CATS.includes(c))]
  return (
    <div>
      {saveBar}
      <div style={{display:'flex', gap:8, alignItems:'center', flexWrap:'wrap', marginBottom:6}}>
        {Object.entries(MODES).map(([k,l]) => (
          <button key={k} type="button" onClick={()=>{ setMode(k); setEdit(null) }}
            style={{fontFamily:'inherit', fontSize:14, fontWeight:800, padding:'7px 18px', borderRadius:4, cursor:'pointer',
              border:`1px solid ${mode===k ? T.ink : T.rule}`, background: mode===k ? T.ink : '#FFFFFF', color: mode===k ? '#FFFFFF' : T.ink}}>{l} 메뉴 ({items.filter(i=>i.mode===k).length})</button>
        ))}
        <span style={{flex:1}}/>
        <Btn kind="blue" onClick={()=>setEdit({ id:`${mode[0]}${Date.now().toString(36)}`, mode, cat:'짬뽕', name:'', price:0, best:false, soldOut:false, hidden:false, desc:'', options:[] })}>+ {MODES[mode]} 메뉴 추가</Btn>
      </div>
      {edit && !items.some(i=>i.id===edit.id) && <ItemForm edit={edit} setEdit={setEdit} onSave={saveEdit}/>}
      {cats.filter(c => list.some(i=>i.cat===c)).map(c => (
        <section key={c} style={{marginTop:14}}>
          <h2 style={{fontSize:15, fontWeight:800, margin:0, paddingBottom:4, borderBottom:`2px solid ${T.ink}`, fontFamily:'inherit'}}>{c}</h2>
          {list.filter(i=>i.cat===c).map(i => edit?.id === i.id ? <ItemForm key={i.id} edit={edit} setEdit={setEdit} onSave={saveEdit}/> : (
            <div key={i.id} style={{display:'flex', alignItems:'center', gap:10, padding:'8px 0', borderBottom:`1px solid ${T.soft}`, fontSize:14, flexWrap:'wrap', opacity: i.hidden ? 0.5 : 1}}>
              <span style={{flex:1, minWidth:160}}>
                <b>{i.name}</b>
                {i.best && <span style={{marginLeft:6, fontSize:11, color:T.red, fontWeight:800}}>추천</span>}
                {i.hidden && <span style={{marginLeft:6, fontSize:11, color:T.sub}}>숨김</span>}
                {i.options?.length > 0 && <span style={{marginLeft:6, fontSize:12, color:T.sub}}>옵션 {i.options.map(g=>g.name).join(', ')}</span>}
              </span>
              <span style={{minWidth:80, textAlign:'right', fontWeight:700, ...num}}>{won(i.price)}</span>
              <label style={{display:'flex', alignItems:'center', gap:4, fontSize:12, color: i.soldOut ? T.red : T.sub}}>
                <input type="checkbox" checked={!!i.soldOut} onChange={e=>patch(i.id,{ soldOut:e.target.checked })}/> 품절
              </label>
              <Btn small onClick={()=>setEdit(JSON.parse(JSON.stringify(i)))}>수정</Btn>
              <Btn small onClick={()=>copyToOther(i)}>{i.mode==='pickup' ? '배달에 복사' : '포장에 복사'}</Btn>
              <Btn small kind="danger" onClick={()=>remove(i)}>삭제</Btn>
            </div>
          ))}
        </section>
      ))}
    </div>
  )
}

// 메뉴 하나 고치기: 이름·가격·분류·설명·추천·숨김 + 옵션 묶음
function ItemForm({ edit, setEdit, onSave }) {
  const set = (k, v) => setEdit(e => ({ ...e, [k]: v }))
  const setGroup = (gi, p) => setEdit(e => ({ ...e, options: e.options.map((g,i) => i===gi ? { ...g, ...p } : g) }))
  const inp = { padding:'6px 8px', border:`1px solid ${T.rule}`, borderRadius:4, fontFamily:'inherit', fontSize:14, background:'#FFFFFF' }
  return (
    <div style={{background:T.chip, borderRadius:6, padding:'12px 14px', margin:'8px 0'}}>
      <div style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'center'}}>
        <input value={edit.name} onChange={e=>set('name', e.target.value)} placeholder="메뉴 이름" style={{...inp, flex:'1 1 180px', fontWeight:700}}/>
        <input inputMode="numeric" value={(+edit.price||0).toLocaleString('ko-KR')} onChange={e=>set('price', +e.target.value.replace(/[^0-9]/g,'')||0)} aria-label="가격" style={{...inp, width:110, textAlign:'right', ...num}}/>
        <span style={{color:T.sub, fontSize:13}}>원</span>
        <select value={edit.cat} onChange={e=>set('cat', e.target.value)} aria-label="분류" style={inp}>
          {CATS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label style={{fontSize:13, display:'flex', gap:4, alignItems:'center'}}><input type="checkbox" checked={!!edit.best} onChange={e=>set('best', e.target.checked)}/> 추천</label>
        <label style={{fontSize:13, display:'flex', gap:4, alignItems:'center'}}><input type="checkbox" checked={!!edit.hidden} onChange={e=>set('hidden', e.target.checked)}/> 손님 화면에서 숨김</label>
      </div>
      <input value={edit.desc||''} onChange={e=>set('desc', e.target.value)} placeholder="설명 (선택) 예: 불맛 가득한 매콤한 짬뽕" style={{...inp, width:'100%', boxSizing:'border-box', marginTop:8}}/>

      <div style={{marginTop:12, fontSize:13, fontWeight:800}}>옵션 <span style={{fontWeight:400, color:T.sub}}>예: 맵기 선택(꼭 고르기) / 추가 토핑(여러 개)</span></div>
      {(edit.options||[]).map((g, gi) => (
        <div key={g.id} style={{background:'#FFFFFF', border:`1px solid ${T.rule}`, borderRadius:6, padding:'8px 10px', marginTop:6}}>
          <div style={{display:'flex', gap:8, flexWrap:'wrap', alignItems:'center'}}>
            <input value={g.name} onChange={e=>setGroup(gi,{ name:e.target.value })} placeholder="옵션 이름 (예: 맵기)" style={{...inp, flex:'1 1 140px'}}/>
            <label style={{fontSize:12, display:'flex', gap:4, alignItems:'center'}}><input type="checkbox" checked={!!g.required} onChange={e=>setGroup(gi,{ required:e.target.checked })}/> 꼭 고르기</label>
            <label style={{fontSize:12, display:'flex', gap:4, alignItems:'center'}}><input type="checkbox" checked={!!g.multi} onChange={e=>setGroup(gi,{ multi:e.target.checked })}/> 여러 개 고르기</label>
            <Btn small kind="danger" onClick={()=>setEdit(e => ({ ...e, options: e.options.filter((_,i)=>i!==gi) }))}>옵션 삭제</Btn>
          </div>
          {g.choices.map((c, ci) => (
            <div key={ci} style={{display:'flex', gap:6, alignItems:'center', marginTop:6, paddingLeft:12}}>
              <input value={c.name} onChange={e=>setGroup(gi,{ choices: g.choices.map((x,i)=>i===ci ? { ...x, name:e.target.value } : x) })} placeholder="고를 것 (예: 보통맵게)" style={{...inp, flex:1}}/>
              <span style={{fontSize:12, color:T.sub}}>+</span>
              <input inputMode="numeric" value={c.price} onChange={e=>setGroup(gi,{ choices: g.choices.map((x,i)=>i===ci ? { ...x, price:e.target.value.replace(/[^0-9]/g,'') } : x) })} placeholder="0" aria-label="추가 금액" style={{...inp, width:80, textAlign:'right'}}/>
              <span style={{fontSize:12, color:T.sub}}>원</span>
              <button type="button" onClick={()=>setGroup(gi,{ choices: g.choices.filter((_,i)=>i!==ci) })} aria-label="이 항목 삭제"
                style={{background:'none', border:'none', color:T.red, cursor:'pointer', fontSize:12, fontFamily:'inherit'}}>삭제</button>
            </div>
          ))}
          <button type="button" onClick={()=>setGroup(gi,{ choices:[...g.choices, { name:'', price:'' }] })}
            style={{background:'none', border:'none', color:T.blue, cursor:'pointer', fontSize:12, fontFamily:'inherit', marginTop:6, paddingLeft:12}}>+ 고를 것 추가</button>
        </div>
      ))}
      <button type="button" onClick={()=>setEdit(e => { const n = 1 + Math.max(-1, ...(e.options||[]).map(g => +String(g.id).replace(/[^0-9]/g,'') || 0)); return { ...e, options:[...(e.options||[]), { id:`g${n}`, name:'', required:false, multi:false, choices:[{ name:'', price:'' }] }] } })}
        style={{background:'none', border:'none', color:T.blue, cursor:'pointer', fontSize:13, fontFamily:'inherit', marginTop:6, padding:0}}>+ 옵션 추가</button>

      <div style={{display:'flex', gap:8, marginTop:12}}>
        <Btn kind="primary" onClick={onSave}>확인</Btn>
        <Btn onClick={()=>setEdit(null)}>취소</Btn>
        <span style={{fontSize:12, color:T.sub, alignSelf:'center'}}>확인 뒤 위의 '저장'을 눌러야 손님 화면에 반영돼요</span>
      </div>
    </div>
  )
}
