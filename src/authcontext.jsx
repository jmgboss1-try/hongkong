import { createContext, useContext, useEffect, useState } from 'react'
import { auth, db } from './firebase'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'

const AuthContext = createContext()

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
  const grade = userData?.grade || null

  return (
    <AuthContext.Provider value={{ user, userData, isOwner, grade, loading }}>
      {!loading && children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)