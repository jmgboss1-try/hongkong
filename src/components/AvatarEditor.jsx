import { useState } from 'react'
import { db } from '../firebase'
import { doc, setDoc } from 'firebase/firestore'
import Avatar from './Avatar'
import { HAIRS, HAIR_COLORS, SKINS, SHIRTS, ACCS, lookOf, AVATAR_CSS } from '../lib/avatar'

const T = { ink:'#1D1B18', sub:'#6E6A63', rule:'#DCD7CE', accent:'#C3261C', green:'#2E7D45' }

// 내 기록: 우리 매장 화면에 나오는 내 캐릭터 꾸미기 (users/{uid}.avatar)
export default function AvatarEditor({ uid, userData, title = '내 캐릭터', hint = '출근하면 매장 화면에서 이 캐릭터가 일해요', onSaved }) {
  const [look, setLook] = useState(() => lookOf({ uid, avatar: userData?.avatar }))
  const [open, setOpen] = useState(false)
  const [msg, setMsg] = useState('')
  const set = (k, v) => { setLook(l => ({ ...l, [k]: v })); setMsg('') }

  async function save() {
    try { await setDoc(doc(db,'users',uid), { avatar: look }, { merge:true }); setMsg('저장했어요. 매장 화면에 바로 나와요'); onSaved?.(look) }
    catch(e) { console.error(e); setMsg('저장하지 못했어요. 다시 시도해 주세요') }
  }

  const chip = (on, label, onClick, key) => (
    <button key={key ?? label} type="button" onClick={onClick} className="av-chip"
      style={{fontFamily:'inherit', fontSize:13, padding:'5px 10px', borderRadius:4, cursor:'pointer',
        border:`1px solid ${on ? T.ink : T.rule}`, background: on ? T.ink : '#FFFFFF', color: on ? '#FFFFFF' : T.ink}}>{label}</button>
  )
  const swatch = (on, color, onClick, label) => (
    <button key={color} type="button" onClick={onClick} aria-label={label} className="av-chip"
      style={{width:28, height:28, borderRadius:4, cursor:'pointer', background:color,
        border: on ? `3px solid ${T.ink}` : `1px solid ${T.rule}`, outlineOffset:2}}/>
  )
  const row = (label, children) => (
    <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', padding:'6px 0', borderBottom:'1px solid #ECE8E1'}}>
      <span style={{width:56, fontSize:13, color:T.sub}}>{label}</span>
      <div style={{display:'flex', gap:6, flexWrap:'wrap', flex:1}}>{children}</div>
    </div>
  )

  return (
    <section style={{marginBottom:20}}>
      <style>{AVATAR_CSS + '.av-chip:focus-visible{outline:2px solid #C3261C;outline-offset:2px}'}</style>
      <div style={{display:'flex', alignItems:'center', gap:12, borderBottom:`2px solid ${T.ink}`, paddingBottom:6}}>
        <svg width="40" height="50" viewBox="0 0 40 50" aria-hidden="true"><Avatar look={look} size={40}/></svg>
        <div style={{flex:1}}>
          <h2 style={{fontSize:16, fontWeight:800, margin:0, fontFamily:'inherit'}}>{title}</h2>
          <div style={{fontSize:12, color:T.sub}}>{hint}</div>
        </div>
        <button type="button" onClick={()=>setOpen(v=>!v)} className="av-chip"
          style={{background:'none', border:'none', borderBottom:'1px solid #2B5C9E', color:'#2B5C9E', padding:0, fontSize:13, cursor:'pointer', fontFamily:'inherit'}}>
          {open ? '접기' : '꾸미기'}
        </button>
      </div>
      {open && (
        <div style={{display:'flex', gap:20, flexWrap:'wrap', paddingTop:10}}>
          <div style={{background:'#EFE6D8', borderRadius:6, padding:'12px 18px', alignSelf:'flex-start'}}>
            <svg width="96" height="120" viewBox="0 0 96 120" aria-label="미리보기"><Avatar look={look} size={96} pose="work"/></svg>
          </div>
          <div style={{flex:1, minWidth:260}}>
            {row('머리', HAIRS.map(h => chip(look.hair===h.id, h.label, ()=>set('hair', h.id), h.id)))}
            {row('머리색', HAIR_COLORS.map((c,i) => swatch(look.hairColor===c, c, ()=>set('hairColor', c), `머리색 ${i+1}`)))}
            {row('피부', SKINS.map((c,i) => swatch(look.skin===c, c, ()=>set('skin', c), `피부색 ${i+1}`)))}
            {row('옷', SHIRTS.map((c,i) => swatch(look.shirt===c, c, ()=>set('shirt', c), `옷 색 ${i+1}`)))}
            {row('소품', ACCS.map(a => chip(look.acc===a.id, a.label, ()=>set('acc', a.id), a.id)))}
            <div style={{display:'flex', alignItems:'center', gap:10, marginTop:10}}>
              <button type="button" onClick={save} className="av-chip"
                style={{background:T.accent, color:'#FFFFFF', border:'none', borderRadius:4, padding:'8px 18px', fontSize:13, fontWeight:700, cursor:'pointer', fontFamily:'inherit'}}>저장</button>
              {msg && <span style={{fontSize:13, color: msg.startsWith('저장했') ? T.green : '#B42318'}}>{msg}</span>}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
