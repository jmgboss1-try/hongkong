import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'
import { useAuth } from '../AuthContext'

const pad = n => String(n).padStart(2,'0')
const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }

export default function MySchedule() {
  const { user, userData } = useAuth()
  const [curMonth, setCurMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [schedData, setSchedData] = useState({})
  const [wage, setWage] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        // 스케쥴 불러오기
        const schRef = doc(db, 'schedule', curMonth)
        const schSnap = await getDoc(schRef)
        if (schSnap.exists()) {
          const data = schSnap.data()
          setSchedData(data[user.uid] || {})
        } else {
          setSchedData({})
        }
        // 시급 불러오기
        const userRef = doc(db, 'users', user.uid)
        const userSnap = await getDoc(userRef)
        if (userSnap.exists()) {
          setWage(userSnap.data().wage || 0)
        }
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [curMonth, user.uid])

  const days = daysIn(curMonth)
  const totalHours = Object.values(schedData).reduce((a,b)=>a+b,0)
  const totalWage = Math.round(totalHours * wage)

  // 월 선택 옵션
  const monthOpts = []
  for(let y=2022; y<=2026; y++) {
    const sm = y===2022 ? 10 : 1
    for(let m=sm; m<=12; m++) {
      const ym = `${y}-${pad(m)}`
      monthOpts.push(ym)
    }
  }

  const now = new Date()
  const isThisMonth = curMonth === `${now.getFullYear()}-${pad(now.getMonth()+1)}`

  return (
    <div>
      <div style={{display:'flex', alignItems:'flex-end', justifyContent:'space-between', marginBottom:22}}>
        <div>
          <div style={{fontSize:20, fontWeight:700}}>📅 내 스케쥴</div>
          <div style={{fontSize:12, color:'#5e6585', marginTop:2}}>{userData?.name} · {userData?.grade}등급</div>
        </div>
        <select value={curMonth} onChange={e=>setCurMonth(e.target.value)}
          style={{background:'#191c2b', border:'1px solid #272a3d', borderRadius:8,
            color:'#dde1f2', padding:'8px 12px', fontSize:12, fontFamily:'inherit', outline:'none'}}>
          {monthOpts.map(m => <option key={m} value={m}>{mLabel(m)}</option>)}
        </select>
      </div>

      {/* 요약 카드 */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:14, marginBottom:20}}>
        {[
          { label:'총 근무일', value: Object.keys(schedData).filter(d=>schedData[d]>0).length + '일', color:'#f9b934' },
          { label:'총 근무시간', value: totalHours + '시간', color:'#93c5fd' },
          { label:'예상 급여', value: totalWage.toLocaleString() + '원', color:'#34d399' },
        ].map(k => (
          <div key={k.label} style={{background:'#12141f', border:'1px solid #272a3d', borderRadius:12, padding:'18px 20px', position:'relative', overflow:'hidden'}}>
            <div style={{position:'absolute', top:0, left:0, right:0, height:3, background:k.color}}></div>
            <div style={{fontSize:10, fontWeight:600, color:'#5e6585', textTransform:'uppercase', letterSpacing:.8, marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:22, fontWeight:700, color:k.color, fontFamily:'DM Mono, monospace'}}>{k.value}</div>
            <div style={{fontSize:10, color:'#5e6585', marginTop:4}}>시급 {wage.toLocaleString()}원</div>
          </div>
        ))}
      </div>

      {/* 달력 */}
      <div style={{background:'#12141f', border:'1px solid #272a3d', borderRadius:12, padding:'20px'}}>
        <div style={{fontSize:13, fontWeight:600, marginBottom:14}}>{mLabel(curMonth)} 근무 현황</div>

        {loading ? <div style={{textAlign:'center', color:'#5e6585', padding:40}}>로딩 중...</div> : (
          <>
            <div style={{display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:3, marginBottom:3}}>
              {['일','월','화','수','목','금','토'].map((d,i) => (
                <div key={d} style={{textAlign:'center', fontSize:10, fontWeight:700, padding:'6px 0',
                  color: i===0?'#f87171': i===6?'#93c5fd':'#5e6585'}}>{d}</div>
              ))}
            </div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:3}}>
              {(() => {
                const [cy,cm] = curMonth.split('-').map(Number)
                const firstDow = new Date(cy,cm-1,1).getDay()
                const cells = []
                for(let i=0;i<firstDow;i++) cells.push(null)
                for(let d=1;d<=days;d++) cells.push(d)
                while(cells.length%7!==0) cells.push(null)
                return cells.map((d,idx) => {
                  if(!d) return <div key={idx}></div>
                  const dd = pad(d)
                  const h = schedData[dd] || 0
                  const dow = idx%7
                  const isToday = isThisMonth && d===now.getDate()
                  return (
                    <div key={idx} style={{
                      background: h>0 ? 'rgba(249,185,52,0.12)' : '#191c2b',
                      border: isToday ? '1px solid #f9b934' : h>0 ? '1px solid rgba(249,185,52,0.3)' : '1px solid #272a3d',
                      borderRadius:8, padding:'8px 6px', minHeight:64,
                      display:'flex', flexDirection:'column', alignItems:'center', gap:4
                    }}>
                      <div style={{fontSize:11, fontWeight:700,
                        color: dow===0?'#f87171': dow===6?'#93c5fd': isToday?'#f9b934':'#dde1f2',
                        fontFamily:'DM Mono, monospace'}}>{d}</div>
                      {h>0 && (
                        <>
                          <div style={{fontSize:10, fontWeight:700, color:'#f9b934', fontFamily:'DM Mono, monospace'}}>{h}h</div>
                          <div style={{fontSize:9, color:'#34d399', fontFamily:'DM Mono, monospace'}}>{Math.round(h*wage).toLocaleString()}원</div>
                        </>
                      )}
                      {!h && <div style={{fontSize:9, color:'#272a3d'}}>휴무</div>}
                    </div>
                  )
                })
              })()}
            </div>
          </>
        )}
      </div>
    </div>
  )
}