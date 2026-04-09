import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore'
import { useAuth } from '../AuthContext'

const pad = n => String(n).padStart(2,'0')
const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const DAYS_KR = ['일','월','화','수','목','금','토']
const EMP_COLORS = ['#f9b934','#93c5fd','#34d399','#c4b5fd','#fb923c','#f87171']

function PendingCard({ u, onApprove, onReject }) {
  const [selGrade, setSelGrade] = useState('3')
  const [joinDate, setJoinDate] = useState(u.createdAt?.slice(0,10)||'')
  const [wage, setWage] = useState(10030)
  return (
    <div style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:10,padding:'16px'}}>
      <div style={{marginBottom:12}}>
        <div style={{fontSize:14,fontWeight:700}}>{u.name}</div>
        <div style={{fontSize:11,color:'#5e6585',marginTop:2}}>{u.email}</div>
        <div style={{fontSize:10,color:'#5e6585',marginTop:2}}>가입 신청일: {u.createdAt?.slice(0,10)}</div>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10,marginBottom:12}}>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          <label style={{fontSize:10,color:'#5e6585',fontWeight:600}}>등급</label>
          <select value={selGrade} onChange={e=>setSelGrade(e.target.value)}
            style={{background:'#0b0d16',border:'1px solid #272a3d',borderRadius:6,color:'#dde1f2',padding:'7px 10px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
            <option value="1">🌟 대선배 (1년↑)</option>
            <option value="2">⭐ 고오급인력 (6개월~1년)</option>
            <option value="3">🐣 병아리 (6개월↓)</option>
          </select>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          <label style={{fontSize:10,color:'#5e6585',fontWeight:600}}>입사일</label>
          <input type="date" value={joinDate} onChange={e=>setJoinDate(e.target.value)}
            style={{background:'#0b0d16',border:'1px solid #272a3d',borderRadius:6,color:'#dde1f2',padding:'7px 10px',fontSize:12,fontFamily:'inherit',outline:'none'}}/>
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          <label style={{fontSize:10,color:'#5e6585',fontWeight:600}}>시급 (원)</label>
          <input type="number" value={wage} onChange={e=>setWage(+e.target.value)}
            style={{background:'#0b0d16',border:'1px solid #272a3d',borderRadius:6,color:'#dde1f2',padding:'7px 10px',fontSize:12,fontFamily:'inherit',outline:'none'}}/>
        </div>
      </div>
      <div style={{display:'flex',gap:8}}>
        <button onClick={()=>onApprove(u,selGrade,joinDate,wage)}
          style={{background:'#34d399',color:'#000',border:'none',borderRadius:6,padding:'8px 18px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
          ✅ 승인
        </button>
        <button onClick={()=>onReject(u.uid)}
          style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',borderRadius:6,padding:'8px 18px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
          거절
        </button>
      </div>
    </div>
  )
}

export default function Staff() {
  const { isOwner } = useAuth()
  const [curMonth, setCurMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [employees, setEmployees] = useState([])
  const [pending, setPending] = useState([])
  const [checkins, setCheckins] = useState({})
  const [events, setEvents] = useState({})
  const [loading, setLoading] = useState(true)
  const [activeDay, setActiveDay] = useState(null)

  const monthOpts = []
  for(let y=2022;y<=2026;y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  async function load() {
    setLoading(true)
    try {
      // 직원목록 — meta/employees 와 members 컬렉션 통합
      const empSnap = await getDoc(doc(db,'meta','employees'))
      const metaEmps = empSnap.exists() ? empSnap.data().list||[] : []

      // members 컬렉션에서도 불러오기
      const memSnap = await getDocs(collection(db,'members'))
      const memEmps = []
      memSnap.forEach(d => memEmps.push({...d.data(), uid:d.id}))

      // 두 목록 병합 (uid 기준, 중복 제거)
      const allUids = new Set(metaEmps.map(e=>e.uid))
      const merged = [...metaEmps]
      memEmps.forEach(m => {
        if(!allUids.has(m.uid)) merged.push(m)
      })
      setEmployees(merged)

      // meta/employees 에 members 정보 동기화
      if(memEmps.length > 0 && merged.length > metaEmps.length) {
        await setDoc(doc(db,'meta','employees'), {list: merged})
      }

      const evSnap = await getDoc(doc(db,'events',curMonth))
      setEvents(evSnap.exists() ? evSnap.data() : {})

      // 출퇴근 기록
      const q = query(collection(db,'checkin'), where('month','==',curMonth))
      const snap = await getDocs(q)
      const ci = {}
      snap.forEach(d => {
        const data = d.data()
        if(!ci[data.uid]) ci[data.uid] = {}
        ci[data.uid][data.date] = data
      })
      setCheckins(ci)

      if(isOwner) {
        const pq = query(collection(db,'users'), where('status','==','pending'))
        const pSnap = await getDocs(pq)
        const list = []
        pSnap.forEach(d => list.push({uid:d.id,...d.data()}))
        setPending(list)
      }
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [curMonth])

  async function saveEmployees(list) {
    await setDoc(doc(db,'meta','employees'), { list })
    setEmployees(list)
  }
  async function saveEvents(newEv) {
    await setDoc(doc(db,'events',curMonth), newEv)
    setEvents(newEv)
  }
  async function approveUser(u, grade, joinDate, wage) {
    await setDoc(doc(db,'users',u.uid), {
      ...u, status:'approved', grade:+grade, wage:+wage||10030, joinDate:joinDate||''
    })
    const updated = [...employees, {uid:u.uid, name:u.name, wage:+wage||10030, phone:'', email:u.email, joinDate:joinDate||''}]
    await saveEmployees(updated)
    setPending(p => p.filter(x=>x.uid!==u.uid))
  }
  async function rejectUser(uid) {
    await setDoc(doc(db,'users',uid), {status:'rejected'}, {merge:true})
    setPending(p => p.filter(x=>x.uid!==uid))
  }
  async function updEvent(dd, text) {
    const newEv = {...events, [dd]: text}
    if(!text) delete newEv[dd]
    await saveEvents(newEv)
  }
  async function delEmp(uid) {
    if(!window.confirm('정말 삭제하시겠습니까?')) return
    await saveEmployees(employees.filter(e=>e.uid!==uid))
  }

  const days = daysIn(curMonth)
  const [cy,cm] = curMonth.split('-').map(Number)
  const firstDow = new Date(cy,cm-1,1).getDay()
  const now = new Date()
  const isThisMonth = now.getFullYear()===cy && now.getMonth()+1===cm

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>📅 스케쥴</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>{mLabel(curMonth)} 공통 달력</div>
        </div>
        <select value={curMonth} onChange={e=>setCurMonth(e.target.value)}
          style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,color:'#dde1f2',padding:'8px 12px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
          {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
        </select>
      </div>

      {/* 사장: 승인 대기 */}
      {isOwner && pending.length>0 && (
        <div style={{background:'#12141f',border:'1px solid #f9b934',borderRadius:12,marginBottom:18}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,color:'#f9b934',display:'flex',alignItems:'center',gap:8}}>
            ⏳ 가입 승인 대기
            <span style={{background:'#f9b934',color:'#000',borderRadius:999,fontSize:10,fontWeight:700,padding:'2px 7px'}}>{pending.length}</span>
          </div>
          <div style={{padding:18,display:'flex',flexDirection:'column',gap:12}}>
            {pending.map(u=><PendingCard key={u.uid} u={u} onApprove={approveUser} onReject={rejectUser}/>)}
          </div>
        </div>
      )}

      {/* 사장: 직원 목록 */}
      {isOwner && (
        <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,marginBottom:18}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span>직원 목록 <span style={{fontSize:10,color:'#5e6585'}}>(인원관리 탭에서 추가/수정)</span></span>
          </div>
          {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:30}}>로딩 중...</div> : (
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:12,padding:18}}>
              {employees.length===0 && <div style={{color:'#5e6585',fontSize:12}}>등록된 직원이 없습니다</div>}
              {employees.map((e,idx)=>(
                <div key={e.uid} style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:10,padding:14,display:'flex',flexDirection:'column',gap:5}}>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <div style={{width:10,height:10,borderRadius:3,background:EMP_COLORS[idx%EMP_COLORS.length],flexShrink:0}}></div>
                    <div style={{fontSize:14,fontWeight:700}}>{e.name}</div>
                  </div>
                  <div style={{fontSize:10,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>{(e.wage||10030).toLocaleString()}원/h</div>
                  <div style={{fontSize:10,color:'#5e6585'}}>시급수정 → 인원관리 탭</div>
                  <div style={{display:'flex',gap:6,marginTop:4}}>
                    <button onClick={()=>delEmp(e.uid)}
                      style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',padding:'3px 8px',fontSize:10,borderRadius:5,cursor:'pointer',fontFamily:'inherit'}}>삭제</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 공통 달력 */}
      <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8}}>
          <span style={{fontSize:13,fontWeight:600}}>📅 {mLabel(curMonth)} 출근 현황</span>
          <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
            {employees.map((e,idx)=>(
              <div key={e.uid} style={{display:'flex',alignItems:'center',gap:4,fontSize:10}}>
                <div style={{width:8,height:8,borderRadius:'50%',background:EMP_COLORS[idx%EMP_COLORS.length]}}></div>
                <span style={{color:'#dde1f2'}}>{e.name}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{padding:14}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3,marginBottom:3}}>
            {DAYS_KR.map((d,i)=>(
              <div key={d} style={{textAlign:'center',fontSize:10,fontWeight:700,padding:'6px 0',
                color:i===0?'#f87171':i===6?'#93c5fd':'#5e6585'}}>{d}</div>
            ))}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3}}>
            {(()=>{
              const cells=[]
              for(let i=0;i<firstDow;i++) cells.push(null)
              for(let d=1;d<=days;d++) cells.push(d)
              while(cells.length%7!==0) cells.push(null)
              return cells.map((d,idx)=>{
                if(!d) return <div key={idx}></div>
                const dd=pad(d)
                const dow=idx%7
                const isToday=isThisMonth&&d===now.getDate()
                const isActive=activeDay===dd
                const event=events[dd]

                // 출퇴근 기록 기반으로 출근 직원 표시
                const dayCheckins=employees.map((e,ei)=>{
                  const ci=(checkins[e.uid]||{})[dd]
                  if(!ci) return null
                  return {emp:e, idx:ei, ci}
                }).filter(Boolean)

                return(
                  <div key={idx}
                    onClick={()=>isOwner&&setActiveDay(isActive?null:dd)}
                    style={{
                      background:isActive?'rgba(249,185,52,0.08)':'#191c2b',
                      border:isActive?'1px solid #f9b934':isToday?'1px solid rgba(249,185,52,0.5)':'1px solid #272a3d',
                      borderRadius:8,padding:'6px',minHeight:90,
                      cursor:isOwner?'pointer':'default',transition:'.15s'
                    }}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}>
                      <div style={{fontSize:11,fontWeight:700,fontFamily:'DM Mono,monospace',
                        color:dow===0?'#f87171':dow===6?'#93c5fd':isToday?'#f9b934':'#dde1f2'}}>{d}</div>
                      {isToday&&<div style={{width:5,height:5,borderRadius:'50%',background:'#f9b934'}}></div>}
                    </div>

                    {event&&!isActive&&(
                      <div style={{background:'rgba(249,185,52,0.15)',color:'#f9b934',fontSize:8,padding:'2px 4px',borderRadius:3,marginBottom:3,lineHeight:1.4}}>
                        📌 {event}
                      </div>
                    )}

                    {/* 출근 직원 표시 */}
                    {!isActive&&(
                      <div style={{display:'flex',flexDirection:'column',gap:2}}>
                        {dayCheckins.map(({emp,idx:ei,ci})=>(
                          <div key={emp.uid} style={{
                            background:EMP_COLORS[ei%EMP_COLORS.length]+'26',
                            borderLeft:`2px solid ${EMP_COLORS[ei%EMP_COLORS.length]}`,
                            borderRadius:3,padding:'2px 4px',fontSize:8,fontWeight:700,
                            color:EMP_COLORS[ei%EMP_COLORS.length],
                          }}>
                            {emp.name.charAt(0)} {ci.checkinTime?.replace('오전 ','').replace('오후 ','')||''}
                            {ci.checkoutTime&&` ~ ${ci.checkoutTime?.replace('오전 ','').replace('오후 ','')}`}
                          </div>
                        ))}
                        {dayCheckins.length===0&&<div style={{fontSize:8,color:'#272a3d'}}>출근 없음</div>}
                      </div>
                    )}

                    {/* 사장: 클릭시 이벤트 입력 + 상세 */}
                    {isActive&&isOwner&&(
                      <div onClick={e=>e.stopPropagation()} style={{display:'flex',flexDirection:'column',gap:6,marginTop:4}}>
                        <input defaultValue={event||''} placeholder="매장일정..."
                          onBlur={e=>updEvent(dd,e.target.value)}
                          style={{width:'100%',background:'rgba(249,185,52,0.1)',border:'1px solid rgba(249,185,52,0.3)',borderRadius:4,color:'#f9b934',padding:'3px 5px',fontSize:9,outline:'none',fontFamily:'inherit'}}/>
                        <div style={{fontSize:9,color:'#5e6585',lineHeight:1.8}}>
                          {dayCheckins.length>0 ? (
                            dayCheckins.map(({emp,ci})=>(
                              <div key={emp.uid}>
                                <span style={{color:'#dde1f2',fontWeight:700}}>{emp.name}</span>
                                {' '}{ci.checkinTime||'?'} ~ {ci.checkoutTime||'근무중'}
                              </div>
                            ))
                          ) : <span>출근 기록 없음</span>}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })
            })()}
          </div>
        </div>
      </div>
    </div>
  )
}
