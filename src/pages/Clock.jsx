import { useEffect, useRef, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, deleteField, serverTimestamp } from 'firebase/firestore'
import { useAuth } from '../AuthContext'
import { DEFAULT_RADIUS, GRACE_MIN, ymOf, ddOf, hm, toDate, planFor, breakForShift, calcRecord, applyRecord, distanceM, getPosition, minsLabel } from '../lib/attendance'

const DAYS_KR = ['일','월','화','수','목','금','토']
const T = { ink:'#1D1B18', sub:'#6E6A63', rule:'#DCD7CE', accent:'#C3261C', red:'#B42318', green:'#2E7D45', blue:'#2B5C9E', amber:'#B45309' }

// 매장 입구 NFC 태그가 여는 페이지 (/clock). 열리면 위치를 확인하고 바로 출근 또는 퇴근을 찍음
//  - 오늘 출근 기록이 없으면 출근, 출근만 있으면 퇴근 (출근 2분 안에 다시 대면 실수로 보고 안 찍음)
//  - 자정 넘어 퇴근하면 어제 출근 기록에 퇴근을 붙임
export default function Clock() {
  const { user, userData, isOwner, isStore, isInvestor } = useAuth()
  const [phase, setPhase] = useState('working') // working | done | error
  const [msg, setMsg] = useState('위치를 확인하고 있어요...')
  const [result, setResult] = useState(null)   // { kind:'in'|'out'|'already'|'soon', rec, ym, dd }
  const [busy, setBusy] = useState(false)
  const started = useRef(false)

  const staffOk = user && userData && !isStore && !isInvestor && (isOwner || !['pending','rejected','retired'].includes(userData.status))

  async function readRec(ym, dd) {
    const s = await getDoc(doc(db,'attendance',ym))
    return s.exists() ? (s.data()[user.uid]?.[dd] || null) : null
  }
  const write = (ym, dd, fields) => setDoc(doc(db,'attendance',ym), { [user.uid]: { [dd]: fields } }, { merge:true })

  async function run(force) {
    setPhase('working'); setMsg('위치를 확인하고 있어요...')
    try {
      // 1. 매장 근처인지
      const nowD = new Date()
      const [pos, cfgSnap, meSnap, plan, subs] = await Promise.all([
        getPosition(),
        getDoc(doc(db,'attendance','_config')),
        getDoc(doc(db,'users',user.uid)),
        getDoc(doc(db,'schedule',ymOf(nowD))).then(x => x.exists() ? x.data() : null).catch(() => null), // 이번 주 근무표 (직접 바꾼 날·일찍 마감)
        getDoc(doc(db,'substitutes','requests')).then(x => x.exists() ? (x.data().list||[]) : []).catch(() => []), // 대타로 들어가는 날
      ])
      const cfg = cfgSnap.exists() ? cfgSnap.data() : null
      const me = meSnap.exists() ? meSnap.data() : userData
      let dist = null
      if (cfg?.lat != null) {
        dist = distanceM(pos, cfg)
        const radius = cfg.radius || DEFAULT_RADIUS
        if (dist - Math.min(pos.acc, 100) > radius)
          throw new Error(`매장에서 약 ${dist.toLocaleString()}m 떨어져 있어요. 매장 입구에서 다시 대 주세요.`)
      }
      setMsg('기록하고 있어요...')

      // 2. 출근인지 퇴근인지
      const now = new Date()
      const ym = ymOf(now), dd = ddOf(now)
      let rec = await readRec(ym, dd)
      let tYm = ym, tDd = dd
      if (!rec?.in) {
        // 자정 넘어 퇴근: 어제 출근만 있고 16시간 안이면 어제 기록에 퇴근
        const y = new Date(now); y.setDate(y.getDate()-1)
        const yRec = await readRec(ymOf(y), ddOf(y))
        const yIn = toDate(yRec?.in)
        if (yRec?.in && !yRec.out && now - yIn < 16*3600*1000) { rec = yRec; tYm = ymOf(y); tDd = ddOf(y) }
      }

      if (!rec?.in) {
        // 예정: 근무표(기본 패턴·직접 바꾼 날·일찍 마감) → 없으면 오늘 대타로 확정된 시간
        const todayStr = `${tYm}-${tDd}`
        const cover = subs.find(r => r.confirmedUid === user.uid && r.date === todayStr)
        const sh = planFor(me, now, plan, user.uid) || (cover ? { start:`${cover.startH}:${cover.startM}`, end:`${cover.endH}:${cover.endM}` } : null)
        const br = breakForShift(cfg, now, sh) // 풀타임이면 그날 매장 브레이크를 기록에 붙임 (근무시간에서 빠짐)
        await write(tYm, tDd, { in: serverTimestamp(), inDist: dist, name: me?.name || '', schedStart: sh?.start || null, schedEnd: sh?.end || null,
          ...(br ? { breakStart: br.start, breakEnd: br.end } : {}) })
        setResult({ kind:'in', rec: await readRec(tYm, tDd), ym:tYm, dd:tDd })
      } else if (!rec.out) {
        if (!force && now - toDate(rec.in) < 2*60*1000) {
          setResult({ kind:'soon', rec, ym:tYm, dd:tDd })
        } else {
          await write(tYm, tDd, { out: serverTimestamp(), outDist: dist })
          const r = await readRec(tYm, tDd)
          // 근무관리에 근무시간 반영 (권한이 없으면 사장님이 근무관리를 열 때 반영됨)
          try { await applyRecord(tYm, user.uid, tDd, r) } catch(e) { console.warn('근무시간 반영은 근무관리에서', e) }
          setResult({ kind:'out', rec: r, ym:tYm, dd:tDd })
        }
      } else {
        setResult({ kind:'already', rec, ym:tYm, dd:tDd })
      }
      setPhase('done')
    } catch(e) {
      console.error(e)
      setMsg(e.code === 'permission-denied' ? '기록할 권한이 없어요. 사장님께 알려 주세요 (Firestore 규칙: attendance).' : (e.message || '기록하지 못했어요. 다시 대 주세요.'))
      setPhase('error')
    }
  }

  // 퇴근을 실수로 찍었을 때 되돌리기
  async function undoOut() {
    if (!result) return
    setBusy(true)
    try {
      await write(result.ym, result.dd, { out: deleteField(), outDist: deleteField(), appliedMins: deleteField() })
      // 퇴근 때 근무관리에 넣은 시간도 되돌림 (권한이 없으면 사장님이 근무관리에서 정리)
      try {
        await setDoc(doc(db,'workhours',result.ym), { [user.uid]: { [result.dd]: 0 } }, { merge:true })
        await setDoc(doc(db,'workextra',result.ym), { [user.uid]: { [result.dd]: 0 } }, { merge:true })
      } catch(e) { console.warn(e) }
      setResult({ ...result, kind:'in', rec: await readRec(result.ym, result.dd), undone:true })
    } catch(e) { console.error(e); alert('되돌리지 못했어요. 사장님께 알려 주세요.') }
    setBusy(false)
  }

  useEffect(()=>{
    if (!staffOk || started.current) return
    started.current = true
    run(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staffOk])

  const now = new Date()
  const wrap = children => (
    <div style={{minHeight:'100vh', background:'#FAF9F6', color:T.ink, padding:'28px 20px', maxWidth:460, margin:'0 auto', textAlign:'left', boxSizing:'border-box'}}>
      <div style={{borderBottom:`3px double ${T.ink}`, paddingBottom:8, marginBottom:22}}>
        <div style={{fontSize:13, color:T.sub}}>홍콩반점 중앙대점</div>
        <h1 style={{fontSize:24, fontWeight:800, margin:'2px 0 0', fontFamily:'inherit'}}>출퇴근</h1>
        <div style={{fontSize:13, color:T.sub, marginTop:2, fontVariantNumeric:'tabular-nums'}}>
          {now.getMonth()+1}월 {now.getDate()}일 ({DAYS_KR[now.getDay()]}){userData?.name ? ` · ${userData.name}` : ''}
        </div>
      </div>
      {children}
    </div>
  )

  if (!userData) return wrap(<div style={{color:T.sub}}>불러오는 중...</div>)
  if (!staffOk) return wrap(
    <div style={{fontSize:15, lineHeight:1.7}}>
      {isStore || isInvestor ? '직원 본인 계정으로 로그인해야 출퇴근을 찍을 수 있어요.' : '아직 가입 승인이 안 됐어요. 사장님께 승인을 요청해 주세요.'}
    </div>
  )
  if (phase === 'working') return wrap(<div style={{fontSize:16, color:T.sub, padding:'30px 0'}}>{msg}</div>)
  if (phase === 'error') return wrap(
    <>
      <div style={{borderLeft:`4px solid ${T.red}`, background:'#B4231810', padding:'14px 16px', borderRadius:'0 4px 4px 0', fontSize:15, lineHeight:1.6, color:T.red, fontWeight:600}}>{msg}</div>
      <button onClick={()=>run(false)} style={{marginTop:16, width:'100%', background:T.accent, color:'#FFFFFF', border:'none', borderRadius:6, padding:'16px 0', fontSize:17, fontWeight:800, fontFamily:'inherit', cursor:'pointer'}}>다시 시도</button>
    </>
  )

  const r = result.rec || {}
  const inD = toDate(r.in), outD = toDate(r.out)
  const c = calcRecord(r)
  const big = (label, time, color) => (
    <div style={{padding:'10px 0 18px'}}>
      <div style={{fontSize:20, fontWeight:800, color}}>{label}</div>
      <div style={{fontSize:56, fontWeight:800, lineHeight:1.1, fontVariantNumeric:'tabular-nums', color}}>{time}</div>
    </div>
  )
  const earlyIn = inD && r.schedStart && (inD.getHours()*60+inD.getMinutes()) < (+r.schedStart.slice(0,2)*60 + +r.schedStart.slice(3)) - GRACE_MIN

  return wrap(
    <>
      {result.kind === 'in' && big(result.undone ? '퇴근을 취소했어요' : '출근했어요', hm(inD), T.green)}
      {result.kind === 'soon' && big('방금 출근했어요', hm(inD), T.green)}
      {result.kind === 'out' && big('퇴근했어요', hm(outD), T.blue)}
      {result.kind === 'already' && big('오늘은 이미 퇴근했어요', hm(outD), T.sub)}

      <div style={{borderTop:`1px solid ${T.rule}`}}>
        {[
          ['예정', r.schedStart ? `${r.schedStart} ~ ${r.schedEnd}` : '오늘 예정 없음'],
          ...(r.breakStart && !r.noBreak ? [['브레이크', `${r.breakStart} ~ ${r.breakEnd} (근무시간에서 빠져요)`]] : []),
          ['출근', hm(inD)],
          ['퇴근', outD ? hm(outD) : '—'],
          ...(c ? [['인정 시간', minsLabel(c.total)]] : []),
        ].map(([k,v])=>(
          <div key={k} style={{display:'flex', justifyContent:'space-between', padding:'10px 0', borderBottom:`1px solid ${T.rule}`, fontSize:16}}>
            <span style={{color:T.sub}}>{k}</span><b style={{fontVariantNumeric:'tabular-nums'}}>{v}</b>
          </div>
        ))}
      </div>

      {(result.kind === 'in' || result.kind === 'soon') && earlyIn && (
        <div style={{marginTop:14, fontSize:14, color:T.amber, lineHeight:1.6}}>
          예정({r.schedStart})보다 {GRACE_MIN}분 넘게 일찍 왔어요. 일찍 온 시간은 사장님이 승인하면 급여에 들어가요.
        </div>
      )}
      {(result.kind === 'in' || result.kind === 'soon') && !r.schedStart && (
        <div style={{marginTop:14, fontSize:14, color:T.amber, lineHeight:1.6}}>오늘은 예정된 근무가 없는 날이에요. 오늘 근무는 사장님이 승인하면 급여에 들어가요.</div>
      )}
      {c?.pending && (
        <div style={{marginTop:14, fontSize:14, color:T.amber, lineHeight:1.6}}>
          {[c.early && r.earlyOk == null && `일찍 온 ${minsLabel(c.early)}`, c.late && r.lateOk == null && `늦게 퇴근한 ${minsLabel(c.late)}`, c.unsched && r.unschedOk == null && `예정 없는 날 근무 ${minsLabel(c.unsched)}`].filter(Boolean).join(', ')}은 사장님 승인 후 급여에 들어가요.
        </div>
      )}

      {result.kind === 'soon' && (
        <button onClick={()=>run(true)} style={{marginTop:20, width:'100%', background:'#FFFFFF', color:T.ink, border:`1px solid ${T.rule}`, borderRadius:6, padding:'14px 0', fontSize:15, fontWeight:700, fontFamily:'inherit', cursor:'pointer'}}>
          지금 퇴근으로 찍기
        </button>
      )}
      {result.kind === 'out' && (
        <button onClick={undoOut} disabled={busy} style={{marginTop:20, width:'100%', background:'#FFFFFF', color:T.red, border:`1px solid #E8C4BF`, borderRadius:6, padding:'14px 0', fontSize:15, fontWeight:700, fontFamily:'inherit', cursor:'pointer'}}>
          잘못 찍었어요 (퇴근 취소)
        </button>
      )}
      <div style={{marginTop:22, fontSize:12, color:T.sub, lineHeight:1.6}}>
        출근할 때 한 번, 퇴근할 때 한 번 매장 입구 태그에 폰을 대면 돼요. 이 창은 닫아도 돼요.
      </div>
    </>
  )
}
