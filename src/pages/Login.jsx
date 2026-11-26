import ThemeDots from '../components/ThemeDots'
import { useState } from 'react'
import { auth, db } from '../firebase'
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth'
import { doc, setDoc } from 'firebase/firestore'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Card } from '@astryxdesign/core/Card'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { TextInput } from '@astryxdesign/core/TextInput'
import { SegmentedControl, SegmentedControlItem } from '@astryxdesign/core/SegmentedControl'
import { AstryxPage, Legacy } from '../astryx/AstryxPage'

export default function Login() {
  const [mode, setMode] = useState('login') // 'login' | 'register'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [resetMsg, setResetMsg] = useState('')

  // 비밀번호 잊었을 때: 입력한 이메일로 재설정 메일 (Firebase가 보냄)
  async function handleReset() {
    setError(''); setResetMsg('')
    const em = email.trim()
    if(!em) return setError('위 이메일 칸에 가입한 이메일을 먼저 넣어주세요.')
    setLoading(true)
    try {
      auth.languageCode = 'ko'
      await sendPasswordResetEmail(auth, em)
      setResetMsg(`${em} 로 비밀번호 재설정 메일을 보냈어요. 메일의 링크에서 새 비밀번호를 정한 뒤 로그인하세요. 안 보이면 스팸함도 확인해 주세요.`)
    } catch(err) {
      if(err.code === 'auth/invalid-email') setError('이메일 형식이 올바르지 않습니다.')
      else if(err.code === 'auth/user-not-found') setError('이 이메일로 가입한 계정이 없어요. 사장님께 가입한 이메일을 물어보세요.')
      else if(err.code === 'auth/too-many-requests') setError('요청이 너무 많아요. 잠시 뒤 다시 시도해 주세요.')
      else setError('메일을 보내지 못했어요. 잠시 뒤 다시 시도해 주세요.')
    }
    setLoading(false)
  }

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

  return (
    <AstryxPage>
    <VStack hAlign="center" vAlign="center" minHeight="100vh" padding={4}>
      <Card padding={6} width={380} maxWidth="100%">
        <VStack gap={5}>
          <VStack gap={1} hAlign="center">
            <Heading level={2}>홍콩반점 중앙대점</Heading>
            <Text type="supporting" color="secondary">STORE MANAGEMENT</Text>
          </VStack>

          <SegmentedControl label="로그인·회원가입" value={mode} onChange={m=>{ if (!m) return; setMode(m); setError(''); setResetMsg(''); setDone(false) }}>
            <SegmentedControlItem value="login" label="로그인"/>
            <SegmentedControlItem value="register" label="회원가입"/>
          </SegmentedControl>

          {done ? (
            <VStack gap={3} hAlign="center">
              <Heading level={4}>가입 신청 완료!</Heading>
              <Text color="secondary" justify="center">사장님 승인 후 로그인 가능합니다. 승인이 완료되면 알려드릴게요.</Text>
              <Button variant="primary" label="로그인 화면으로" onClick={()=>{setMode('login');setDone(false);setEmail('');setPassword('');setName('')}}/>
            </VStack>
          ) : (
            <form onSubmit={mode==='login' ? handleLogin : handleRegister}>
              <VStack gap={3}>
                {mode==='register' && <TextInput label="이름" placeholder="실명 입력" isRequired value={name} onChange={v=>setName(v)}/>}
                <TextInput type="email" label="이메일" placeholder="이메일 입력" isRequired value={email} onChange={v=>setEmail(v)}/>
                <TextInput type="password" label="비밀번호" placeholder={mode==='register' ? '6자 이상' : '비밀번호 입력'} isRequired value={password} onChange={v=>setPassword(v)}/>
                {error && <Banner status="error" title={error}/>}
                {resetMsg && <Banner status="success" title={resetMsg}/>}
                <Button type="submit" variant="primary" width="100%" label={loading ? '처리 중...' : mode==='login' ? '로그인' : '가입 신청'} isDisabled={loading}/>
                {mode==='login' && <HStack hAlign="center"><Button variant="ghost" label="비밀번호를 잊으셨나요?" isDisabled={loading} onClick={handleReset}/></HStack>}
              </VStack>
            </form>
          )}

          {mode==='login' && !done && (
            <VStack gap={1} hAlign="center">
              <Text type="supporting" color="secondary" justify="center">아이디(가입한 이메일)를 잊었으면 사장님께 물어보세요.</Text>
              <Text type="supporting" color="secondary">계정이 없으신가요?</Text>
              <Button size="sm" variant="ghost" label="회원가입 신청하기" onClick={()=>setMode('register')}/>
            </VStack>
          )}
          {/* 이 기기에서 고른 색 테마 (로그인 전에도 바꿀 수 있음) */}
          <HStack hAlign="center"><Legacy><ThemeDots size={18} style={{justifyContent:'center'}}/></Legacy></HStack>
        </VStack>
      </Card>
    </VStack>
    </AstryxPage>
  )
}
