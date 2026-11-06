import { useState } from 'react'
import { db } from '../firebase'
import { doc, setDoc } from 'firebase/firestore'
import { LINE_DEFS, DEFAULT_LINES, FREQ_DEFS, FREQ_LABELS, TONES, DEFAULT_LIFE } from '../lib/storeLife'

// 우리 매장 '매장 장면 설정' (사장님만): 손님·직원 대사, 일이 얼마나 자주 생기나, 키오스크/포스 주문 비율, 사장님 기본 반응
// rewards/storeLife 에 저장 (매장계정·직원이 읽을 수 있는 곳이라 규칙을 안 바꿔도 됨)
const T = { ink:'#1D1B18', sub:'#6E6A63', rule:'#DCD7CE', soft:'#ECE8E1', chip:'#F3F1EC', accent:'#C3261C', green:'#2E7D45' }
const sel = { fontFamily:'inherit', fontSize:13, padding:'5px 8px', borderRadius:4, border:`1px solid ${T.rule}`, background:'#FFFFFF', color:T.ink }
const btn = (primary) => ({ fontFamily:'inherit', fontSize:13, fontWeight:700, padding:'7px 14px', borderRadius:4, cursor:'pointer',
  border: primary ? 'none' : `1px solid ${T.rule}`, background: primary ? T.accent : '#FFFFFF', color: primary ? '#FFFFFF' : T.ink })

const toText = list => (list || []).join('\n')
const fromText = text => String(text).split('\n').map(x => x.trim()).filter(Boolean)

export default function StoreLifeSettings({ raw }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(null)   // 고치는 중인 값 (열 때 저장된 값으로 채움)
  const [msg, setMsg] = useState('')
  const [saving, setSaving] = useState(false)

  const start = () => {
    setForm({
      freq: { ...DEFAULT_LIFE.freq, ...(raw?.freq || {}) },
      kioskRate: raw?.kioskRate ?? DEFAULT_LIFE.kioskRate,
      tone: raw?.tone || DEFAULT_LIFE.tone,
      lines: Object.fromEntries(LINE_DEFS.map(([k]) => [k, toText(raw?.lines?.[k]?.length ? raw.lines[k] : DEFAULT_LINES[k])])),
    })
    setOpen(true); setMsg('')
  }
  const save = async () => {
    setSaving(true); setMsg('')
    try {
      const lines = Object.fromEntries(Object.entries(form.lines).map(([k, v]) => [k, fromText(v)]))
      await setDoc(doc(db, 'rewards', 'storeLife'), { freq: form.freq, kioskRate: +form.kioskRate, tone: form.tone, lines }, { merge: true })
      setMsg('저장했어요. 매장 그림에 바로 반영돼요')
    } catch (e) { console.error(e); setMsg('저장하지 못했어요') }
    setSaving(false)
  }
  const setLine = (k, v) => setForm(f => ({ ...f, lines: { ...f.lines, [k]: v } }))

  return (
    <section style={{marginTop:22}}>
      <div style={{display:'flex', alignItems:'baseline', gap:10, borderBottom:`2px solid ${T.ink}`, paddingBottom:4, flexWrap:'wrap'}}>
        <h2 style={{fontSize:15, fontWeight:800, margin:0, fontFamily:'inherit', color:T.ink}}>매장 장면 설정</h2>
        <span style={{fontSize:12, color:T.sub}}>손님·직원 대사, 일이 얼마나 자주 생기나, 사장님 반응</span>
        <span style={{flex:1}}/>
        <button type="button" onClick={() => open ? setOpen(false) : start()} style={{...btn(false), padding:'4px 10px', fontSize:12}}>{open ? '접기' : '고치기'}</button>
      </div>
      {open && form && (
        <div style={{paddingTop:10}}>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 260px), 1fr))', gap:'8px 24px'}}>
            {FREQ_DEFS.map(([k, label]) => (
              <label key={k} style={{display:'flex', alignItems:'center', gap:8, fontSize:13, padding:'4px 0', borderBottom:`1px dotted ${T.rule}`}}>
                <span style={{flex:1}}>{label}</span>
                <select value={form.freq[k]} onChange={e => setForm(f => ({ ...f, freq: { ...f.freq, [k]: +e.target.value } }))} style={sel}>
                  {FREQ_LABELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
                </select>
              </label>
            ))}
            <label style={{display:'flex', alignItems:'center', gap:8, fontSize:13, padding:'4px 0', borderBottom:`1px dotted ${T.rule}`}}>
              <span style={{flex:1}}>키오스크로 주문하는 손님</span>
              <select value={form.kioskRate} onChange={e => setForm(f => ({ ...f, kioskRate: +e.target.value }))} style={sel}>
                {[100, 90, 80, 70, 60, 50].map(v => <option key={v} value={v}>{v}% (포스 {100 - v}%)</option>)}
              </select>
            </label>
            <label style={{display:'flex', alignItems:'center', gap:8, fontSize:13, padding:'4px 0', borderBottom:`1px dotted ${T.rule}`}}>
              <span style={{flex:1}}>주방 실수 때 사장님 반응</span>
              <select value={form.tone} onChange={e => setForm(f => ({ ...f, tone: e.target.value }))} style={sel}>
                {TONES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          </div>
          <div style={{fontSize:12, color:T.sub, margin:'10px 0 4px', lineHeight:1.6}}>
            실수가 생기면 사장님 화면에 '다그치기 · 다독이기 · 위로' 버튼이 12초 동안 나와요. 고르면 모든 화면에서 사장님 캐릭터가 그렇게 말하고, 안 고르면 위 기본 반응으로 말해요.
          </div>

          <h3 style={{fontSize:14, fontWeight:800, margin:'16px 0 2px', fontFamily:'inherit'}}>대사</h3>
          <div style={{fontSize:12, color:T.sub, marginBottom:6}}>한 줄에 하나씩. 그중 하나를 골라서 말해요. '/'를 넣으면 말풍선이 두 줄이 되고, 손님끼리 수다는 '말1 &gt; 말2'로 적어요.</div>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap:'10px 24px'}}>
            {LINE_DEFS.map(([k, label, who]) => (
              <div key={k}>
                <div style={{display:'flex', alignItems:'baseline', gap:6, fontSize:13, marginBottom:3}}>
                  <b>{label}</b><span style={{fontSize:11, color:T.sub, background:T.chip, padding:'1px 6px', borderRadius:3}}>{who}</span>
                  <span style={{flex:1}}/>
                  {form.lines[k] !== toText(DEFAULT_LINES[k]) && <button type="button" onClick={() => setLine(k, toText(DEFAULT_LINES[k]))} style={{fontFamily:'inherit', fontSize:11, color:T.sub, background:'none', border:'none', cursor:'pointer', textDecoration:'underline'}}>기본으로</button>}
                </div>
                <textarea value={form.lines[k]} onChange={e => setLine(k, e.target.value)} rows={Math.min(5, Math.max(2, form.lines[k].split('\n').length))}
                  style={{width:'100%', boxSizing:'border-box', fontFamily:'inherit', fontSize:13, padding:'6px 8px', borderRadius:4, border:`1px solid ${T.rule}`, background:T.chip, color:T.ink, resize:'vertical', lineHeight:1.5}}/>
              </div>
            ))}
          </div>
          <div style={{position:'sticky', bottom:0, display:'flex', alignItems:'center', gap:10, padding:'10px 0', background:'#FAF9F6', borderTop:`1px solid ${T.soft}`, marginTop:12}}>
            <button type="button" onClick={save} disabled={saving} style={btn(true)}>{saving ? '저장 중…' : '저장'}</button>
            <button type="button" onClick={() => setOpen(false)} style={btn(false)}>닫기</button>
            {msg && <span style={{fontSize:13, color: msg.startsWith('저장했') ? T.green : T.accent}}>{msg}</span>}
          </div>
        </div>
      )}
    </section>
  )
}
