import { useState } from 'react'
import { db } from '../firebase'
import { doc, setDoc } from 'firebase/firestore'
import Avatar from './Avatar'
import { useAuth } from '../AuthContext'
import {
  HAIRS, HAIR_COLORS, TIP_COLORS, SKINS, SHIRTS, EYES, BROWS, MOUTHS, MARKS, HATS, TOPS, APRONS, PANTS, SHOES, HOLDS, ACCS, DECOS, LOCKED,
  POSITIONS, HOLD_BY_POSITION, lookOf, randomLook, AVATAR_CSS,
} from '../lib/avatar'

const T = { ink:'#1D1B18', sub:'#6E6A63', rule:'#DCD7CE', soft:'#ECE8E1', accent:'#C3261C', green:'#2E7D45', blue:'#2B5C9E', amber:'#B45309' }
const TABS = [['face','얼굴'], ['hair','머리'], ['clothes','옷'], ['items','소품']]

// 우리 매장 화면에 나오는 캐릭터 꾸미기 (users/{uid}.avatar). 내 기록(직원)과 우리 매장(사장님)에서 씀
// 특별 아이템(LOCKED)은 사장님에게만 보이고 입어 보기만 됨 (저장 안 됨, 직원에게 줄 방법은 정하는 중)
export default function AvatarEditor({ uid, userData, title = '내 캐릭터', hint = '출근하면 매장 화면에서 이 캐릭터가 일해요', onSaved }) {
  const { isOwner } = useAuth()
  const [saved, setSaved] = useState(() => lookOf({ uid, avatar: userData?.avatar }))
  const [look, setLook] = useState(saved)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('face')
  const [tryOn, setTryOn] = useState([])
  const [msg, setMsg] = useState('')
  const set = (k, v) => { setLook(l => ({ ...l, [k]: v })); setMsg('') }
  const toggleDeco = id => { setLook(l => { const d = new Set(l.deco || []); d.has(id) ? d.delete(id) : d.add(id); return { ...l, deco:[...d] } }); setMsg('') }
  const changed = JSON.stringify(look) !== JSON.stringify(saved)
  const role = (userData?.positions?.[0]) || userData?.position || (isOwner && !userData?.positions ? 'kitchen' : 'hall')

  async function save() {
    try {
      await setDoc(doc(db,'users',uid), { avatar: look }, { merge:true })
      setSaved(look); setMsg('저장했어요. 매장 화면에 바로 나와요'); onSaved?.(look)
    } catch(e) { console.error(e); setMsg('저장하지 못했어요. 다시 시도해 주세요') }
  }

  const chip = (on, label, onClick, key) => (
    <button key={key ?? label} type="button" onClick={onClick} className="av-chip" aria-pressed={on}
      style={{fontFamily:'inherit', fontSize:13, padding:'5px 10px', borderRadius:4, cursor:'pointer',
        border:`1px solid ${on ? T.ink : T.rule}`, background: on ? T.ink : '#FFFFFF', color: on ? '#FFFFFF' : T.ink}}>{label}</button>
  )
  const swatch = (on, color, onClick, label) => (
    <button key={color || 'none'} type="button" onClick={onClick} aria-label={label} aria-pressed={on} className="av-chip" title={label}
      style={{width:28, height:28, borderRadius:4, cursor:'pointer', position:'relative',
        background: color && color !== 'none' ? color : 'repeating-linear-gradient(45deg,#FFFFFF 0 4px,#ECE8E1 4px 8px)',
        border: on ? `3px solid ${T.ink}` : `1px solid ${T.rule}`}}/>
  )
  const row = (label, children) => (
    <div style={{display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', padding:'7px 0', borderBottom:`1px solid ${T.soft}`}}>
      <span style={{width:64, fontSize:13, color:T.sub}}>{label}</span>
      <div style={{display:'flex', gap:6, flexWrap:'wrap', flex:1}}>{children}</div>
    </div>
  )
  const picks = (list, key) => list.map(o => chip(look[key] === o.id, o.label, () => set(key, o.id), o.id))
  const colors = (list, key, name) => list.map((c, i) => swatch(look[key] === c, c, () => set(key, c), !c || c === 'none' ? `${name} 없음` : `${name} ${i+1}`))
  const big = (l, t, label) => (
    <figure style={{margin:0, textAlign:'center'}}>
      <div style={{background:'#EFE6D8', borderRadius:6, padding:'8px 10px'}}>
        <svg width="150" height="200" viewBox="-30 -50 210 290" aria-label={label}><Avatar look={l} size={150} pose="work" role={role} try={t}/></svg>
      </div>
      <figcaption style={{fontSize:12, color:T.sub, marginTop:4}}>{label}</figcaption>
    </figure>
  )

  return (
    <section style={{marginBottom:20}}>
      <style>{AVATAR_CSS + '.av-chip:focus-visible{outline:2px solid #C3261C;outline-offset:2px}'}</style>
      <div style={{display:'flex', alignItems:'center', gap:12, borderBottom:`2px solid ${T.ink}`, paddingBottom:6}}>
        <svg width="40" height="54" viewBox="-4 -8 48 62" aria-hidden="true"><Avatar look={saved} size={40} role={role}/></svg>
        <div style={{flex:1}}>
          <h2 style={{fontSize:16, fontWeight:800, margin:0, fontFamily:'inherit'}}>{title}</h2>
          <div style={{fontSize:12, color:T.sub}}>{hint}</div>
        </div>
        <button type="button" onClick={()=>setOpen(v=>!v)} className="av-chip"
          style={{background:'none', border:'none', borderBottom:`1px solid ${T.blue}`, color:T.blue, padding:0, fontSize:13, cursor:'pointer', fontFamily:'inherit'}}>
          {open ? '접기' : '꾸미기'}
        </button>
      </div>
      {open && (
        <div style={{display:'flex', gap:20, flexWrap:'wrap', paddingTop:12}}>
          {/* 크게 미리보기 (바꾸는 중이면 지금 모습과 나란히) */}
          <div style={{display:'flex', gap:10, alignItems:'flex-start', flexWrap:'wrap'}}>
            {changed && big(saved, [], '지금 모습')}
            {big(look, tryOn, changed ? '바꾼 뒤' : '미리보기')}
          </div>
          <div style={{flex:1, minWidth:280}}>
            <div style={{display:'flex', gap:14, borderBottom:`1px solid ${T.rule}`, marginBottom:4}}>
              {TABS.map(([k, l]) => (
                <button key={k} type="button" onClick={()=>setTab(k)} className="av-chip"
                  style={{background:'none', border:'none', borderBottom:`2px solid ${tab===k ? T.accent : 'transparent'}`, padding:'6px 0', fontFamily:'inherit', fontSize:14,
                    fontWeight: tab===k ? 800 : 500, color: tab===k ? T.ink : T.sub, cursor:'pointer'}}>{l}</button>
              ))}
            </div>
            {tab === 'face' && <>
              {row('피부', colors(SKINS, 'skin', '피부색'))}
              {row('눈', picks(EYES, 'eyes'))}
              {row('눈썹', picks(BROWS, 'brows'))}
              {row('입', picks(MOUTHS, 'mouth'))}
              {row('얼굴 표시', picks(MARKS, 'mark'))}
              {row('꾸밈', DECOS.filter(d => d.id === 'blush').map(d => chip((look.deco||[]).includes(d.id) || look.acc === 'blush', d.label, () => toggleDeco(d.id), d.id)))}
            </>}
            {tab === 'hair' && <>
              {row('머리', picks(HAIRS, 'hair'))}
              {row('머리색', colors(HAIR_COLORS, 'hairColor', '머리색'))}
              {row('브릿지', colors(TIP_COLORS, 'tip', '브릿지'))}
              {row('모자', picks(HATS, 'hat'))}
              {row('머리핀', [chip((look.deco||[]).includes('hairpin'), (look.deco||[]).includes('hairpin') ? '했음' : '안 함', () => toggleDeco('hairpin'), 'hp')])}
            </>}
            {tab === 'clothes' && <>
              {row('윗옷', picks(TOPS, 'top'))}
              {row('옷 색', colors(SHIRTS, 'shirt', '옷 색'))}
              {row('앞치마', colors(APRONS, 'apron', '앞치마'))}
              {row('바지', colors(PANTS, 'pants', '바지'))}
              {row('신발', picks(SHOES, 'shoes'))}
              {row('명찰', [chip((look.deco||[]).includes('nametag'), (look.deco||[]).includes('nametag') ? '달았음' : '안 닮', () => toggleDeco('nametag'), 'nt')])}
            </>}
            {tab === 'items' && <>
              {row('손에', picks(HOLDS, 'hold'))}
              {look.hold === 'auto' && <div style={{fontSize:12, color:T.sub, padding:'4px 0 2px 74px'}}>
                포지션 따라: {POSITIONS.map(p => `${p.label.split(' ')[0]} ${HOLDS.find(h => h.id === HOLD_BY_POSITION[p.id])?.label}`).join(' · ')}
              </div>}
              {row('얼굴에', picks(ACCS, 'acc'))}
              {row('귀걸이', [chip((look.deco||[]).includes('earring'), (look.deco||[]).includes('earring') ? '했음' : '안 함', () => toggleDeco('earring'), 'er')])}
            </>}

            {/* 특별 아이템: 사장님만 보임, 입어 보기만 */}
            {isOwner && (
              <div style={{marginTop:12, padding:'10px 12px', border:`1px dashed ${T.amber}`, borderRadius:6, background:'#FFF8EC'}}>
                <div style={{fontSize:13, fontWeight:800, color:T.amber}}>특별 아이템 · 사장님만 보여요</div>
                <div style={{fontSize:12, color:T.sub, margin:'2px 0 8px', lineHeight:1.6}}>직원 화면에는 안 나와요. 입어 보기만 되고 저장되지 않아요. 어떻게 열어 줄지(개근·근속 등)는 같이 정해요.</div>
                <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
                  {LOCKED.map(it => chip(tryOn.includes(it.id), `${it.label} · ${it.idea}`, () => setTryOn(t => t.includes(it.id) ? t.filter(x => x !== it.id) : [...t, it.id]), it.id))}
                </div>
              </div>
            )}

            <div style={{display:'flex', alignItems:'center', gap:8, marginTop:12, flexWrap:'wrap'}}>
              <button type="button" onClick={save} disabled={!changed} className="av-chip"
                style={{background:T.accent, color:'#FFFFFF', border:'none', borderRadius:4, padding:'8px 18px', fontSize:13, fontWeight:700, cursor: changed ? 'pointer' : 'default', fontFamily:'inherit', opacity: changed ? 1 : 0.5}}>저장</button>
              <button type="button" onClick={()=>{ setLook(l => ({ ...l, ...randomLook() })); setMsg('') }} className="av-chip"
                style={{background:'#FFFFFF', color:T.ink, border:`1px solid ${T.rule}`, borderRadius:4, padding:'8px 14px', fontSize:13, cursor:'pointer', fontFamily:'inherit'}}>랜덤</button>
              {changed && <button type="button" onClick={()=>{ setLook(saved); setMsg('') }} className="av-chip"
                style={{background:'none', color:T.sub, border:'none', padding:'8px 4px', fontSize:13, cursor:'pointer', fontFamily:'inherit', textDecoration:'underline'}}>원래대로</button>}
              {msg && <span style={{fontSize:13, color: msg.startsWith('저장했') ? T.green : '#B42318'}}>{msg}</span>}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
