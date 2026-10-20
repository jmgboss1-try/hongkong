import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'

const todayStr = () => { const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}` }

// 다른 매장(상암점 등)과 주고받는 대여금 장부 — loans/{ledgerId} 에 { list:[{id,date,type:'lent'|'received',amount,memo,bankKey?}] }
// 계좌내역 가져오기(BankImport)도 같은 문서에 기록함. reloadKey가 바뀌면 다시 불러옴
export default function StoreLoanLedger({ ledgerId, title, partner, reloadKey }) {
  const [list, setList] = useState([])
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ date: todayStr(), type:'lent', amount:'', memo:'' })
  const [saving, setSaving] = useState(false)

  useEffect(()=>{
    getDoc(doc(db,'loans',ledgerId))
      .then(s=>setList(s.exists() ? (s.data().list||[]) : []))
      .catch(e=>console.error(e))
  },[ledgerId, reloadKey])

  // 저장 직전 최신 목록을 다시 읽어서 변경 적용 (계좌내역 가져오기와 동시에 써도 덮어쓰지 않게)
  async function update(fn) {
    setSaving(true)
    try {
      const s = await getDoc(doc(db,'loans',ledgerId))
      const next = fn(s.exists() ? (s.data().list||[]) : [])
      await setDoc(doc(db,'loans',ledgerId), { list: next })
      setList(next)
      return true
    } catch(e) { console.error(e); alert('저장 중 오류가 발생했어요.'); return false }
    finally { setSaving(false) }
  }
  async function add() {
    const amount = +String(form.amount).replace(/[^0-9]/g,'') || 0
    if (!form.date || !amount) return alert('날짜와 금액을 입력해주세요')
    const ok = await update(l => [...l, { id: Date.now().toString(), date: form.date, type: form.type, amount, memo: form.memo||'' }]
      .sort((a,b)=>a.date.localeCompare(b.date)))
    if (ok) setForm(f=>({ ...f, amount:'', memo:'' }))
  }
  async function remove(id) {
    if (!window.confirm('이 기록을 삭제하시겠습니까?')) return
    await update(l => l.filter(r=>r.id!==id))
  }

  const balance = list.reduce((a,r)=> r.type==='lent' ? a + r.amount : a - r.amount, 0)
  const inputStyle = {background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
    padding:'7px 10px',fontSize:12,outline:'none',fontFamily:'inherit'}

  return (
    <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,marginBottom:18,overflow:'hidden'}}>
      <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
        <div>
          <span style={{fontSize:13,fontWeight:600}}>{title}</span>
          <span style={{fontSize:11,color:'#5e6585',marginLeft:10}}>
            {balance>0 ? `${partner}이 ${balance.toLocaleString()}원 갚을 상태` :
             balance<0 ? `${partner}에 ${Math.abs(balance).toLocaleString()}원 갚을 상태` : '잔액 없음'}
          </span>
        </div>
        <button onClick={()=>setOpen(v=>!v)}
          style={{background:'#191c2b',border:'1px solid #272a3d',color:'#dde1f2',borderRadius:7,
            padding:'6px 10px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
          {open ? '▲ 접기' : `내역 ${list.length}건 · + 기록 추가`}
        </button>
      </div>

      {open && (
        <>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',background:'rgba(147,197,253,0.04)',
            display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
            <input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} style={inputStyle}/>
            <div style={{display:'flex',gap:4}}>
              {[['lent','빌려줌'],['received','받음']].map(([k,l])=>(
                <button key={k} onClick={()=>setForm(f=>({...f,type:k}))}
                  style={{padding:'7px 12px',borderRadius:6,border:'none',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                    background:form.type===k?(k==='lent'?'#f87171':'#34d399'):'#191c2b',
                    color:form.type===k?'#000':'#5e6585'}}>{l}</button>
              ))}
            </div>
            <input type="number" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))}
              placeholder="금액" style={{...inputStyle,width:120,fontFamily:'DM Mono,monospace'}}/>
            <input value={form.memo} onChange={e=>setForm(f=>({...f,memo:e.target.value}))}
              placeholder="메모 (선택)" style={{...inputStyle,flex:1,minWidth:100}}/>
            <button onClick={add} disabled={saving}
              style={{background:'#93c5fd',color:'#000',border:'none',borderRadius:7,padding:'7px 16px',
                fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>+ 추가</button>
          </div>
          {list.length === 0 ? (
            <div style={{padding:20,textAlign:'center',color:'#5e6585',fontSize:12}}>
              기록이 없어요. 계좌내역을 올리면 {partner} 계좌와 주고받은 돈이 자동으로 들어와요.
            </div>
          ) : (
            <div style={{padding:'8px 0',maxHeight:360,overflowY:'auto'}}>
              {[...list].sort((a,b)=>b.date.localeCompare(a.date)).map(r=>(
                <div key={r.id} style={{display:'flex',alignItems:'center',gap:12,padding:'9px 18px',borderBottom:'1px solid #1a1d2e',flexWrap:'wrap'}}>
                  <div style={{fontSize:11,color:'#5e6585',fontFamily:'DM Mono,monospace',minWidth:75}}>{r.date}</div>
                  <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:4,
                    background: r.type==='lent'?'rgba(248,113,113,0.15)':'rgba(52,211,153,0.15)',
                    color: r.type==='lent'?'#f87171':'#34d399'}}>{r.type==='lent'?'빌려줌':'받음'}</span>
                  <span style={{flex:1,fontSize:11,color:'#5e6585'}}>{r.memo||'—'}</span>
                  <span style={{fontSize:13,fontWeight:700,fontFamily:'DM Mono,monospace',color:r.type==='lent'?'#f87171':'#34d399'}}>
                    {r.type==='lent'?'+':'-'}{r.amount.toLocaleString()}원
                  </span>
                  <button onClick={()=>remove(r.id)} disabled={saving}
                    style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',
                      padding:'3px 8px',fontSize:10,borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>삭제</button>
                </div>
              ))}
            </div>
          )}
          <div style={{display:'flex',justifyContent:'space-between',padding:'10px 18px',background:'rgba(255,255,255,0.02)',fontSize:11,color:'#5e6585'}}>
            <span>잔액 (빌려준 돈 − 받은 돈)</span>
            <span style={{fontSize:13,fontWeight:700,fontFamily:'DM Mono,monospace',
              color:balance>0?'#f87171':balance<0?'#34d399':'#5e6585'}}>{balance.toLocaleString()}원</span>
          </div>
        </>
      )}
    </div>
  )
}
