import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, setDoc } from 'firebase/firestore'
import Avatar from './Avatar'
import { lookOf, defaultLook, AVATAR_CSS } from '../lib/avatar'
import { dayStatus } from '../lib/attendance'
import { loadAvatarRules, perfectStreaks, tenureMonths, canUse, allowedLook, linesFor, linesOf, ITEM_GROUPS, itemKey, tierOf } from '../lib/avatarRules'

const T = { ink:'#1D1B18', sub:'#6E6A63', rule:'#DCD7CE', accent:'#C3261C', red:'#B42318', amber:'#B45309' }
const hashOf = s => { let h = 7; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h }

// 출퇴근 화면: 내 아바타가 출근·지각·퇴근 대사를 말하고, 개근·근속으로 새로 열린 아이템·대사를 알려 줌
//  - 대사·지급 기준은 아바타 탭 (rewards/avatar). 이미 알려 준 것은 users/{uid}.seenUnlocks 에 적어 둠
//  - seenUnlocks 가 아직 없으면(처음) 지금 열린 것을 조용히 적기만 함 (한꺼번에 '새로 열림'이 뜨지 않게)
export default function ClockAvatar({ uid, me, kind, rec }) {
  const [data, setData] = useState(null)

  useEffect(() => {
    if (!uid || !me) return
    let off = false
    ;(async () => {
      const rules = await loadAvatarRules()
      const owner = me.role === 'owner'
      const user = { uid, ...me }
      const streak = owner ? 0 : ((await perfectStreaks([user]).catch(() => ({})))[uid] || 0)
      const who = { rules, user, streak, tenure: tenureMonths(me.joinDate), owner }
      const ok = key => canUse(key, who)
      const look = allowedLook(lookOf(user), ok, defaultLook(uid))
      const role = me.positions?.[0] || me.position || 'hall'
      const late = kind === 'in' && rec?.schedStart && dayStatus(rec, { start: rec.schedStart }).late > 0
      const when = kind === 'out' || kind === 'already' ? 'leave' : late ? 'late' : 'arrive'
      let list = linesFor(rules, when, role, who)
      if (!list.length && when === 'late') list = linesFor(rules, 'arrive', role, who)
      const line = list.length ? list[(new Date().getDate() + hashOf(uid)) % list.length].text : null

      // 새로 열린 포상 아이템·대사 (기본이 아닌 것 중 지금 쓸 수 있는 것)
      let fresh = []
      if (!owner) {
        const rewards = [
          ...ITEM_GROUPS.flatMap(g => g.items.map(it => ({ key:itemKey(g.key, it.id), group:g.label, label:it.label, color:it.color }))),
          ...linesOf(rules).filter(l => l.pos !== 'boss').map(l => ({ key:'line:' + l.id, group:'대사', label:`"${l.text}"` })),
        ].filter(it => tierOf(rules, it.key) !== 'base')
        const usable = rewards.filter(it => ok(it.key))
        const seen = me.seenUnlocks
        fresh = Array.isArray(seen) ? usable.filter(it => !seen.includes(it.key)) : []
        if (!Array.isArray(seen) || fresh.length)
          setDoc(doc(db, 'users', uid), { seenUnlocks: usable.map(it => it.key) }, { merge:true }).catch(() => {})
      }
      if (!off) setData({ look, line, when, role, fresh })
    })().catch(e => console.warn('아바타를 못 불러왔어요', e))
    return () => { off = true }
  }, [uid, kind]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return null
  const parts = data.line ? String(data.line).split('/').map(x => x.trim()).filter(Boolean) : []
  const color = i => data.when === 'late' && i === 0 ? T.red : data.when === 'leave' && i === parts.length - 1 && parts.length > 1 ? T.accent : T.ink
  return (
    <div style={{margin:'4px 0 18px'}}>
      <style>{AVATAR_CSS}</style>
      <div style={{display:'flex', alignItems:'flex-end', gap:10}}>
        <svg width="96" height="128" viewBox="-14 -24 124 160" aria-label="내 캐릭터" style={{flexShrink:0}}>
          <Avatar look={data.look} size={96} pose={data.when === 'leave' ? 'walk' : 'work'} role={data.role}/>
        </svg>
        {parts.length > 0 && (
          <div style={{position:'relative', background:'#FFFFFF', border:`1.5px solid ${T.ink}`, borderRadius:10, padding:'10px 14px', marginBottom:56, fontSize:16, fontWeight:800, lineHeight:1.5}}>
            <span style={{position:'absolute', left:-9, bottom:12, width:14, height:14, background:'#FFFFFF', borderLeft:`1.5px solid ${T.ink}`, borderBottom:`1.5px solid ${T.ink}`, transform:'rotate(45deg)'}}/>
            {parts.map((t, i) => <div key={i} style={{color:color(i), position:'relative'}}>{t}</div>)}
          </div>
        )}
      </div>
      {data.fresh.length > 0 && (
        <div style={{border:`1.5px dashed ${T.amber}`, background:'#FFF8EC', borderRadius:6, padding:'10px 12px', marginTop:4}}>
          <div style={{fontSize:15, fontWeight:800, color:T.amber}}>새로 열렸어요!</div>
          <div style={{display:'flex', flexWrap:'wrap', gap:6, marginTop:6}}>
            {data.fresh.slice(0, 8).map(it => (
              <span key={it.key} style={{fontSize:13, padding:'4px 9px', borderRadius:4, background:'#FFFFFF', border:`1px solid ${T.rule}`, display:'inline-flex', alignItems:'center', gap:5}}>
                {it.group} · {it.color ? <span style={{display:'inline-block', width:12, height:12, background:it.color, border:`1px solid ${T.rule}`, borderRadius:2}}/> : it.label}
              </span>
            ))}
            {data.fresh.length > 8 && <span style={{fontSize:13, color:T.sub, padding:'4px 0'}}>외 {data.fresh.length - 8}개</span>}
          </div>
          <div style={{fontSize:12, color:T.sub, marginTop:6}}>내 기록 → 내 캐릭터 꾸미기에서 바로 써 볼 수 있어요</div>
        </div>
      )}
    </div>
  )
}
