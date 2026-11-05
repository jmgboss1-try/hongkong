import { useEffect, useRef, useState } from 'react'
import { db } from '../firebase'
import { collection, doc, getDoc, getDocs, onSnapshot } from 'firebase/firestore'
import { calcGrade, useAuth } from '../AuthContext'
import Avatar from '../components/Avatar'
import AvatarEditor from '../components/AvatarEditor'
import { lookOf, defaultLook, AVATAR_CSS, POSITIONS } from '../lib/avatar'
import { toDate, hm, recBreak, planFor, dayStatus, monthStatus, loadMonthContext, pad } from '../lib/attendance'
import { MAP_W, MAP_H, NODES, route, nodeDist, SLOTS, HALL_POINTS, TABLES, SEAT_ORDER } from '../lib/storeMap'

// 우리 매장: 지금 출근한 직원들의 캐릭터가 위에서 내려다본 매장 그림 안에서 일하는 모습
//  - NFC 출근하면 문에서 걸어 들어와 자기 포지션(인원관리)으로, 브레이크면 휴게 공간, 퇴근하면 문으로 나감
//  - 머리 위: 개근 중(불꽃), 근속 등급(병아리·별·왕관), 오늘 체크리스트를 다 끝냈으면 별
//  - 오늘 매출만큼 손님이 앉아 있고, 배달이 많으면 배달 봉투가 쌓임
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
function Walker({ at, start, off = [0, 0], speed = SPEED, children }) {
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
  return (
    <g style={{transform:`translate(${x + off[0]}px, ${y + off[1]}px)`, transition:`transform ${st.dur}ms linear`}}>
      {children(moving)}
    </g>
  )
}

function Badges({ flame, grade, star }) {
  const items = []
  if (flame) items.push(<g key="f"><rect x="2" y="4" width="6" height="8" fill="#E8742A"/><rect x="3" y="1" width="3" height="4" fill="#E8742A"/><rect x="4" y="7" width="3" height="5" fill="#F6C343"/></g>)
  if (grade === 'legend') items.push(<g key="g"><rect x="1" y="5" width="10" height="6" fill="#D9A441"/><rect x="1" y="2" width="2" height="3" fill="#D9A441"/><rect x="5" y="1" width="2" height="4" fill="#D9A441"/><rect x="9" y="2" width="2" height="3" fill="#D9A441"/></g>)
  if (grade === 'senior') items.push(<g key="g"><polygon points="6,1 7.6,4.6 11.4,4.8 8.4,7.2 9.4,11 6,8.8 2.6,11 3.6,7.2 0.6,4.8 4.4,4.6" fill="#2B5C9E"/></g>)
  if (grade === 'chick') items.push(<g key="g"><rect x="2" y="3" width="8" height="7" fill="#F6C343"/><rect x="9" y="5" width="2" height="2" fill="#E8742A"/><rect x="6" y="4" width="1" height="1" fill="#1D1B18"/></g>)
  if (star) items.push(<g key="s"><polygon points="6,0 7.8,4.2 12,4.4 8.6,7.2 9.8,11.6 6,9 2.2,11.6 3.4,7.2 0,4.4 4.2,4.2" fill="#F6C343" stroke="#B45309" strokeWidth=".6"/></g>)
  const wsum = items.length * 14
  return <g transform={`translate(${-wsum/2},-${SIZE*1.25 + 16})`}>{items.map((it,i) => <g key={i} transform={`translate(${i*14},0)`}>{it}</g>)}</g>
}

// 말풍선 (머리 오른쪽). lines: [[글, 색], ...]
function Bubble({ lines, pop }) {
  const w = Math.max(...lines.map(([t]) => t.length)) * 12 + 16, h = lines.length * 16 + 8
  return (
    <g transform={`translate(${SIZE/2 - 2},${-SIZE*1.25 - 4})`} style={{pointerEvents:'none'}}>
      <g className={pop ? 'av-pop' : undefined}>
        <rect x="6" y="0" width={w} height={h} rx="6" fill="#FFFFFF" stroke={T.ink} strokeWidth="1.5"/>
        <polygon points={`6,${h-14} -2,${h-6} 12,${h-10}`} fill="#FFFFFF" stroke={T.ink} strokeWidth="1.5" strokeLinejoin="round"/>
        <rect x="7" y={h-15} width="7" height="6" fill="#FFFFFF"/>
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
      <Badges {...badges}/>
      {/* 개근 중이면 반짝반짝 */}
      {badges.flame && [[-SIZE/2 - 4, -SIZE*0.9, 0], [SIZE/2 + 2, -SIZE*0.5, 0.6]].map(([x, y, d], i) => (
        <polygon key={i} className="av-twinkle" style={{animationDelay:`${d}s`}} transform={`translate(${x},${y})`} points="0,-4 1.2,-1.2 4,0 1.2,1.2 0,4 -1.2,1.2 -4,0 -1.2,-1.2" fill="#F6C343"/>
      ))}
      {/* 바쁜 시간: 땀 */}
      {p.busy && pose !== 'rest' && <path className="av-drip" d={`M${-SIZE/2 + 2},${-SIZE*1.05} q-2,4 0,5 q2,-1 0,-5z`} fill="#7FB2D9"/>}
      {pose === 'rest' && <text className="av-float" x="14" y={-SIZE*1.1} fontSize="14" fontWeight="800" fill={T.blue}>z</text>}
      {p.state === 'leaving'
        ? <Bubble lines={[['퇴근하겠습니다.'], ['수고하셨습니다!', T.accent]]}/>
        : p.say && <Bubble key={p.say.map(l => l[0]).join()} lines={p.say} pop={p.sayPop}/>}
      <text x="0" y="16" textAnchor="middle" fontSize="13" fontWeight="800" fill={boss ? T.accent : T.ink} stroke="#FFFFFF" strokeWidth="4" paintOrder="stroke">{label}</text>
    </>
  )
}

// 가끔 하는 한마디 (지금 있는 자리 따라)
const LINES = {
  wok: ['짬뽕 나갑니다!', '불 올립니다!'], kitchen: ['면 삶을게요!', '재료 채워 둘게요!'], hall: ['맛있게 드세요!', '어서 오세요!'],
  counter: ['주문 들어왔어요!', '포장 나왔어요!'], delivery: ['배달 출발!', '포장 다 됐어요!'], boss: ['다들 화이팅!', '오늘도 수고 많아요!'],
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
    const base = { uid:u.uid, label:u.name, look:lookOf(u), badges:{ flame, grade, star: ckDone }, posKey, ps, inD, outD, plan, late: rec?.in ? dayStatus(rec, plan).late : 0 }
    if (inD && outD) {
      // 퇴근하면 1분 동안 문으로 걸어 나가고 화면에서 빠짐 (퇴근한 사람은 목록에도 안 보임)
      if (seen['out:' + u.uid] && nowMs - seen['out:' + u.uid] < 60000) people.push({ ...base, state:'leaving', pose:'walk', from: slotFor(posKey), to: 'door' })
    } else if (inD) {
      const br = recBreak(rec)
      const resting = br && nowMin >= toMin(br.start) && nowMin < toMin(br.end)
      const to = resting ? slotFor('rest') : pick(u.uid, stationsOf(ps))
      const arriving = !!seen['in:' + u.uid] && nowMs - seen['in:' + u.uid] < 120000
      // 출근해서 들어오는 동안 인사 (지각이면 '헉')
      const say = arriving ? (base.late ? [['헉! 늦었다', T.red], ['죄송합니다!']] : [['안녕하세요!']]) : null
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
  // 자리 따라 드는 것, 가끔 한마디 (50초마다 5초, 사람마다 다른 때), 바쁜 시간
  const busy = BUSY.some(([a, b]) => nowMin >= a && nowMin < b)
  for (const p of people) {
    p.role = roleAt(p.to, p.posKey); p.busy = busy
    if (p.say || p.state !== 'work') continue
    const h = hashOf(p.uid), t = (beat + h % 50) % 50
    if (t < 5) { const list = LINES[p.boss ? 'boss' : p.role] || LINES.hall; p.say = [[list[Math.floor((beat + h) / 50) % list.length]]]; p.sayPop = true }
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
  // 손님: 오늘 매출만큼 SEAT_ORDER 순서로 앉음
  const seated = new Set(SEAT_ORDER.slice(0, customers).map(o => o.seat))
  const customer = ([x, y], i) => (
    <g key={`c${x}-${y}`} transform={`translate(${x-14},${y-30})`}>
      <g className="av-bob"><Avatar look={CUSTOMER_LOOKS[i % CUSTOMER_LOOKS.length]} size={28} apron={false}/></g>
    </g>
  )
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
            const back = t.seats.filter(([,y]) => y < cy), front = t.seats.filter(([,y]) => y >= cy)
            return (
              <g key={t.id}>
                {t.seats.map(stool)}
                {back.filter(s => seated.has(s)).map((s,i) => customer(s, i + t.id.charCodeAt(0)))}
                <rect x={t.x} y={t.y} width={t.w} height={t.h} fill={t.bar ? '#C9B79A' : '#F7F7F5'} stroke={t.bar ? '#8A7A66' : '#B8BAB8'}/>
                {!t.bar && <rect x={t.x} y={t.y + t.h - 4} width={t.w} height="4" fill="#B8BAB8"/>}
                {t.seats.filter(s => seated.has(s)).map(([x,y]) => {
                  const bx = t.bar ? t.x + 14 : Math.min(Math.max(x, t.x + 12), t.x + t.w - 12), by = t.bar ? y : (y < cy ? t.y + 12 : t.y + t.h - 14)
                  return <g key={`b${x}-${y}`}><ellipse cx={bx} cy={by} rx="8" ry="4" fill="#FFFFFF" stroke="#DDD"/><ellipse cx={bx} cy={by - 1} rx="5" ry="2.5" fill="#C3261C"/></g>
                })}
                <text x={t.x + t.w/2} y={t.y + t.h/2 + 5} textAnchor="middle" fontSize="13" fontWeight="800" fill={t.bar ? '#5A4E40' : '#A8A39A'} style={{pointerEvents:'none'}}>{t.id}</text>
                {front.filter(s => seated.has(s)).map((s,i) => customer(s, i + 3 + t.id.charCodeAt(0)))}
              </g>
            )
          })}

          {/* 직원 */}
          {[...people].sort((a,b) => String(a.uid).localeCompare(String(b.uid))).map(p => (
            <Walker key={p.uid} at={p.to} start={p.from} off={p.off} speed={p.busy ? SPEED * 1.5 : SPEED}>{moving => <g opacity={p.state === 'leaving' ? 0.85 : 1}><Person p={p} moving={moving}/></g>}</Walker>
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
        캐릭터는 직원이 내 기록에서 꾸미고, 자리는 인원관리의 포지션으로 정해져요. 머리 위 표시: 불꽃은 이번 달 개근 중, 병아리·별·왕관은 근속 등급, 노란 별은 오늘 체크리스트 완료.
      </div>
    </div>
  )
}
