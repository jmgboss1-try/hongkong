import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'
import { HStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { List, ListItem } from '@astryxdesign/core/List'
import { LedgerCard } from '../astryx/AstryxPage'
import { hm, toDate, minsLabel, monthStatus, loadMonthContext } from '../lib/attendance'

const DAYS_KR = ['일','월','화','수','목','금','토']

// 내 기록: 이 달 내 출퇴근 (지각·조퇴·결근)과 개근 포상 결과. 인정 시간·승인 여부는 직원에게 안 보여 줌 (사장님만 근무관리에서)
export default function MyAttendance({ curMonth, uid }) {
  const [data, setData] = useState(null)

  useEffect(() => {
    let off = false
    Promise.all([
      loadMonthContext(curMonth),
      getDoc(doc(db,'users',uid)).then(s => s.exists() ? s.data() : {}),
      getDoc(doc(db,'rewards',curMonth)).then(s => s.exists() ? s.data() : null).catch(() => null),
    ]).then(([ctx, me, reward]) => {
      if (off) return
      const st = monthStatus({ ym:curMonth, uid, user:me, recs:ctx.att[uid], holidays:ctx.holidays, subs:ctx.subs, plan:ctx.plan, since:ctx.since })
      setData({ st, mine: reward?.list?.find(r => r.uid === uid) || null })
    }).catch(e => { console.error(e); if (!off) setData({ error:true }) })
    return () => { off = true }
  }, [curMonth, uid])

  if (!data || data.error) return null
  const { st, mine } = data
  if (!st.days.length && !mine) return null
  const c = st.cnt
  const [y, m] = curMonth.split('-').map(Number)
  const dow = dd => DAYS_KR[new Date(y, m-1, +dd).getDay()]

  return (
    <LedgerCard title="내 출퇴근" right={st.perfect && <Badge variant="success" label={st.monthOver ? `${m}월 개근` : '지금까지 개근 중'}/>}>
      <HStack gap={3} wrap="wrap">
        <Text hasTabularNumbers>출근 <Text weight="bold">{c.worked}</Text>일</Text>
        <Text hasTabularNumbers color={c.late ? 'accent' : 'secondary'}>지각 <Text weight="bold">{c.late}</Text>회{c.late ? ` (${minsLabel(c.lateMins)})` : ''}</Text>
        <Text hasTabularNumbers color={c.leftEarly ? 'accent' : 'secondary'}>조퇴 <Text weight="bold">{c.leftEarly}</Text>회</Text>
        <Text hasTabularNumbers color={c.absent ? 'accent' : 'secondary'}>결근 <Text weight="bold">{c.absent}</Text>일</Text>
      </HStack>
      {mine && <Banner status="success" title={`${m}월 개근 포상: ${mine.prize}${mine.paid ? (/포인트|\dP/i.test(mine.prize) ? ` · ${mine.amount}포인트 받음` : ` · 급여 상여로 ${mine.amount.toLocaleString('ko-KR')}원`) : ''}`}/>}
      <List hasDividers edge="flush">
        {[...st.days].reverse().map(d => (
          <ListItem key={d.dd}
            label={<HStack gap={2} vAlign="center" wrap="wrap">
              <Text color="secondary" hasTabularNumbers>{+d.dd}일 ({dow(d.dd)})</Text>
              {d.rec?.in ? <Text weight="semibold" hasTabularNumbers>{hm(toDate(d.rec.in))} ~ {d.rec.out ? hm(toDate(d.rec.out)) : '—'}</Text> : <Text color="secondary">기록 없음</Text>}
            </HStack>}
            description={d.sched ? `예정 ${d.sched.start}~${d.sched.end||''}` : undefined}
            endContent={<HStack gap={1} wrap="wrap">
              {d.late > 0 && <Badge variant="error" label={`지각 ${minsLabel(d.late)}`}/>}
              {d.leftEarly > 0 && <Badge variant="error" label="조퇴"/>}
              {d.absent && <Badge variant="error" label="결근"/>}
              {d.excused && <Badge label="사유 인정"/>}
              {d.noOut && <Badge variant="warning" label="퇴근 안 찍음"/>}
            </HStack>}/>
        ))}
      </List>
    </LedgerCard>
  )
}
