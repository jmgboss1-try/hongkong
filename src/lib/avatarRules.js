// 아바타 아이템 지급 기준 (사장님 '아바타' 탭에서 정함)
//  rewards/avatar = { tiers: { '<그룹>:<값>': 'base'|'p1'|'p2'|'p3'|'t1'|'t2'|'t3'|'t6'|'t12'|'manual' }, showLocked }
//  - base: 모두 / pN: 연속 개근 N개월 이상 (지난 달까지, 끝난 달만 셈) / tN: 근속 N개월 이상 (입사일 기준) / manual: 사장님이 직접 줄 때만
//  - 직접 준 것: users/{uid}.unlocks = ['<그룹>:<값>', ...] (조건과 상관없이 열림). 사장님은 전부 쓸 수 있음
//  - 대사: lines = [{ id, text ('/'로 두 줄), when, pos, tier }], lineEvery = 일하면서 한마디 간격(초, 0이면 안 함). 대사 키는 'line:<id>'
// rewards 컬렉션에 두는 까닭: 직원이 이미 읽을 수 있는 곳이라 Firestore 규칙을 바꾸지 않아도 됨
import { db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'
import {
  HAIRS, HAIR_COLORS, TIP_COLORS, SHIRTS, EYES, BROWS, MOUTHS, MARKS, HATS, TOPS, APRONS, PANTS, SHOES, HOLDS, ACCS, DECOS, LOCKED, LOOK_BASE, accsOf,
} from './avatar'
import { loadMonthContext, monthStatus, pad } from './attendance'

export const TIERS = [
  { id:'base', label:'기본 (모두)' },
  { id:'p1', label:'개근 1개월', type:'perfect', n:1 }, { id:'p2', label:'개근 2개월', type:'perfect', n:2 }, { id:'p3', label:'개근 3개월 이상', type:'perfect', n:3 },
  { id:'t1', label:'근속 1개월', type:'tenure', n:1 }, { id:'t2', label:'근속 2개월', type:'tenure', n:2 }, { id:'t3', label:'근속 3개월', type:'tenure', n:3 },
  { id:'t6', label:'근속 6개월', type:'tenure', n:6 }, { id:'t12', label:'근속 1년', type:'tenure', n:12 },
  { id:'manual', label:'직접 줄 때만' },
]
const TIER = Object.fromEntries(TIERS.map(t => [t.id, t]))

// 기준을 정할 수 있는 아이템 (피부색·기본값(없음·기본)은 늘 쓸 수 있어서 뺌)
const opts = (list, skip = []) => list.filter(o => !skip.includes(o.id)).map(o => ({ id:o.id, label:o.label }))
const cols = (list, name) => list.filter(c => c && c !== 'none').map((c, i) => ({ id:c, label:`${name} ${i+1}`, color:c }))
export const ITEM_GROUPS = [
  { key:'hair', label:'머리', items: opts(HAIRS) },
  { key:'hairColor', label:'머리색', items: cols(HAIR_COLORS, '머리색') },
  { key:'tip', label:'브릿지', items: cols(TIP_COLORS, '브릿지') },
  { key:'hat', label:'모자', items: opts(HATS, ['none']) },
  { key:'eyes', label:'눈', items: opts(EYES, ['dot']) },
  { key:'brows', label:'눈썹', items: opts(BROWS, ['none']) },
  { key:'mouth', label:'입', items: opts(MOUTHS, ['smile']) },
  { key:'mark', label:'얼굴 표시', items: opts(MARKS, ['none']) },
  { key:'top', label:'윗옷', items: opts(TOPS, ['long']) },
  { key:'shirt', label:'옷 색', items: cols(SHIRTS, '옷 색') },
  { key:'apron', label:'앞치마', items: cols(APRONS, '앞치마') },
  { key:'pants', label:'바지', items: cols(PANTS, '바지') },
  { key:'shoes', label:'신발', items: opts(SHOES, ['black']) },
  { key:'hold', label:'손에', items: opts(HOLDS, ['auto', 'none']) },
  { key:'acc', label:'얼굴에', items: opts(ACCS, ['none']) },
  { key:'deco', label:'꾸밈', items: opts(DECOS) },
  { key:'special', label:'특별 아이템', items: opts(LOCKED) },
]
export const itemKey = (group, id) => `${group}:${id}`
export const defaultTier = key => key.startsWith('special:') ? 'manual' : 'base'
export const tierOf = (rules, key) => key.startsWith('line:')
  ? (linesOf(rules).find(l => 'line:' + l.id === key)?.tier || 'base')
  : rules?.tiers?.[key] || defaultTier(key)

// ── 대사 ──
export const WHENS = [
  { id:'arrive', label:'출근할 때' }, { id:'late', label:'지각했을 때' }, { id:'leave', label:'퇴근할 때' },
  { id:'work', label:'일하면서' }, { id:'busy', label:'바쁜 시간 (점심·저녁)' }, { id:'rest', label:'브레이크 중' },
]
export const LINE_POS = [
  { id:'any', label:'누구나' }, { id:'wok', label:'웍' }, { id:'kitchen', label:'주방' }, { id:'hall', label:'홀' },
  { id:'counter', label:'카운터' }, { id:'delivery', label:'배달·포장' }, { id:'boss', label:'사장님' },
]
export const DEFAULT_LINES = [
  { id:'a1', when:'arrive', pos:'any', tier:'base', text:'안녕하세요!' },
  { id:'l1', when:'late', pos:'any', tier:'base', text:'헉! 늦었다 / 죄송합니다!' },
  { id:'o1', when:'leave', pos:'any', tier:'base', text:'퇴근하겠습니다. / 수고하셨습니다!' },
  { id:'w1', when:'work', pos:'wok', tier:'base', text:'짬뽕 나갑니다!' }, { id:'w2', when:'work', pos:'wok', tier:'base', text:'불 올립니다!' },
  { id:'w3', when:'work', pos:'kitchen', tier:'base', text:'면 삶을게요!' }, { id:'w4', when:'work', pos:'kitchen', tier:'base', text:'재료 채워 둘게요!' },
  { id:'w5', when:'work', pos:'hall', tier:'base', text:'맛있게 드세요!' }, { id:'w6', when:'work', pos:'hall', tier:'base', text:'어서 오세요!' },
  { id:'w7', when:'work', pos:'counter', tier:'base', text:'주문 들어왔어요!' }, { id:'w8', when:'work', pos:'counter', tier:'base', text:'포장 나왔어요!' },
  { id:'w9', when:'work', pos:'delivery', tier:'base', text:'배달 출발!' }, { id:'w10', when:'work', pos:'delivery', tier:'base', text:'포장 다 됐어요!' },
  { id:'w11', when:'work', pos:'boss', tier:'base', text:'다들 화이팅!' }, { id:'w12', when:'work', pos:'boss', tier:'base', text:'오늘도 수고 많아요!' },
  { id:'w13', when:'work', pos:'any', tier:'p1', text:'이번 달도 개근 간다!' },
  { id:'w14', when:'work', pos:'any', tier:'t12', text:'이 가게는 내가 지킨다' },
  { id:'b1', when:'busy', pos:'any', tier:'base', text:'주문 밀려요! 힘내요!' },
  { id:'r1', when:'rest', pos:'any', tier:'base', text:'잠깐 쉴게요~' },
]
export const linesOf = rules => rules?.lines || DEFAULT_LINES
export const lineEveryOf = rules => rules?.lineEvery ?? 50
// 이 사람이 지금 할 수 있는 대사들 (상황·자리·지급 기준)
export function linesFor(rules, when, role, who) {
  const pos = l => l.pos || 'any'
  return linesOf(rules).filter(l => l.when === when && l.text?.trim() && (who.owner
    // 사장님: '사장님' 대사, 일하면서가 아닐 때(바쁜 시간 등)는 '누구나' 대사도
    ? pos(l) === 'boss' || (when !== 'work' && pos(l) === 'any')
    : pos(l) !== 'boss' && (pos(l) === 'any' || pos(l) === role) && canUse('line:' + l.id, who)))
}

export async function loadAvatarRules() {
  try { const s = await getDoc(doc(db, 'rewards', 'avatar')); return s.exists() ? { showLocked: true, tiers: {}, ...s.data() } : { showLocked: true, tiers: {} } }
  catch { return { showLocked: true, tiers: {} } }
}

// 근속 개월 (입사일 → 오늘)
export function tenureMonths(joinDate, now = new Date()) {
  if (!joinDate) return 0
  const j = new Date(joinDate); if (isNaN(j)) return 0
  let m = (now.getFullYear() - j.getFullYear()) * 12 + (now.getMonth() - j.getMonth())
  if (now.getDate() < j.getDate()) m--
  return Math.max(0, m)
}

// 연속 개근 개월: 지난 달부터 거꾸로, 개근이 끊기기 전까지 (최대 12개월, 집계 시작 전 달은 안 셈)
export async function perfectStreaks(users, now = new Date()) {
  const out = Object.fromEntries(users.map(u => [u.uid, 0]))
  let alive = users.filter(u => u.uid)
  for (let k = 1; k <= 12 && alive.length; k++) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1)
    const ym = `${d.getFullYear()}-${pad(d.getMonth()+1)}`
    const ctx = await loadMonthContext(ym)
    if (ym < String(ctx.since).slice(0, 7)) break
    const monthEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59)
    alive = alive.filter(u => {
      const st = monthStatus({ ym, uid:u.uid, user:u, recs:ctx.att[u.uid], holidays:ctx.holidays, subs:ctx.subs, plan:ctx.plan, since:ctx.since, now:monthEnd })
      if (st.perfect) { out[u.uid]++; return true }
      return false
    })
  }
  return out
}

// 이 사람이 이 아이템을 쓸 수 있나
export function canUse(key, { rules, user, streak = 0, tenure = 0, owner }) {
  if (owner) return true
  if ((user?.unlocks || []).includes(key)) return true
  const t = TIER[tierOf(rules, key)] || TIER.base
  if (t.id === 'base') return true
  if (t.type === 'perfect') return streak >= t.n
  if (t.type === 'tenure') return tenure >= t.n
  return false
}
export const tierLabel = (rules, key) => (TIER[tierOf(rules, key)] || TIER.base).label

// 쓸 수 없는 아이템은 기본으로 바꿔서 보여 줌 (기준이 바뀌거나 거둬들였을 때)
const SINGLE = ['hair','hairColor','tip','hat','eyes','brows','mouth','mark','top','shirt','apron','pants','shoes','hold']
export function allowedLook(look, ok, fallback) {
  const l = { ...look }
  for (const g of SINGLE) {
    const v = l[g]
    if (v == null || v === '' || v === 'none' || v === 'auto' || v === LOOK_BASE[g]) continue
    if (!ok(itemKey(g, v))) l[g] = fallback?.[g] ?? LOOK_BASE[g]
  }
  l.acc = accsOf(l.acc).filter(a => a === 'blush' || ok(itemKey('acc', a)))
  l.deco = (l.deco || []).filter(d => ok(itemKey('deco', d)))
  l.special = (l.special || []).filter(s => ok(itemKey('special', s)))
  return l
}
