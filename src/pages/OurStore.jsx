import { useEffect, useRef, useState } from 'react'
import { db } from '../firebase'
import { collection, doc, getDoc, getDocs, onSnapshot } from 'firebase/firestore'
import { calcGrade, useAuth } from '../AuthContext'
import Avatar from '../components/Avatar'
import AvatarEditor from '../components/AvatarEditor'
import { lookOf, defaultLook, AVATAR_CSS, POSITIONS } from '../lib/avatar'
import { loadAvatarRules, perfectStreaks, tenureMonths, canUse, allowedLook, linesFor, lineEveryOf } from '../lib/avatarRules'
import { toDate, hm, recBreak, planFor, dayStatus, monthStatus, loadMonthContext, pad } from '../lib/attendance'
import { MAP_W, MAP_H, NODES, route, nodeDist, SLOTS, HALL_POINTS, TABLES, SEAT_ORDER } from '../lib/storeMap'
import { storeLife, activeTables } from '../lib/storeLife'

// 우리 매장: 지금 출근한 직원들의 캐릭터가 위에서 내려다본 매장 그림 안에서 일하는 모습
//  - NFC 출근하면 문에서 걸어 들어와 자기 포지션(인원관리)으로, 브레이크면 휴게 공간, 퇴근하면 문으로 나감
//  - 개근 중인 직원은 옆이 반짝임 (머리 위 작은 그림은 없앰)
//  - 손님은 들어와서 주문하고, 홀 직원이 음식을 날라 주고, 다 먹으면 나가고 직원이 치움 (src/lib/storeLife.js)
//    가끔 입구에서 미끄러지거나, 손님끼리 수다, 직원을 불러 단무지를 더 달라고 함
//  - 손님 수는 오늘 매출과 시간대(점심·저녁 바쁜 시간)로 정함. 배달이 많으면 배달 봉투가 쌓임
// attendance·revenue·checklist는 실시간(onSnapshot)으로 받아서 포스에 띄워 두면 저절로 바뀜

const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', soft:'#ECE8E1', accent:'#C3261C', red:'#B42318', green:'#2E7D45', blue:'#2B5C9E', amber:'#B45309' }
const num = { fontVariantNumeric:'tabular-nums' }
const W = MAP_W, H = MAP_H, SIZE = 36        // 그림 크기, 캐릭터 크기
const SPEED = 120                              // 걷는 빠르기 (그림 점/초)
// 같은 사람은 늘 같은 순서로 움직이게: uid로 만든 숫자
const hashOf = str => { let h = 7; for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h }
const CUSTOMER_LOOKS = Array.from({length:12}, (_,i) => ({ ...defaultLook(`손님${i*7}`), shirt: ['#2B5C9E','#6E6A63','#2E7D45','#B45309','#6B4FA0','#E8E4DC','#D9A441'][i % 7] }))

// 통로를 따라 걷기: at(통로 점 이름)이 바뀌면 지금 있는 점에서 거기까지 가장 짧은 길로 한 칸씩 걸어감.
// 처음 나타날 때는 start 에서 출발 (출근하면 출입문). 걷는 동안은 children(true)
function Walker({ at, start, off = [0, 0], speed = SPEED, ghost, children }) {
  const cur = useRef(start || at)
  const busyUntil = useRef(0)
  const [st, setSt] = useState({ node: start || at, dur: 0 })
  const [moving, setMoving] = useState(false)
  useEffect(() => {
    let t, alive = true
    const path = route(cur.current, at)
    let i = path[0] === cur.current ? 1 : 0
    const step = () => {
      if (!alive) return
      if (i >= path.length) { setMoving(false); return }
      const from = cur.current, next = path[i++]
      const dur = from === next ? 0 : Math.max(250, Math.round(nodeDist(from, next) / speed * 1000))
      cur.current = next; busyUntil.current = Date.now() + dur
      setMoving(true); setSt({ node: next, dur })
      t = setTimeout(step, dur)
    }
    // 걷던 중이면 지금 가던 점에 닿은 뒤 새 길로
    const wait = Math.max(0, busyUntil.current - Date.now())
    t = setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(step)), wait)
    return () => { alive = false; clearTimeout(t) }
  }, [at, speed])
  const [x, y] = NODES[st.node] || NODES.door
  const tf = `translate(${x + off[0]}px, ${y + off[1]}px)`
  return (
    <>
      {/* 잔상(특별 아이템): 같은 곳으로 조금 늦게 따라오는 흐린 복사본 둘. 멈추면 사라짐 */}
      {ghost && [[160, 0.35], [320, 0.18]].map(([lag, op]) => (
        <g key={lag} style={{transform:tf, transition:`transform ${st.dur + lag}ms linear, opacity .4s`, opacity: moving ? op : 0, pointerEvents:'none'}}>{ghost()}</g>
      ))}
      <g style={{transform:tf, transition:`transform ${st.dur}ms linear`}}>
        {children(moving)}
      </g>
    </>
  )
}


// 말풍선 (머리 오른쪽). lines: [[글, 색], ...]
// below: 그림 맨 위쪽에 있는 사람은 말풍선이 잘리지 않게 발 아래로
function Bubble({ lines, pop, below }) {
  const w = Math.max(...lines.map(([t]) => t.length)) * 12 + 16, h = lines.length * 16 + 8
  return (
    <g transform={`translate(${SIZE/2 - 2},${below ? 4 : -SIZE*1.25 - 4})`} style={{pointerEvents:'none'}}>
      <g className={pop ? 'av-pop' : undefined}>
        <rect x="6" y="0" width={w} height={h} rx="6" fill="#FFFFFF" stroke={T.ink} strokeWidth="1.5"/>
        <polygon points={below ? '6,14 -2,6 12,10' : `6,${h-14} -2,${h-6} 12,${h-10}`} fill="#FFFFFF" stroke={T.ink} strokeWidth="1.5" strokeLinejoin="round"/>
        <rect x="7" y={below ? 9 : h-15} width="7" height="6" fill="#FFFFFF"/>
        {lines.map(([t, c], i) => <text key={i} x={6 + w/2} y={17 + i*16} textAnchor="middle" fontSize="12" fontWeight="800" fill={c || T.ink}>{t}</text>)}
      </g>
    </g>
  )
}

function Person({ p, moving }) {
  const { look, label, badges, boss } = p
  const pose = moving ? 'walk' : p.pose
  return (
    <>
      <g transform={`translate(${-SIZE/2},${-SIZE*1.25})`}><Avatar look={look} size={SIZE} pose={pose} title={label} role={p.role}/></g>
      {/* 머리 위 작은 그림(불꽃·근속 등급·체크리스트 별)은 사장님 요청으로 안 보여 줌 */}
      {/* 개근 중이면 반짝반짝 */}
      {/* 위치는 바깥 g에 (CSS 애니메이션이 같은 요소의 transform 속성을 덮어써서 발밑으로 떨어지던 문제) */}
      {badges.flame && [[-SIZE/2 - 4, -SIZE*0.9, 0], [SIZE/2 + 2, -SIZE*0.5, 0.6]].map(([x, y, d], i) => (
        <g key={i} transform={`translate(${x},${y})`}>
          <polygon className="av-twinkle" style={{animationDelay:`${d}s`}} points="0,-4 1.2,-1.2 4,0 1.2,1.2 0,4 -1.2,1.2 -4,0 -1.2,-1.2" fill="#F6C343"/>
        </g>
      ))}
      {/* 바쁜 시간: 땀 */}
      {p.busy && pose !== 'rest' && <path className="av-drip" d={`M${-SIZE/2 + 2},${-SIZE*1.05} q-2,4 0,5 q2,-1 0,-5z`} fill="#7FB2D9"/>}
      {pose === 'rest' && <text className="av-float" x="14" y={-SIZE*1.1} fontSize="14" fontWeight="800" fill={T.blue}>z</text>}
      {p.say && <Bubble key={p.say.map(l => l[0]).join()} lines={p.say} pop={p.sayPop} below={(NODES[p.to]?.[1] ?? 999) < 90}/>}
      <text x="0" y="16" textAnchor="middle" fontSize="13" fontWeight="800" fill={boss ? T.accent : T.ink} stroke="#FFFFFF" strokeWidth="4" paintOrder="stroke">{label}</text>
    </>
  )
}

// 대사 글 → 말풍선 줄 ('/'로 두 줄). 지각은 첫 줄 빨강, 퇴근은 마지막 줄 강조
const toBubble = (text, when) => {
  const parts = String(text).split('/').map(x => x.trim()).filter(Boolean)
  return parts.map((t, i) => [t, when === 'late' && i === 0 ? T.red : when === 'leave' && i === parts.length - 1 && parts.length > 1 ? T.accent : undefined])
}
// 점심·저녁 바쁜 시간 (땀 흘리고 빨리 걸음)
const BUSY = [[11*60+30, 13*60+30], [17*60+30, 19*60+30]]
// 통로 점 → 그 자리의 일 (손에 드는 것·한마디)
const roleAt = (node, fallback) => Object.keys(SLOTS).find(k => k !== 'hall' && k !== 'rest' && SLOTS[k].includes(node)) || (HALL_POINTS.includes(node) ? 'hall' : fallback)

export default function OurStore() {
  const { user, userData, isOwner } = useAuth()
  const [now, setNow] = useState(() => new Date())
  const [beat, setBeat] = useState(() => Math.floor(Date.now() / 1000)) // 2초마다: 돌아다니는 자리 바꾸기
  const [staff, setStaff] = useState([])
  const [owner, setOwner] = useState(null) // 사장님: 출퇴근 없이 늘 매장에 있음
  const [att, setAtt] = useState({})
  // 이 화면에서 출근·퇴근을 본 때 (이 컴퓨터 시계 기준). 포스 시계가 서버와 달라도 들어오고 나가는 모습이 1~2분 뒤 끝나게
  const [seen, setSeen] = useState({})
  const prevAtt = useRef(null)
  const [rev, setRev] = useState({})
  const [checks, setChecks] = useState({})
  const [ckCfg, setCkCfg] = useState(null)
  const [ctx, setCtx] = useState(null)
  // 아바타 지급 기준: 기준이 안 되는(또는 거둔) 아이템은 기본 모습으로
  const [avRules, setAvRules] = useState(null)
  const [streaks, setStreaks] = useState({})
  const ym = `${now.getFullYear()}-${pad(now.getMonth()+1)}`, dd = pad(now.getDate())
  const todayStr = `${ym}-${dd}`

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 5000); return () => clearInterval(t) }, [])
  useEffect(() => { const t = setInterval(() => setBeat(Math.floor(Date.now() / 1000)), 2000); return () => clearInterval(t) }, [])

  useEffect(() => {
    let off = false
    prevAtt.current = null
    Promise.all([
      getDocs(collection(db,'users')),
      getDoc(doc(db,'checklist','config')).then(s => s.exists() ? s.data() : null).catch(() => null),
      loadMonthContext(ym),
    ]).then(([us, cfg, c]) => {
      if (off) return
      const list = []
      let boss = null
      us.forEach(d => { const u = d.data(); if (u.role === 'owner' && !boss) boss = { uid:d.id, ...u }; if (u.status==='approved' && !['owner','store','investor'].includes(u.role)) list.push({ uid:d.id, ...u }) })
      setOwner(boss)
      setStaff(list); setCkCfg(cfg); setCtx(c)
      loadAvatarRules().then(r => { if (!off) setAvRules(r) })
      perfectStreaks(list).then(st => { if (!off) setStreaks(st) }).catch(() => {})
    }).catch(e => console.error(e))
    const subs = [
      onSnapshot(doc(db,'attendance',ym), s => {
        const data = s.exists() ? s.data() : {}
        const nowL = Date.now(), day = pad(new Date().getDate()), prev = prevAtt.current
        // 처음 열 때는 서버 시각으로 막 찍은 것만, 그 뒤로는 새로 찍힌 것을 '지금 봤음'으로
        const fresh = (r, p, k, ms) => r?.[k] && (prev ? !p?.[k] : (d => d >= -5000 && d < ms)(nowL - (toDate(r[k])?.getTime() ?? 0)))
        const add = {}
        for (const [uid, days] of Object.entries(data)) {
          const r = days?.[day], p = prev?.[uid]?.[day]
          if (fresh(r, p, 'out', 60000)) add['out:' + uid] = nowL
          if (fresh(r, p, 'in', 120000)) add['in:' + uid] = nowL
        }
        prevAtt.current = data
        if (Object.keys(add).length) setSeen(x => ({ ...x, ...add }))
        setAtt(data)
      }, () => {}),
      onSnapshot(doc(db,'revenue',ym), s => setRev(s.exists() ? s.data() : {}), () => {}),
      onSnapshot(doc(db,'checklist','records'), s => setChecks(s.exists() ? (s.data().byDate || {}) : {}), () => {}),
    ]
    return () => { off = true; subs.forEach(u => u()) }
  }, [ym])

  // ── 오늘 매출 → 손님 수, 배달 봉투 ──
  const r = rev[dd] || {}
  const sum = (...ks) => ks.reduce((a,k) => a + (r[k]||0), 0)
  const closeTotal = sum('kiosk','del','pos')
  const total = closeTotal || sum('morningKiosk','morningDel','morningPos','middleKiosk','middleDel','middlePos')
  const delTotal = r.del || sum('morningDel','middleDel')
  const customers = Math.min(SEAT_ORDER.length, Math.round(total / 100000))
  const bags = Math.min(6, Math.round(delTotal / 120000))

  // ── 오늘 체크리스트 ──
  const todayChecks = Object.values(checks[todayStr] || {}).filter(Boolean).length
  const ckTotal = ckCfg ? (ckCfg.daily||[]).length * 2 + (ckCfg.weekly||[]).filter(w => w.dow === now.getDay()).length : 0
  const ckDone = ckTotal > 0 && todayChecks >= ckTotal

  // ── 직원별 지금 상태 ──
  const nowMs = now.getTime(), nowMin = now.getHours()*60 + now.getMinutes()
  const toMin = s => { const [h,m] = String(s).split(':').map(Number); return h*60 + (m||0) }
  const people = [], waiting = []
  const used = {}
  const slotFor = key => { const list = SLOTS[key] || SLOTS.hall; const i = used[key] = (used[key] ?? -1) + 1; return list[i % list.length] }
  const positionsOf = u => { const ps = (u.positions?.length ? u.positions : [u.position]).filter(p => POSITIONS.some(x => x.id === p)); return ps.length ? ps : ['hall'] }
  // 이 사람이 오가는 자리들: 홀이면 통로 여러 곳, 나머지 포지션은 자기 자리 하나씩. 여러 포지션이면 그 사이를 오감
  const stationsOf = (ps, weights) => ps.flatMap(p => p === 'hall' ? HALL_POINTS : Array(weights?.[p] || 1).fill(slotFor(p)))
  // 9~14초마다 다음 자리로 (사람마다 다른 박자)
  const pick = (uid, points) => {
    if (points.length === 1) return points[0]
    const h = hashOf(uid), period = 9 + (h % 6)
    const epoch = Math.floor((beat + (h % period)) / period)
    return points[(h + epoch * 7) % points.length]
  }
  for (const u of staff) {
    const rec = att[u.uid]?.[dd] || null
    const inD = toDate(rec?.in), outD = toDate(rec?.out)
    const plan = rec?.schedStart ? { start:rec.schedStart, end:rec.schedEnd } : planFor(u, now, ctx?.plan, u.uid)
    const grade = calcGrade(u.joinDate)
    const flame = ctx ? monthStatus({ ym, uid:u.uid, user:u, recs:att[u.uid], holidays:ctx.holidays, subs:ctx.subs, plan:ctx.plan, since:ctx.since }).perfect : false
    const ps = positionsOf(u), posKey = ps[0]
    const look = allowedLook(lookOf(u), key => canUse(key, { rules:avRules, user:u, streak:streaks[u.uid] || 0, tenure:tenureMonths(u.joinDate) }), defaultLook(u.uid))
    const base = { uid:u.uid, user:u, label:u.name, look, badges:{ flame, grade, star: ckDone }, posKey, ps, inD, outD, plan, late: rec?.in ? dayStatus(rec, plan).late : 0 }
    if (inD && outD) {
      // 퇴근하면 1분 동안 문으로 걸어 나가고 화면에서 빠짐 (퇴근한 사람은 목록에도 안 보임)
      if (seen['out:' + u.uid] && nowMs - seen['out:' + u.uid] < 60000) people.push({ ...base, state:'leaving', pose:'walk', from: slotFor(posKey), to: 'door' })
    } else if (inD) {
      const br = recBreak(rec)
      const resting = br && nowMin >= toMin(br.start) && nowMin < toMin(br.end)
      const to = resting ? slotFor('rest') : pick(u.uid, stationsOf(ps))
      const arriving = !!seen['in:' + u.uid] && nowMs - seen['in:' + u.uid] < 120000
      // 출근해서 들어오는 동안 인사 (지각이면 '헉')
      const say = arriving ? 'arrive' : null
      people.push({ ...base, state: resting ? 'rest' : 'work', pose: resting ? 'rest' : 'work', from: arriving ? 'door' : to, to, brEnd: resting ? br.end : null, say })
    } else if (plan) {
      waiting.push({ ...base, overdue: nowMin > toMin(plan.start) })
    }
  }
  // 사장님: 늘 매장에 있음. 주로 주방, 가끔 홀에 나와 둘러봄
  if (owner) {
    const to = pick(owner.uid, stationsOf(['kitchen','hall'], { kitchen: 14 }))
    people.push({ uid:owner.uid, label:'사장님', boss:true, look:lookOf(owner), badges:{}, posKey:'kitchen', ps:['kitchen','hall'], state:'work', pose:'work', from:to, to })
  }
  // 자리 따라 드는 것, 대사 (아바타 탭에서 정한 대사·지급 기준), 바쁜 시간
  const busy = BUSY.some(([a, b]) => nowMin >= a && nowMin < b)
  // ── 손님 이야기: 영업 중이면 시간대만큼은 손님이 있음 (매출이 더 많으면 그만큼) ──
  const open = nowMin >= 11*60 && nowMin < 21*60 + 30
  const guests = Math.max(customers, busy ? 12 : open ? 5 : 0)
  const working = people.filter(p => p.state === 'work' && !p.boss)
  const byPos = k => working.filter(p => (p.ps || []).includes(k)).map(p => p.uid).sort()
  const servers = byPos('hall').length ? byPos('hall') : byPos('counter').length ? byPos('counter') : working.length ? [working[0].uid] : owner ? [owner.uid] : []
  const life = storeLife(beat, activeTables(guests), servers)
  for (const p of people) {
    const task = life.tasks[p.uid]
    if (!task || p.state !== 'work') continue
    p.to = task.to; p.task = task
    if (task.hold) p.look = { ...p.look, hold: task.hold }
  }
  const every = lineEveryOf(avRules)
  for (const p of people) {
    p.role = roleAt(p.to, p.posKey); p.busy = busy
    const h = hashOf(p.uid)
    const who = { rules:avRules, user:p.user, streak:streaks[p.uid] || 0, tenure:tenureMonths(p.user?.joinDate), owner:!!p.boss }
    const pickLine = (whens, n) => { const list = whens.flatMap(w => linesFor(avRules, w, p.role, who).map(l => [l, w])); if (!list.length) return null; const [l, w] = list[n % list.length]; return toBubble(l.text, w) }
    if (p.task) { p.say = p.task.say ? toBubble(p.task.say) : null; p.sayPop = true; continue }
    if (p.state === 'leaving') p.say = pickLine(['leave'], h)
    else if (p.say === 'arrive') p.say = (p.late && pickLine(['late'], h)) || pickLine(['arrive'], h)
    else if (every > 0 && (beat + h % every) % every < 5) {
      const n = h + Math.floor((beat + h % every) / every)
      p.say = p.state === 'rest' ? pickLine(['rest'], n) : p.state === 'work' ? pickLine(busy ? ['busy', 'work'] : ['work'], n) : null
      p.sayPop = true
    }
  }
  // 주문이 들어가면 웍 앞 사람(없으면 사장님)이 대답
  if (life.kitchenSay) {
    const cook = people.find(p => p.state === 'work' && !p.task && SLOTS.wok.includes(p.to)) || people.find(p => p.boss && !p.task)
    if (cook) { cook.say = toBubble(life.kitchenSay); cook.sayPop = true }
  }
  // 같은 자리에 두 사람이 오면 옆으로 살짝 비켜 섬
  const taken = {}
  for (const p of people) { const n = taken[p.to] = (taken[p.to] || 0) + 1; p.off = n > 1 ? [(n-1)*20, (n-1)*5] : [0, 0] }
  waiting.sort((a,b) => toMin(a.plan.start) - toMin(b.plan.start))
  // 웍 앞에 서 있는 사람 수만큼 불
  const wokOn = SLOTS.wok.map(n => people.some(p => p.state === 'work' && p.to === n))

  const tile = (x, y, w, h, a, b, id, size = 32) => (
    <>
      <defs><pattern id={id} width={size} height={size} patternUnits="userSpaceOnUse"><rect width={size} height={size} fill={a}/><rect width={size/2} height={size/2} fill={b}/><rect x={size/2} y={size/2} width={size/2} height={size/2} fill={b}/></pattern></defs>
      <rect x={x} y={y} width={w} height={h} fill={`url(#${id})`}/>
    </>
  )
  const label = (x, y, t, dark, anchor = 'middle') => <text x={x} y={y} fontSize="11" textAnchor={anchor} fill={dark ? '#E8E4DC' : '#4A4744'} fontWeight="700" style={{pointerEvents:'none'}}>{t}</text>
  // 스테인리스 기구 한 칸
  const steel = (x, y, w, h, t, fill = '#B9BEC3') => (
    <g><rect x={x} y={y} width={w} height={h} fill={fill} stroke="#7C8187"/><rect x={x} y={y} width={w} height="3" fill="#D5D9DD"/>{t && label(x + w/2, y + h/2 + 4, t)}</g>
  )
  // 손님: 앉아 있는 사람은 의자 위에 (테이블 앞뒤 순서 맞춰 그림), 걷는 사람은 아래에서 통로를 따라
  const seatedAt = {}
  for (const c of life.customers) if (c.mode === 'sit') (seatedAt[c.tableId] ||= {})[c.seat] = c
  const custLook = c => CUSTOMER_LOOKS[c.look % CUSTOMER_LOOKS.length]
  const customer = (c, [x, y]) => (
    <g key={c.key} transform={`translate(${x-14},${y-30})`}>
      <g className="av-bob"><Avatar look={custLook(c)} size={28} apron={false}/></g>
    </g>
  )
  // 테이블 위: 물컵 → 음식(짬뽕 빨강·짜장 갈색, 가운데 탕수육) → 빈 그릇
  const DISH_COLOR = { jjamppong:'#C3261C', jjajang:'#3B2A1E' }
  const tableTop = (t, cy) => {
    const f = life.food[t.id]
    if (!f) return null
    return (
      <g style={{pointerEvents:'none'}}>
        {t.seats.map(([x, y], i) => {
          if (!seatedAt[t.id]?.[i] && f.state !== 'empty') return null
          if (f.state === 'empty' && i >= f.dishes.length) return null
          const bx = t.bar ? t.x + 14 : Math.min(Math.max(x, t.x + 12), t.x + t.w - 12), by = t.bar ? y : (y < cy ? t.y + 12 : t.y + t.h - 14)
          if (f.state === 'water') return <g key={i}><rect x={bx-3} y={by-4} width="6" height="8" fill="#DDEBF5" stroke="#9FC3DD"/></g>
          return <g key={i}><ellipse cx={bx} cy={by} rx="8" ry="4" fill="#FFFFFF" stroke="#D5D0C6"/>{f.state === 'food'
            ? <><ellipse cx={bx} cy={by - 1} rx="5.5" ry="2.6" fill={DISH_COLOR[f.dishes[i]] || '#C3261C'}/><rect x={bx-2} y={by-2} width="1.6" height="1.2" fill={f.dishes[i] === 'jjajang' ? '#F6C343' : '#2E7D45'}/></>
            : <ellipse cx={bx} cy={by - 1} rx="5" ry="2.2" fill="#EFE9DF"/>}</g>
        })}
        {f.shared && f.state !== 'water' && (() => { const cx = t.x + t.w/2, py = t.y + t.h/2 - (t.h > 60 ? 18 : 0); return (
          <g><ellipse cx={cx} cy={py} rx="13" ry="6" fill="#FFFFFF" stroke="#D5D0C6"/>
            {f.state === 'food' && [[-6,-1,'#D9A441'],[0,-2,'#C98A2E'],[6,-1,'#D9A441'],[-2,1,'#E8742A']].map(([dx,dy,c],k) => <rect key={k} x={cx+dx-2.5} y={py+dy-1.5} width="5" height="3.5" fill={c}/>)}</g>
        ) })()}
      </g>
    )
  }
  const stool = ([x, y]) => <rect key={`s${x}-${y}`} x={x-8} y={y-7} width="16" height="14" fill="#C9CBCE" stroke="#8D9297"/>

  return (
    <div style={{maxWidth:1100}}>
      <style>{AVATAR_CSS}</style>
      <header style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:12, flexWrap:'wrap', paddingBottom:10, borderBottom:`3px double ${T.ink}`, marginBottom:16}}>
        <h1 style={{fontSize:24, fontWeight:800, margin:0, fontFamily:'inherit', color:T.ink}}>우리 매장</h1>
        <div style={{fontSize:14, color:T.sub, ...num}}>{now.getMonth()+1}월 {now.getDate()}일 {hm(now)} · 지금 {people.filter(p=>p.state!=='leaving' && !p.boss).length}명 근무 중</div>
      </header>

      <div style={{background:'#2A211C', borderRadius:6, padding:8}}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="매장 안에서 일하는 직원들" style={{display:'block', shapeRendering:'crispEdges'}}>
          {/* 바닥: 홀은 진회색 타일, 주방은 밝은 타일 */}
          {tile(0, 0, W, H, '#4E4E4E', '#474747', 'th')}
          {tile(48, 8, 529, 168, '#D3D6D9', '#C7CBCF', 'tk', 24)}
          {/* 바깥 벽 (아래 가운데가 출입문) */}
          <rect x="0" y="0" width={W} height="8" fill="#EDE6D6"/>
          <rect x="0" y="0" width="8" height={H} fill="#EDE6D6"/><rect x={W-8} y="0" width="8" height={H} fill="#EDE6D6"/>
          <rect x="0" y={H-8} width="448" height="8" fill="#EDE6D6"/><rect x="542" y={H-8} width={W-542} height="8" fill="#EDE6D6"/>
          <rect x="448" y={H-8} width="94" height="8" fill="#7C7C7C"/><rect x="452" y={H-6} width="86" height="3" fill="#B8B2A7"/>
          {label(495, H-14, '출입문', true)}

          {/* 주방: 면·싱크(윗벽), 웍 3 · 빈 칸 · 튀김 · 퇴식 / POS · 조리대 · 냉장 · 정수 · 쓰레기 */}
          <rect x="330" y="10" width="104" height="36" fill="#B9BEC3" stroke="#7C8187"/>{label(352, 32, '면')}
          <circle cx="405" cy="28" r="13" fill="#5E6268"/><circle cx="405" cy="28" r="9" fill="#E8E4DC"/>
          {steel(524, 10, 52, 78, '')}<rect x="530" y="20" width="40" height="46" fill="#7FB2D9"/>{label(550, 80, '싱크')}
          {[0,1,2].map(i => (
            <g key={i}>
              {steel(120 + i*66, 92, 66, 42, '', '#A9AEB4')}
              {wokOn[i] && <rect className="av-flame" x={139 + i*66} y="118" width="28" height="8" fill="#E8742A"/>}
              <ellipse cx={153 + i*66} cy="111" rx="22" ry="12" fill="#2F2B28"/><ellipse cx={153 + i*66} cy="109" rx="15" ry="7" fill={wokOn[i] ? '#C3261C' : '#45403B'}/>
            </g>
          ))}
          {steel(318, 92, 90, 42, '')}
          {steel(408, 92, 114, 42, '')}<rect x="420" y="100" width="40" height="26" fill="#D9A441" stroke="#7C8187"/><rect x="468" y="100" width="40" height="26" fill="#D9A441" stroke="#7C8187"/>{label(465, 90, '튀김')}
          {steel(522, 92, 55, 42, '퇴식', '#9A9EA3')}
          {steel(120, 134, 65, 38, '')}<rect x="132" y="140" width="40" height="22" fill="#1D1B18"/><rect x="135" y="143" width="34" height="14" fill="#7FB2D9"/>{label(152, 170, 'POS')}
          {steel(185, 134, 223, 38, '')}{label(330, 157, '조리대')}
          {Array.from({length:bags}).map((_,i) => <g key={i}><rect x={192 + i*22} y="139" width="18" height="18" fill="#FFFFFF" stroke="#C3261C"/><rect x={196 + i*22} y="143" width="10" height="5" fill="#C3261C"/></g>)}
          {steel(408, 134, 68, 38, '냉장')}
          {steel(476, 134, 46, 38, '정수')}
          <rect x="522" y="134" width="55" height="38" fill="#2A2A2A"/>{label(549, 157, '쓰레기', true)}
          {label(60, 30, '주방', false, 'start')}
          {/* 선반 · 냉장고 2 · 주방 출입(점선) */}
          <rect x="8" y="124" width="40" height="164" fill="#8A7A66" stroke="#5A4E40"/>
          {[0,1,2,3].map(i => <rect key={i} x="12" y={132 + i*38} width="32" height="4" fill="#5A4E40"/>)}
          {label(28, 212, '선반', true)}
          {steel(50, 224, 60, 64, '냉장')}{steel(112, 224, 60, 64, '냉장')}
          <line x1="48" y1="150" x2="120" y2="150" stroke="#8D9297" strokeWidth="2" strokeDasharray="5 5"/>
          {/* 오른쪽 칸막이 (주방과 5·6번 사이) */}
          <rect x="577" y="8" width="8" height="258" fill="#EDE6D6"/>

          {/* 왼쪽 아래: 화장실 · 술 · 창고, 1번 칸막이 */}
          <rect x="8" y="340" width="44" height="272" fill="#D8D2C4" stroke="#8A8378"/>{[0,1,2].map(i => <text key={i} x="30" y={440 + i*18} textAnchor="middle" fontSize="12" fontWeight="700" fill="#4A4744">{'화장실'[i]}</text>)}
          <rect x="52" y="356" width="60" height="72" fill="#3B4A5A" stroke="#22303D"/>{[0,1,2].map(i => <rect key={i} x={58 + i*18} y="364" width="12" height="20" fill="#2E7D45"/>)}{label(82, 414, '술', true)}
          <rect x="56" y="498" width="64" height="114" fill="#6A5A48" stroke="#4A3E30"/>{label(88, 560, '창고', true)}
          <rect x="128" y="484" width="10" height="128" fill="#9FC3DD"/><rect x="348" y="484" width="10" height="128" fill="#9FC3DD"/><rect x="551" y="484" width="9" height="128" fill="#9FC3DD"/>
          {/* 키오스크 · 셀프바 · 에어컨 · B 바 자리 */}
          <rect x="378" y="566" width="58" height="40" fill="#1D1B18"/><rect x="384" y="571" width="46" height="22" fill="#7FB2D9"/>{label(407, 562, '키오스크', true)}
          <rect x="582" y="272" width="126" height="58" fill="#C3261C"/><rect x="588" y="278" width="114" height="16" fill="#2A2A2A"/>{[0,1,2,3].map(i => <rect key={i} x={594 + i*28} y="281" width="20" height="10" fill="#E8E4DC"/>)}{label(645, 318, '셀프바', true)}
          <rect x="862" y="10" width="88" height="46" fill="#F4F4F2" stroke="#B8B2A7"/>{[0,1,2].map(i => <rect key={i} x="870" y={20 + i*9} width="72" height="3" fill="#B8B2A7"/>)}{label(906, 66, '에어컨', true)}

          {/* 손님 테이블과 의자 (번호는 실제 테이블 번호). 오늘 매출만큼 손님이 앉아 있음 */}
          {TABLES.map(t => {
            const cy = t.y + t.h / 2
            return (
              <g key={t.id}>
                {t.seats.map(stool)}
                {t.seats.map((s, i) => s[1] < cy && seatedAt[t.id]?.[i] ? customer(seatedAt[t.id][i], s) : null)}
                <rect x={t.x} y={t.y} width={t.w} height={t.h} fill={t.bar ? '#C9B79A' : '#F7F7F5'} stroke={t.bar ? '#8A7A66' : '#B8BAB8'}/>
                {!t.bar && <rect x={t.x} y={t.y + t.h - 4} width={t.w} height="4" fill="#B8BAB8"/>}
                {tableTop(t, cy)}
                <text x={t.x + t.w/2} y={t.y + t.h/2 + 5} textAnchor="middle" fontSize="13" fontWeight="800" fill={t.bar ? '#5A4E40' : '#A8A39A'} style={{pointerEvents:'none'}}>{t.id}</text>
                {t.seats.map((s, i) => s[1] >= cy && seatedAt[t.id]?.[i] ? customer(seatedAt[t.id][i], s) : null)}
              </g>
            )
          })}

          {/* 걸어 들어오고 나가는 손님 (입구에서 미끄러지기도) */}
          {life.customers.filter(c => c.mode === 'walk').map(c => (
            <Walker key={c.key + c.start} at={c.to} start={c.start} speed={SPEED * 0.8}>{moving => (
              <g>
                {c.fallen
                  ? <g transform="rotate(-80)"><g transform="translate(-14,-30)"><Avatar look={custLook(c)} size={28} apron={false}/></g></g>
                  : <g transform="translate(-14,-30)"><Avatar look={custLook(c)} size={28} apron={false} pose={moving ? 'walk' : 'idle'}/></g>}
                {c.fallen && [[-30,-14],[-22,-22],[-12,-16]].map(([x,y],i) => <g key={i} transform={`translate(${x},${y})`}><polygon className="av-twinkle" style={{animationDelay:`${i*0.2}s`}} points="0,-4 1.2,-1.2 4,0 1.2,1.2 0,4 -1.2,1.2 -4,0 -1.2,-1.2" fill="#F6C343"/></g>)}
                {c.say && <Bubble key={c.say} lines={toBubble(c.say)} pop/>}
              </g>
            )}</Walker>
          ))}
          {/* 앉아 있는 손님의 말풍선 (테이블 위에 가려지지 않게 나중에 그림) */}
          {life.customers.filter(c => c.mode === 'sit' && c.say).map(c => {
            const [x, y] = NODES[c.node]
            return <g key={'say' + c.key} transform={`translate(${x},${y + 6})`}><Bubble key={c.say} lines={toBubble(c.say)} pop below={y < 90}/></g>
          })}

          {/* 직원 */}
          {[...people].sort((a,b) => String(a.uid).localeCompare(String(b.uid))).map(p => (
            <Walker key={p.uid} at={p.to} start={p.from} off={p.off} speed={p.busy ? SPEED * 1.5 : SPEED}
              ghost={(p.look?.special || []).includes('trail') ? () => <g transform={`translate(${-SIZE/2},${-SIZE*1.25})`}><Avatar look={p.look} size={SIZE} pose="walk" role={p.role}/></g> : null}>{moving => <g opacity={p.state === 'leaving' ? 0.85 : 1}><Person p={p} moving={moving}/></g>}</Walker>
          ))}
        </svg>
      </div>

      {/* 아래: 글로 보는 지금 상황 */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap:'18px 32px', marginTop:18}}>
        <section>
          <h2 style={{fontSize:15, fontWeight:800, margin:'0 0 4px', fontFamily:'inherit', borderBottom:`2px solid ${T.ink}`, paddingBottom:4}}>근무 중</h2>
          {people.filter(p => p.state !== 'leaving' && !p.boss).length === 0 && <div style={{fontSize:13, color:T.sub, padding:'6px 0'}}>지금 근무 중인 사람이 없어요</div>}
          {people.filter(p => p.state !== 'leaving' && !p.boss).map(p => (
            <div key={p.uid} style={{display:'flex', gap:8, alignItems:'baseline', fontSize:14, padding:'5px 0', borderBottom:`1px solid ${T.soft}`}}>
              <b style={{minWidth:56}}>{p.label}</b>
              <span style={{color:T.sub, fontSize:12}}>{(p.ps||[p.posKey]).map(k => POSITIONS.find(x=>x.id===k)?.label.split(' ')[0]).join('·')}</span>
              <span style={{flex:1}}/>
              <span style={{...num, fontSize:13, color: p.state==='rest' ? T.blue : p.late ? T.red : T.green}}>
                {p.state === 'rest' ? `브레이크 ~${p.brEnd}` : `${hm(p.inD)} 출근${p.late ? ` (지각 ${p.late}분)` : ''}`}
              </span>
            </div>
          ))}
        </section>
        <section>
          <h2 style={{fontSize:15, fontWeight:800, margin:'0 0 4px', fontFamily:'inherit', borderBottom:`2px solid ${T.ink}`, paddingBottom:4}}>오늘</h2>
          {[
            ['체크리스트', ckTotal ? `${Math.min(todayChecks, ckTotal)} / ${ckTotal}${ckDone ? ' 다 끝냄' : ''}` : '—'],
            ['오늘 매출', total ? `${total.toLocaleString('ko-KR')}원` : '아직 없음'],
            ...waiting.map(w => [w.label, w.overdue ? `${w.plan.start} 출근인데 아직 안 옴` : `${w.plan.start} 출근 예정`]),
          ].map(([k,v],i) => (
            <div key={i} style={{display:'flex', gap:8, alignItems:'baseline', fontSize:14, padding:'5px 0', borderBottom:`1px solid ${T.soft}`}}>
              <span style={{color:T.sub, minWidth:72}}>{k}</span><span style={{flex:1}}/>
              <span style={{...num, color: String(v).includes('아직 안 옴') ? T.red : T.ink}}>{v}</span>
            </div>
          ))}
        </section>
      </div>
      {/* 사장님 캐릭터 꾸미기 (사장님 계정에서만) */}
      {isOwner && user && (
        <div style={{marginTop:22}}>
          <AvatarEditor uid={user.uid} userData={owner?.uid === user.uid ? owner : userData} title="사장님 캐릭터" hint="늘 매장에 있어요. 주로 주방에 있다가 가끔 홀을 둘러봐요"
            onSaved={look => setOwner(o => o && o.uid === user.uid ? { ...o, avatar: look } : o)}/>
        </div>
      )}

      <div style={{fontSize:12, color:T.sub, marginTop:12, lineHeight:1.7}}>
        캐릭터는 직원이 내 기록에서 꾸미고, 자리는 인원관리의 포지션으로 정해져요. 이번 달 개근 중인 직원은 옆이 반짝여요. 손님은 영업시간엔 늘 있고(점심·저녁엔 더 많이), 매출이 많으면 더 늘어요. 홀 직원이 주문을 받고 음식을 나르며, 홀 직원이 없으면 카운터, 그다음 다른 직원이 대신해요.
      </div>
    </div>
  )
}
