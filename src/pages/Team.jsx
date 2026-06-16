import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'
import { GradeBadge } from '../AuthContext'

const EMP_COLORS = ['#f9b934','#93c5fd','#34d399','#c4b5fd','#fb923c','#f87171']

export default function Team() {
  const [employees, setEmployees] = useState([])
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(()=>{
    async function load() {
      setLoading(true)
      try {
        const empSnap = await getDoc(doc(db,'meta','employees'))
        const emps = empSnap.exists() ? empSnap.data().list||[] : []
        setEmployees(emps)

        // 인원관리에서 입사일 등 상세정보 가져오기
        const memSnap = await getDoc(doc(db,'meta','members'))
        if(memSnap.exists()) setMembers(memSnap.data().list||[])
      } catch(e) { console.error(e) }
      setLoading(false)
    }
    load()
  },[])

  function getMemberInfo(uid) {
    return members.find(m=>m.uid===uid) || {}
  }

  return (
    <div>
      <div style={{marginBottom:22}}>
        <div style={{fontSize:20,fontWeight:700}}>👥 팀원 소개</div>
        <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>홍콩반점 중앙대점 함께하는 멤버들</div>
      </div>

      {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:60}}>로딩 중...</div> : (
        <>
          <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'18px 20px',marginBottom:20,textAlign:'center'}}>
            <div style={{fontSize:28,marginBottom:8}}>🍜</div>
            <div style={{fontSize:16,fontWeight:700,color:'#f9b934',marginBottom:4}}>홍콩반점 중앙대점</div>
            <div style={{fontSize:12,color:'#5e6585'}}>총 {employees.length}명이 함께하고 있어요</div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:14}}>
            {employees.map((e,idx)=>{
              const info = getMemberInfo(e.uid)
              const color = EMP_COLORS[idx%EMP_COLORS.length]
              return(
                <div key={e.uid} style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden'}}>
                  {/* 컬러 헤더 */}
                  <div style={{height:6,background:color}}></div>
                  <div style={{padding:'18px 16px',display:'flex',flexDirection:'column',gap:8}}>
                    {/* 아바타 */}
                    <div style={{width:48,height:48,borderRadius:'50%',background:color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,fontWeight:700,color:'#000'}}>
                      {e.name.charAt(0)}
                    </div>
                    <div>
                      <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>{e.name}</div>
                      <GradeBadge joinDate={info.joinDate} size={11}/>
                    </div>
                    {info.joinDate && (
                      <div style={{fontSize:11,color:'#5e6585',display:'flex',flexDirection:'column',gap:3}}>
                        <div>📅 입사일: {info.joinDate}</div>
                        <div>📱 {e.phone||info.phone||'연락처 없음'}</div>
                      </div>
                    )}
                    {!info.joinDate && (
                      <div style={{fontSize:11,color:'#5e6585'}}>
                        <div>📱 {e.phone||'연락처 없음'}</div>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
