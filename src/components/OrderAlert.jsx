import { useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { db } from '../firebase'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { loadSound, unlockAudio, audioReady, playEvent } from '../lib/orderSounds'
import { toDate } from '../lib/attendance'

// 앱 어느 화면에서든 QR 새 주문 알림 (사장님·매장 계정) — Layout 에 한 번
//  - 접수 안 한 주문(status 'new')을 실시간으로 보고, 새로 들어오면 소리 + 위에 띠
//  - 오래 접수 안 하면 경고 소리 (소리 설정의 시간대로)
//  - 메뉴·주문 화면에서는 그 화면이 직접 소리를 내므로 여기선 띠만
//  - 브라우저는 사람이 한 번 눌러야 소리를 낼 수 있어서, 화면 아무 데나 처음 누를 때 소리를 켬
export default function OrderAlert() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [fresh, setFresh] = useState([])
  const [ready, setReady] = useState(audioReady())
  const seen = useRef(null)
  const freshRef = useRef([])
  const onPage = useRef(false)
  const lastRemind = useRef(0)
  useEffect(() => { onPage.current = pathname === '/menu-manage' }, [pathname])

  // 처음 누를 때 소리 켜기
  useEffect(() => {
    if (ready) return
    const on = () => { if (unlockAudio()) setReady(true) }
    window.addEventListener('pointerdown', on, { once:true })
    window.addEventListener('keydown', on, { once:true })
    return () => { window.removeEventListener('pointerdown', on); window.removeEventListener('keydown', on) }
  }, [ready])

  useEffect(() => onSnapshot(query(collection(db,'orders'), where('status','==','new')), s => {
    const list = s.docs.map(d => ({ id:d.id, ...d.data() }))
    if (seen.current && !onPage.current && list.some(o => !seen.current.has(o.id))) {
      playEvent(loadSound(), 'new')
      try { navigator.vibrate?.(400) } catch { /* 진동 없어도 됨 */ }
    }
    seen.current = new Set(list.map(o => o.id))
    freshRef.current = list
    setFresh(list)
  }, e => console.warn('주문 알림을 받을 수 없어요', e.code)), [])

  // 접수 안 한 주문 경고 (메뉴·주문 화면 밖에서)
  useEffect(() => {
    const id = setInterval(() => {
      if (onPage.current || !freshRef.current.length) return
      const snd = loadSound(), now = Date.now()
      const late = freshRef.current.some(o => toDate(o.createdAt) && now - toDate(o.createdAt).getTime() > snd.remindMin * 60000)
      if (late && now - lastRemind.current > snd.remindEvery * 1000) { lastRemind.current = now; playEvent(snd, 'remind') }
    }, 5000)
    return () => clearInterval(id)
  }, [])

  if (!fresh.length || pathname === '/menu-manage') return null
  return (
    <button type="button" onClick={()=>navigate('/menu-manage')}
      style={{position:'fixed', top:12, left:'50%', transform:'translateX(-50%)', zIndex:50, display:'flex', alignItems:'center', gap:10,
        background:'#C3261C', color:'#FFFFFF', border:'none', borderRadius:6, padding:'12px 18px', fontSize:16, fontWeight:800,
        fontFamily:'inherit', cursor:'pointer', boxShadow:'0 4px 16px rgba(29,27,24,0.25)', maxWidth:'calc(100vw - 24px)'}}>
      QR 새 주문 {fresh.length}건 · 눌러서 접수하기
      {!ready && <span style={{fontSize:12, fontWeight:500, opacity:0.9}}>(화면을 한 번 누르면 소리가 켜져요)</span>}
    </button>
  )
}
