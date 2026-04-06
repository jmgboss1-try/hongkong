import { useState } from 'react'
import { auth, db } from '../firebase'
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'

export default function Login() {
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch {
      setError('이메일 또는 비밀번호가 올바르지 않습니다.')
    }
    setLoading(false)
  }

  async function handleRegister(e) {
    e.preventDefault()
    if(!name.trim()) return setError('이름을 입력해주세요.')
    setLoading(true); setError('')
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password)
      await setDoc(doc(db, 'users', cred.user.uid), {
        name: name.trim(),
        email,
        role: 'staff',
        grade: null,
        status: 'pending',
        wage: 10030,
        createdAt: new Date().toISOString()
      })
      await auth.signOut()
      setDone(true)
    } catch(err) {
      if(err.code === 'auth/email-already-in-use') setError('이미 사용 중인 이메일입니다.')
      else if(err.code === 'auth/weak-password') setError('비밀번호는 6자 이상이어야 합니다.')
      else setError('가입 중 오류가 발생했습니다.')
    }
    setLoading(false)
  }

  const inputStyle = {
    background:'#191c2b', border:'1px solid #272a3d', borderRadius:8,
    color:'#dde1f2', padding:'10px 12px', fontSize:13, outline:'none', width:'100%'
  }

  return (
    <div style={{minHeight:'100vh', background:'#0b0d16', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'Noto Sans KR, sans-serif'}}>
      <div style={{background:'#12141f', border:'1px solid #272a3d', borderRadius:16, padding:'40px 36px', width:380}}>
        <div style={{textAlign:'center', marginBottom:28}}>
          <div style={{fontSize:28, marginBottom:6}}>🍜</div>
          <div style={{fontSize:18, fontWeight:700, color:'#f9b934'}}>홍콩반점 중앙대점</div>
          <div style={{fontSize:11, color:'#5e6585', marginTop:4, letterSpacing:1}}>STORE MANAGEMENT</div>
        </div>

        {/* 탭 */}
        <div style={{display:'flex', border:'1px solid #272a3d', borderRadius:8, overflow:'hidden', marginBottom:24}}>
          {[['login','로그인'],['register','회원가입']].map(([m,label])=>(
            <button key={m} onClick={()=>{setMode(m);setError('');setDone(false)}}
              style={{flex:1, padding:'9px', fontSize:12, fontWeight:600, border:'none', cursor:'pointer', fontFamily:'inherit',
                background: mode===m ? '#f9b934' : 'transparent',
                color: mode===m ? '#000' : '#5e6585'}}>
              {label}
            </button>
          ))}
        </div>

        {done ? (
          <div style={{textAlign:'center', padding:'20px 0'}}>
            <div style={{fontSize:32, marginBottom:12}}>✅</div>
            <div style={{fontSize:14, fontWeight:700, color:'#34d399', marginBottom:8}}>가입 신청 완료!</div>
            <div style={{fontSize:12, color:'#5e6585', lineHeight:1.8}}>
              사장님 승인 후 로그인 가능합니다.<br/>
              승인이 완료되면 알려드릴게요.
            </div>
            <button onClick={()=>{setMode('login');setDone(false);setEmail('');setPassword('');setName('')}}
              style={{marginTop:20, background:'#f9b934', color:'#000', border:'none', borderRadius:8, padding:'10px 24px', fontSize:12, fontWeight:700, cursor:'pointer', fontFamily:'inherit'}}>
              로그인 화면으로
            </button>
          </div>
        ) : (
          <form onSubmit={mode==='login' ? handleLogin : handleRegister}
            style={{display:'flex', flexDirection:'column', gap:12}}>
            {mode==='register' && (
              <div style={{display:'flex', flexDirection:'column', gap:4}}>
                <label style={{fontSize:11, color:'#5e6585', fontWeight:600}}>이름</label>
                <input type="text" value={name} onChange={e=>setName(e.target.value)}
                  placeholder="실명 입력" required style={inputStyle}/>
              </div>
            )}
            <div style={{display:'flex', flexDirection:'column', gap:4}}>
              <label style={{fontSize:11, color:'#5e6585', fontWeight:600}}>이메일</label>
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
                placeholder="이메일 입력" required style={inputStyle}/>
            </div>
            <div style={{display:'flex', flexDirection:'column', gap:4}}>
              <label style={{fontSize:11, color:'#5e6585', fontWeight:600}}>비밀번호</label>
              <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
                placeholder={mode==='register' ? '6자 이상' : '비밀번호 입력'} required style={inputStyle}/>
            </div>

            {error && <div style={{fontSize:12, color:'#f87171', textAlign:'center'}}>{error}</div>}

            <button type="submit" disabled={loading}
              style={{background:'#f9b934', color:'#000', border:'none', borderRadius:8, padding:'11px', fontSize:13, fontWeight:700, cursor:'pointer', marginTop:6, fontFamily:'inherit'}}>
              {loading ? '처리 중...' : mode==='login' ? '로그인' : '가입 신청'}
            </button>
          </form>
        )}

        {mode==='login' && !done && (
          <div style={{fontSize:11, color:'#5e6585', textAlign:'center', marginTop:20, lineHeight:1.8}}>
            계정이 없으신가요?<br/>
            <span style={{color:'#f9b934', cursor:'pointer'}} onClick={()=>setMode('register')}>회원가입 신청하기</span>
          </div>
        )}
      </div>
    </div>
  )
}