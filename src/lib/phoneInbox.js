import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { db } from '../firebase'
import { doc, setDoc, onSnapshot, deleteDoc, Timestamp } from 'firebase/firestore'

// 폰→포스 사진 받기: photoInbox/{sid} 를 만들고 QR 을 그린 뒤 들어오는 사진을 onAdd 로 넘김 (창이 닫히면 문서 삭제)
// Astryx 창(src/astryx/PhotoField.jsx 의 PhoneReceiveDialog)과 예전 창(PhoneReceiveModal)이 같이 씀
export function usePhoneInbox({ onAdd, hiRes = false }) {
  const [qr, setQr] = useState('')
  const [status, setStatus] = useState('creating') // creating | ready | error
  const [received, setReceived] = useState(0)
  const [note, setNote] = useState('')
  const onAddRef = useRef(onAdd)
  useEffect(()=>{ onAddRef.current = onAdd })

  useEffect(()=>{
    let cancelled = false
    let unsub = null
    let sid = null
    let merged = 0
    async function start() {
      try {
        const bytes = new Uint8Array(16)
        crypto.getRandomValues(bytes)
        sid = Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('')
        await setDoc(doc(db,'photoInbox',sid), {
          images: [],
          createdAt: Timestamp.now(),
          expiresAt: Timestamp.fromMillis(Date.now() + 10*60*1000),
        })
        if(cancelled) return
        const url = `${window.location.origin}/upload/${sid}${hiRes ? '?hi=1' : ''}`
        const dataUrl = await QRCode.toDataURL(url, { width:260, margin:1 })
        if(cancelled) return
        setQr(dataUrl)
        setStatus('ready')
        unsub = onSnapshot(doc(db,'photoInbox',sid), snap=>{
          const imgs = snap.exists() ? (snap.data().images||[]) : []
          if(imgs.length > merged) {
            const fresh = imgs.slice(merged)
            merged = imgs.length
            setReceived(imgs.length)
            const msg = onAddRef.current(fresh)
            setNote(msg || '')
          }
        })
      } catch(e) {
        console.error(e)
        if(!cancelled) setStatus('error')
      }
    }
    start()
    return ()=>{
      cancelled = true
      if(unsub) unsub()
      if(sid) deleteDoc(doc(db,'photoInbox',sid)).catch(()=>{})
    }
  },[hiRes])

  return { qr, status, received, note }
}

