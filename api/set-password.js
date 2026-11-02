// 인원관리: 사장님이 직원 비밀번호를 새로 정해줌 (직원이 비밀번호와 이메일 비밀번호를 모두 잊었을 때)
//
// Vercel 서버 함수 (POST /api/set-password)
//   요청: Authorization: Bearer <사장님 Firebase ID 토큰>, body { uid, password }
//   응답: { ok: true } 또는 { error }
// Vercel 환경변수: FIREBASE_SERVICE_ACCOUNT = Firebase 콘솔 → 프로젝트 설정 → 서비스 계정 → '새 비공개 키 생성'으로 받은 JSON 전체
//   (채팅·저장소에 올리지 말 것. Vercel에만)
// 무거운 firebase-admin 대신 jose로 서비스 계정 토큰을 만들어 Google REST API를 직접 부름
import { createRemoteJWKSet, jwtVerify, SignJWT, importPKCS8 } from 'jose'

const FIREBASE_KEYS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'))

// 서비스 계정으로 Google API 접근 토큰 받기
async function accessToken(sa) {
  const key = await importPKCS8(String(sa.private_key).replace(/\\n/g, '\n'), 'RS256')
  const now = Math.floor(Date.now() / 1000)
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/cloud-platform' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(sa.client_email).setSubject(sa.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now).setExpirationTime(now + 600)
    .sign(key)
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  })
  const j = await r.json()
  if (!r.ok || !j.access_token) throw new Error('서비스 계정 토큰을 받지 못했어요')
  return j.access_token
}

// Firestore users/{uid} 의 role (문서가 없으면 null)
async function roleOf(projectId, token, uid) {
  const r = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(uid)}`,
    { headers: { Authorization: `Bearer ${token}` } })
  if (r.status === 404) return null
  if (!r.ok) throw new Error('직원 정보를 읽지 못했어요')
  const j = await r.json()
  return j.fields?.role?.stringValue || 'staff'
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 가능해요' })
  let sa
  try { sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '') } catch { sa = null }
  if (!sa?.private_key || !sa?.client_email) {
    return res.status(500).json({ error: '서버에 Firebase 관리자 키(FIREBASE_SERVICE_ACCOUNT)가 아직 설정되지 않았어요' })
  }
  const projectId = sa.project_id || process.env.VITE_FIREBASE_PROJECT_ID || 'terry-hongkong'

  // 1) 로그인한 사람 확인
  const idToken = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  let caller
  try {
    const { payload } = await jwtVerify(idToken, FIREBASE_KEYS, { issuer: `https://securetoken.google.com/${projectId}`, audience: projectId })
    caller = payload.sub
  } catch {
    return res.status(401).json({ error: '로그인이 필요해요' })
  }

  const uid = String(req.body?.uid || '')
  const password = String(req.body?.password || '')
  if (!uid) return res.status(400).json({ error: '직원을 골라주세요' })
  if (password.length < 6) return res.status(400).json({ error: '비밀번호는 6자 이상이어야 해요' })

  try {
    const token = await accessToken(sa)
    // 2) 사장님만 가능
    if (await roleOf(projectId, token, caller) !== 'owner') return res.status(403).json({ error: '사장님 계정만 할 수 있어요' })
    // 3) 대상은 앱에 등록된 직원이고 사장님 계정은 아님
    const targetRole = await roleOf(projectId, token, uid)
    if (targetRole === null) return res.status(404).json({ error: '직원 정보를 찾지 못했어요' })
    if (targetRole === 'owner') return res.status(403).json({ error: '사장님 계정 비밀번호는 여기서 바꿀 수 없어요' })

    // 4) 비밀번호 바꾸기 (Identity Toolkit)
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/accounts:update`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ localId: uid, password }),
    })
    if (!r.ok) {
      const j = await r.json().catch(() => ({}))
      const msg = j.error?.message || ''
      if (msg.includes('USER_NOT_FOUND')) return res.status(404).json({ error: '이 직원은 로그인 계정이 없어요 (사장님이 직접 추가한 직원). 직원이 회원가입을 해야 해요' })
      if (msg.includes('WEAK_PASSWORD')) return res.status(400).json({ error: '비밀번호는 6자 이상이어야 해요' })
      console.error('accounts:update', msg)
      return res.status(500).json({ error: '비밀번호를 바꾸지 못했어요' })
    }
    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error(err)
    return res.status(500).json({ error: err.message || '비밀번호를 바꾸지 못했어요' })
  }
}
