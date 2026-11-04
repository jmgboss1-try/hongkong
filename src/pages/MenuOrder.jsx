import { useEffect, useMemo, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { MODES, CATS, DEFAULT_ITEMS, DEFAULT_SETTINGS, won, unitPrice, totals } from '../lib/menuData'

// 손님용 메뉴·주문 화면 (명함 QR → /menu, 로그인 없음)
// 1) 포장 / 배달 고르기 → 2) 메뉴 담기 (옵션) → 3) 연락처·주소 넣고 주문 → 매장 포스(메뉴·주문)에 바로 뜸
const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', soft:'#ECE8E1', paper:'#FAF9F6', chip:'#F3F1EC', red:'#C3261C', deep:'#990000', green:'#2E7D45', amber:'#B45309' }
const num = { fontVariantNumeric:'tabular-nums' }
// 주문번호 4자리 (손님이 매장에 말하기 쉽게)
const newCode = () => String(Math.floor(1000 + Math.random()*9000))
const telHref = p => `tel:${String(p).replace(/[^0-9]/g,'')}`

function Btn({ children, onClick, kind = 'plain', disabled, full, style }) {
  const solid = kind === 'primary'
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{fontFamily:'inherit', cursor: disabled ? 'default' : 'pointer', borderRadius:6, fontSize:16, fontWeight:700,
        padding:'14px 16px', width: full ? '100%' : undefined, border: solid ? 'none' : `1px solid ${T.rule}`,
        background: solid ? (disabled ? '#D9A6A2' : T.red) : '#FFFFFF', color: solid ? '#FFFFFF' : T.ink, ...style}}>
      {children}
    </button>
  )
}

export default function MenuOrder() {
  const [items, setItems] = useState(null)
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [mode, setMode] = useState(null)          // 'pickup' | 'delivery'
  const [cart, setCart] = useState([])            // [{ key, id, name, price, qty, options:[{group,name,price}], total }]
  const [open, setOpen] = useState(null)          // 옵션 고르는 메뉴
  const [step, setStep] = useState('menu')        // 'menu' | 'checkout' | 'done'
  const [form, setForm] = useState({ phone:'', address:'', request:'', pay:'card', pickupIn:'20' })
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(null)

  useEffect(() => {
    getDoc(doc(db,'menu','public'))
      .then(s => {
        const d = s.exists() ? s.data() : null
        setItems(d?.items?.length ? d.items : DEFAULT_ITEMS)
        setSettings({ ...DEFAULT_SETTINGS, ...(d?.settings||{}) })
      })
      .catch(() => setItems(DEFAULT_ITEMS))   // 읽기 권한이 아직 없어도 기본 메뉴로 보여줌
  }, [])

  const list = useMemo(() => (items||[]).filter(i => i.mode === mode && !i.hidden), [items, mode])
  const cats = CATS.filter(c => list.some(i => i.cat === c))
  const t = totals(cart, mode, settings)
  const count = cart.reduce((a,l)=>a+l.qty,0)

  function chooseMode(m) {
    if (cart.length && m !== mode && !window.confirm('포장과 배달은 메뉴 가격이 달라서 담은 메뉴가 비워져요. 바꿀까요?')) return
    if (m !== mode) setCart([])
    setMode(m); setStep('menu'); window.scrollTo(0,0)
  }
  function addLine(item, picked, qty) {
    const price = unitPrice(item, picked)
    const key = item.id + '|' + picked.map(o=>o.group+':'+o.name).join(',')
    setCart(c => {
      const hit = c.find(l => l.key === key)
      if (hit) return c.map(l => l.key === key ? { ...l, qty: l.qty + qty, total: (l.qty + qty) * price } : l)
      return [...c, { key, id:item.id, name:item.name, price, qty, options:picked, total: qty * price }]
    })
    setOpen(null)
  }
  const changeQty = (key, d) => setCart(c => c.flatMap(l => {
    if (l.key !== key) return [l]
    const q = l.qty + d
    return q <= 0 ? [] : [{ ...l, qty:q, total: q * l.price }]
  }))

  async function submit() {
    const phone = form.phone.replace(/[^0-9]/g,'')
    if (phone.length < 10) return alert('연락받을 휴대폰 번호를 넣어 주세요')
    if (mode === 'delivery' && form.address.trim().length < 5) return alert('배달 받을 주소를 자세히 넣어 주세요')
    if (t.short > 0) return alert(`배달은 ${won(settings.minDelivery)} 이상부터 돼요. ${won(t.short)} 더 담아 주세요`)
    if (!window.confirm(`${MODES[mode]} 주문 ${won(t.total)}\n이대로 주문할까요?`)) return
    setSending(true)
    try {
      const code = newCode()
      await addDoc(collection(db,'orders'), {
        createdAt: serverTimestamp(), mode, code, status:'new',
        items: cart.map(({ id, name, price, qty, options, total }) => ({ id, name, price, qty, options, total })),
        subtotal: t.subtotal, deliveryFee: t.deliveryFee, total: t.total,
        phone, address: mode === 'delivery' ? form.address.trim() : '', request: form.request.trim().slice(0,200),
        pay: form.pay, pickupIn: mode === 'pickup' ? +form.pickupIn : null,
      })
      setDone({ code, total:t.total }); setCart([]); setStep('done'); window.scrollTo(0,0)
    } catch(e) {
      console.error(e)
      alert('주문을 보내지 못했어요. 전화로 주문해 주세요.')
    }
    setSending(false)
  }

  const page = children => (
    <div style={{minHeight:'100vh', background:T.paper, color:T.ink, fontFamily:'Noto Sans KR, sans-serif'}}>
      <div style={{maxWidth:560, margin:'0 auto', paddingBottom:110}}>
        <header style={{background:T.deep, color:'#FFFFFF', padding:'18px 16px 16px'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', gap:10}}>
            <div>
              <div style={{fontSize:21, fontWeight:900, letterSpacing:'0.01em'}}>홍콩반점 0410 중앙대</div>
              <div style={{fontSize:13, opacity:0.85, marginTop:2}}>배달 {won(settings.minDelivery)} 이상 · {won(settings.freeDelivery)} 이상 무료배달</div>
            </div>
            <a href={telHref(settings.phone)} style={{color:T.deep, background:'#FFFFFF', borderRadius:6, padding:'9px 12px', fontSize:14, fontWeight:800, textDecoration:'none', whiteSpace:'nowrap'}}>
              전화 주문
            </a>
          </div>
          {mode && step !== 'done' && (
            <div style={{display:'flex', gap:6, marginTop:14}}>
              {Object.entries(MODES).map(([k,l]) => (
                <button key={k} type="button" onClick={()=>chooseMode(k)}
                  style={{flex:1, padding:'9px 0', borderRadius:5, fontFamily:'inherit', fontSize:15, fontWeight:800, cursor:'pointer',
                    border:'1px solid #FFFFFF', background: mode===k ? '#FFFFFF' : 'transparent', color: mode===k ? T.deep : '#FFFFFF'}}>{l}</button>
              ))}
            </div>
          )}
        </header>
        {settings.notice && <div style={{padding:'10px 16px', fontSize:14, background:'#FFF4E5', color:T.amber, borderBottom:`1px solid ${T.rule}`}}>{settings.notice}</div>}
        {children}
      </div>
    </div>
  )

  if (!items) return page(<div style={{padding:40, textAlign:'center', color:T.sub}}>메뉴를 불러오고 있어요...</div>)

  // 1) 포장 / 배달
  if (!mode) return page(
    <div style={{padding:'28px 16px'}}>
      <div style={{fontSize:19, fontWeight:800, marginBottom:4}}>어떻게 받으실 건가요?</div>
      <div style={{fontSize:14, color:T.sub, marginBottom:18}}>포장과 배달은 메뉴 가격이 달라요</div>
      {[['pickup','포장', '매장에 와서 가져가요'], ['delivery','배달', `${won(settings.minDelivery)} 이상 · ${won(settings.freeDelivery)} 미만은 배달비 ${won(settings.deliveryFee)}`]].map(([k,l,sub]) => (
        <button key={k} type="button" onClick={()=>chooseMode(k)}
          style={{display:'block', width:'100%', textAlign:'left', background:'#FFFFFF', border:`1px solid ${T.rule}`, borderLeft:`5px solid ${T.red}`,
            borderRadius:6, padding:'20px 18px', marginBottom:12, cursor:'pointer', fontFamily:'inherit', color:T.ink}}>
          <div style={{fontSize:22, fontWeight:900}}>{l}</div>
          <div style={{fontSize:14, color:T.sub, marginTop:4}}>{sub}</div>
        </button>
      ))}
    </div>
  )

  // 3) 주문 완료
  if (step === 'done') return page(
    <div style={{padding:'34px 16px', textAlign:'center'}}>
      <div style={{fontSize:15, color:T.sub}}>주문번호</div>
      <div style={{fontSize:48, fontWeight:900, color:T.red, ...num}}>{done?.code}</div>
      <div style={{fontSize:19, fontWeight:800, marginTop:10}}>주문이 매장으로 들어갔어요</div>
      <div style={{fontSize:14, color:T.sub, lineHeight:1.7, marginTop:8}}>
        결제 금액 {won(done?.total)} · 받으실 때 {form.pay === 'card' ? '카드' : '현금'}로 결제해 주세요.<br/>
        확인이 필요하면 매장에서 전화드릴 수 있어요.
      </div>
      <div style={{display:'flex', flexDirection:'column', gap:10, marginTop:24}}>
        <a href={telHref(settings.phone)} style={{display:'block', background:'#FFFFFF', border:`1px solid ${T.rule}`, borderRadius:6, padding:14, color:T.ink, fontWeight:700, textDecoration:'none'}}>
          매장에 전화하기 {settings.phone}
        </a>
        <Btn onClick={()=>{ setStep('menu'); setDone(null) }} full>메뉴로 돌아가기</Btn>
      </div>
    </div>
  )

  const canOrder = settings.open !== false

  // 2-2) 주문서
  if (step === 'checkout') return page(
    <div style={{padding:'16px'}}>
      <button type="button" onClick={()=>setStep('menu')} style={{background:'none', border:'none', color:T.sub, fontSize:14, padding:0, cursor:'pointer', fontFamily:'inherit'}}>메뉴 더 담기</button>
      <h2 style={{fontSize:19, fontWeight:800, margin:'10px 0 6px', fontFamily:'inherit'}}>{MODES[mode]} 주문</h2>
      <div style={{borderTop:`2px solid ${T.ink}`}}>
        {cart.map(l => (
          <div key={l.key} style={{display:'flex', alignItems:'center', gap:10, padding:'12px 0', borderBottom:`1px solid ${T.soft}`}}>
            <div style={{flex:1, minWidth:0}}>
              <div style={{fontSize:15, fontWeight:700}}>{l.name}</div>
              {l.options.length > 0 && <div style={{fontSize:13, color:T.sub}}>{l.options.map(o=>o.name).join(', ')}</div>}
              <div style={{fontSize:13, color:T.sub, ...num}}>{won(l.price)}</div>
            </div>
            <div style={{display:'flex', alignItems:'center', border:`1px solid ${T.rule}`, borderRadius:6}}>
              <button type="button" onClick={()=>changeQty(l.key,-1)} aria-label="하나 빼기" style={qtyBtn}>−</button>
              <span style={{minWidth:26, textAlign:'center', fontWeight:700, ...num}}>{l.qty}</span>
              <button type="button" onClick={()=>changeQty(l.key,1)} aria-label="하나 더" style={qtyBtn}>+</button>
            </div>
            <div style={{minWidth:72, textAlign:'right', fontWeight:700, ...num}}>{won(l.total)}</div>
          </div>
        ))}
        {!cart.length && <div style={{padding:'20px 0', color:T.sub}}>담은 메뉴가 없어요</div>}
      </div>
      <div style={{padding:'10px 0', fontSize:15}}>
        {[['메뉴 합계', t.subtotal], ...(mode==='delivery' ? [['배달비', t.deliveryFee]] : [])].map(([k,v]) => (
          <div key={k} style={{display:'flex', justifyContent:'space-between', padding:'3px 0', color:T.sub}}><span>{k}</span><span style={num}>{v ? won(v) : '무료'}</span></div>
        ))}
        <div style={{display:'flex', justifyContent:'space-between', padding:'8px 0 0', borderTop:`3px double ${T.ink}`, marginTop:6, fontSize:18, fontWeight:900}}>
          <span>결제 금액</span><span style={num}>{won(t.total)}</span>
        </div>
        {t.short > 0 && <div style={{color:T.red, fontSize:14, marginTop:6}}>배달은 {won(settings.minDelivery)} 이상부터 돼요 · {won(t.short)} 더 담아 주세요</div>}
        {mode==='delivery' && t.short === 0 && t.deliveryFee > 0 && <div style={{color:T.sub, fontSize:13, marginTop:6}}>{won(settings.freeDelivery - t.subtotal)} 더 담으면 배달비가 무료예요</div>}
      </div>

      <div style={{display:'flex', flexDirection:'column', gap:12, marginTop:8}}>
        <label style={lab}>휴대폰 번호
          <input type="tel" inputMode="numeric" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))} placeholder="010-0000-0000" style={inp}/>
        </label>
        {mode === 'delivery' ? (
          <label style={lab}>배달 주소
            <textarea value={form.address} onChange={e=>setForm(f=>({...f,address:e.target.value}))} rows={2} placeholder="동·호수까지 자세히 (예: 흑석동 ○○빌라 302호)" style={{...inp, resize:'vertical'}}/>
          </label>
        ) : (
          <div style={lab}>언제 오실 건가요?
            <div style={{display:'flex', gap:6, flexWrap:'wrap', marginTop:6}}>
              {['15','20','30','40','60'].map(m => (
                <button key={m} type="button" onClick={()=>setForm(f=>({...f,pickupIn:m}))} style={chip(form.pickupIn===m)}>{m}분 뒤</button>
              ))}
            </div>
          </div>
        )}
        <div style={lab}>결제 (받으실 때)
          <div style={{display:'flex', gap:6, marginTop:6}}>
            {[['card','카드'],['cash','현금']].map(([k,l]) => <button key={k} type="button" onClick={()=>setForm(f=>({...f,pay:k}))} style={chip(form.pay===k)}>{l}</button>)}
          </div>
        </div>
        <label style={lab}>요청사항 (선택)
          <input value={form.request} onChange={e=>setForm(f=>({...f,request:e.target.value}))} maxLength={200} placeholder="예: 단무지 많이, 문 앞에 두고 벨 눌러 주세요" style={inp}/>
        </label>
      </div>
      <div style={{marginTop:18}}>
        {canOrder
          ? <Btn kind="primary" full onClick={submit} disabled={sending || !cart.length || t.short > 0}>{sending ? '보내는 중...' : `${won(t.total)} 주문하기`}</Btn>
          : <a href={telHref(settings.phone)} style={{display:'block', textAlign:'center', background:T.red, color:'#FFFFFF', borderRadius:6, padding:14, fontWeight:800, textDecoration:'none'}}>지금은 전화로 주문해 주세요 {settings.phone}</a>}
      </div>
    </div>
  )

  // 2-1) 메뉴
  return page(
    <>
      <nav style={{position:'sticky', top:0, zIndex:5, background:T.paper, borderBottom:`1px solid ${T.rule}`, display:'flex', gap:16, overflowX:'auto', padding:'0 16px'}}>
        {cats.map(c => (
          <a key={c} href={`#cat-${c}`} style={{padding:'12px 0', whiteSpace:'nowrap', fontSize:15, fontWeight:700, color:T.ink, textDecoration:'none'}}>{c}</a>
        ))}
      </nav>
      {cats.map(c => (
        <section key={c} id={`cat-${c}`} style={{padding:'0 16px', scrollMarginTop:46}}>
          <h2 style={{fontSize:17, fontWeight:900, margin:'20px 0 0', paddingBottom:6, borderBottom:`2px solid ${T.ink}`, fontFamily:'inherit'}}>{c}</h2>
          {list.filter(i => i.cat === c).map(i => (
            <button key={i.id} type="button" disabled={i.soldOut} onClick={()=>setOpen(i)}
              style={{display:'flex', width:'100%', alignItems:'baseline', gap:8, padding:'14px 0', background:'none', border:'none', borderBottom:`1px solid ${T.soft}`,
                textAlign:'left', fontFamily:'inherit', color: i.soldOut ? T.faint : T.ink, cursor: i.soldOut ? 'default' : 'pointer'}}>
              <span style={{flex:1, minWidth:0}}>
                <span style={{fontSize:16, fontWeight:700}}>{i.name}</span>
                {i.best && <span style={{marginLeft:6, fontSize:11, fontWeight:800, color:T.red, border:`1px solid ${T.red}`, borderRadius:3, padding:'0 4px', verticalAlign:2}}>추천</span>}
                {i.soldOut && <span style={{marginLeft:6, fontSize:12, fontWeight:700}}>품절</span>}
                {i.desc && <span style={{display:'block', fontSize:13, color:T.sub, marginTop:2}}>{i.desc}</span>}
                {i.options?.length > 0 && <span style={{display:'block', fontSize:12, color:T.sub, marginTop:2}}>옵션 선택</span>}
              </span>
              <span style={{fontSize:16, fontWeight:700, ...num}}>{won(i.price)}</span>
            </button>
          ))}
        </section>
      ))}

      {count > 0 && (
        <div style={{position:'fixed', left:0, right:0, bottom:0, zIndex:10, padding:'10px 16px 16px', background:'linear-gradient(transparent, #FAF9F6 30%)'}}>
          <div style={{maxWidth:528, margin:'0 auto'}}>
            <Btn kind="primary" full onClick={()=>{ setStep('checkout'); window.scrollTo(0,0) }}>
              {count}개 담음 · {won(t.subtotal)} · 주문하기
            </Btn>
          </div>
        </div>
      )}
      {open && <OptionSheet item={open} onClose={()=>setOpen(null)} onAdd={addLine}/>}
    </>
  )
}

const qtyBtn = { background:'none', border:'none', width:34, height:34, fontSize:18, cursor:'pointer', fontFamily:'inherit', color:'#1D1B18' }
const lab = { display:'flex', flexDirection:'column', gap:6, fontSize:14, fontWeight:700, color:'#1D1B18' }
const inp = { fontFamily:'inherit', fontSize:16, padding:'11px 12px', border:'1px solid #CBC5BA', borderRadius:6, background:'#FFFFFF', color:'#1D1B18', fontWeight:400 }
const chip = on => ({ fontFamily:'inherit', fontSize:15, fontWeight:700, padding:'9px 14px', borderRadius:6, cursor:'pointer',
  border:`1px solid ${on ? '#C3261C' : '#DCD7CE'}`, background: on ? '#C3261C14' : '#FFFFFF', color: on ? '#C3261C' : '#1D1B18' })

// 메뉴 하나: 옵션 고르고 수량 정해서 담기
function OptionSheet({ item, onClose, onAdd }) {
  const [sel, setSel] = useState({})   // groupId → [choice index]
  const [qty, setQty] = useState(1)
  const groups = item.options || []
  const picked = groups.flatMap(g => (sel[g.id]||[]).map(i => ({ group:g.name, name:g.choices[i].name, price:+g.choices[i].price||0 })))
  const missing = groups.filter(g => g.required && !(sel[g.id]||[]).length)
  const toggle = (g, i) => setSel(s => {
    const cur = s[g.id] || []
    if (!g.multi) return { ...s, [g.id]: cur[0] === i && !g.required ? [] : [i] }
    return { ...s, [g.id]: cur.includes(i) ? cur.filter(x=>x!==i) : [...cur, i] }
  })
  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, zIndex:20, background:'rgba(29,27,24,0.45)', display:'flex', alignItems:'flex-end', justifyContent:'center'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'#FFFFFF', width:'100%', maxWidth:560, maxHeight:'85vh', overflowY:'auto', borderRadius:'10px 10px 0 0', padding:'18px 16px 16px'}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:10}}>
          <div style={{fontSize:20, fontWeight:900}}>{item.name}</div>
          <div style={{fontSize:17, fontWeight:700, ...num}}>{won(item.price)}</div>
        </div>
        {item.desc && <div style={{fontSize:14, color:'#6E6A63', marginTop:4}}>{item.desc}</div>}
        {groups.map(g => (
          <div key={g.id} style={{marginTop:16}}>
            <div style={{fontSize:15, fontWeight:800}}>{g.name} <span style={{fontSize:12, fontWeight:500, color: g.required ? '#C3261C' : '#6E6A63'}}>{g.required ? '꼭 골라 주세요' : g.multi ? '여러 개 고를 수 있어요' : '선택'}</span></div>
            {g.choices.map((c,i) => {
              const on = (sel[g.id]||[]).includes(i)
              return (
                <button key={i} type="button" onClick={()=>toggle(g,i)}
                  style={{display:'flex', width:'100%', justifyContent:'space-between', padding:'12px 10px', marginTop:6, borderRadius:6, cursor:'pointer', fontFamily:'inherit', fontSize:15,
                    border:`1px solid ${on ? '#C3261C' : '#DCD7CE'}`, background: on ? '#C3261C0F' : '#FFFFFF', color:'#1D1B18', fontWeight: on ? 700 : 400}}>
                  <span>{on ? '● ' : '○ '}{c.name}</span><span style={num}>{+c.price ? `+${won(+c.price)}` : ''}</span>
                </button>
              )
            })}
          </div>
        ))}
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginTop:18}}>
          <span style={{fontSize:15, fontWeight:700}}>수량</span>
          <div style={{display:'flex', alignItems:'center', border:'1px solid #DCD7CE', borderRadius:6}}>
            <button type="button" onClick={()=>setQty(q=>Math.max(1,q-1))} aria-label="하나 빼기" style={qtyBtn}>−</button>
            <span style={{minWidth:30, textAlign:'center', fontWeight:700, ...num}}>{qty}</span>
            <button type="button" onClick={()=>setQty(q=>q+1)} aria-label="하나 더" style={qtyBtn}>+</button>
          </div>
        </div>
        <div style={{display:'flex', gap:8, marginTop:18}}>
          <Btn onClick={onClose} style={{flex:'0 0 auto'}}>닫기</Btn>
          <Btn kind="primary" full disabled={missing.length > 0} onClick={()=>onAdd(item, picked, qty)}>
            {missing.length ? `${missing[0].name} 골라 주세요` : `${won(unitPrice(item, picked) * qty)} 담기`}
          </Btn>
        </div>
      </div>
    </div>
  )
}
