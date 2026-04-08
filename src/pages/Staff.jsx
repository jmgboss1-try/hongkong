import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')

function parseTimeDiff(inTime, outTime) {
  try {
    const parse = t => {
      if(!t) return 0
      const isPM = t.includes('오후')
      const clean = t.replace('오전 ','').replace('오후 ','')
      const [h,m] = clean.split(':').map(Number)
      return (h%12+(isPM?12:0))*60+m
    }
    const diff = parse(outTime)-parse(inTime)
    if(diff<=0) return '—'
    return `${Math.floor(diff/60)}h ${diff%60}m`
  } catch { return '—' }
}

function CheckinRecords({ month, employees }) {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [selEmp, setSelEmp] = useState('all')

  useEffect(()=>{
    async function load() {
      setLoading(true)
      try {
        const { collection, query, where, getDocs } = await import('firebase/firestore')
        const { db } = await import('../firebase')
        const q = query(collection(db,'checkin'), where('month','==',month))
        const snap = await getDocs(q)
        const list = []
        snap.forEach(d=>list.push(d.data()))
        setRecords(list.sort((a,b)=>a.date>b.date?1:a.date<b.date?-1:0))
      } catch(e){ console.error(e) }
      setLoading(false)
    }
    load()
  },[month])

  const filtered = selEmp==='all' ? records : records.filter(r=>r.uid===selEmp)

  return (
    <div>
      {/* 직원 필터 */}
      <div style={{padding:'12px 18px',borderBottom:'1px solid #272a3d',display:'flex',gap:8,flexWrap:'wrap'}}>
        <button onClick={()=>setSelEmp('all')}
          style={{padding:'5px 12px',borderRadius:6,border:'none',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
            background:selEmp==='all'?'#f9b934':'#191c2b',color:selEmp==='all'?'#000':'#5e6585'}}>
          전체
        </button>
        {employees.map(e=>(
          <button key={e.uid} onClick={()=>setSelEmp(e.uid)}
            style={{padding:'5px 12px',borderRadius:6,border:'none',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
              background:selEmp===e.uid?'#f9b934':'#191c2b',color:selEmp===e.uid?'#000':'#5e6585'}}>
            {e.name}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{textAlign:'center',color:'#5e6585',padding:30}}>로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div style={{textAlign:'center',color:'#5e6585',padding:30}}>기록이 없습니다</div>
      ) : (
        <div style={{overflowX:'auto'}}>
          <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
            <thead>
              <tr style={{background:'#191c2b'}}>
                {['날짜','직원','출근','퇴근','근무시간'].map(h=>(
                  <th key={h} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:'#5e6585',
                    textAlign:h==='날짜'||h==='직원'?'left':'right',whiteSpace:'nowrap'}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r,i)=>(
                <tr key={i}>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',color:'#dde1f2'}}>{+r.date}일</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',color:'#dde1f2',fontFamily:'Noto Sans KR,sans-serif'}}>{r.name}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace',color:'#34d399'}}>{r.checkinTime||'—'}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace',color:'#f87171'}}>{r.checkoutTime||'—'}</td>
                  <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace',color:'#f9b934'}}>
                    {r.checkinTime&&r.checkoutTime ? parseTimeDiff(r.checkinTime,r.checkoutTime) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const DAYS_KR = ['일','월','화','수','목','금','토']

const SHIFT_TYPES = {
  morning: { label:'오전근무', color:'#3b82f6', bg:'rgba(59,130,246,0.15)', text:'#93c5fd' },
  afternoon: { label:'오후근무', color:'#ef4444', bg:'rgba(239,68,68,0.15)', text:'#f87171' },
  sub: { label:'대타근무', color:'#e5e7eb', bg:'rgba(229,231,235,0.15)', text:'#e5e7eb' },
}

const EMP_COLORS = ['#f9b934','#93c5fd','#34d399','#c4b5fd','#fb923c','#f87171']

function PendingCard({ u, onApprove, onReject }) {
  const [selGrade, setSelGrade] = useState('3')
  const [joinDate, setJoinDate] = useState(u.createdAt?.slice(0,10) || '')
  const [wage, setWage] = useState(10030)

  return (
    <div style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:10,padding:'16px'}}>
      <div style={{display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:8,marginBottom:12}}>
        <div>
          <div style={{fontSize:14,fontWeight:700}}>{u.name}</div>
          <div style={{fontSize:11,color:'#5e6585',marginTop:2}}>{u.email}</div>
          <div style={{fontSize:10,color:'#5e6585',marginTop:2}}>가입 신청일: {u.createdAt?.slice(0,10)}</div>
        </div>
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
        <button onClick={()=>onApprove(u, selGrade, joinDate, wage)}
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
  const [curMonth, setCurMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [employees, setEmployees] = useState([])
  const [pending, setPending] = useState([])
  const [schData, setSchData] = useState({})
  const [events, setEvents] = useState({})
  const [loading, setLoading] = useState(true)
  const [activeDay, setActiveDay] = useState(null)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newWage, setNewWage] = useState(10030)
  const [newPhone, setNewPhone] = useState('')
  const [newEmail, setNewEmail] = useState('')

  const monthOpts = []
  for(let y=2022;y<=2026;y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  async function load() {
    setLoading(true)
    try {
      const empSnap = await getDoc(doc(db,'meta','employees'))
      setEmployees(empSnap.exists() ? empSnap.data().list||[] : [])
      const schSnap = await getDoc(doc(db,'schedule',curMonth))
      setSchData(schSnap.exists() ? schSnap.data() : {})
      const evSnap = await getDoc(doc(db,'events',curMonth))
      setEvents(evSnap.exists() ? evSnap.data() : {})
      const q = query(collection(db,'users'), where('status','==','pending'))
      const pendingSnap = await getDocs(q)
      const list = []
      pendingSnap.forEach(d => list.push({uid:d.id,...d.data()}))
      setPending(list)
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [curMonth])

  async function saveEmployees(list) {
    await setDoc(doc(db,'meta','employees'), { list })
    setEmployees(list)
  }

  async function saveSched(newSch) {
    await setDoc(doc(db,'schedule',curMonth), newSch)
    setSchData(newSch)
  }

  async function saveEvents(newEv) {
    await setDoc(doc(db,'events',curMonth), newEv)
    setEvents(newEv)
  }

  async function approveUser(u, grade, joinDate, wage) {
  await setDoc(doc(db,'users',u.uid), {
    ...u,
    status:'approved',
    grade:+grade,
    wage:+wage||10030,
    joinDate: joinDate||''
  })
  const updated = [...employees, {uid:u.uid, name:u.name, wage:+wage||10030, phone:'', email:u.email, joinDate:joinDate||''}]
  await saveEmployees(updated)
  setPending(p => p.filter(x=>x.uid!==u.uid))
}

  async function rejectUser(uid) {
    await setDoc(doc(db,'users',uid), {status:'rejected'}, {merge:true})
    setPending(p => p.filter(x=>x.uid!==uid))
  }

  async function updShift(uid, dd, shiftType) {
    const newSch = {...schData}
    if (!newSch[uid]) newSch[uid] = {}
    if (newSch[uid][dd] === shiftType) {
      delete newSch[uid][dd]
    } else {
      newSch[uid][dd] = shiftType
    }
    await saveSched(newSch)
  }

  async function updEvent(dd, text) {
    const newEv = {...events, [dd]: text}
    if (!text) delete newEv[dd]
    await saveEvents(newEv)
  }

  async function addEmp() {
    if(!newName.trim()) return alert('이름을 입력해주세요')
    const newEmp = {uid:Date.now().toString(), name:newName.trim(), wage:+newWage||10030, phone:newPhone.trim(), email:newEmail.trim()}
    await saveEmployees([...employees, newEmp])
    setNewName(''); setNewWage(10030); setNewPhone(''); setNewEmail('')
    setShowAdd(false)
  }

  async function delEmp(uid) {
    if(!window.confirm('정말 삭제하시겠습니까?')) return
    await saveEmployees(employees.filter(e=>e.uid!==uid))
  }

  async function updateWage(uid, wage) {
    await saveEmployees(employees.map(e=>e.uid===uid?{...e,wage:+wage}:e))
  }

  const days = daysIn(curMonth)
  const [cy,cm] = curMonth.split('-').map(Number)
  const firstDow = new Date(cy,cm-1,1).getDay()
  const now = new Date()
  const isThisMonth = now.getFullYear()===cy && now.getMonth()+1===cm

  const schedTotals = employees.reduce((acc,e) => {
    const empSch = schData[e.uid]||{}
    const workDays = Object.keys(empSch).filter(d=>empSch[d]).length
    acc[e.uid] = { workDays }
    return acc
  }, {})

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>👥 인원 · 스케쥴</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>{mLabel(curMonth)}</div>
        </div>
        <select value={curMonth} onChange={e=>setCurMonth(e.target.value)}
          style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,color:'#dde1f2',padding:'8px 12px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
          {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
        </select>
      </div>

      {/* 승인 대기 */}
      {pending.length > 0 && (
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

      {/* 직원 목록 */}
      <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,marginBottom:18}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span>직원 목록</span>
          <button onClick={()=>setShowAdd(v=>!v)}
            style={{background:'#f9b934',color:'#000',border:'none',borderRadius:6,padding:'5px 14px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
            + 직접 추가
          </button>
        </div>
        {showAdd && (
          <div style={{padding:18,borderBottom:'1px solid #272a3d',display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:10}}>
            {[['이름',newName,setNewName,'text'],['시급',newWage,setNewWage,'number'],['연락처',newPhone,setNewPhone,'text'],['이메일',newEmail,setNewEmail,'email']].map(([label,val,set,type])=>(
              <div key={label} style={{display:'flex',flexDirection:'column',gap:4}}>
                <label style={{fontSize:10,color:'#5e6585',fontWeight:600}}>{label}</label>
                <input type={type} value={val} onChange={e=>set(e.target.value)}
                  style={{background:'#0b0d16',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',padding:'8px 10px',fontSize:12,outline:'none'}}/>
              </div>
            ))}
            <div style={{display:'flex',alignItems:'flex-end',gap:8}}>
              <button onClick={addEmp} style={{background:'#f9b934',color:'#000',border:'none',borderRadius:7,padding:'9px 14px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>추가</button>
              <button onClick={()=>setShowAdd(false)} style={{background:'#191c2b',color:'#5e6585',border:'1px solid #272a3d',borderRadius:7,padding:'9px 14px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>취소</button>
            </div>
          </div>
        )}
        {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:30}}>로딩 중...</div> : (
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:12,padding:18}}>
            {employees.length===0 && <div style={{color:'#5e6585',fontSize:12}}>등록된 직원이 없습니다</div>}
            {employees.map((e,idx)=>{
              const s = schedTotals[e.uid]||{workDays:0}
              return (
                <div key={e.uid} style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:10,padding:14,display:'flex',flexDirection:'column',gap:5}}>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <div style={{width:10,height:10,borderRadius:3,background:EMP_COLORS[idx%EMP_COLORS.length],flexShrink:0}}></div>
                    <div style={{fontSize:14,fontWeight:700}}>{e.name}</div>
                  </div>
                  <div style={{fontSize:10,color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{(e.wage||10030).toLocaleString()}원/h</div>
                  <div style={{fontSize:11,color:'#5e6585'}}>{mLabel(curMonth)} {s.workDays}일 근무</div>
                  <div style={{display:'flex',gap:6,marginTop:4}}>
                    <button onClick={()=>{const w=prompt(`${e.name} 시급:`,e.wage);if(w)updateWage(e.uid,w)}}
                      style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',padding:'3px 8px',fontSize:10,borderRadius:5,cursor:'pointer',fontFamily:'inherit'}}>시급수정</button>
                    <button onClick={()=>delEmp(e.uid)}
                      style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',padding:'3px 8px',fontSize:10,borderRadius:5,cursor:'pointer',fontFamily:'inherit'}}>삭제</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 달력 */}
      <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontSize:13,fontWeight:600}}>📅 {mLabel(curMonth)} 스케쥴</span>
          {/* 범례 */}
          <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap'}}>
            {Object.entries(SHIFT_TYPES).map(([k,v])=>(
              <div key={k} style={{display:'flex',alignItems:'center',gap:4,fontSize:10}}>
                <div style={{width:10,height:10,borderRadius:2,background:v.color}}></div>
                <span style={{color:'#5e6585'}}>{v.label}</span>
              </div>
            ))}
          </div>
        </div>
        {/* 출퇴근 기록 조회 */}
      <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,marginTop:18}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>
          🕐 직원 출퇴근 기록 — {mLabel(curMonth)}
        </div>
        <CheckinRecords month={curMonth} employees={employees}/>
      </div>
    </div>
  )
}

        {/* 직원 범례 */}
        <div style={{padding:'10px 18px',borderBottom:'1px solid #272a3d',display:'flex',flexWrap:'wrap',gap:10}}>
          {employees.map((e,idx)=>(
            <div key={e.uid} style={{display:'flex',alignItems:'center',gap:5,fontSize:11}}>
              <div style={{width:8,height:8,borderRadius:2,background:EMP_COLORS[idx%EMP_COLORS.length]}}></div>
              <span style={{color:'#dde1f2'}}>{e.name}</span>
            </div>
          ))}
        </div>

        <div style={{padding:14}}>
          {/* 요일 헤더 */}
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3,marginBottom:3}}>
            {DAYS_KR.map((d,i)=>(
              <div key={d} style={{textAlign:'center',fontSize:10,fontWeight:700,padding:'6px 0',
                color:i===0?'#f87171':i===6?'#93c5fd':'#5e6585'}}>{d}</div>
            ))}
          </div>

          {/* 날짜 셀 */}
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

                // 이 날 근무하는 직원들
                const dayShifts=employees.map((e,ei)=>{
                  const shift=(schData[e.uid]||{})[dd]
                  if(!shift) return null
                  return {emp:e, idx:ei, shift}
                }).filter(Boolean)

                return(
                  <div key={idx} onClick={()=>setActiveDay(isActive?null:dd)}
                    style={{
                      background:isActive?'rgba(249,185,52,0.08)':'#191c2b',
                      border:isActive?'1px solid #f9b934':isToday?'1px solid rgba(249,185,52,0.5)':'1px solid #272a3d',
                      borderRadius:8,padding:'6px',minHeight:100,cursor:'pointer',transition:'.15s',position:'relative'
                    }}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:3}}>
                      <div style={{fontSize:11,fontWeight:700,fontFamily:'DM Mono, monospace',
                        color:dow===0?'#f87171':dow===6?'#93c5fd':isToday?'#f9b934':'#dde1f2'}}>{d}</div>
                      {isToday&&<div style={{width:5,height:5,borderRadius:'50%',background:'#f9b934'}}></div>}
                    </div>

                    {/* 매장 이벤트 */}
                    {event&&!isActive&&(
                      <div style={{background:'rgba(249,185,52,0.15)',color:'#f9b934',fontSize:8,padding:'2px 4px',borderRadius:3,marginBottom:3,lineHeight:1.4,wordBreak:'break-all'}}>
                        📌 {event}
                      </div>
                    )}

                    {/* 근무 라벨 */}
                    {!isActive&&(
                      <div style={{display:'flex',flexDirection:'column',gap:2}}>
                        {dayShifts.map(({emp,idx:ei,shift})=>(
                          <div key={emp.uid} style={{
                            background:SHIFT_TYPES[shift]?.bg||'rgba(100,100,100,0.2)',
                            borderLeft:`2px solid ${EMP_COLORS[ei%EMP_COLORS.length]}`,
                            borderRadius:3,padding:'2px 4px',fontSize:8,fontWeight:700,
                            color:SHIFT_TYPES[shift]?.text||'#dde1f2',
                            display:'flex',alignItems:'center',gap:3
                          }}>
                            <span>{emp.name.charAt(0)}</span>
                            <span style={{fontSize:7,opacity:.8}}>{SHIFT_TYPES[shift]?.label||shift}</span>
                          </div>
                        ))}
                        {dayShifts.length===0&&<div style={{fontSize:8,color:'#272a3d'}}>휴무</div>}
                      </div>
                    )}

                    {/* 클릭시 입력 패널 */}
                    {isActive&&(
                      <div onClick={e=>e.stopPropagation()} style={{display:'flex',flexDirection:'column',gap:6,marginTop:4}}>
                        {/* 매장 이벤트 입력 */}
                        <input
                          defaultValue={event||''}
                          placeholder="매장일정 입력..."
                          onBlur={e=>updEvent(dd,e.target.value)}
                          style={{width:'100%',background:'rgba(249,185,52,0.1)',border:'1px solid rgba(249,185,52,0.3)',borderRadius:4,color:'#f9b934',padding:'3px 5px',fontSize:9,outline:'none',fontFamily:'inherit'}}
                        />
                        {/* 직원 근무 유형 선택 */}
                        {employees.map((e,ei)=>{
                          const currentShift=(schData[e.uid]||{})[dd]
                          return(
                            <div key={e.uid}>
                              <div style={{fontSize:9,color:EMP_COLORS[ei%EMP_COLORS.length],fontWeight:700,marginBottom:2}}>{e.name}</div>
                              <div style={{display:'flex',gap:2,flexWrap:'wrap'}}>
                                {Object.entries(SHIFT_TYPES).map(([k,v])=>(
                                  <button key={k} onClick={()=>updShift(e.uid,dd,k)}
                                    style={{
                                      padding:'2px 5px',fontSize:8,borderRadius:3,cursor:'pointer',fontFamily:'inherit',fontWeight:600,
                                      background:currentShift===k?v.color:'transparent',
                                      color:currentShift===k?'#000':v.text,
                                      border:`1px solid ${v.color}`
                                    }}>
                                    {v.label.replace('근무','')}
                                  </button>
                                ))}
                                {currentShift&&(
                                  <button onClick={()=>updShift(e.uid,dd,currentShift)}
                                    style={{padding:'2px 5px',fontSize:8,borderRadius:3,cursor:'pointer',fontFamily:'inherit',background:'transparent',color:'#5e6585',border:'1px solid #272a3d'}}>
                                    ✕
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })}
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
