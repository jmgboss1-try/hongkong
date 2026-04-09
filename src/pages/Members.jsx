import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { collection, getDocs, doc, setDoc } from 'firebase/firestore'
import { GradeBadge, calcGrade } from '../AuthContext'

function calcTenure(joinDate) {
  if (!joinDate) return '—'
  const now = new Date()
  const join = new Date(joinDate)
  const diffMs = now - join
  const diffDays = Math.floor(diffMs / (1000*60*60*24))
  const years = Math.floor(diffDays/365)
  const months = Math.floor((diffDays%365)/30)
  if (years > 0) return `${years}년 ${months}개월`
  if (months > 0) return `${months}개월`
  return `${diffDays}일`
}

function calcSeverance(joinDate, wage, avgHours) {
  if (!joinDate) return 0
  const now = new Date()
  const join = new Date(joinDate)
  const diffDays = Math.floor((now-join)/(1000*60*60*24))
  if (diffDays < 365) return 0
  const years = diffDays / 365
  const dailyWage = (wage * (avgHours||8)) / 30
  return Math.round(dailyWage * 30 * years)
}

function maskSSN(ssn) {
  if (!ssn) return '—'
  return ssn.slice(0,6) + '-●●●●●●'
}

function MemberCard({ m, onEdit, onDelete }) {
  const [showDetail, setShowDetail] = useState(false)
  const tenure = calcTenure(m.joinDate)
  const severance = calcSeverance(m.joinDate, m.wage||10030, m.avgHours||8)

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
              ['💰 시급', `${(m.wage||10030).toLocaleString()}원`],
              ['⏱ 평균 근무시간', `${m.avgHours||8}h/일`],
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
  <button onClick={()=>onDelete(m.uid)}
    style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',borderRadius:7,padding:'8px 16px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
    🗑 삭제
  </button>
</div>
        </div>
      )}
    </div>
  )
}

export default function Members() {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)

  async function load() {
    setLoading(true)
    try {
      // users 컬렉션에서 승인된 직원만 불러오기
      const snap = await getDocs(collection(db,'users'))
      const list = []
      snap.forEach(d => {
        const data = d.data()
        if(data.status === 'approved' && data.role !== 'owner') {
          list.push({uid: d.id, ...data})
        }
      })
      setMembers(list.sort((a,b)=>a.joinDate>b.joinDate?1:-1))
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(()=>{ load() },[])

  function setF(key,val){ setForm(f=>({...f,[key]:val})) }

  async function save() {
    if(!form.name?.trim()) return alert('이름을 입력해주세요')
    setSaving(true)
    try {
      // users 컬렉션 업데이트
      await setDoc(doc(db,'users',form.uid), {
        name: form.name,
        wage: +form.wage || 10030,
        joinDate: form.joinDate || '',
        phone: form.phone || '',
        email: form.email || '',
        account: form.account || '',
        ssn: form.ssn || '',
        avgHours: +form.avgHours || 8,
      }, {merge:true})

      // meta/employees 도 시급 동기화
      const empSnap = await getDocs(collection(db,'meta'))
      const metaRef = doc(db,'meta','employees')
      const metaSnap = await import('firebase/firestore').then(({getDoc})=>getDoc(metaRef))
      if(metaSnap.exists()) {
        const list = metaSnap.data().list || []
        const updated = list.map(e => e.uid===form.uid ? {...e, wage:+form.wage||10030, name:form.name} : e)
        await setDoc(metaRef, {list:updated})
      }

      await load()
      setShowForm(false)
      setForm({})
    } catch(e) { console.error(e) }
    setSaving(false)
  }
async function deleteMember(uid) {
  if(!window.confirm('정말 삭제하시겠습니까?\n해당 직원의 로그인 계정은 유지되지만\n인원관리 목록에서 제외됩니다.')) return
  try {
    const { deleteDoc } = await import('firebase/firestore')
    await setDoc(doc(db,'users',uid), {status:'deleted'}, {merge:true})
    setMembers(m => m.filter(x=>x.uid!==uid))
  } catch(e) { console.error(e) }
}
  function editMember(m) {
    setForm(m)
    setShowForm(true)
    window.scrollTo({top:0,behavior:'smooth'})
  }

  const totalSeverance = members.reduce((a,m)=>
    a+calcSeverance(m.joinDate,m.wage||10030,m.avgHours||8),0)

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
        <div style={{fontSize:11,color:'#5e6585'}}>총 {members.length}명</div>
      </div>

      {/* 수정 폼 */}
      {showForm && (
        <div style={{background:'#12141f',border:'1px solid #f9b934',borderRadius:12,marginBottom:18}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,color:'#f9b934',display:'flex',justifyContent:'space-between'}}>
            <span>✏️ {form.name} 정보 수정</span>
            <button onClick={()=>setShowForm(false)}
              style={{background:'transparent',border:'none',color:'#5e6585',fontSize:18,cursor:'pointer'}}>✕</button>
          </div>
          <div style={{padding:18,display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:12}}>
            {[
              ['이름','text','name',form.name||''],
              ['입사일','date','joinDate',form.joinDate||''],
              ['연락처','text','phone',form.phone||''],
              ['계좌번호','text','account',form.account||''],
              ['주민등록번호','text','ssn',form.ssn||''],
              ['시급','number','wage',form.wage||10030],
              ['평균근무시간(h/일)','number','avgHours',form.avgHours||8],
            ].map(([label,type,key,val])=>(
              <div key={key} style={{display:'flex',flexDirection:'column',gap:4}}>
                <label style={{fontSize:10,color:'#5e6585',fontWeight:600}}>{label}</label>
                <input type={type} value={val} onChange={e=>setF(key,e.target.value)}
                  style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
              </div>
            ))}
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

      {/* 직원 목록 */}
      {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:60}}>로딩 중...</div> : (
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {members.length===0 && (
            <div style={{textAlign:'center',color:'#5e6585',padding:40}}>
              승인된 직원이 없습니다.<br/>
              <span style={{fontSize:11}}>스케쥴 탭에서 직원 가입 신청을 승인해주세요.</span>
            </div>
          )}
{members.map(m=>(
  <MemberCard key={m.uid} m={m} onEdit={editMember} onDelete={deleteMember}/>
))}
        </div>
      )}
    </div>
  )
}
