import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { db } from '../firebase'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { loadSound, unlockAudio, audioReady, playEvent, isOrdersVisible, askNotify, notify } from '../lib/orderSounds'
import { MODES, won } from '../lib/menuData'
import { toDate } from '../lib/attendance'

// 앱 어느 화면에서든 QR 새 주문 알림 (사장님·매장 계정) — Layout 에 한 번만
//  - 접수 안 한 주문(status 'new')을 실시간으로 보고, 새로 들어오면 소리 + 위에 띠 + (탭을 안 보고 있으면) 윈도우 알림
//  - 새 주문·경고 소리는 여기서만 냄 (메뉴·주문 화면 안의 다른 탭에 있어도 빠지지 않게)
//  - 접수 안 한 주문이 오래 있으면 경고 소리 (소리 설정의 시간대로)
//  - 브라우저는 사람이 한 번 눌러야 소리를 낼 수 있어서, 화면 아무 데나 처음 누를 때 소리를 켬
export default function OrderAlert() {
  const navigate = useNavigate()
  const [fresh, setFresh] = useState([])
  const [ready, setReady] = useState(audioReady())
  const [listVisible, setListVisible] = useState(isOrdersVisible())
  const [err, setErr] = useState('')
  const seen = useRef(null)
  const freshRef = useRef([])
  const lastRemind = useRef(0)

  // 처음 누를 때 소리 켜기 (+ 윈도우 알림 허락 받기)
  useEffect(() => {
    if (ready) return
    const on = () => { askNotify(); if (unlockAudio()) setReady(true) }
    window.addEventListener('pointerdown', on, { once:true })
    window.addEventListener('keydown', on, { once:true })
    return () => { window.removeEventListener('pointerdown', on); window.removeEventListener('keydown', on) }
  }, [ready])

  useEffect(() => {
    const f = () => setListVisible(isOrdersVisible())
    window.addEventListener('ordersview', f)
    return () => window.removeEventListener('ordersview', f)
  }, [])

  useEffect(() => onSnapshot(query(collection(db,'orders'), where('status','==','new')), s => {
    const list = s.docs.map(d => ({ id:d.id, ...d.data() }))
    const added = seen.current ? list.filter(o => !seen.current.has(o.id)) : []
    if (added.length) {
      playEvent(loadSound(), 'new')
      try { navigator.vibrate?.([300,150,300]) } catch { /* 진동 없어도 됨 */ }
      // 다른 프로그램·탭을 보고 있으면 윈도우(폰) 알림도
      if (document.hidden) { const o = added[0]; notify('QR 새 주문', `${o.code} ${MODES[o.mode]||''} ${won(o.total)}${added.length > 1 ? ` 외 ${added.length-1}건` : ''}`) }
    }
    seen.current = new Set(list.map(o => o.id))
    freshRef.current = list
    setFresh(list); setErr('')
  }, e => { console.warn('주문 알림을 받을 수 없어요', e.code); setErr(e.code || 'error') }), [])

  // 접수 안 한 주문 경고
  useEffect(() => {
    const id = setInterval(() => {
      if (!freshRef.current.length) return
      const snd = loadSound(), now = Date.now()
      const late = freshRef.current.some(o => toDate(o.createdAt) && now - toDate(o.createdAt).getTime() > snd.remindMin * 60000)
      if (late && now - lastRemind.current > snd.remindEvery * 1000) {
        lastRemind.current = now; playEvent(snd, 'remind')
        if (document.hidden) notify('접수 안 한 QR 주문이 있어요', `${freshRef.current.length}건 기다리는 중`)
      }
    }, 5000)
    return () => clearInterval(id)
  }, [])

  // 탭 제목에도 표시 (다른 탭을 보고 있어도 보이게)
  useEffect(() => {
    const base = '홍콩반점 중앙대점'
    document.title = fresh.length ? `(${fresh.length}) 새 주문 · ${base}` : base
  }, [fresh.length])

  if (err === 'permission-denied') return null
  if (!fresh.length || listVisible) return null
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
