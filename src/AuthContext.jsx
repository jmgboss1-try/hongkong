import { createContext, useContext, useEffect, useState } from 'react'
import { auth, db } from './firebase'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'

const AuthContext = createContext()

export function calcGrade(joinDate) {
  if (!joinDate) return null
  const now = new Date()
  const join = new Date(joinDate)
  const diffMs = now - join
  const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30.44)
  if (diffMonths < 6) return 'chick'
  if (diffMonths < 12) return 'senior'
  return 'legend'
}

export function calcYears(joinDate) {
  if (!joinDate) return 0
  const now = new Date()
  const join = new Date(joinDate)
  const diffMs = now - join
  return Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365.25))
}

export function GradeBadge({ joinDate, size = 12 }) {
  const grade = calcGrade(joinDate)
  const years = calcYears(joinDate)

  if (!grade) return null

  if (grade === 'chick') {
    return (
      <span style={{display:'inline-flex',alignItems:'center',gap:4,
        background:'rgba(251,191,36,0.15)',color:'#fbbf24',
        fontSize:size,fontWeight:600,padding:'2px 8px',borderRadius:999,whiteSpace:'nowrap'}}>
        🐣 병아리
      </span>
    )
  }

  if (grade === 'senior') {
    return (
      <span style={{display:'inline-flex',alignItems:'center',gap:4,
        background:'rgba(248,113,113,0.15)',color:'#f87171',
        fontSize:size,fontWeight:600,padding:'2px 8px',borderRadius:999,whiteSpace:'nowrap'}}>
        ⭐ 고오급인력
      </span>
    )
  }

  // legend — 1년마다 노란별 하나씩
  const stars = Math.max(1, years)
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:4,
      background:'rgba(234,179,8,0.15)',color:'#eab308',
      fontSize:size,fontWeight:600,padding:'2px 8px',borderRadius:999,whiteSpace:'nowrap'}}>
      {'🌟'.repeat(Math.min(stars,5))} 대선배
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
        if (snap.exists()) setUserData(snap.data())
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
