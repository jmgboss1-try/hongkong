import { useState } from 'react'
import { auth } from '../firebase'
import { signInWithEmailAndPassword } from 'firebase/auth'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (err) {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.')
    }
    setLoading(false)
  }

  return (
    <div style={{
      minHeight:'100vh', background:'#0b0d16', display:'flex',
      alignItems:'center', justifyContent:'center', fontFamily:'Noto Sans KR, sans-serif'
    }}>
      <div style={{
        background:'#12141f', border:'1px solid #272a3d', borderRadius:16,
        padding:'40px 36px', width:360
      }}>
        <div style={{textAlign:'center', marginBottom:28}}>
          <div style={{fontSize:28, marginBottom:6}}>🍜</div>
          <div style={{fontSize:18, fontWeight:700, color:'#f9b934'}}>홍콩반점 중앙대점</div>
          <div style={{fontSize:11, color:'#5e6585', marginTop:4, letterSpacing:1}}>STORE MANAGEMENT</div>
        </div>

        <form onSubmit={handleLogin} style={{display:'flex', flexDirection:'column', gap:12}}>
          <div style={{display:'flex', flexDirection:'column', gap:4}}>
            <label style={{fontSize:11, color:'#5e6585', fontWeight:600}}>이메일</label>
            <input
              type="email" value={email} onChange={e=>setEmail(e.target.value)}
              placeholder="이메일 입력" required
              style={{background:'#191c2b', border:'1px solid #272a3d', borderRadius:8,
                color:'#dde1f2', padding:'10px 12px', fontSize:13, outline:'none'}}
            />
          </div>
          <div style={{display:'flex', flexDirection:'column', gap:4}}>
            <label style={{fontSize:11, color:'#5e6585', fontWeight:600}}>비밀번호</label>
            <input
              type="password" value={password} onChange={e=>setPassword(e.target.value)}
              placeholder="비밀번호 입력" required
              style={{background:'#191c2b', border:'1px solid #272a3d', borderRadius:8,
                color:'#dde1f2', padding:'10px 12px', fontSize:13, outline:'none'}}
            />
          </div>

          {error && <div style={{fontSize:12, color:'#f87171', textAlign:'center'}}>{error}</div>}

          <button type="submit" disabled={loading} style={{
            background:'#f9b934', color:'#000', border:'none', borderRadius:8,
            padding:'11px', fontSize:13, fontWeight:700, cursor:'pointer', marginTop:6
          }}>
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <div style={{fontSize:11, color:'#5e6585', textAlign:'center', marginTop:20, lineHeight:1.8}}>
          계정이 없으신가요?<br/>
          <span style={{color:'#f9b934'}}>사장님에게 계정 발급을 요청하세요</span>
        </div>
      </div>
    </div>
  )
}