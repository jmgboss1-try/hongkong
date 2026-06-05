import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { collection, getDocs, getDoc, doc, setDoc } from 'firebase/firestore'
import { GradeBadge } from '../AuthContext'

function calcTenure(joinDate, leaveDate) {
  if (!joinDate) return '—'
  const end = leaveDate ? new Date(leaveDate) : new Date()
  const join = new Date(joinDate)
  const diffDays = Math.floor((end-join)/(1000*60*60*24))
  const years = Math.floor(diffDays/365)
  const months = Math.floor((diffDays%365)/30)
  if (years > 0) return `${years}년 ${months}개월`
  if (months > 0) return `${months}개월`
  return `${diffDays}일`
}

function calcSeverance(joinDate, leaveDate, wage, avgHours) {
  if (!joinDate) return 0
  const end = leaveDate ? new Date(leaveDate) : new Date()
  const join = new Date(joinDate)
  const diffDays = Math.floor((end-join)/(1000*60*60*24))
  if (diffDays < 365) return 0
  const years = diffDays / 365
  const dailyWage = (wage * (avgHours||8)) / 30
  return Math.round(dailyWage * 30 * years)
}

function maskSSN(ssn) {
  if (!ssn) return '—'
  return ssn.slice(0,6) + '-●●●●●●'
}

function MemberCard({ m, onEdit, onRetire }) {
  const [showDetail, setShowDetail] = useState(false)
  const tenure = calcTenure(m.joinDate)
  const severance = calcSeverance(m.joinDate, null, m.wage||10030, m.avgHours||8)

  return (
    <div style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden'}}>
      <div style={{padding:'16px',display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer'}}
        onClick={()=>setShowDetail(v=>!v)}>
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{fontSize:16,fontWeight:700}}>{m.name}</div>
            <GradeBadge joinDate={m.joinDate} size={11}/>
          </div>
          <div style={{fontSize:11,color:'#5e6585'}}>
            📅 입사일: {m.joinDate||'미입력'} · 근속 {tenure}
          </div>
        </div>
        <div style={{fontSize:12,color:'#5e6585'}}>{showDetail?'▲':'▼'}</div>
      </div>
      {showDetail && (
        <div style={{borderTop:'1px solid #272a3d',padding:'16px',display:'flex',flexDirection:'column',gap:10}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            {[
              ['📱 연락처', m.phone||'—'],
              ['✉️ 이메일', m.email||'—'],
              ['🏦 계좌번호', m.account||'—'],
              ['🔐 주민번호', maskSSN(m.ssn)],
              ...(m.payType==='fixed'
                ? [['💰 월 고정급', `${(m.fixedSalary||0).toLocaleString()}원`]]
                : [
                    ['💰 시급', `${(m.wage||10030).toLocaleString()}원`],
                    ['⏱ 평균 근무시간', `${m.avgHours||8}h/일`],
                  ]
              ),
            ].map(([label,val])=>(
              <div key={label} style={{background:'#12141f',borderRadius:8,padding:'10px 12px'}}>
                <div style={{fontSize:10,color:'#5e6585',marginBottom:3}}>{label}</div>
                <div style={{fontSize:12,color:'#dde1f2',fontFamily:'DM Mono,monospace'}}>{val}</div>
              </div>
            ))}
          </div>
          <div style={{background:'rgba(249,185,52,0.08)',border:'1px solid rgba(249,185,52,0.2)',borderRadius:8,padding:'12px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <div style={{fontSize:10,color:'#5e6585',marginBottom:3}}>📦 예상 퇴직금 (현재 기준)</div>
              <div style={{fontSize:16,fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>
                {severance > 0 ? severance.toLocaleString()+'원' : '1년 미만 (해당없음)'}
              </div>
            </div>
            <div style={{fontSize:10,color:'#5e6585',textAlign:'right',lineHeight:1.8}}>
              근속 {tenure}<br/>시급 {(m.wage||10030).toLocaleString()}원
            </div>
          </div>
          <div style={{display:'flex',gap:8}}>
            <button onClick={()=>onEdit(m)}
              style={{background:'#f9b934',color:'#000',border:'none',borderRadius:7,padding:'8px 16px',fontSize:11,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              ✏️ 정보 수정
            </button>
            <button onClick={()=>onRetire(m)}
              style={{background:'transparent',border:'1px solid #f87171',color:'#f87171',borderRadius:7,padding:'8px 16px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
              📤 퇴직 처리
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function RetiredCard({ m }) {
  const [showDetail, setShowDetail] = useState(false)
  const tenure = calcTenure(m.joinDate, m.leaveDate)
  const severance = calcSeverance(m.joinDate, m.leaveDate, m.wage||10030, m.avgHours||8)

  return (
    <div style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden',opacity:0.8}}>
      <div style={{padding:'16px',display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer'}}
        onClick={()=>setShowDetail(v=>!v)}>
        <div style={{display:'flex',flexDirection:'column',gap:6}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{fontSize:16,fontWeight:700,color:'#5e6585'}}>{m.name}</div>
            <span style={{fontSize:10,background:'rgba(94,101,133,0.2)',color:'#5e6585',padding:'2px 8px',borderRadius:4,fontWeight:600}}>퇴직</span>
          </div>
          <div style={{fontSize:11,color:'#5e6585'}}>
            📅 {m.joinDate||'?'} ~ {m.leaveDate||'?'} · 근속 {tenure}
          </div>
        </div>
        <div style={{fontSize:12,color:'#5e6585'}}>{showDetail?'▲':'▼'}</div>
      </div>
      {showDetail && (
        <div style={{borderTop:'1px solid #272a3d',padding:'16px',display:'flex',flexDirection:'column',gap:10}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            {[
              ['📅 입사일', m.joinDate||'—'],
              ['📤 퇴사일', m.leaveDate||'—'],
              ['📱 연락처', m.phone||'—'],
              ['🏦 계좌번호', m.account||'—'],
              ['💰 마지막 시급', `${(m.wage||10030).toLocaleString()}원`],
              ['⏱ 평균 근무시간', `${m.avgHours||8}h/일`],
            ].map(([label,val])=>(
              <div key={label} style={{background:'#12141f',borderRadius:8,padding:'10px 12px'}}>
                <div style={{fontSize:10,color:'#5e6585',marginBottom:3}}>{label}</div>
                <div style={{fontSize:12,color:'#dde1f2',fontFamily:'DM Mono,monospace'}}>{val}</div>
              </div>
            ))}
          </div>
          <div style={{background:'rgba(94,101,133,0.08)',border:'1px solid rgba(94,101,133,0.2)',borderRadius:8,padding:'12px 14px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div>
              <div style={{fontSize:10,color:'#5e6585',marginBottom:3}}>📦 퇴직금 (퇴사일 기준)</div>
              <div style={{fontSize:16,fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>
                {severance > 0 ? severance.toLocaleString()+'원' : '1년 미만 (해당없음)'}
              </div>
            </div>
            <div style={{fontSize:10,color:'#5e6585',textAlign:'right',lineHeight:1.8}}>
              근속 {tenure}<br/>시급 {(m.wage||10030).toLocaleString()}원
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Members() {
  const [members, setMembers] = useState([])
  const [retired, setRetired] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [showRetired, setShowRetired] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [retireForm, setRetireForm] = useState(null) // 퇴직 처리 중인 직원

  async function load() {
    setLoading(true)
    try {
      const snap = await getDocs(collection(db,'users'))
      const active = [], ret = []
      snap.forEach(d => {
        const data = d.data()
        if(data.role === 'owner') return
        if(data.status === 'approved') active.push({uid:d.id,...data})
        if(data.status === 'retired') ret.push({uid:d.id,...data})
      })
      setMembers(active.sort((a,b)=>a.joinDate>b.joinDate?1:-1))
      setRetired(ret.sort((a,b)=>a.leaveDate>b.leaveDate?-1:1))
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(()=>{ load() },[])

  function setF(key,val){ setForm(f=>({...f,[key]:val})) }

  async function save() {
    if(!form.name?.trim()) return alert('이름을 입력해주세요')
    setSaving(true)
    try {
      const now = new Date()
      const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`
      const userSnap = await getDoc(doc(db,'users',form.uid))
      const existingHistory = userSnap.exists() ? userSnap.data().wageHistory || [] : []
      const oldWage = userSnap.exists() ? (userSnap.data().wage || 10030) : 10030
      const newWage = +form.wage || 10030
      const hasPriorHistory = existingHistory.some(h => h.month < thisMonth)
      const newHistory = existingHistory.filter(h => h.month !== thisMonth)
      if (!hasPriorHistory && oldWage !== newWage) {
        const joinMonth = form.joinDate ? form.joinDate.slice(0,7) : '2022-10'
        newHistory.push({ month: joinMonth, wage: oldWage })
      }
      newHistory.push({ month: thisMonth, wage: newWage })
      newHistory.sort((a,b) => a.month > b.month ? 1 : -1)

      await setDoc(doc(db,'users',form.uid), {
        name: form.name,
        wage: newWage,
        joinDate: form.joinDate || '',
        phone: form.phone || '',
        email: form.email || '',
        account: form.account || '',
        ssn: form.ssn || '',
        avgHours: +form.avgHours || 8,
        workDays: form.workDays || [1,2,3,4,5],
        holidayBase: form.holidayBase || 'contract',
        employType: form.employType || 'part',
        payType: form.payType || 'hourly',
        fixedSalary: +form.fixedSalary || 0,
        wageHistory: newHistory,
      }, {merge:true})

      await load()
      setShowForm(false)
      setForm({})
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  async function retireMember() {
    if(!retireForm?.leaveDate) return alert('퇴사일을 입력해주세요')
    setSaving(true)
    try {
      await setDoc(doc(db,'users',retireForm.uid), {
        status: 'retired',
        leaveDate: retireForm.leaveDate,
      }, {merge:true})
      setRetireForm(null)
      await load()
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  function editMember(m) {
    setForm({...m, workDays: Array.isArray(m.workDays) ? m.workDays : [1,2,3,4,5]})
    setShowForm(true)
    window.scrollTo({top:0,behavior:'smooth'})
  }

  const totalSeverance = members.reduce((a,m)=>
    a+calcSeverance(m.joinDate,null,m.wage||10030,m.avgHours||8),0)

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>📁 인원관리</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>사장 전용 — 승인된 직원 정보</div>
        </div>
      </div>

      {/* 총 퇴직금 */}
      <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'18px 20px',marginBottom:18,display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div>
          <div style={{fontSize:11,color:'#5e6585',marginBottom:4}}>📦 전체 예상 퇴직금 합계</div>
          <div style={{fontSize:22,fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>{totalSeverance.toLocaleString()}원</div>
        </div>
        <div style={{fontSize:11,color:'#5e6585'}}>재직 {members.length}명 · 퇴직 {retired.length}명</div>
      </div>

      {/* 퇴직 처리 모달 */}
      {retireForm && (
        <div style={{background:'#12141f',border:'1px solid #f87171',borderRadius:12,marginBottom:18,padding:'18px'}}>
          <div style={{fontSize:13,fontWeight:600,color:'#f87171',marginBottom:14}}>
            📤 {retireForm.name} 퇴직 처리
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            <div>
              <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6}}>퇴사일</label>
              <input type="date" value={retireForm.leaveDate||''}
                onChange={e=>setRetireForm(f=>({...f,leaveDate:e.target.value}))}
                style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                  padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
            </div>
            {retireForm.leaveDate && (
              <div style={{background:'rgba(249,185,52,0.08)',border:'1px solid rgba(249,185,52,0.2)',borderRadius:8,padding:'12px 14px'}}>
                <div style={{fontSize:11,color:'#5e6585',marginBottom:4}}>퇴직금 (퇴사일 기준)</div>
                <div style={{fontSize:16,fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>
                  {calcSeverance(retireForm.joinDate, retireForm.leaveDate, retireForm.wage||10030, retireForm.avgHours||8).toLocaleString()}원
                </div>
                <div style={{fontSize:10,color:'#5e6585',marginTop:4}}>
                  근속 {calcTenure(retireForm.joinDate, retireForm.leaveDate)}
                </div>
              </div>
            )}
            <div style={{display:'flex',gap:8}}>
              <button onClick={retireMember} disabled={saving}
                style={{background:'#f87171',color:'#fff',border:'none',borderRadius:8,
                  padding:'9px 20px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                {saving?'처리 중...':'퇴직 확정'}
              </button>
              <button onClick={()=>setRetireForm(null)}
                style={{background:'#191c2b',color:'#5e6585',border:'1px solid #272a3d',borderRadius:8,
                  padding:'9px 20px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 수정 폼 */}
      {showForm && (
        <div style={{background:'#12141f',border:'1px solid #f9b934',borderRadius:12,marginBottom:18}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,color:'#f9b934',display:'flex',justifyContent:'space-between'}}>
            <span>✏️ {form.name} 정보 수정</span>
            <button onClick={()=>setShowForm(false)}
              style={{background:'transparent',border:'none',color:'#5e6585',fontSize:18,cursor:'pointer'}}>✕</button>
          </div>
          {/* 급여 방식 선택 */}
          <div style={{padding:'0 18px 14px'}}>
            <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:8}}>급여 방식</label>
            <div style={{display:'flex',gap:8}}>
              {[
                {key:'hourly', label:'⏱ 시급제', desc:'근무시간 기반 계산'},
                {key:'fixed',  label:'📅 고정급제', desc:'매달 고정 금액 지급'},
              ].map(opt=>{
                const selected = (form.payType||'hourly') === opt.key
                return (
                  <div key={opt.key} onClick={()=>setF('payType', opt.key)}
                    style={{flex:1,padding:'10px 14px',borderRadius:8,cursor:'pointer',
                      background:selected?'rgba(249,185,52,0.12)':'#191c2b',
                      border:selected?'1px solid #f9b934':'1px solid #272a3d'}}>
                    <div style={{fontSize:12,fontWeight:600,color:selected?'#f9b934':'#5e6585',marginBottom:3}}>{opt.label}</div>
                    <div style={{fontSize:10,color:'#5e6585'}}>{opt.desc}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div style={{padding:'0 18px 14px',display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:12}}>
            {[
              ['이름','text','name',form.name||''],
              ['입사일','date','joinDate',form.joinDate||''],
              ['연락처','text','phone',form.phone||''],
              ['계좌번호','text','account',form.account||''],
              ['주민등록번호','text','ssn',form.ssn||''],
              ...((form.payType||'hourly')==='fixed'
                ? [['월 고정급 (원)','number','fixedSalary',form.fixedSalary||0]]
                : [
                    ['시급','number','wage',form.wage||10030],
                    ['평균근무시간(h/일)','number','avgHours',form.avgHours||8],
                  ]
              ),
            ].map(([label,type,key,val])=>(
              <div key={key} style={{display:'flex',flexDirection:'column',gap:4}}>
                <label style={{fontSize:10,color:'#5e6585',fontWeight:600}}>{label}</label>
                <input type={type} value={val} onChange={e=>setF(key,e.target.value)}
                  style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
              </div>
            ))}
          </div>

          {/* 소정근로일 */}
          <div style={{padding:'0 18px 14px'}}>
            <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:8}}>소정근로일 (주휴수당 기준)</label>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              {['월','화','수','목','금','토','일'].map((day,i)=>{
                const idx = i+1===7 ? 0 : i+1
                const workDays = form.workDays || [1,2,3,4,5]
                const checked = workDays.includes(idx)
                return (
                  <label key={day} style={{display:'flex',alignItems:'center',gap:4,cursor:'pointer',
                    background:checked?'rgba(249,185,52,0.15)':'#191c2b',
                    border:checked?'1px solid #f9b934':'1px solid #272a3d',
                    borderRadius:6,padding:'6px 10px',fontSize:12,fontWeight:600,
                    color:checked?'#f9b934':'#5e6585',transition:'.15s'}}>
                    <input type="checkbox" checked={checked} style={{display:'none'}}
                      onChange={()=>{
                        const current = form.workDays || [1,2,3,4,5]
                        const next = current.includes(idx)
                          ? current.filter(d=>d!==idx)
                          : [...current, idx].sort()
                        setF('workDays', next)
                      }}/>
                    {day}
                  </label>
                )
              })}
            </div>
            <div style={{fontSize:10,color:'#5e6585',marginTop:6}}>
              주 {Array.isArray(form.workDays)?form.workDays.length:5}일 소정근로
            </div>
          </div>

          {/* 주휴 계산 기준 */}
          <div style={{padding:'0 18px 14px'}}>
            <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:8}}>주휴수당 계산 기준</label>
            <div style={{display:'flex',gap:8}}>
              {[
                {key:'contract', label:'📋 소정근로 기준', desc:'법적 기준'},
                {key:'actual',   label:'⭐ 실제근무 기준', desc:'복지 적용'},
              ].map(opt=>{
                const selected = (form.holidayBase||'contract') === opt.key
                return (
                  <div key={opt.key} onClick={()=>setF('holidayBase', opt.key)}
                    style={{flex:1,padding:'10px 14px',borderRadius:8,cursor:'pointer',
                      background:selected?'rgba(249,185,52,0.12)':'#191c2b',
                      border:selected?'1px solid #f9b934':'1px solid #272a3d'}}>
                    <div style={{fontSize:12,fontWeight:600,color:selected?'#f9b934':'#5e6585',marginBottom:3}}>{opt.label}</div>
                    <div style={{fontSize:10,color:'#5e6585'}}>{opt.desc}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 고용 유형 */}
          <div style={{padding:'0 18px 14px'}}>
            <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:8}}>고용 유형 (공제 기준)</label>
            <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
              {[
                {key:'part', label:'🕐 아르바이트', desc:'3.3% 원천징수'},
                {key:'full', label:'💼 정직원',     desc:'4대보험 적용'},
                {key:'none', label:'✕ 공제없음',   desc:'세전 지급'},
              ].map(opt=>{
                const selected = (form.employType||'part') === opt.key
                return (
                  <div key={opt.key} onClick={()=>setF('employType', opt.key)}
                    style={{flex:1,padding:'10px 14px',borderRadius:8,cursor:'pointer',
                      background:selected?'rgba(249,185,52,0.12)':'#191c2b',
                      border:selected?'1px solid #f9b934':'1px solid #272a3d',minWidth:100}}>
                    <div style={{fontSize:12,fontWeight:600,color:selected?'#f9b934':'#5e6585',marginBottom:3}}>{opt.label}</div>
                    <div style={{fontSize:10,color:'#5e6585'}}>{opt.desc}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div style={{padding:'0 18px 18px',display:'flex',gap:8}}>
            <button onClick={save} disabled={saving}
              style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'9px 20px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              {saving?'저장 중...':'저 장'}
            </button>
            <button onClick={()=>setShowForm(false)}
              style={{background:'#191c2b',color:'#5e6585',border:'1px solid #272a3d',borderRadius:8,padding:'9px 20px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
              취 소
            </button>
          </div>
        </div>
      )}

      {/* 재직 직원 목록 */}
      {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:60}}>로딩 중...</div> : (
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {members.length===0 && (
            <div style={{textAlign:'center',color:'#5e6585',padding:40}}>
              승인된 직원이 없습니다.
            </div>
          )}
          {members.map(m=>(
            <MemberCard key={m.uid} m={m} onEdit={editMember} onRetire={m=>setRetireForm({...m,leaveDate:''})}/>
          ))}
        </div>
      )}

      {/* 퇴직자 목록 */}
      <div style={{marginTop:24}}>
        <button onClick={()=>setShowRetired(v=>!v)}
          style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,color:'#5e6585',
            padding:'8px 16px',fontSize:12,cursor:'pointer',fontFamily:'inherit',width:'100%',marginBottom:10}}>
          {showRetired?'▲':'▼'} 퇴직자 기록 ({retired.length}명)
        </button>
        {showRetired && (
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {retired.length===0 ? (
              <div style={{textAlign:'center',color:'#5e6585',padding:20}}>퇴직자 기록이 없습니다</div>
            ) : (
              retired.map(m=><RetiredCard key={m.uid} m={m}/>)
            )}
          </div>
        )}
      </div>
    </div>
  )
}
