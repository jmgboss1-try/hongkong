import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { collection, doc, getDocs, setDoc } from 'firebase/firestore'
import Avatar from '../components/Avatar'
import { AVATAR_CSS, defaultLook } from '../lib/avatar'
import { ITEM_GROUPS, TIERS, WHENS, LINE_POS, itemKey, tierOf, defaultTier, loadAvatarRules, perfectStreaks, tenureMonths, canUse, linesOf, lineEveryOf } from '../lib/avatarRules'

const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', soft:'#ECE8E1', chip:'#F3F1EC', accent:'#C3261C', green:'#2E7D45', red:'#B42318', blue:'#2B5C9E', amber:'#B45309' }
const num = { fontVariantNumeric:'tabular-nums' }

// 이 아이템을 입은 모습 (미리보기용)
function itemLook(group, id) {
  const base = { ...defaultLook('미리보기'), hair:'short', hairColor:'#1D1B18', shirt:'#E8E4DC', skin:'#EBC29B', hold:'none' }
  if (group === 'acc') return { ...base, acc:[id] }
  if (group === 'deco') return { ...base, deco:[id] }
  if (group === 'special') return { ...base, special:[id] }
  return { ...base, [group]: id }
}

function Btn({ children, onClick, kind = 'plain', disabled, small }) {
  const solid = kind === 'primary'
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{fontFamily:'inherit', cursor: disabled ? 'default' : 'pointer', borderRadius:4, whiteSpace:'nowrap', fontSize: small ? 12 : 13, padding: small ? '4px 9px' : '7px 14px',
        fontWeight: solid ? 700 : 500, opacity: disabled ? 0.55 : 1, background: solid ? T.accent : '#FFFFFF', color: solid ? '#FFFFFF' : T.ink, border: solid ? 'none' : `1px solid ${T.rule}`}}>
      {children}
    </button>
  )
}

// 사장님 '아바타' 탭: 아이템별 지급 기준(기본 / 개근 N개월 / 근속 N개월 / 직접 줄 때만)과 직원별로 직접 주기
export default function AvatarManage() {
  const [rules, setRules] = useState(null)
  const [saved, setSaved] = useState(null)
  const [staff, setStaff] = useState([])
  const [streaks, setStreaks] = useState({})
  const [open, setOpen] = useState(null)       // 펼친 직원 uid
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let off = false
    Promise.all([loadAvatarRules(), getDocs(collection(db,'users'))]).then(([r, us]) => {
      if (off) return
      const list = []
      us.forEach(d => { const u = d.data(); if (u.status === 'approved' && !['owner','store','investor'].includes(u.role)) list.push({ uid:d.id, ...u }) })
      list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'))
      setRules(r); setSaved(JSON.stringify(r)); setStaff(list)
      perfectStreaks(list).then(st => { if (!off) setStreaks(st) }).catch(() => {})
    }).catch(e => { console.error(e); setMsg('불러오지 못했어요') })
    return () => { off = true }
  }, [])

  if (!rules) return <div style={{color:T.sub}}>{msg || '불러오는 중...'}</div>
  const dirty = JSON.stringify(rules) !== saved
  const setTier = (key, t) => setRules(r => {
    const tiers = { ...r.tiers }
    if (t === defaultTier(key)) delete tiers[key]; else tiers[key] = t
    return { ...r, tiers }
  })
  async function save() {
    setBusy(true); setMsg('')
    try { await setDoc(doc(db,'rewards','avatar'), { tiers: rules.tiers, showLocked: rules.showLocked !== false, lines: linesOf(rules).filter(l => l.text?.trim()), lineEvery: lineEveryOf(rules), updatedAt: new Date().toISOString() }); setSaved(JSON.stringify(rules)); setMsg('저장했어요. 직원 꾸미기 화면과 우리 매장에 바로 적용돼요') }
    catch(e) { console.error(e); setMsg(e.code === 'permission-denied' ? '저장할 권한이 없어요 (Firestore 규칙에서 rewards 쓰기 확인)' : '저장하지 못했어요. 다시 시도해 주세요') }
    setBusy(false)
  }
  // 직접 주기·거두기 (users/{uid}.unlocks)
  async function give(u, key, on) {
    const next = on ? [...new Set([...(u.unlocks || []), key])] : (u.unlocks || []).filter(x => x !== key)
    setStaff(list => list.map(x => x.uid === u.uid ? { ...x, unlocks: next } : x))
    try { await setDoc(doc(db,'users',u.uid), { unlocks: next }, { merge:true }) }
    catch(e) { console.error(e); setStaff(list => list.map(x => x.uid === u.uid ? { ...x, unlocks: u.unlocks } : x)); setMsg('직접 주기를 저장하지 못했어요') }
  }
  const rewardItems = [
    ...ITEM_GROUPS.flatMap(g => g.items.map(it => ({ ...it, group:g.key, groupLabel:g.label, key:itemKey(g.key, it.id) }))),
    ...linesOf(rules).filter(l => l.pos !== 'boss').map(l => ({ id:l.id, label:`"${l.text}"`, group:'line', groupLabel:'대사', key:'line:' + l.id })),
  ].filter(it => tierOf(rules, it.key) !== 'base')
  // 대사 고치기
  const lines = linesOf(rules)
  const setLines = f => setRules(r => ({ ...r, lines: f(linesOf(r)) }))
  const patchLine = (id, p) => setLines(ls => ls.map(l => l.id === id ? { ...l, ...p } : l))
  const addLine = when => setLines(ls => [...ls, { id:'n' + Date.now().toString(36), when, pos:'any', tier:'base', text:'' }])
  const tierName = id => TIERS.find(t => t.id === id)?.label
  const sel = { fontFamily:'inherit', fontSize:13, padding:'4px 6px', border:`1px solid ${T.rule}`, borderRadius:4, background:'#FFFFFF', color:T.ink }

  return (
    <div style={{maxWidth:1000}}>
      <style>{AVATAR_CSS}</style>
      <header style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:12, flexWrap:'wrap', paddingBottom:10, borderBottom:`3px double ${T.ink}`, marginBottom:14}}>
        <h1 style={{fontSize:24, fontWeight:800, margin:0, fontFamily:'inherit', color:T.ink}}>아바타</h1>
        <div style={{fontSize:13, color:T.sub}}>꾸미기 아이템을 개근·근속 포상으로 나눠 줘요 · 사장님만 보는 화면</div>
      </header>
      <div style={{position:'sticky', top:0, zIndex:3, background:'#FAF9F6', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', padding:'8px 0', borderBottom:`1px solid ${T.soft}`}}>
          <Btn kind="primary" onClick={save} disabled={busy || !dirty}>{busy ? '저장 중...' : '저장'}</Btn>
          {dirty && <span style={{fontSize:13, color:T.amber, fontWeight:700}}>바꾼 기준·대사가 아직 저장 안 됐어요</span>}
          <label style={{display:'flex', alignItems:'center', gap:6, fontSize:13}}>
            <input type="checkbox" checked={rules.showLocked !== false} onChange={e=>setRules(r => ({ ...r, showLocked: e.target.checked }))}/>
            못 쓰는 아이템도 직원에게 자물쇠로 보여 주기
          </label>
          {msg && <span style={{fontSize:13, color: msg.includes('못') || msg.includes('권한') ? T.red : T.green}}>{msg}</span>}
        </div>

      {/* 직원별 현황 + 직접 주기 */}
      <section style={{marginBottom:24}}>
        <h2 style={{fontSize:16, fontWeight:800, margin:'0 0 4px', fontFamily:'inherit', borderBottom:`2px solid ${T.ink}`, paddingBottom:4}}>직원별</h2>
        <div style={{fontSize:12, color:T.sub, margin:'0 0 6px'}}>연속 개근은 지난 달까지 끝난 달만 세요 (집계 시작 전 달은 빼고). 조건이 안 돼도 '직접 주기'로 열 수 있어요.</div>
        {staff.length === 0 && <div style={{fontSize:13, color:T.sub}}>직원이 없어요</div>}
        {staff.map(u => {
          const tenure = tenureMonths(u.joinDate), streak = streaks[u.uid] || 0
          const usable = rewardItems.filter(it => canUse(it.key, { rules, user:u, streak, tenure }))
          return (
            <div key={u.uid} style={{borderBottom:`1px solid ${T.soft}`}}>
              <button type="button" onClick={()=>setOpen(o => o === u.uid ? null : u.uid)}
                style={{display:'flex', width:'100%', alignItems:'center', gap:12, padding:'8px 0', background:'none', border:'none', cursor:'pointer', fontFamily:'inherit', textAlign:'left', color:T.ink}}>
                <svg width="30" height="40" viewBox="-3 -6 36 46" aria-hidden="true"><Avatar look={{ ...defaultLook(u.uid), ...(u.avatar || {}) }} size={30}/></svg>
                <b style={{minWidth:64, fontSize:14}}>{u.name}</b>
                <span style={{fontSize:13, color:T.sub, ...num}}>근속 {tenure}개월{!u.joinDate && ' (입사일 없음)'}</span>
                <span style={{fontSize:13, color: streak ? T.amber : T.sub, ...num}}>연속 개근 {streak}개월</span>
                <span style={{flex:1}}/>
                <span style={{fontSize:13, ...num}}>포상 아이템 {usable.length}/{rewardItems.length} 열림</span>
                <span style={{fontSize:12, color:T.blue}}>{open === u.uid ? '접기' : '보기'}</span>
              </button>
              {open === u.uid && (
                <div style={{padding:'4px 0 12px 42px'}}>
                  {rewardItems.length === 0 && <div style={{fontSize:13, color:T.sub}}>아래 지급 기준에서 포상 아이템을 먼저 정해 주세요</div>}
                  {rewardItems.map(it => {
                    const given = (u.unlocks || []).includes(it.key)
                    const earned = canUse(it.key, { rules, user:{ ...u, unlocks:[] }, streak, tenure })
                    return (
                      <div key={it.key} style={{display:'flex', alignItems:'center', gap:10, padding:'3px 0', fontSize:13}}>
                        <span style={{minWidth:150, maxWidth:260, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{it.groupLabel} · {it.color ? <span style={{display:'inline-block', width:12, height:12, background:it.color, border:`1px solid ${T.rule}`, verticalAlign:-1}}/> : it.label}</span>
                        <span style={{minWidth:110, color:T.sub}}>{tierName(tierOf(rules, it.key))}</span>
                        {earned
                          ? <span style={{color:T.green, fontWeight:700}}>조건 충족</span>
                          : <label style={{display:'flex', gap:4, alignItems:'center'}}><input type="checkbox" checked={given} onChange={e=>give(u, it.key, e.target.checked)}/> 직접 주기</label>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </section>

      {/* 지급 기준 */}
      <section>
        <div style={{display:'flex', alignItems:'baseline', gap:10, flexWrap:'wrap', borderBottom:`2px solid ${T.ink}`, paddingBottom:4, marginBottom:6}}>
          <h2 style={{fontSize:16, fontWeight:800, margin:0, fontFamily:'inherit'}}>지급 기준</h2>
          <span style={{fontSize:12, color:T.sub}}>정하지 않은 건 기본(모두)이고, 특별 아이템은 기본이 '직접 줄 때만'이에요</span>
        </div>
        {ITEM_GROUPS.map(g => (
          <div key={g.key} style={{padding:'10px 0', borderBottom:`1px solid ${T.soft}`}}>
            <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:6}}>
              <b style={{fontSize:14}}>{g.label}</b>
              <select aria-label={`${g.label} 한꺼번에`} value="" style={{...sel, color:T.sub}}
                onChange={e => { const t = e.target.value; if (t) g.items.forEach(it => setTier(itemKey(g.key, it.id), t)) }}>
                <option value="">한꺼번에 바꾸기</option>
                {TIERS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(250px, 1fr))', gap:6}}>
              {g.items.map(it => {
                const key = itemKey(g.key, it.id), t = tierOf(rules, key)
                return (
                  <div key={key} style={{display:'flex', alignItems:'center', gap:8, padding:'4px 6px', borderRadius:4, background: t === 'base' ? 'transparent' : '#FFF8EC', border:`1px solid ${t === 'base' ? 'transparent' : '#F0D9B5'}`}}>
                    <svg width="28" height="38" viewBox="-4 -8 36 48" aria-hidden="true"><Avatar look={itemLook(g.key, it.id)} size={28} role="kitchen"/></svg>
                    <span style={{flex:1, fontSize:13, minWidth:0, whiteSpace:'nowrap'}}>
                      {it.color ? <span style={{display:'inline-block', width:16, height:16, background:it.color, border:`1px solid ${T.rule}`, borderRadius:3, verticalAlign:-3}} title={it.label}/> : it.label}
                    </span>
                    <select aria-label={`${g.label} ${it.label} 지급 기준`} value={t} onChange={e=>setTier(key, e.target.value)} style={{...sel, fontWeight: t === 'base' ? 400 : 700, color: t === 'base' ? T.sub : T.amber}}>
                      {TIERS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                    </select>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </section>

      {/* 대사: 상황별 대사와 누가 할 수 있는지 */}
      <section style={{marginTop:24}}>
        <div style={{display:'flex', alignItems:'baseline', gap:10, flexWrap:'wrap', borderBottom:`2px solid ${T.ink}`, paddingBottom:4, marginBottom:6}}>
          <h2 style={{fontSize:16, fontWeight:800, margin:0, fontFamily:'inherit'}}>대사</h2>
          <span style={{fontSize:12, color:T.sub}}>우리 매장에서 캐릭터가 말풍선으로 해요. '/'를 넣으면 두 줄. 기준이 '기본'이 아니면 그 조건이 되는 직원만 해요. 저장은 위의 '저장'</span>
        </div>
        <label style={{display:'flex', alignItems:'center', gap:8, fontSize:13, padding:'6px 0'}}>
          일하면서 한마디 간격
          <select value={lineEveryOf(rules)} onChange={e=>setRules(r => ({ ...r, lineEvery: +e.target.value }))} style={sel}>
            {[[30,'30초마다'],[50,'50초마다'],[90,'1분 30초마다'],[120,'2분마다'],[300,'5분마다'],[0,'안 함']].map(([v,l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <span style={{fontSize:12, color:T.sub}}>(한 번에 5초 동안, 사람마다 다른 때)</span>
        </label>
        {WHENS.map(w => (
          <div key={w.id} style={{padding:'8px 0', borderBottom:`1px solid ${T.soft}`}}>
            <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:4}}>
              <b style={{fontSize:14}}>{w.label}</b>
              <Btn small onClick={()=>addLine(w.id)}>+ 대사 추가</Btn>
            </div>
            {lines.filter(l => l.when === w.id).map(l => (
              <div key={l.id} style={{display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', padding:'3px 0'}}>
                <input value={l.text} onChange={e=>patchLine(l.id, { text:e.target.value })} placeholder="대사 (예: 짬뽕 나갑니다!)" aria-label={`${w.label} 대사`}
                  style={{flex:'1 1 220px', fontFamily:'inherit', fontSize:14, padding:'6px 8px', border:`1px solid ${T.rule}`, borderRadius:4}}/>
                {(w.id === 'work' || w.id === 'busy' || w.id === 'rest') && (
                  <select value={l.pos || 'any'} onChange={e=>patchLine(l.id, { pos:e.target.value })} aria-label="누가 (자리)" style={sel}>
                    {LINE_POS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                )}
                {l.pos !== 'boss' && (
                  <select value={l.tier || 'base'} onChange={e=>patchLine(l.id, { tier:e.target.value })} aria-label="지급 기준" style={{...sel, fontWeight: (l.tier||'base') === 'base' ? 400 : 700, color: (l.tier||'base') === 'base' ? T.sub : T.amber}}>
                    {TIERS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                  </select>
                )}
                <button type="button" onClick={()=>setLines(ls => ls.filter(x => x.id !== l.id))} style={{background:'none', border:'none', color:T.red, cursor:'pointer', fontSize:12, fontFamily:'inherit'}}>삭제</button>
              </div>
            ))}
            {!lines.some(l => l.when === w.id) && <div style={{fontSize:12, color:T.faint}}>대사 없음 (이때는 말풍선이 안 떠요)</div>}
          </div>
        ))}
      </section>
    </div>
  )
}
