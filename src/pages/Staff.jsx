import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, collection, query, where, getDocs } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')
const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const COLORS = ['#f9b934','#93c5fd','#34d399','#c4b5fd','#fb923c','#f87171']

export default function Staff() {
  const [curMonth, setCurMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [employees, setEmployees] = useState([])
  const [pending, setPending] = useState([])
  const [schData, setSchData] = useState({})
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newWage, setNewWage] = useState(10030)
  const [newPhone, setNewPhone] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [activeDay, setActiveDay] = useState(null)

  const monthOpts = []
  for(let y=2022;y<=2026;y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  async function load() {
    setLoading(true)
    try {
      // 직원 목록
      const empSnap = await getDoc(doc(db,'meta','employees'))
      const emps = empSnap.exists() ? empSnap.data().list || [] : []
      setEmployees(emps)

      // 스케쥴
      const schSnap = await getDoc(doc(db,'schedule',curMonth))
      setSchData(schSnap.exists() ? schSnap.data() : {})

      // 승인 대기 목록
      const q = query(collection(db,'users'), where('status','==','pending'))
      const pendingSnap = await getDocs(q)
      const pendingList = []
      pendingSnap.forEach(d => pendingList.push({uid:d.id, ...d.data()}))
      setPending(pendingList)
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

  // 승인
  async function approveUser(u, grade) {
    await setDoc(doc(db,'users',u.uid), {
      ...u, status:'approved', grade:+grade, wage:10030
    })
    // 직원 목록에 추가
    const updated = [...employees, {uid:u.uid, name:u.name, wage:10030, phone:'', email:u.email}]
    await saveEmployees(updated)
    setPending(p => p.filter(x=>x.uid!==u.uid))
  }

  // 거절
  async function rejectUser(uid) {
    await setDoc(doc(db,'users',uid), {status:'rejected'}, {merge:true})
    setPending(p => p.filter(x=>x.uid!==uid))
  }

  async function addEmp() {
    if(!newName.trim()) return alert('이름을 입력해주세요')
    const newEmp = { uid: Date.now().toString(), name:newName.trim(), wage:+newWage||10030, phone:newPhone.trim(), email:newEmail.trim() }
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

  async function updSched(uid, dd, val) {
    const h = parseFloat(val)||0
    const newSch = { ...schData }
    if(!newSch[uid]) newSch[uid] = {}
    if(h>0) newSch[uid][dd] = h
    else delete newSch[uid][dd]
    await saveSched(newSch)
  }

  const days = daysIn(curMonth)
  const [cy,cm] = curMonth.split('-').map(Number)
  const firstDow = new Date(cy,cm-1,1).getDay()
  const now = new Date()
  const isThisMonth = now.getFullYear()===cy && now.getMonth()+1===cm

  const schedTotals = employees.reduce((acc,e) => {
    const h = Object.values(schData[e.uid]||{}).reduce((a,b)=>a+b,0)
    acc[e.uid] = { hours:h, wage:Math.round(h*e.wage) }
    return acc
  }, {})
  const totalWage = Object.values(schedTotals).reduce((a,b)=>a+b.wage,0)

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>👥 인원 · 스케쥴</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>{mLabel(curMonth)}</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{fontSize:16,fontWeight:700,color:'#34d399',fontFamily:'DM Mono, monospace'}}>{totalWage.toLocaleString()}원</div>
          <select value={curMonth} onChange={e=>setCurMonth(e.target.value)}
            style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,color:'#dde1f2',padding:'8px 12px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
            {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
          </select>
        </div>
      </div>

      {/* 승인 대기 목록 */}
      {pending.length > 0 && (
        <div style={{background:'#12141f',border:'1px solid #f9b934',borderRadius:12,marginBottom:18}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,color:'#f9b934',display:'flex',alignItems:'center',gap:8}}>
            ⏳ 가입 승인 대기 <span style={{background:'#f9b934',color:'#000',borderRadius:999,fontSize:10,fontWeight:700,padding:'2px 7px'}}>{pending.length}</span>
          </div>
          <div style={{padding:18,display:'flex',flexDirection:'column',gap:12}}>
            {pending.map(u=>{
              const [selGrade, setSelGrade] = useState('3')
              return(
                <div key={u.uid} style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:10,padding:'14px 16px',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
                  <div>
                    <div style={{fontSize:14,fontWeight:700}}>{u.name}</div>
                    <div style={{fontSize:11,color:'#5e6585',marginTop:2}}>{u.email}</div>
                    <div style={{fontSize:10,color:'#5e6585',marginTop:2}}>가입일: {u.createdAt?.slice(0,10)}</div>
                  </div>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <select value={selGrade} onChange={e=>setSelGrade(e.target.value)}
                      style={{background:'#0b0d16',border:'1px solid #272a3d',borderRadius:6,color:'#dde1f2',padding:'6px 10px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
                      <option value="1">1등급 (1년↑)</option>
                      <option value="2">2등급 (6개월~1년)</option>
                      <option value="3">3등급 (6개월↓)</option>
                    </select>
                    <button onClick={()=>approveUser(u, selGrade)}
                      style={{background:'#34d399',color:'#000',border:'none',borderRadius:6,padding:'7px 14px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                      승인
                    </button>
                    <button onClick={()=>rejectUser(u.uid)}
                      style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',borderRadius:6,padding:'7px 14px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
                      거절
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 직원 추가 폼 */}
      {showAdd && (
        <div style={{background:'#12141f',border:'1px solid #f9b934',borderRadius:12,marginBottom:18}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,color:'#f9b934'}}>직원 직접 추가</div>
          <div style={{padding:18,display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:10}}>
            {[['이름',newName,setNewName,'text','홍길동'],['시급',newWage,setNewWage,'number','10030'],['연락처',newPhone,setNewPhone,'text','010-0000-0000'],['이메일',newEmail,setNewEmail,'email','example@gmail.com']].map(([label,val,set,type,ph])=>(
              <div key={label} style={{display:'flex',flexDirection:'column',gap:4}}>
                <label style={{fontSize:10,color:'#5e6585',fontWeight:600}}>{label}</label>
                <input type={type} value={val} onChange={e=>set(e.target.value)} placeholder={ph}
                  style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',padding:'8px 10px',fontSize:12,outline:'none'}}/>
              </div>
            ))}
          </div>
          <div style={{padding:'0 18px 18px',display:'flex',gap:8}}>
            <button onClick={addEmp} style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'9px 20px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>추 가</button>
            <button onClick={()=>setShowAdd(false)} style={{background:'#191c2b',color:'#5e6585',border:'1px solid #272a3d',borderRadius:8,padding:'9px 20px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>취 소</button>
          </div>
        </div>
      )}

      {/* 직원 카드 */}
      <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,marginBottom:18}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span>직원 목록</span>
          <button onClick={()=>setShowAdd(true)} style={{background:'#f9b934',color:'#000',border:'none',borderRadius:6,padding:'5px 14px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>+ 직접 추가</button>
        </div>
        {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:40}}>로딩 중...</div> : (
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:12,padding:18}}>
            {employees.map((e,idx)=>{
              const s = schedTotals[e.uid]||{hours:0,wage:0}
              const color = COLORS[idx%COLORS.length]
              return (
                <div key={e.uid} style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:10,padding:16,display:'flex',flexDirection:'column',gap:5}}>
                  <div style={{display:'flex',alignItems:'center',gap:8}}>
                    <div style={{width:10,height:10,borderRadius:3,background:color,flexShrink:0}}></div>
                    <div style={{fontSize:14,fontWeight:700}}>{e.name}</div>
                  </div>
                  <div style={{display:'inline-block',background:'rgba(249,185,52,0.12)',color:'#f9b934',fontSize:10,fontWeight:600,padding:'2px 7px',borderRadius:4,fontFamily:'DM Mono, monospace',width:'fit-content'}}>{e.wage.toLocaleString()}원/h</div>
                  <div style={{fontSize:11,color:'#5e6585'}}>{e.phone||e.email||'연락처 없음'}</div>
                  <div style={{fontSize:11,color:'#34d399',fontFamily:'DM Mono, monospace'}}>{mLabel(curMonth)} {s.hours}h · {s.wage.toLocaleString()}원</div>
                  <div style={{display:'flex',gap:6,marginTop:6}}>
                    <button onClick={()=>{const w=prompt(`${e.name} 시급 수정:`,e.wage);if(w)updateWage(e.uid,w)}}
                      style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',padding:'4px 8px',fontSize:10,borderRadius:5,cursor:'pointer',fontFamily:'inherit'}}>
                      시급수정
                    </button>
                    <button onClick={()=>delEmp(e.uid)}
                      style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',padding:'4px 8px',fontSize:10,borderRadius:5,cursor:'pointer',fontFamily:'inherit'}}>
                      삭제
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 달력 스케쥴 */}
      <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>
          📅 {mLabel(curMonth)} 근무 스케쥴 <span style={{fontSize:11,fontWeight:400,color:'#5e6585'}}>— 날짜 클릭 시 입력</span>
        </div>
        <div style={{padding:18}}>
          <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:14}}>
            {employees.map((e,idx)=>(
              <div key={e.uid} style={{display:'flex',alignItems:'center',gap:5,fontSize:11,color:'#5e6585'}}>
                <div style={{width:10,height:10,borderRadius:3,background:COLORS[idx%COLORS.length]}}></div>
                {e.name}
              </div>
            ))}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3,marginBottom:3}}>
            {['일','월','화','수','목','금','토'].map((d,i)=>(
              <div key={d} style={{textAlign:'center',fontSize:10,fontWeight:700,padding:'6px 0',
                color:i===0?'#f87171':i===6?'#93c5fd':'#5e6585'}}>{d}</div>
            ))}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(7,1fr)',gap:3}}>
            {(() => {
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
                const dayWorkers=employees.filter(e=>(schData[e.uid]||{})[dd]>0)
                return(
                  <div key={idx} onClick={()=>setActiveDay(isActive?null:dd)}
                    style={{background:isActive?'rgba(249,185,52,0.1)':'#191c2b',
                      border:isActive?'1px solid #f9b934':isToday?'1px solid rgba(249,185,52,0.4)':'1px solid #272a3d',
                      borderRadius:8,padding:'6px',minHeight:80,cursor:'pointer',transition:'.15s'}}>
                    <div style={{fontSize:11,fontWeight:700,fontFamily:'DM Mono, monospace',marginBottom:3,
                      color:dow===0?'#f87171':dow===6?'#93c5fd':isToday?'#f9b934':'#dde1f2'}}>{d}</div>
                    {!isActive && (
                      <div style={{display:'flex',flexDirection:'column',gap:2}}>
                        {dayWorkers.map((e)=>(
                          <div key={e.uid} style={{background:COLORS[employees.indexOf(e)%COLORS.length],color:'#111',borderRadius:3,padding:'1px 4px',fontSize:9,fontWeight:700,display:'flex',justifyContent:'space-between'}}>
                            <span>{e.name.charAt(0)}</span>
                            <span>{(schData[e.uid]||{})[dd]}h</span>
                          </div>
                        ))}
                        {dayWorkers.length===0&&<div style={{fontSize:9,color:'#272a3d'}}>휴무</div>}
                      </div>
                    )}
                    {isActive && (
                      <div onClick={e=>e.stopPropagation()} style={{display:'flex',flexDirection:'column',gap:4,marginTop:4}}>
                        {employees.map((e,ei)=>(
                          <div key={e.uid} style={{display:'flex',alignItems:'center',gap:4}}>
                            <div style={{width:6,height:6,borderRadius:2,background:COLORS[ei%COLORS.length],flexShrink:0}}></div>
                            <span style={{fontSize:9,flex:1,color:'#dde1f2'}}>{e.name.charAt(0)}</span>
                            <input type="number" defaultValue={(schData[e.uid]||{})[dd]||''} min="0" max="16" step="0.5"
                              placeholder="0" onBlur={ev=>updSched(e.uid,dd,ev.target.value)}
                              style={{width:32,background:'#0b0d16',border:'1px solid #272a3d',borderRadius:3,color:'#dde1f2',padding:'2px 0',fontSize:9,textAlign:'center',outline:'none'}}/>
                          </div>
                        ))}
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