import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, setDoc } from 'firebase/firestore'
import { parseAmount, addRewardBonuses } from '../lib/rewards'

// 개근 포상 게임: 개근한 직원끼리 룰렛 또는 사다리로 상품을 정함
// 결과는 rewards/{YYYY-MM} = { list:[{uid,name,prize,amount,paid}], game, playedAt } 에 저장
// '상여에 넣기'는 bonuses/{YYYY-MM}[uid] 에 {id,date,amount,memo} 를 더함 (급여관리 상여와 같은 자리)

const T = { ink:'#1D1B18', sub:'#6E6A63', rule:'#DCD7CE', accent:'#C3261C', red:'#B42318', green:'#2E7D45', blue:'#2B5C9E' }
const SEG = ['#C3261C','#F3F1EC','#2B5C9E','#FFFFFF','#2E7D45','#F3F1EC','#B45309','#FFFFFF','#6B4FA0','#F3F1EC']
const SEG_TEXT = c => ['#F3F1EC','#FFFFFF'].includes(c) ? T.ink : '#FFFFFF'
const LANE = ['#C3261C','#2B5C9E','#2E7D45','#B45309','#6B4FA0','#1D1B18']

const won = n => (n||0).toLocaleString('ko-KR')

function Btn({ children, onClick, kind = 'plain', disabled }) {
  const solid = kind==='primary' || kind==='ok'
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{fontFamily:'inherit', cursor: disabled ? 'default' : 'pointer', borderRadius:4, whiteSpace:'nowrap', fontSize:13, padding:'7px 14px',
        fontWeight: solid ? 700 : 500, background: kind==='primary' ? T.accent : kind==='ok' ? T.green : '#FFFFFF',
        color: solid ? '#FFFFFF' : T.ink, border: solid ? 'none' : `1px solid ${T.rule}`, opacity: disabled ? 0.5 : 1}}>
      {children}
    </button>
  )
}

// ── 룰렛: 상품 칸이 그려진 판을 직원마다 한 번씩 돌림 ──
export function Roulette({ people, prizes, results, onResult }) {
  const [angle, setAngle] = useState(0)
  const [spinning, setSpinning] = useState(false)
  const next = people.find(p => !results[p.uid])
  const n = prizes.length, seg = 360 / n, R = 150, C = 160
  const pt = a => [C + R*Math.sin(a*Math.PI/180), C - R*Math.cos(a*Math.PI/180)]

  function spin() {
    if (!next || spinning) return
    const pick = Math.floor(Math.random() * n)
    // 바늘(위쪽)에 pick 칸 가운데가 오도록: 판을 (360 - pick칸 가운데각) 만큼 돌린 위치 + 여러 바퀴
    const target = 360 - (pick*seg + seg/2) + (Math.random()-0.5)*seg*0.6
    const base = angle - (angle % 360)
    const final = base + 360*5 + ((target % 360) + 360) % 360
    setSpinning(true); setAngle(final)
    setTimeout(() => { setSpinning(false); onResult(next, prizes[pick]) }, 4200)
  }

  return (
    <div style={{display:'flex', gap:24, flexWrap:'wrap', alignItems:'center', justifyContent:'center'}}>
      <div style={{position:'relative', width:320, height:330}}>
        <div style={{position:'absolute', left:150, top:0, width:0, height:0, zIndex:2,
          borderLeft:'10px solid transparent', borderRight:'10px solid transparent', borderTop:`22px solid ${T.ink}`}}/>
        <svg width="320" height="320" viewBox="0 0 320 320" style={{marginTop:10, transform:`rotate(${angle}deg)`,
          transition: spinning ? 'transform 4s cubic-bezier(.12,.75,.15,1)' : 'none'}}>
          {prizes.map((p,i) => {
            const a0 = i*seg, a1 = (i+1)*seg, [x0,y0] = pt(a0), [x1,y1] = pt(a1), mid = a0 + seg/2
            const fill = SEG[i % SEG.length]
            return (
              <g key={i}>
                {n === 1 ? <circle cx={C} cy={C} r={R} fill={fill} stroke={T.ink}/> :
                  <path d={`M${C},${C} L${x0},${y0} A${R},${R} 0 ${seg>180?1:0} 1 ${x1},${y1} Z`} fill={fill} stroke={T.ink} strokeWidth="1"/>}
                <text x={C} y={C - R*0.62} transform={`rotate(${mid} ${C} ${C})`} textAnchor="middle" dominantBaseline="middle"
                  fontSize={n > 8 ? 12 : 15} fontWeight="700" fill={SEG_TEXT(fill)} style={{fontFamily:'inherit'}}>{p.length > 8 ? p.slice(0,8)+'…' : p}</text>
              </g>
            )
          })}
          <circle cx={C} cy={C} r="16" fill="#FFFFFF" stroke={T.ink} strokeWidth="2"/>
        </svg>
      </div>
      <div style={{minWidth:200, textAlign:'center'}}>
        {next ? <>
          <div style={{fontSize:14, color:T.sub}}>이번 차례</div>
          <div style={{fontSize:30, fontWeight:800, margin:'4px 0 14px'}}>{next.name}</div>
          <Btn kind="primary" onClick={spin} disabled={spinning}>{spinning ? '돌아가는 중...' : '룰렛 돌리기'}</Btn>
        </> : <div style={{fontSize:18, fontWeight:800, color:T.green}}>모두 돌렸어요</div>}
      </div>
    </div>
  )
}

// ── 사다리: 위에 이름, 아래에 상품. 이름을 누르면 길을 따라 내려감 ──
function shuffle(list) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
  return a
}
function makeLadder(n, rows = 9) {
  const rungs = [] // rungs[r] = Set of column indexes c (c ↔ c+1 연결)
  for (let r = 0; r < rows; r++) {
    const set = new Set()
    for (let c = 0; c < n-1; c++) if (!set.has(c-1) && Math.random() < 0.45) set.add(c)
    rungs.push(set)
  }
  // 모든 이웃 줄 사이에 가로줄이 최소 하나는 있게
  for (let c = 0; c < n-1; c++) if (!rungs.some(s => s.has(c))) {
    const r = rungs.findIndex(s => !s.has(c-1) && !s.has(c+1))
    rungs[r >= 0 ? r : 0].add(c)
  }
  return rungs
}
function trace(rungs, start) {
  let c = start
  const path = [[c, -1]]
  rungs.forEach((s, r) => {
    path.push([c, r])
    if (s.has(c)) c = c + 1; else if (s.has(c-1)) c = c - 1
    path.push([c, r])
  })
  path.push([c, rungs.length])
  return { end: c, path }
}

const LADDER_SECONDS = 5 // 한 사람이 사다리를 내려가는 시간 (천천히 보이게)

function Ladder({ people, prizes, onResult }) {
  const n = people.length
  // 게임을 시작할 때 한 번만 섞고 그림 (다시 그려도 바뀌지 않게)
  const [bottom] = useState(() => {
    const list = prizes.slice(0, n)
    while (list.length < n) list.push('꽝')
    return shuffle(list)
  })
  const [rungs] = useState(() => makeLadder(n))
  const [arrived, setArrived] = useState([]) // 다 내려온 사람
  const [running, setRunning] = useState(null) // 지금 내려가는 사람 번호
  const [progress, setProgress] = useState(0)  // 0 → 1
  const W = Math.max(300, n*90), colX = c => 45 + c*((W-90)/Math.max(1,n-1)), H = 300, top = 30, rowY = r => top + 20 + r*((H-80)/rungs.length)
  const yOf = r => r < 0 ? top : r >= rungs.length ? H - 30 : rowY(r)
  const pointsOf = i => trace(rungs, i).path.map(([c, r]) => [colX(c), yOf(r)])
  const lengthOf = pts => pts.slice(1).reduce((a, p, k) => a + Math.hypot(p[0]-pts[k][0], p[1]-pts[k][1]), 0)
  // 길 위에서 비율 t 지점 좌표
  const pointAt = (pts, t) => {
    let left = lengthOf(pts) * t
    for (let k = 1; k < pts.length; k++) {
      const seg = Math.hypot(pts[k][0]-pts[k-1][0], pts[k][1]-pts[k-1][1])
      if (left <= seg) { const f = seg ? left/seg : 0; return [pts[k-1][0] + (pts[k][0]-pts[k-1][0])*f, pts[k-1][1] + (pts[k][1]-pts[k-1][1])*f] }
      left -= seg
    }
    return pts[pts.length-1]
  }

  // 내려가는 동안 화면을 계속 그림 → 다 내려오면 결과
  useEffect(() => {
    if (running === null) return
    let raf, start
    const step = ts => {
      if (start === undefined) start = ts
      const t = Math.min(1, (ts - start) / (LADDER_SECONDS*1000))
      setProgress(t)
      if (t < 1) raf = requestAnimationFrame(step)
      else {
        const { end } = trace(rungs, running)
        setArrived(v => [...v, running]); setRunning(null)
        onResult(people[running], bottom[end])
      }
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running])

  function start(i) {
    if (running !== null || arrived.includes(i)) return
    setProgress(0); setRunning(i)
  }
  const endOf = i => trace(rungs, i).end
  const winnerAt = c => arrived.find(i => endOf(i) === c) // 이 상품 칸에 도착한 사람

  return (
    <div style={{overflowX:'auto'}}>
      <svg width={W} height={H+40} viewBox={`0 0 ${W} ${H+40}`} style={{display:'block', margin:'0 auto'}}>
        {people.map((p,i) => {
          const done = arrived.includes(i), now = running === i
          return (
            <g key={p.uid} onClick={()=>start(i)} style={{cursor: running === null && !done ? 'pointer' : 'default'}}>
              <rect x={colX(i)-40} y={0} width={80} height={24} rx={4} fill={done || now ? LANE[i % LANE.length] : '#FFFFFF'} stroke={T.ink}/>
              <text x={colX(i)} y={13} textAnchor="middle" dominantBaseline="middle" fontSize="13" fontWeight="700"
                fill={done || now ? '#FFFFFF' : T.ink} style={{fontFamily:'inherit'}}>{p.name}</text>
            </g>
          )
        })}
        {people.map((p,i) => <line key={'v'+i} x1={colX(i)} y1={top} x2={colX(i)} y2={H-30} stroke={T.rule} strokeWidth="3"/>)}
        {rungs.map((s, r) => [...s].map(c => <line key={`h${r}-${c}`} x1={colX(c)} y1={rowY(r)} x2={colX(c+1)} y2={rowY(r)} stroke={T.rule} strokeWidth="3"/>))}
        {[...arrived, ...(running !== null ? [running] : [])].map(i => {
          const pts = pointsOf(i), len = lengthOf(pts), t = i === running ? progress : 1
          const head = pointAt(pts, t)
          return (
            <g key={'p'+i}>
              <polyline points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke={LANE[i % LANE.length]} strokeWidth="4" strokeLinejoin="round"
                strokeDasharray={len} strokeDashoffset={len * (1 - t)}/>
              {i === running && <circle cx={head[0]} cy={head[1]} r="8" fill={LANE[i % LANE.length]} stroke="#FFFFFF" strokeWidth="2"/>}
            </g>
          )
        })}
        {bottom.map((b,c) => {
          const w = winnerAt(c)
          return (
            <g key={'b'+c}>
              <rect x={colX(c)-40} y={H-24} width={80} height={26} rx={4} fill={w !== undefined ? LANE[w % LANE.length] : '#F3F1EC'} stroke={T.ink}/>
              <text x={colX(c)} y={H-11} textAnchor="middle" dominantBaseline="middle" fontSize="12" fontWeight="700"
                fill={w !== undefined ? '#FFFFFF' : T.ink} style={{fontFamily:'inherit'}}>{b.length > 7 ? b.slice(0,7)+'…' : b}</text>
            </g>
          )
        })}
      </svg>
      <div style={{textAlign:'center', fontSize:14, color: running !== null ? T.ink : T.sub, marginTop:6, fontWeight: running !== null ? 700 : 400}}>
        {running !== null ? `${people[running].name} 내려가는 중...`
          : arrived.length < n ? '위의 이름을 하나씩 누르면 사다리를 타고 천천히 내려가요' : '모두 내려왔어요'}
      </div>
    </div>
  )
}

// practice: 연습 (저장 안 됨, 아무 직원으로 해볼 수 있음)
export default function RewardGame({ ym, people, onClose, onSaved, practice }) {
  const [game, setGame] = useState('roulette')
  const [prizeText, setPrizeText] = useState('3만원, 2만원, 1만원, 꽝')
  const [started, setStarted] = useState(false)
  const [results, setResults] = useState({}) // uid → prize
  const [amounts, setAmounts] = useState({}) // uid → 금액(고칠 수 있음)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const prizes = prizeText.split(/[,\n]/).map(s=>s.trim()).filter(Boolean)
  const m = ym.split('-')[1]
  const done = people.length > 0 && people.every(p => results[p.uid])

  function onResult(p, prize) {
    setResults(r => ({ ...r, [p.uid]: prize }))
    setAmounts(a => ({ ...a, [p.uid]: parseAmount(prize) }))
  }

  async function save(withBonus) {
    setSaving(true)
    try {
      const list = people.map(p => ({ uid:p.uid, name:p.name, prize:results[p.uid], amount:+amounts[p.uid]||0, paid:!!withBonus && (+amounts[p.uid]||0) > 0 }))
      await setDoc(doc(db,'rewards',ym), { list, game, prizes, eligible: people, status:'done', playedAt:new Date().toISOString() }, { merge:true })
      if (withBonus) await addRewardBonuses(ym, list, game==='roulette' ? '룰렛' : '사다리')
      setSaved(withBonus ? 'bonus' : 'only'); onSaved?.()
    } catch(e) { console.error(e); alert('저장하지 못했어요. 다시 시도해 주세요.') }
    setSaving(false)
  }

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000, overflowY:'auto', padding:'30px 12px'}}>
      <div onClick={e=>e.stopPropagation()} style={{background:'#FAF9F6', borderRadius:6, maxWidth:760, margin:'0 auto', padding:'20px 22px', color:T.ink}}>
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', borderBottom:`3px double ${T.ink}`, paddingBottom:8, marginBottom:14, gap:10, flexWrap:'wrap'}}>
          <h2 style={{fontSize:22, fontWeight:800, margin:0, fontFamily:'inherit'}}>{practice ? '포상 게임 연습' : `${+m}월 개근 포상 게임`}</h2>
          <span style={{fontSize:13, color: practice ? T.red : T.sub}}>{practice ? '연습이라 결과는 저장되지 않아요' : `개근 ${people.length}명: ${people.map(p=>p.name).join(', ')}`}</span>
        </div>

        {!started ? (
          <>
            <div style={{display:'flex', gap:16, marginBottom:12}}>
              {[['roulette','룰렛'],['ladder','사다리']].map(([k,l]) => (
                <button key={k} type="button" onClick={()=>setGame(k)}
                  style={{background:'none', border:'none', padding:'4px 0', cursor:'pointer', fontFamily:'inherit', fontSize:16,
                    fontWeight: game===k ? 800 : 500, color: game===k ? T.ink : T.sub, borderBottom:`2px solid ${game===k ? T.accent : 'transparent'}`}}>{l}</button>
              ))}
            </div>
            <div style={{fontSize:13, color:T.sub, marginBottom:6, lineHeight:1.6}}>
              {game==='roulette'
                ? '룰렛 칸에 들어갈 상품을 쉼표로 나눠 적어요. 같은 상품을 여러 번 적으면 그만큼 잘 나와요. 직원마다 한 번씩 돌려요.'
                : `사다리 아래에 놓일 상품을 쉼표로 나눠 적어요. 사람 수(${people.length}명)보다 적으면 나머지는 '꽝', 많으면 앞에서부터 ${people.length}개만 써요.`}
            </div>
            <textarea value={prizeText} onChange={e=>setPrizeText(e.target.value)} rows={2} aria-label="상품"
              style={{width:'100%', boxSizing:'border-box', background:'#FFFFFF', border:'1px solid #CBC5BA', borderRadius:4, padding:'8px 10px', fontSize:15, fontFamily:'inherit'}}/>
            <div style={{fontSize:12, color:T.sub, margin:'4px 0 14px'}}>
              금액으로 읽힌 상품: {prizes.map(p => `${p}${parseAmount(p) ? `(${won(parseAmount(p))}원)` : ''}`).join(' · ') || '없음'}
            </div>
            <div style={{display:'flex', gap:8}}>
              <Btn kind="primary" onClick={()=>setStarted(true)} disabled={!prizes.length || !people.length}>게임 시작</Btn>
              {practice && done && <span style={{fontSize:13, color:T.sub}}>연습이 끝났어요. 실제 게임은 달이 끝난 뒤 개근한 직원끼리 해요.</span>}
              <Btn onClick={onClose}>닫기</Btn>
            </div>
          </>
        ) : (
          <>
            {game==='roulette'
              ? <Roulette people={people} prizes={prizes} results={results} onResult={onResult}/>
              : <Ladder people={people} prizes={prizes} onResult={onResult}/>}

            {Object.keys(results).length > 0 && (
              <div style={{marginTop:18}}>
                <div style={{fontSize:15, fontWeight:800, borderBottom:`2px solid ${T.ink}`, paddingBottom:4}}>결과</div>
                {people.filter(p=>results[p.uid]).map(p => (
                  <div key={p.uid} style={{display:'flex', alignItems:'center', gap:10, padding:'7px 0', borderBottom:'1px solid #ECE8E1', fontSize:15}}>
                    <b style={{minWidth:70}}>{p.name}</b>
                    <span style={{flex:1}}>{results[p.uid]}</span>
                    <input type="text" inputMode="numeric" value={amounts[p.uid] ? won(amounts[p.uid]) : ''} placeholder="0" aria-label={`${p.name} 금액`}
                      onChange={e=>setAmounts(a=>({ ...a, [p.uid]: +e.target.value.replace(/[^0-9]/g,'') || 0 }))} disabled={!!saved}
                      style={{width:110, textAlign:'right', background:'#FFFFFF', border:'1px solid #CBC5BA', borderRadius:4, padding:'5px 8px', fontSize:14, fontFamily:'inherit', fontVariantNumeric:'tabular-nums'}}/>
                    <span style={{fontSize:13, color:T.sub}}>원</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{display:'flex', gap:8, flexWrap:'wrap', marginTop:14, alignItems:'center'}}>
              {saved ? (
                <span style={{fontSize:14, fontWeight:700, color:T.green}}>
                  {saved==='bonus' ? `저장했고 ${+m}월 급여 상여에 넣었어요` : '결과만 저장했어요'}
                </span>
              ) : done && !practice && <>
                <Btn kind="ok" onClick={()=>save(true)} disabled={saving}>결과 저장 + {+m}월 급여 상여에 넣기</Btn>
                <Btn onClick={()=>save(false)} disabled={saving}>결과만 저장</Btn>
              </>}
              {practice && done && <span style={{fontSize:13, color:T.sub}}>연습이 끝났어요. 실제 게임은 달이 끝난 뒤 개근한 직원끼리 해요.</span>}
              <Btn onClick={onClose}>닫기</Btn>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
