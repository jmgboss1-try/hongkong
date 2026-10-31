import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { collection, doc, getDoc, getDocs, onSnapshot } from 'firebase/firestore'
import { calcGrade } from '../AuthContext'
import Avatar from '../components/Avatar'
import { lookOf, defaultLook, AVATAR_CSS, POSITIONS } from '../lib/avatar'
import { toDate, hm, recBreak, planFor, dayStatus, monthStatus, loadMonthContext, pad } from '../lib/attendance'

// 우리 매장: 지금 출근한 직원들의 캐릭터가 위에서 내려다본 매장 그림 안에서 일하는 모습
//  - NFC 출근하면 문에서 걸어 들어와 자기 포지션(인원관리)으로, 브레이크면 휴게 공간, 퇴근하면 문으로 나감
//  - 머리 위: 개근 중(불꽃), 근속 등급(병아리·별·왕관), 오늘 체크리스트를 다 끝냈으면 별
//  - 오늘 매출만큼 손님이 앉아 있고, 배달이 많으면 배달 봉투가 쌓임
// attendance·revenue·checklist는 실시간(onSnapshot)으로 받아서 포스에 띄워 두면 저절로 바뀜

const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', soft:'#ECE8E1', accent:'#C3261C', red:'#B42318', green:'#2E7D45', blue:'#2B5C9E', amber:'#B45309' }
const num = { fontVariantNumeric:'tabular-nums' }
const W = 960, H = 600, SIZE = 40           // 그림 크기, 캐릭터 크기
const DOOR = [265, 590]
// 포지션별로 서 있을 자리 (발 위치)
const SLOTS = {
  wok:      [[95,128],[215,128],[335,128],[150,150]],
  kitchen:  [[520,128],[620,128],[800,128],[700,150]],
  hall:     [[395,380],[565,380],[395,520],[565,520]],
  counter:  [[835,395],[890,395]],
  delivery: [[75,535],[140,535],[105,565]],
  rest:     [[55,345],[105,345],[155,345],[80,385]],
}
const WOKS = [[95,78],[215,78],[335,78]]
const TABLES = [[310,330],[480,330],[650,330],[310,470],[480,470],[650,470]]
const CUSTOMER_LOOKS = Array.from({length:12}, (_,i) => ({ ...defaultLook(`손님${i*7}`), shirt: ['#2B5C9E','#6E6A63','#2E7D45','#B45309','#6B4FA0','#E8E4DC','#D9A441'][i % 7] }))

// 문에서 들어오거나 나갈 때: 처음엔 from, 바로 다음 그림에서 to로 (CSS transition으로 걸어감)
function Mover({ from, to, children }) {
  const [pos, setPos] = useState(from)
  useEffect(() => { const r = requestAnimationFrame(() => requestAnimationFrame(() => setPos(to))); return () => cancelAnimationFrame(r) }, [to[0], to[1]]) // eslint-disable-line react-hooks/exhaustive-deps
  return <g className="os-move" style={{transform:`translate(${pos[0]}px, ${pos[1]}px)`}}>{children}</g>
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

function Person({ p }) {
  const { look, pose, label, badges, pace } = p
  const body = (
    <>
      <g transform={`translate(${-SIZE/2},${-SIZE*1.25})`}><Avatar look={look} size={SIZE} pose={pose} title={label}/></g>
      <Badges {...badges}/>
      {pose === 'rest' && <text className="av-float" x="14" y={-SIZE*1.1} fontSize="14" fontWeight="800" fill={T.blue}>z</text>}
      <text x="0" y="16" textAnchor="middle" fontSize="13" fontWeight="800" fill={T.ink} stroke="#FFFFFF" strokeWidth="4" paintOrder="stroke">{label}</text>
    </>
  )
  return pace ? <g className="av-pace" style={{'--pace': `${pace}px`}}>{body}</g> : body
}

export default function OurStore() {
  const [now, setNow] = useState(() => new Date())
  const [staff, setStaff] = useState([])
  const [att, setAtt] = useState({})
  const [rev, setRev] = useState({})
  const [checks, setChecks] = useState({})
  const [ckCfg, setCkCfg] = useState(null)
  const [ctx, setCtx] = useState(null)
  const ym = `${now.getFullYear()}-${pad(now.getMonth()+1)}`, dd = pad(now.getDate())
  const todayStr = `${ym}-${dd}`

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t) }, [])

  useEffect(() => {
    let off = false
    Promise.all([
      getDocs(collection(db,'users')),
      getDoc(doc(db,'checklist','config')).then(s => s.exists() ? s.data() : null).catch(() => null),
      loadMonthContext(ym),
    ]).then(([us, cfg, c]) => {
      if (off) return
      const list = []
      us.forEach(d => { const u = d.data(); if (u.status==='approved' && !['owner','store','investor'].includes(u.role)) list.push({ uid:d.id, ...u }) })
      setStaff(list); setCkCfg(cfg); setCtx(c)
    }).catch(e => console.error(e))
    const subs = [
      onSnapshot(doc(db,'attendance',ym), s => setAtt(s.exists() ? s.data() : {}), () => {}),
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
  const customers = Math.min(12, Math.round(total / 100000))
  const bags = Math.min(6, Math.round(delTotal / 120000))

  // ── 오늘 체크리스트 ──
  const todayChecks = Object.values(checks[todayStr] || {}).filter(Boolean).length
  const ckTotal = ckCfg ? (ckCfg.daily||[]).length * 2 + (ckCfg.weekly||[]).filter(w => w.dow === now.getDay()).length : 0
  const ckDone = ckTotal > 0 && todayChecks >= ckTotal

  // ── 직원별 지금 상태 ──
  const nowMs = now.getTime(), nowMin = now.getHours()*60 + now.getMinutes()
  const toMin = s => { const [h,m] = String(s).split(':').map(Number); return h*60 + (m||0) }
  const people = [], waiting = [], gone = []
  const used = {}
  const slotFor = key => { const list = SLOTS[key] || SLOTS.hall; const i = used[key] = (used[key] ?? -1) + 1; const [x,y] = list[i % list.length]; return [x + Math.floor(i / list.length) * 18, y] }
  for (const u of staff) {
    const rec = att[u.uid]?.[dd] || null
    const inD = toDate(rec?.in), outD = toDate(rec?.out)
    const plan = rec?.schedStart ? { start:rec.schedStart, end:rec.schedEnd } : planFor(u, now, ctx?.plan, u.uid)
    const grade = calcGrade(u.joinDate)
    const flame = ctx ? monthStatus({ ym, uid:u.uid, user:u, recs:att[u.uid], holidays:ctx.holidays, subs:ctx.subs, plan:ctx.plan, since:ctx.since }).perfect : false
    const posKey = POSITIONS.some(p => p.id === u.position) ? u.position : 'hall'
    const base = { uid:u.uid, label:u.name, look:lookOf(u), badges:{ flame, grade, star: ckDone }, posKey, inD, outD, plan, late: rec?.in ? dayStatus(rec, plan).late : 0 }
    if (inD && outD) {
      if (nowMs - outD.getTime() < 180000) people.push({ ...base, state:'leaving', pose:'walk', from: slotFor(posKey), to: DOOR })
      else gone.push(base)
    } else if (inD) {
      const br = recBreak(rec)
      const resting = br && nowMin >= toMin(br.start) && nowMin < toMin(br.end)
      const to = resting ? slotFor('rest') : slotFor(posKey)
      const arriving = nowMs - inD.getTime() < 120000
      people.push({ ...base, state: resting ? 'rest' : 'work', pose: resting ? 'rest' : 'work', from: arriving ? DOOR : to, to,
        pace: !resting && posKey === 'hall' ? 110 : 0, brEnd: resting ? br.end : null })
    } else if (plan) {
      waiting.push({ ...base, overdue: nowMin > toMin(plan.start) })
    }
  }
  waiting.sort((a,b) => toMin(a.plan.start) - toMin(b.plan.start))
  const occupiedWoks = people.filter(p => p.state==='work' && p.posKey==='wok').length

  const tile = (x, y, w, h, a, b, id) => (
    <>
      <defs><pattern id={id} width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill={a}/><rect width="20" height="20" fill={b}/><rect x="20" y="20" width="20" height="20" fill={b}/></pattern></defs>
      <rect x={x} y={y} width={w} height={h} fill={`url(#${id})`}/>
    </>
  )
  const label = (x, y, t) => <text x={x} y={y} fontSize="12" fill={T.sub} fontWeight="700">{t}</text>

  return (
    <div style={{maxWidth:1100}}>
      <style>{AVATAR_CSS}</style>
      <header style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:12, flexWrap:'wrap', paddingBottom:10, borderBottom:`3px double ${T.ink}`, marginBottom:16}}>
        <h1 style={{fontSize:24, fontWeight:800, margin:0, fontFamily:'inherit', color:T.ink}}>우리 매장</h1>
        <div style={{fontSize:14, color:T.sub, ...num}}>{now.getMonth()+1}월 {now.getDate()}일 {hm(now)} · 지금 {people.filter(p=>p.state!=='leaving').length}명 근무 중</div>
      </header>

      <div style={{background:'#2A211C', borderRadius:6, padding:8}}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="매장 안에서 일하는 직원들" style={{display:'block', shapeRendering:'crispEdges'}}>
          {/* 바닥: 주방은 회색 타일, 홀은 따뜻한 타일 */}
          {tile(20, 40, 920, 190, '#D9D5CE', '#CFCAC2', 'tk')}
          {tile(20, 240, 920, 340, '#EFE3CF', '#E6D7BE', 'th')}
          {/* 벽과 간판 */}
          <rect x="0" y="0" width={W} height="40" fill="#8E2A21"/>
          <rect x="360" y="6" width="240" height="28" fill="#C3261C" stroke="#F6C343" strokeWidth="2"/>
          <text x="480" y="26" textAnchor="middle" fontSize="17" fontWeight="900" fill="#FFFFFF">홍콩반점 중앙대점</text>
          <rect x="0" y="0" width="20" height={H} fill="#5A1E18"/><rect x={W-20} y="0" width="20" height={H} fill="#5A1E18"/>
          <rect x="0" y={H-20} width="220" height="20" fill="#5A1E18"/><rect x="310" y={H-20} width={W-310} height="20" fill="#5A1E18"/>
          <rect x="222" y={H-14} width="86" height="10" fill="#6E6A63"/>
          {label(232, H-24, '입구')}

          {/* 웍 화구 */}
          <rect x="40" y="48" width="360" height="56" fill="#9AA0A6"/><rect x="40" y="96" width="360" height="8" fill="#6E747A"/>
          {WOKS.map(([x,y],i) => (
            <g key={i}>
              {i < occupiedWoks && <rect className="av-flame" x={x-14} y={y+6} width="28" height="8" fill="#E8742A"/>}
              <ellipse cx={x} cy={y} rx="26" ry="14" fill="#2F2B28"/><ellipse cx={x} cy={y-2} rx="18" ry="8" fill={i < occupiedWoks ? '#C3261C' : '#45403B'}/>
            </g>
          ))}
          {label(44, 62, '웍')}
          {/* 준비대·설거지 */}
          <rect x="470" y="54" width="240" height="46" fill="#B8BDC2"/><rect x="500" y="62" width="60" height="26" fill="#E8D3A8"/>
          <rect x="580" y="64" width="16" height="16" fill="#2E7D45"/><rect x="600" y="66" width="14" height="14" fill="#C3261C"/><rect x="620" y="64" width="18" height="16" fill="#F6C343"/>
          {label(474, 50, '준비')}
          <rect x="740" y="54" width="170" height="46" fill="#B8BDC2"/><rect x="760" y="62" width="60" height="30" fill="#7FB2D9"/><rect x="835" y="62" width="60" height="30" fill="#7FB2D9"/>
          {label(744, 50, '설거지')}
          {/* 내주는 곳 (짬뽕 그릇) */}
          <rect x="230" y="200" width="480" height="26" fill="#B07D4F"/><rect x="230" y="222" width="480" height="6" fill="#8A5F3A"/>
          {[0,1,2,3].slice(0, Math.min(4, Math.ceil(customers/3))).map(i => <g key={i}><ellipse cx={290 + i*110} cy="210" rx="16" ry="7" fill="#FFFFFF"/><ellipse cx={290 + i*110} cy="209" rx="12" ry="4" fill="#C3261C"/></g>)}

          {/* 휴게 공간 */}
          <rect x="20" y="240" width="190" height="170" fill="#D8CDB9"/>
          <rect x="30" y="300" width="160" height="26" fill="#2E7D45"/><rect x="30" y="292" width="160" height="10" fill="#246338"/>
          <rect x="88" y="360" width="40" height="22" fill="#B07D4F"/><rect x="100" y="352" width="10" height="10" fill="#FFFFFF"/>
          <rect x="176" y="250" width="22" height="30" fill="#2E7D45"/><rect x="180" y="278" width="14" height="14" fill="#8A5F3A"/>
          {label(30, 258, '휴게')}
          {/* 배달·포장 */}
          <rect x="20" y="430" width="190" height="150" fill="#E3D9C8"/>
          {label(30, 448, `배달·포장${bags ? ` ${bags}건 대기` : ''}`)}
          <rect x="30" y="456" width="170" height="30" fill="#9C7451"/>
          {Array.from({length:bags}).map((_,i) => <g key={i}><rect x={36 + i*27} y="458" width="22" height="24" fill="#FFFFFF" stroke="#C3261C"/><rect x={42 + i*27} y="464" width="10" height="6" fill="#C3261C"/></g>)}
          {/* 키오스크·카운터 */}
          <rect x="770" y="250" width="160" height="110" fill="#E3D9C8"/>
          <rect x="790" y="262" width="34" height="56" fill="#1D1B18"/><rect x="795" y="268" width="24" height="30" fill="#7FB2D9"/>
          <rect x="840" y="300" width="80" height="40" fill="#B07D4F"/><rect x="862" y="290" width="26" height="14" fill="#1D1B18"/>
          {label(836, 266, '키오스크·카운터')}

          {/* 손님 테이블: 오늘 매출만큼 손님 */}
          {TABLES.map(([x,y],t) => {
            const seated = [0,1].filter(s => t*2 + s < customers)
            return (
              <g key={t}>
                {seated.map(s => (
                  <g key={s} transform={`translate(${x - 52 + s*64},${y - 50})`}>
                    {/* 움직임(av-bob)은 안쪽 g에: 바깥 g의 위치(transform)를 덮어쓰지 않게 */}
                    <g className="av-bob"><Avatar look={CUSTOMER_LOOKS[(t*2+s) % CUSTOMER_LOOKS.length]} size={36} apron={false}/></g>
                  </g>
                ))}
                <rect x={x-50} y={y-8} width="100" height="40" fill="#B07D4F"/><rect x={x-50} y={y+28} width="100" height="6" fill="#8A5F3A"/>
                {seated.map(s => <g key={'b'+s}><ellipse cx={x - 22 + s*44} cy={y+6} rx="11" ry="5" fill="#FFFFFF"/><ellipse cx={x - 22 + s*44} cy={y+5} rx="8" ry="3" fill="#C3261C"/></g>)}
              </g>
            )
          })}

          {/* 직원 */}
          {[...people].sort((a,b) => a.to[1] - b.to[1]).map(p => (
            <Mover key={p.uid + p.state} from={p.from} to={p.to}><g opacity={p.state === 'leaving' ? 0.85 : 1}><Person p={p}/></g></Mover>
          ))}
        </svg>
      </div>

      {/* 아래: 글로 보는 지금 상황 */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap:'18px 32px', marginTop:18}}>
        <section>
          <h2 style={{fontSize:15, fontWeight:800, margin:'0 0 4px', fontFamily:'inherit', borderBottom:`2px solid ${T.ink}`, paddingBottom:4}}>근무 중</h2>
          {people.filter(p => p.state !== 'leaving').length === 0 && <div style={{fontSize:13, color:T.sub, padding:'6px 0'}}>지금 근무 중인 사람이 없어요</div>}
          {people.filter(p => p.state !== 'leaving').map(p => (
            <div key={p.uid} style={{display:'flex', gap:8, alignItems:'baseline', fontSize:14, padding:'5px 0', borderBottom:`1px solid ${T.soft}`}}>
              <b style={{minWidth:56}}>{p.label}</b>
              <span style={{color:T.sub, fontSize:12}}>{POSITIONS.find(x=>x.id===p.posKey)?.label}</span>
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
            ...gone.map(g => [g.label, `${hm(g.inD)}~${hm(g.outD)} 퇴근`]),
          ].map(([k,v],i) => (
            <div key={i} style={{display:'flex', gap:8, alignItems:'baseline', fontSize:14, padding:'5px 0', borderBottom:`1px solid ${T.soft}`}}>
              <span style={{color:T.sub, minWidth:72}}>{k}</span><span style={{flex:1}}/>
              <span style={{...num, color: String(v).includes('아직 안 옴') ? T.red : T.ink}}>{v}</span>
            </div>
          ))}
        </section>
      </div>
      <div style={{fontSize:12, color:T.sub, marginTop:12, lineHeight:1.7}}>
        캐릭터는 직원이 내 기록에서 꾸미고, 자리는 인원관리의 포지션으로 정해져요. 머리 위 표시: 불꽃은 이번 달 개근 중, 병아리·별·왕관은 근속 등급, 노란 별은 오늘 체크리스트 완료.
      </div>
    </div>
  )
}
