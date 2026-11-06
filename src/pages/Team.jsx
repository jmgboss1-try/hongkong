import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { collection, getDocs } from 'firebase/firestore'
import { GradeBadge } from '../AuthContext'

const EMP_COLORS = ['#C3261C','#2B5C9E','#2E7D45','#6B4FA0','#B45309','#B42318']

export default function Team() {
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)

  // 재직 중인 직원 이름·입사일만 (예전 meta 문서에는 시급이 들어 있어 더 이상 읽지 않음)
  useEffect(()=>{
    getDocs(collection(db,'users')).then(snap => {
      const list = []
      snap.forEach(d => {
        const u = d.data()
        if (u.status === 'approved' && !['owner','store','investor'].includes(u.role) && u.name)
          list.push({ uid:d.id, name:String(u.name), joinDate:u.joinDate || '' })
      })
      list.sort((a,b) => (a.joinDate || '9') < (b.joinDate || '9') ? -1 : 1)
      setEmployees(list)
    }).catch(e => console.error(e)).finally(() => setLoading(false))
  },[])

  return (
    <div>
      <div style={{marginBottom:22}}>
        <div style={{fontSize:20,fontWeight:700}}>팀원 소개</div>
        <div style={{fontSize:12,color:'#6E6A63',marginTop:2}}>홍콩반점 중앙대점 함께하는 멤버들</div>
      </div>

      {loading ? <div style={{textAlign:'center',color:'#6E6A63',padding:60}}>로딩 중...</div> : (
        <>
          <div style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,padding:'18px 20px',marginBottom:20,textAlign:'center'}}>
            <div style={{fontSize:28,marginBottom:8}}></div>
            <div style={{fontSize:16,fontWeight:700,color:'#C3261C',marginBottom:4}}>홍콩반점 중앙대점</div>
            <div style={{fontSize:12,color:'#6E6A63'}}>총 {employees.length}명이 함께하고 있어요</div>
          </div>

          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:14}}>
            {employees.map((e,idx)=>{
              const info = e
              const color = EMP_COLORS[idx%EMP_COLORS.length]
              return(
                <div key={e.uid} style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,overflow:'hidden'}}>
                  {/* 컬러 헤더 */}
                  <div style={{height:6,background:color}}></div>
                  <div style={{padding:'18px 16px',display:'flex',flexDirection:'column',gap:8}}>
                    {/* 아바타 */}
                    <div style={{width:48,height:48,borderRadius:'50%',background:color,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,fontWeight:700,color:'#FFFFFF'}}>
                      {e.name.charAt(0)}
                    </div>
                    <div>
                      <div style={{fontSize:16,fontWeight:700,marginBottom:4}}>{e.name}</div>
                      <GradeBadge joinDate={info.joinDate} size={11}/>
                    </div>
                    {info.joinDate && (
                      <div style={{fontSize:11,color:'#6E6A63'}}>입사일: {info.joinDate}</div>
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
