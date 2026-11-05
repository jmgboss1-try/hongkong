import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, setDoc } from 'firebase/firestore'
import Avatar from './Avatar'
import { useAuth } from '../AuthContext'
import {
  HAIRS, HAIR_COLORS, TIP_COLORS, SKINS, SHIRTS, EYES, BROWS, MOUTHS, MARKS, HATS, TOPS, APRONS, PANTS, SHOES, HOLDS, ACCS, DECOS, LOCKED,
  POSITIONS, HOLD_BY_POSITION, lookOf, defaultLook, accsOf, randomLook, AVATAR_CSS,
} from '../lib/avatar'
import { loadAvatarRules, perfectStreaks, tenureMonths, canUse, tierLabel, itemKey, allowedLook } from '../lib/avatarRules'

const T = { ink:'#1D1B18', sub:'#6E6A63', rule:'#DCD7CE', soft:'#ECE8E1', accent:'#C3261C', green:'#2E7D45', blue:'#2B5C9E', amber:'#B45309' }
const TABS = [['face','얼굴'], ['hair','머리'], ['clothes','옷'], ['items','소품']]

// 우리 매장 화면에 나오는 캐릭터 꾸미기 (users/{uid}.avatar). 내 기록(직원)과 우리 매장(사장님)에서 씀
// 아이템마다 지급 기준(아바타 탭): 조건이 안 되는 건 자물쇠로 보여 주거나(설정) 숨김. 사장님은 전부
export default function AvatarEditor({ uid, userData, title = '내 캐릭터', hint = '출근하면 매장 화면에서 이 캐릭터가 일해요', onSaved }) {
  const { isOwner } = useAuth()
  const [saved, setSaved] = useState(() => lookOf({ uid, ...userData }))
  const [look, setLook] = useState(saved)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('face')
  const [msg, setMsg] = useState('')
  const set = (k, v) => { setLook(l => ({ ...l, [k]: v })); setMsg('') }
  // 얼굴 소품은 여러 개 같이 (안경과 선글라스만 둘 중 하나)
  const toggleAcc = id => { setLook(l => {
    if (id === 'none') return { ...l, acc:[] }
    const a = new Set(accsOf(l.acc).filter(x => x !== 'blush'))
    if (a.has(id)) a.delete(id); else { a.add(id); if (id === 'glasses') a.delete('sunglasses'); if (id === 'sunglasses') a.delete('glasses') }
    return { ...l, acc:[...a] }
  }); setMsg('') }
  const toggleSpecial = id => { setLook(l => { const a = new Set(l.special || []); a.has(id) ? a.delete(id) : a.add(id); return { ...l, special:[...a] } }); setMsg('') }
  // 지급 기준과 내 근속·연속 개근
  const owner = isOwner && userData?.role !== 'staff'
  const [rules, setRules] = useState(null)
  const [streak, setStreak] = useState(0)
  useEffect(() => {
    if (!open || rules) return
    let off = false
    loadAvatarRules().then(r => { if (!off) setRules(r) })
    if (!owner) perfectStreaks([{ uid, ...userData }]).then(s => { if (!off) setStreak(s[uid] || 0) }).catch(() => {})
    return () => { off = true }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const tenure = tenureMonths(userData?.joinDate)
  const ok = key => canUse(key, { rules, user:userData, streak, tenure, owner })
  const showLocked = rules?.showLocked !== false
  const lockedChip = (label, key) => (
    <span key={key} title={`${tierLabel(rules, key)}부터 쓸 수 있어요`}
      style={{fontSize:12, padding:'5px 9px', borderRadius:4, border:`1px dashed ${T.rule}`, color:'#A8A39A', background:'#F7F5F0', whiteSpace:'nowrap'}}>
      {label} <span style={{fontSize:11}}>· {tierLabel(rules, key)}</span>
    </span>
  )
  const mySpecials = LOCKED.filter(it => ok(itemKey('special', it.id)))
  const lockedSpecials = showLocked ? LOCKED.filter(it => !ok(itemKey('special', it.id))) : []
  const toggleDeco = id => { setLook(l => { const d = new Set(l.deco || []); d.has(id) ? d.delete(id) : d.add(id); return { ...l, deco:[...d] } }); setMsg('') }
  const changed = JSON.stringify(look) !== JSON.stringify(saved)
  const role = (userData?.positions?.[0]) || userData?.position || (isOwner && !userData?.positions ? 'kitchen' : 'hall')

  async function save() {
    try {
      const clean = allowedLook(look, ok, defaultLook(uid))
      await setDoc(doc(db,'users',uid), { avatar: clean }, { merge:true })
      setLook(clean); setSaved(clean); setMsg('저장했어요. 매장 화면에 바로 나와요'); onSaved?.(clean)
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
  // 쓸 수 없는 건 자물쇠(조건 표시) 또는 숨김
  const picks = (list, key) => list.flatMap(o => ok(itemKey(key, o.id)) ? [chip(look[key] === o.id, o.label, () => set(key, o.id), o.id)] : showLocked ? [lockedChip(o.label, itemKey(key, o.id))] : [])
  const colors = (list, key, name) => list.flatMap((c, i) => {
    const label = !c || c === 'none' ? `${name} 없음` : `${name} ${i+1}`
    if (!c || c === 'none' || ok(itemKey(key, c))) return [swatch(look[key] === c, c, () => set(key, c), label)]
    return showLocked ? [<span key={c} title={`${tierLabel(rules, itemKey(key, c))}부터 쓸 수 있어요`} aria-label={`${label} (잠김)`}
      style={{width:28, height:28, borderRadius:4, background:c, opacity:0.25, border:`1px dashed ${T.ink}`, display:'inline-block'}}/>] : []
  })
  const toggleChip = (group, id, label, onLabel, offLabel) => ok(itemKey(group, id))
    ? chip((look.deco||[]).includes(id), (look.deco||[]).includes(id) ? onLabel : offLabel, () => toggleDeco(id), id)
    : showLocked ? lockedChip(label, itemKey(group, id)) : null
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
            {big(look, [], changed ? '바꾼 뒤' : '미리보기')}
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
              {row('볼터치', [toggleChip('deco', 'blush', '볼터치', '했음', '안 함')])}
            </>}
            {tab === 'hair' && <>
              {row('머리', picks(HAIRS, 'hair'))}
              {row('머리색', colors(HAIR_COLORS, 'hairColor', '머리색'))}
              {row('브릿지', colors(TIP_COLORS, 'tip', '브릿지'))}
              {row('모자', picks(HATS, 'hat'))}
              {row('머리핀', [toggleChip('deco', 'hairpin', '머리핀', '했음', '안 함')])}
            </>}
            {tab === 'clothes' && <>
              {row('윗옷', picks(TOPS, 'top'))}
              {row('옷 색', colors(SHIRTS, 'shirt', '옷 색'))}
              {row('앞치마', colors(APRONS, 'apron', '앞치마'))}
              {row('바지', colors(PANTS, 'pants', '바지'))}
              {row('신발', picks(SHOES, 'shoes'))}
              {row('명찰', [toggleChip('deco', 'nametag', '명찰', '달았음', '안 닮')])}
            </>}
            {tab === 'items' && <>
              {row('손에', picks(HOLDS, 'hold'))}
              {look.hold === 'auto' && <div style={{fontSize:12, color:T.sub, padding:'4px 0 2px 74px'}}>
                포지션 따라: {POSITIONS.map(p => `${p.label.split(' ')[0]} ${HOLDS.find(h => h.id === HOLD_BY_POSITION[p.id])?.label}`).join(' · ')}
              </div>}
              {row('얼굴에', ACCS.flatMap(a => a.id === 'none' || ok(itemKey('acc', a.id)) ? [chip(a.id === 'none' ? !accsOf(look.acc).filter(x => x !== 'blush').length : accsOf(look.acc).includes(a.id), a.label, () => toggleAcc(a.id), a.id)] : showLocked ? [lockedChip(a.label, itemKey('acc', a.id))] : []))}
              <div style={{fontSize:12, color:T.sub, padding:'2px 0 0 74px'}}>여러 개 같이 할 수 있어요 (예: 안경 + 마스크)</div>
              {row('귀걸이', [toggleChip('deco', 'earring', '귀걸이', '했음', '안 함')])}
            </>}

            {/* 특별 아이템 (포상): 사장님은 전부, 직원은 받은 것만 */}
            {(mySpecials.length > 0 || lockedSpecials.length > 0) && (
              <div style={{marginTop:12, padding:'10px 12px', border:`1px dashed ${T.amber}`, borderRadius:6, background:'#FFF8EC'}}>
                <div style={{fontSize:13, fontWeight:800, color:T.amber}}>특별 아이템{owner ? ' · 사장님은 전부 쓸 수 있어요' : ''}</div>
                {owner && <div style={{fontSize:12, color:T.sub, margin:'2px 0 0', lineHeight:1.6}}>직원에게 주는 기준은 '아바타' 탭에서 정해요.</div>}
                {!owner && <div style={{fontSize:12, color:T.sub, margin:'2px 0 0', lineHeight:1.6}}>개근·근속 포상으로 열려요. 지금 근속 {tenure}개월 · 연속 개근 {streak}개월</div>}
                <div style={{display:'flex', gap:6, flexWrap:'wrap', marginTop:8}}>
                  {mySpecials.map(it => chip((look.special || []).includes(it.id), it.label, () => toggleSpecial(it.id), it.id))}
                  {lockedSpecials.map(it => lockedChip(it.label, itemKey('special', it.id)))}
                </div>
              </div>
            )}

            <div style={{display:'flex', alignItems:'center', gap:8, marginTop:12, flexWrap:'wrap'}}>
              <button type="button" onClick={save} disabled={!changed} className="av-chip"
                style={{background:T.accent, color:'#FFFFFF', border:'none', borderRadius:4, padding:'8px 18px', fontSize:13, fontWeight:700, cursor: changed ? 'pointer' : 'default', fontFamily:'inherit', opacity: changed ? 1 : 0.5}}>저장</button>
              <button type="button" onClick={()=>{ setLook(l => allowedLook({ ...l, ...randomLook() }, ok, defaultLook(uid))); setMsg('') }} className="av-chip"
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
