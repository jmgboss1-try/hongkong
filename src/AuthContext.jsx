import { createContext, useContext, useEffect, useState } from 'react'
import { auth, db } from './firebase'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'

const AuthContext = createContext()

// 등급 계산 함수
export function calcGrade(joinDate) {
  if (!joinDate) return null
  const now = new Date()
  const join = new Date(joinDate)
  const diffMs = now - join
  const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30.44)
  if (diffMonths < 6) return 'chick'       // 병아리
  if (diffMonths < 12) return 'senior'     // 고오급인력
  return 'legend'                           // 대선배
}

// 별 개수 계산 (2년차부터 1년에 빨간별 하나씩 추가)
export function calcStars(joinDate) {
  if (!joinDate) return 0
  const now = new Date()
  const join = new Date(joinDate)
  const diffMs = now - join
  const diffYears = diffMs / (1000 * 60 * 60 * 24 * 365.25)
  if (diffYears < 1) return 0
  return Math.floor(diffYears) // 1년차=별1개, 2년차=별2개...
}

export function GradeBadge({ joinDate, size = 12 }) {
  const grade = calcGrade(joinDate)
  const stars = calcStars(joinDate)

  const config = {
    chick:  { label:'병아리',    bg:'rgba(251,191,36,0.15)', color:'#fbbf24', emoji:'🐣' },
    senior: { label:'고오급인력', bg:'rgba(147,197,253,0.15)', color:'#93c5fd', emoji:'⭐' },
    legend: { label:'대선배',    bg:'rgba(248,113,113,0.15)', color:'#f87171', emoji:'🔴' },
  }
  if (!grade) return null
  const c = config[grade]

  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:4,background:c.bg,color:c.color,
      fontSize:size,fontWeight:600,padding:'2px 8px',borderRadius:999,whiteSpace:'nowrap'}}>
      {c.emoji} {c.label}
      {grade === 'legend' && stars > 0 && (
        <span style={{color:'#f87171',fontSize:size-1}}>
          {'★'.repeat(stars)}
        </span>
      )}
      {grade === 'senior' && (
        <span style={{color:'#fbbf24',fontSize:size-1}}>★</span>
      )}
    </span>
  )
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [userData, setUserData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const ref = doc(db, 'users', firebaseUser.uid)
        const snap = await getDoc(ref)
        if (snap.exists()) {
          setUserData(snap.data())
        }
        setUser(firebaseUser)
      } else {
        setUser(null)
        setUserData(null)
      }
      setLoading(false)
    })
    return () => unsub()
  }, [])

  const isOwner = userData?.role === 'owner'
  const isPending = userData?.status === 'pending'
  const isLegend = calcGrade(userData?.joinDate) === 'legend'

  return (
    <AuthContext.Provider value={{ user, userData, isOwner, isPending, isLegend, loading }}>
      {!loading && children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
