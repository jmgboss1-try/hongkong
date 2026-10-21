import { useState } from 'react'
import { parseTxKey, currentClass, classLabel, classOptions, reclassify } from '../lib/bankReclass'

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

  const txs = (data?.bankSeen||[]).map(parseTxKey)
    .filter(t => day ? t.date === `${ym}-${day}` : (dir==='out' ? t.out : t.in))
    .filter(t => !q || norm(t.desc).includes(norm(q)) || String(t.out||t.in).includes(q.replace(/[^0-9]/g,'') || '__'))
    .sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))
  if (!(data?.bankSeen||[]).length) return null

  async function apply(t) {
    const e = edit[t.key] || {}
    const cur = currentClass(data, t).value
    if (e.to === undefined || e.to === cur) return
    if (cur === '?expense' && !e.fromCat) return alert('원래 들어가 있던 카테고리를 먼저 골라주세요')
    setBusyKey(t.key)
    try {
      await reclassify({ ym, tx:t, to:e.to, fromCat:e.fromCat, categories })
      setEdit(p=>{ const n = { ...p }; delete n[t.key]; return n })
      onChanged?.()
    } catch(err) { console.error(err); alert(err.message || '바꾸는 중 오류가 발생했어요.') }
    setBusyKey(null)
  }

  const sel = {background:'#12141f',border:'1px solid #272a3d',borderRadius:6,color:'#dde1f2',
    padding:'5px 8px',fontSize:11,outline:'none',fontFamily:'inherit'}
  const renderOptions = t => {
    const opts = classOptions(t, categories)
    const groups = [...new Set(opts.map(o=>o.group||''))]
    return groups.map(g => g
      ? <optgroup key={g} label={g}>{opts.filter(o=>o.group===g).map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</optgroup>
      : opts.filter(o=>!o.group).map(o=><option key={o.value} value={o.value}>{o.label}</option>))
  }

  return (
    <div style={{marginTop: day ? 0 : 12}}>
      {!day && <button type="button" onClick={()=>setOpen(v=>!v)}
        style={{background:'transparent',border:'none',color:'#93c5fd',fontSize:11,cursor:'pointer',fontFamily:'inherit',padding:0}}>
        {open ? '▾ 통장 거래 분류 접기' : `▸ 🔁 통장 거래 분류 보기·바꾸기 (${(data.bankSeen||[]).length}건)`}
      </button>}
      {open && (
        <div style={{marginTop:8}}>
          {day ? (
            <div style={{fontSize:10,color:'#5e6585',marginBottom:6}}>
              {+day}일 통장 거래 — 한 건씩 분류를 바꿀 수 있어요. 바꾸면 위 표의 칸 금액도 같이 바뀌어요.
            </div>
          ) : <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap',marginBottom:8}}>
            {[['out','💸 출금'],['in','💰 입금']].map(([k,l])=>(
              <button key={k} onClick={()=>setDir(k)}
                style={{padding:'5px 12px',borderRadius:6,border:'none',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                  background:dir===k?'#f9b934':'#191c2b',color:dir===k?'#000':'#5e6585'}}>{l}</button>
            ))}
            <input value={q} onChange={e=>setQ(e.target.value)} placeholder="이름·금액 검색"
              style={{...sel,padding:'6px 10px',width:160}}/>
            <span style={{fontSize:10,color:'#5e6585'}}>분류를 바꾸면 원래 들어간 곳(지출 칸·실입금·대여금 장부·투자관리)에서 빼고 새 곳에 넣어요</span>
          </div>}
          <div style={{display:'flex',flexDirection:'column',gap:4,maxHeight:420,overflowY:'auto'}}>
            {txs.map(t=>{
              const cur = currentClass(data, t).value
              const e = edit[t.key] || {}
              const to = e.to ?? (cur === '?expense' ? '' : cur)
              const changed = e.to !== undefined && e.to !== cur
              return (
                <div key={t.key} style={{display:'flex',alignItems:'center',gap:8,background:'#191c2b',borderRadius:6,padding:'6px 10px',flexWrap:'wrap'}}>
                  <span style={{fontSize:11,color:'#5e6585',fontFamily:'DM Mono,monospace',minWidth:76}}>{t.date.slice(5)} {t.time.slice(0,5)}</span>
                  <span style={{flex:1,fontSize:11,color:'#dde1f2',minWidth:110}}>{t.desc||'—'}</span>
                  <span style={{fontSize:12,fontWeight:700,fontFamily:'DM Mono,monospace',color: t.out ? '#f87171' : '#34d399',minWidth:84,textAlign:'right'}}>{wonFmt(t.out||t.in)}</span>
                  <span style={{fontSize:10,color: cur ? '#5e6585' : '#f87171',minWidth:120}}>지금: {classLabel(cur, categories)}</span>
                  {cur === '?expense' && (
                    <select value={e.fromCat||''} onChange={ev=>setEdit(p=>({ ...p, [t.key]: { ...e, fromCat: ev.target.value } }))}
                      style={{...sel, borderColor: e.fromCat ? '#272a3d' : '#f9b934'}} title="이 출금이 원래 어느 카테고리에 들어가 있었는지">
                      <option value="">원래 카테고리?</option>
                      {categories.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  )}
                  <select value={to} onChange={ev=>setEdit(p=>({ ...p, [t.key]: { ...e, to: ev.target.value } }))} style={{...sel,minWidth:130}}>
                    <option value="">— 미분류 —</option>
                    {renderOptions(t)}
                  </select>
                  <button onClick={()=>apply(t)} disabled={!changed || busyKey===t.key}
                    style={{background: changed ? '#f9b934' : '#191c2b',color: changed ? '#000' : '#5e6585',border: changed ? 'none' : '1px solid #272a3d',
                      borderRadius:6,padding:'5px 10px',fontSize:11,fontWeight:700,cursor: changed ? 'pointer' : 'default',fontFamily:'inherit'}}>
                    {busyKey===t.key ? '...' : '바꾸기'}
                  </button>
                </div>
              )
            })}
            {!txs.length && <div style={{fontSize:11,color:'#5e6585',padding:10}}>해당하는 거래가 없어요</div>}
          </div>
        </div>
      )}
    </div>
  )
}
