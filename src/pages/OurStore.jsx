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
// 배치는 실제 매장 사진대로: 위쪽 주방(웍 3개), 그 앞 주문·포장 카운터, 왼쪽 창고·화장실, 오른쪽 퇴식대·입구, 아래 창가
const DOOR = [860, 592]
// 포지션별로 서 있을 자리 (발 위치)
const SLOTS = {
  wok:      [[655,140],[745,140],[835,140],[700,160]],
  kitchen:  [[510,140],[570,140],[450,140],[540,160]],
  counter:  [[400,212],[470,212],[540,212]],
  delivery: [[262,308],[300,300],[262,335]],
  hall:     [[265,345],[395,345],[525,345],[265,445]],
  rest:     [[55,290],[105,290],[80,320],[130,320]],
}
const WOKS = [[655,82],[745,82],[835,82]]
// 2인 테이블 (가운데 좌표) 4줄 x 3칸
const TABLES = [200,330,460,590].flatMap(x => [295,395,495].map(y => [x,y]))
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
  const customers = Math.min(TABLES.length * 2, Math.round(total / 100000))
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
  const label = (x, y, t, dark) => <text x={x} y={y} fontSize="12" fill={dark ? '#E8E4DC' : T.sub} fontWeight="700">{t}</text>

  return (
    <div style={{maxWidth:1100}}>
      <style>{AVATAR_CSS}</style>
      <header style={{display:'flex', alignItems:'baseline', justifyContent:'space-between', gap:12, flexWrap:'wrap', paddingBottom:10, borderBottom:`3px double ${T.ink}`, marginBottom:16}}>
        <h1 style={{fontSize:24, fontWeight:800, margin:0, fontFamily:'inherit', color:T.ink}}>우리 매장</h1>
        <div style={{fontSize:14, color:T.sub, ...num}}>{now.getMonth()+1}월 {now.getDate()}일 {hm(now)} · 지금 {people.filter(p=>p.state!=='leaving').length}명 근무 중</div>
      </header>

      <div style={{background:'#2A211C', borderRadius:6, padding:8}}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="매장 안에서 일하는 직원들" style={{display:'block', shapeRendering:'crispEdges'}}>
          {/* 바닥: 주방은 밝은 회색 타일, 매장은 진회색 타일 (실제 매장처럼) */}
          {tile(20, 40, 940, 540, '#4E4E4E', '#474747', 'th')}
          {tile(360, 40, 580, 150, '#D3D6D9', '#C7CBCF', 'tk2')}
          {/* 벽: 아이보리 + 빨간 띠, 아래쪽은 창가 */}
          <rect x="0" y="0" width={W} height="40" fill="#EDE6D6"/><rect x="0" y="30" width={W} height="10" fill="#B8282A"/>
          <rect x="0" y="0" width="20" height={H} fill="#EDE6D6"/><rect x={W-20} y="0" width="20" height={H} fill="#EDE6D6"/>
          <rect x="0" y={H-20} width="790" height="20" fill="#3B4A5A"/><rect x="20" y={H-18} width="770" height="6" fill="#9FC3DD"/>
          <rect x="910" y={H-20} width="50" height="20" fill="#EDE6D6"/>
          {label(30, H-26, '창가', true)}
          {/* 창가 바 좌석 */}
          <rect x="30" y="548" width="740" height="12" fill="#F2F2F2"/>
          {[60,120,180,240,300,360,420,480,540,600,660,720].map(x => <rect key={x} x={x} y="532" width="14" height="12" fill="#3A3A3A"/>)}

          {/* 계단 밑 휴게 자리 · 화장실 */}
          <rect x="20" y="40" width="190" height="160" fill="#E4DDCF"/>
          {[0,1,2,3,4].map(i => <rect key={i} x={20 + i*38} y={40 + i*12} width="38" height={160 - i*12} fill="#00000008"/>)}
          <rect x="130" y="40" width="60" height="70" fill="#D8D2C4" stroke="#8A8378"/><rect x="176" y="72" width="5" height="5" fill="#8A8378"/>
          {label(136, 128, '화장실')}
          <rect x="20" y="240" width="140" height="110" fill="#5A5A5A"/>
          <rect x="45" y="262" width="80" height="34" fill="#F4F4F2"/>
          <rect x="78" y="266" width="12" height="10" fill="#FFFFFF" stroke="#B8B2A7"/>
          {label(28, 344, '휴게', true)}

          {/* 창고 선반 · 홍콩반점 냉장고 · 하이트진로 상자 (카운터 왼쪽) */}
          <rect x="210" y="40" width="150" height="150" fill="#5E5E5E"/>
          <rect x="216" y="46" width="68" height="40" fill="#3A3A3A"/>{[0,1,2].map(i => <rect key={i} x={222 + i*20} y="52" width="16" height="28" fill="#F2EFEA"/>)}
          <rect x="296" y="46" width="56" height="86" fill="#F4F4F2"/><rect x="300" y="58" width="48" height="66" fill="#6F8FE8"/><rect x="296" y="46" width="56" height="12" fill="#C3261C"/>
          <text x="324" y="56" textAnchor="middle" fontSize="8" fontWeight="900" fill="#FFFFFF">홍콩반점</text>
          {[0,1,2].map(i => <rect key={i} x="222" y={100 + i*20} width="30" height="18" fill="#2B5C9E" stroke="#1E4577"/>)}
          {Array.from({length:bags}).map((_,i) => <g key={i}><rect x={260 + (i%3)*24} y={140 + Math.floor(i/3)*24} width="20" height="20" fill="#FFFFFF" stroke="#C3261C"/><rect x={265 + (i%3)*24} y={145 + Math.floor(i/3)*24} width="10" height="5" fill="#C3261C"/></g>)}
          {label(216, 204, `포장·배달${bags ? ` ${bags}건 대기` : ''}`, true)}

          {/* 주방: 냉장고 · 준비 냉장고 · 웍 3개 · 개수대 */}
          <rect x="360" y="40" width="580" height="8" fill="#F4F4F2"/>
          <rect x="368" y="50" width="70" height="56" fill="#B9BEC3" stroke="#8D9297"/><rect x="368" y="78" width="70" height="2" fill="#8D9297"/>
          {label(372, 118, '냉장고')}
          <rect x="450" y="56" width="140" height="44" fill="#B9BEC3"/><rect x="458" y="62" width="40" height="22" fill="#E8D3A8"/>
          <rect x="506" y="64" width="14" height="14" fill="#2E7D45"/><rect x="524" y="64" width="14" height="14" fill="#C3261C"/><rect x="544" y="62" width="34" height="26" fill="#DADDE0" stroke="#8D9297"/>
          {label(452, 112, '준비')}
          <rect x="610" y="50" width="270" height="62" fill="#A9AEB4"/><rect x="610" y="104" width="270" height="8" fill="#7C8187"/>
          {WOKS.map(([x,y],i) => (
            <g key={i}>
              {i < occupiedWoks && <rect className="av-flame" x={x-14} y={y+6} width="28" height="8" fill="#E8742A"/>}
              <ellipse cx={x} cy={y} rx="26" ry="14" fill="#2F2B28"/><ellipse cx={x} cy={y-2} rx="18" ry="8" fill={i < occupiedWoks ? '#C3261C' : '#45403B'}/>
            </g>
          ))}
          <rect x="888" y="52" width="40" height="22" fill="#B9BEC3"/><rect x="888" y="80" width="40" height="22" fill="#B9BEC3"/>
          <rect x="884" y="110" width="48" height="40" fill="#B9BEC3"/><rect x="890" y="116" width="36" height="26" fill="#7FB2D9"/>
          {label(616, 64, '웍')}
          {label(888, 162, '개수대')}

          {/* 주문·포장 카운터 (위에 홍콩반점 글씨, 포스·밥솥) */}
          <rect x="360" y="178" width="400" height="26" fill="#3A3A3A"/><rect x="360" y="178" width="400" height="5" fill="#9A9EA3"/>
          <rect x="380" y="168" width="22" height="12" fill="#1D1B18"/><rect x="383" y="170" width="16" height="7" fill="#7FB2D9"/>
          <rect x="560" y="166" width="20" height="16" fill="#F2F2F2" stroke="#B8B2A7"/><rect x="590" y="166" width="20" height="16" fill="#F2F2F2" stroke="#B8B2A7"/>
          <text x="560" y="172" textAnchor="middle" fontSize="15" fontWeight="900" fill="#C3261C" stroke="#FFFFFF" strokeWidth="3" paintOrder="stroke">홍콩반점</text>
          {label(616, 220, '주문·포장 카운터', true)}
          {/* 카운터 오른쪽: 음료 냉장고 · 정수기 · 퇴식대 · 쓰레기통 */}
          <rect x="768" y="160" width="40" height="44" fill="#F4F4F2"/><rect x="772" y="170" width="32" height="30" fill="#BFD6EA"/><rect x="768" y="160" width="40" height="9" fill="#C3261C"/>
          <rect x="814" y="170" width="22" height="34" fill="#F4F4F2" stroke="#B8B2A7"/>
          <rect x="842" y="150" width="98" height="54" fill="#9A9EA3"/><rect x="850" y="160" width="82" height="22" fill="#5E6268"/>
          {label(856, 216, '퇴식대', true)}
          <rect x="846" y="226" width="22" height="22" fill="#2A2A2A"/><rect x="874" y="226" width="22" height="22" fill="#2A2A2A"/>

          {/* 셀프바 · 메뉴판 */}
          <rect x="660" y="250" width="70" height="32" fill="#C3261C"/><rect x="664" y="252" width="62" height="8" fill="#2A2A2A"/>
          {label(664, 296, '셀프바', true)}
          <rect x="22" y="380" width="8" height="60" fill="#C3261C"/><rect x="22" y="460" width="8" height="60" fill="#3A1F1C"/>

          {/* 입구 쪽: 칸막이 유리 · 키오스크 · 대기 의자 */}
          <rect x="770" y="260" width="6" height="230" fill="#9FC3DD"/>
          <rect x="900" y="268" width="34" height="56" fill="#1D1B18"/><rect x="905" y="274" width="24" height="32" fill="#7FB2D9"/>
          {label(870, 340, '키오스크', true)}
          <circle cx="905" cy="470" r="11" fill="#5A4636"/><circle cx="905" cy="500" r="11" fill="#5A4636"/>
          <rect x="820" y={H-20} width="90" height="20" fill="#7C7C7C"/><rect x="826" y={H-16} width="78" height="4" fill="#B8B2A7"/>
          {label(840, H-26, '입구', true)}

          {/* 손님 테이블 (하얀 2인 테이블): 오늘 매출만큼 손님 — 앞자리부터 한 명씩, 다 차면 맞은편 */}
          {TABLES.map(([x,y],t) => {
            const top = t < customers, bottom = t + TABLES.length < customers
            return (
              <g key={t}>
                <rect x={x-20} y={y-34} width="18" height="12" fill="#C9CBCE"/><rect x={x+2} y={y-34} width="18" height="12" fill="#C9CBCE"/>
                {top && (
                  <g transform={`translate(${x-16},${y-60})`}>
                    {/* 움직임(av-bob)은 안쪽 g에: 바깥 g의 위치(transform)를 덮어쓰지 않게 */}
                    <g className="av-bob"><Avatar look={CUSTOMER_LOOKS[t % CUSTOMER_LOOKS.length]} size={32} apron={false}/></g>
                  </g>
                )}
                <rect x={x-30} y={y-20} width="60" height="34" fill="#F7F7F5"/><rect x={x-30} y={y+12} width="60" height="4" fill="#B8BAB8"/>
                <rect x={x-20} y={y+20} width="18" height="12" fill="#C9CBCE"/><rect x={x+2} y={y+20} width="18" height="12" fill="#C9CBCE"/>
                {top && <g><ellipse cx={x-8} cy={y-6} rx="9" ry="4" fill="#FFFFFF" stroke="#DDD"/><ellipse cx={x-8} cy={y-7} rx="6" ry="2.5" fill="#C3261C"/></g>}
                {bottom && (
                  <g transform={`translate(${x-2},${y-8})`}>
                    <g className="av-bob"><Avatar look={CUSTOMER_LOOKS[(t+5) % CUSTOMER_LOOKS.length]} size={32} apron={false}/></g>
                  </g>
                )}
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
