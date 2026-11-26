import { useEffect, useRef, useState } from 'react'
import { VStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { Divider } from '@astryxdesign/core/Divider'
import { List, ListItem } from '@astryxdesign/core/List'
import { AstryxPage, Legacy } from '../astryx/AstryxPage'
import { db } from '../firebase'
import { doc, getDoc, setDoc, deleteField, serverTimestamp } from 'firebase/firestore'
import { useAuth } from '../AuthContext'
import ClockAvatar from '../components/ClockAvatar'
import { DEFAULT_RADIUS, ymOf, ddOf, hm, toDate, planFor, breakForShift, calcRecord, applyRecord, distanceM, getPosition } from '../lib/attendance'

const DAYS_KR = ['일','월','화','수','목','금','토']

// 매장 입구 NFC 태그가 여는 페이지 (/clock). 열리면 위치를 확인하고 바로 출근 또는 퇴근을 찍음
//  - 오늘 출근 기록이 없으면 출근, 출근만 있으면 퇴근 (출근 2분 안에 다시 대면 실수로 보고 안 찍음)
//  - 자정 넘어 퇴근하면 어제 출근 기록에 퇴근을 붙임
export default function Clock() {
  const { user, userData, isOwner, isStore, isInvestor } = useAuth()
  const [phase, setPhase] = useState('working') // working | done | error
  const [msg, setMsg] = useState('위치를 확인하고 있어요...')
  const [result, setResult] = useState(null)   // { kind:'in'|'out'|'already'|'soon'|'back', rec, ym, dd }
  const [busy, setBusy] = useState(false)
  const [me, setMe] = useState(null)        // 내 users 문서 (아바타·대사용)
  const started = useRef(false)

  // 사장님은 출퇴근을 기록하지 않음 (월급제, 근무관리·스케쥴에도 안 나옴)
  const staffOk = user && userData && !isStore && !isInvestor && !isOwner && !['pending','rejected','retired'].includes(userData.status)

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
      setMe(me)
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
      let forgotYesterday = null
      if (!rec?.in) {
        // 자정 넘어 퇴근: 어제 출근만 있고 지금이 새벽(6시 전)이면 어제 기록에 퇴근
        // (아침에 출근 태그를 했는데 어제 퇴근을 안 찍었으면 어제 기록은 그대로 두고 오늘 출근으로 — 어제 퇴근 시각은 사장님이 근무관리에서 넣음)
        const y = new Date(now); y.setDate(y.getDate()-1)
        const yRec = await readRec(ymOf(y), ddOf(y))
        const yIn = toDate(yRec?.in)
        if (yRec?.in && !yRec.out) {
          if (now.getHours() < 6 && now - yIn < 16*3600*1000) { rec = yRec; tYm = ymOf(y); tDd = ddOf(y) }
          else forgotYesterday = yIn
        }
      }

      if (!rec?.in) {
        // 예정: 근무표(기본 패턴·직접 바꾼 날·일찍 마감) → 없으면 오늘 대타로 확정된 시간
        const todayStr = `${tYm}-${tDd}`
        const cover = subs.find(r => r.confirmedUid === user.uid && r.date === todayStr)
        const sh = planFor(me, now, plan, user.uid) || (cover ? { start:`${cover.startH}:${cover.startM}`, end:`${cover.endH}:${cover.endM}` } : null)
        const br = breakForShift(cfg, now, sh) // 풀타임이면 그날 매장 브레이크를 기록에 붙임 (근무시간에서 빠짐)
        // 일찍 출근 자동 인정 분: 직원 설정 > 매장 기본 (근무관리 설정). 기록에 붙여 둬서 나중에 설정이 바뀌어도 그날 기준 그대로
        const earlyAuto = Math.max(0, +(me?.earlyAuto ?? cfg?.earlyAuto ?? 0) || 0)
        const earlyGrace = cfg?.earlyGrace != null ? Math.max(0, +cfg.earlyGrace || 0) : 10   // 이 분 이내로 일찍 오면 그냥 예정 시각부터
        await write(tYm, tDd, { in: serverTimestamp(), inDist: dist, name: me?.name || '', schedStart: sh?.start || null, schedEnd: sh?.end || null, earlyAuto, earlyGrace,
          ...(br ? { breakStart: br.start, breakEnd: br.end } : {}) })
        setResult({ kind:'in', rec: await readRec(tYm, tDd), ym:tYm, dd:tDd, forgotYesterday })
      } else if (!rec.out) {
        if (!force && now - toDate(rec.splitBack || rec.in) < 2*60*1000) {   // 출근(또는 다시 출근) 2분 안에 또 찍으면 확인
          setResult({ kind:'soon', rec, ym:tYm, dd:tDd })
        } else {
          await write(tYm, tDd, { out: serverTimestamp(), outDist: dist })
          const r = await readRec(tYm, tDd)
          // 근무관리에 근무시간 반영 (권한이 없으면 사장님이 근무관리를 열 때 반영됨)
          try { await applyRecord(tYm, user.uid, tDd, r) } catch(e) { console.warn('근무시간 반영은 근무관리에서', e) }
          setResult({ kind:'out', rec: r, ym:tYm, dd:tDd })
        }
      } else if (!rec.splitBack && now - toDate(rec.out) >= 10*60*1000) {
        // 쪼개 근무 (예: 9:00~13:30, 17:00~21:00): 퇴근한 뒤 10분 넘어 다시 찍으면 다시 출근.
        // 그 사이(퇴근~지금)를 그날 쉬는 시간(브레이크)으로 넣고 퇴근을 지움 → 마지막 퇴근 때 쉬는 시간을 뺀 시간이 계산됨. 하루 한 번만
        const outD = toDate(rec.out)
        await write(tYm, tDd, { out: deleteField(), outDist: deleteField(), breakStart: hm(outD), breakEnd: hm(now), editedBreak: true,
          noBreak: deleteField(), splitBack: serverTimestamp(), splitBackDist: dist })
        setResult({ kind:'back', rec: await readRec(tYm, tDd), ym:tYm, dd:tDd })
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
    <AstryxPage>
    <VStack hAlign="center" minHeight="100vh">
    <VStack padding={5} gap={5} width="100%" maxWidth={460}>
      <VStack gap={0}>
        <Text type="supporting" color="secondary">홍콩반점 중앙대점</Text>
        <Heading level={1}>출퇴근</Heading>
        <Text type="supporting" color="secondary" hasTabularNumbers>{now.getMonth()+1}월 {now.getDate()}일 ({DAYS_KR[now.getDay()]}){userData?.name ? ` · ${userData.name}` : ''}</Text>
      </VStack>
      <Divider variant="strong"/>
      {children}
    </VStack>
    </VStack>
    </AstryxPage>
  )

  if (!userData) return wrap(<Text color="secondary">불러오는 중...</Text>)
  if (!staffOk) return wrap(
    <Text type="large">{isOwner ? '사장님은 출퇴근을 찍지 않아도 돼요. 기록은 남기지 않았어요.' : isStore || isInvestor ? '직원 본인 계정으로 로그인해야 출퇴근을 찍을 수 있어요.' : '아직 가입 승인이 안 됐어요. 사장님께 승인을 요청해 주세요.'}</Text>
  )
  if (phase === 'working') return wrap(<Text type="large" color="secondary">{msg}</Text>)
  if (phase === 'error') return wrap(
    <>
      <Banner status="error" title={msg}/>
      <Button variant="primary" size="lg" width="100%" label="다시 시도" onClick={()=>run(false)}/>
    </>
  )

  const r = result.rec || {}
  const inD = toDate(r.in), outD = toDate(r.out)
  const c = calcRecord(r)
  const big = (label, time, accent) => (
    <VStack gap={0}>
      <Heading level={3}>{label}</Heading>
      <Text type="display-1" color={accent ? 'accent' : 'primary'} hasTabularNumbers>{time}</Text>
    </VStack>
  )
  // 일찍 온 시간 인정 여부는 직원 화면에 안 보여 줌 (사장님이 근무관리에서 정함)

  return wrap(
    <>
      {result.kind === 'in' && big(result.undone ? '퇴근을 취소했어요' : '출근했어요', hm(inD), true)}
      {result.kind === 'soon' && big('방금 출근했어요', hm(inD), true)}
      {result.kind === 'out' && big('퇴근했어요', hm(outD))}
      {result.kind === 'already' && big('오늘은 이미 퇴근했어요', hm(outD))}
      {result.kind === 'back' && big('다시 출근했어요', hm(toDate(r.splitBack)), true)}

      <Legacy><ClockAvatar uid={user?.uid} me={me} kind={result.kind === 'back' ? 'in' : result.kind} rec={r}/></Legacy>

      <List hasDividers edge="flush">
        {[
          ['예정', r.schedStart ? `${r.schedStart} 출근${r.schedEnd ? ` ~ ${r.schedEnd}` : ''}` : '오늘 예정 없음'],
          ...(r.breakStart && !r.noBreak ? [[r.splitBack ? '쉬는 시간' : '브레이크', `${r.breakStart} ~ ${r.breakEnd} (근무시간에서 빠져요)`]] : []),
          ['출근', hm(inD)],
          ...(r.splitBack ? [['다시 출근', hm(toDate(r.splitBack))]] : []),
          ['퇴근', outD ? hm(outD) : '—'],
        ].map(([k,v]) => (
          <ListItem key={k} label={<Text color="secondary">{k}</Text>} endContent={<Text type="large" weight="bold" hasTabularNumbers>{v}</Text>}/>
        ))}
      </List>

      {result.forgotYesterday && (
        <Banner status="error" title={`어제(${hm(result.forgotYesterday)} 출근) 퇴근을 안 찍었어요.`} description="어제 근무시간이 아직 안 들어갔으니 사장님께 퇴근한 시각을 알려 주세요."/>
      )}
      {(result.kind === 'in' || result.kind === 'soon') && !r.schedStart && (
        <Banner status="warning" title="오늘은 예정된 근무가 없는 날이에요." description="오늘 근무는 사장님이 승인하면 급여에 들어가요."/>
      )}
      {/* 인정 시간·일찍 온 시간 승인 여부는 직원 화면에 안 보여 줌. 예정 없는 날 근무만 안내 */}
      {c?.unsched > 0 && r.unschedOk == null && (
        <Banner status="warning" title="오늘은 예정 없는 날 근무라 사장님 승인 후 급여에 들어가요."/>
      )}

      {result.kind === 'soon' && <Button size="lg" width="100%" label="지금 퇴근으로 찍기" onClick={()=>run(true)}/>}
      {result.kind === 'out' && <Button size="lg" variant="destructive" width="100%" label="잘못 찍었어요 (퇴근 취소)" isDisabled={busy} onClick={undoOut}/>}
      <Text type="supporting" color="secondary">출근할 때 한 번, 퇴근할 때 한 번 매장 입구 태그에 폰을 대면 돼요. 이 창은 닫아도 돼요.</Text>
    </>
  )
}
