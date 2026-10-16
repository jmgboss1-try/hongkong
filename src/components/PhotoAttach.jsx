import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { db } from '../firebase'
import { doc, setDoc, deleteDoc, onSnapshot, Timestamp } from 'firebase/firestore'

// 사진 1장을 가로/세로 최대 maxSide px, JPEG로 압축해서 dataURL로 반환 (목표 용량 ~targetKB)
export async function compressImage(file, maxSide = 1000, targetKB = 130) {
  let bitmap
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    bitmap = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
      img.onerror = reject
      img.src = url
    })
  }
  const w0 = bitmap.width, h0 = bitmap.height
  const scale = Math.min(1, maxSide / Math.max(w0, h0))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(w0 * scale)
  canvas.height = Math.round(h0 * scale)
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  let q = 0.8
  let dataUrl = canvas.toDataURL('image/jpeg', q)
  while (dataUrl.length * 0.75 > targetKB * 1024 && q > 0.4) {
    q -= 0.1
    dataUrl = canvas.toDataURL('image/jpeg', q)
  }
  return dataUrl
}

// Firestore 문서 1MB 제한 안전선 (base64 글자 수 기준)
const MAX_TOTAL_CHARS = 800000

// 확대 보기 (여러 장이면 세로로 쭉 스크롤)
export function Lightbox({ images, label, onClose }) {
  return (
    <div onClick={onClose}
      style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',zIndex:1000,
        overflowY:'auto',padding:'20px 12px'}}>
      <div onClick={e=>e.stopPropagation()}
        style={{maxWidth:720,margin:'0 auto',display:'flex',flexDirection:'column',gap:12}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
          <span style={{fontSize:14,fontWeight:700,color:'#f9b934'}}>{label || '사진'}</span>
          <button onClick={onClose}
            style={{background:'#191c2b',border:'1px solid #272a3d',color:'#dde1f2',borderRadius:8,
              padding:'6px 14px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>닫기 ✕</button>
        </div>
        {images.length===0 && (
          <div style={{color:'#5e6585',fontSize:13,textAlign:'center',padding:40}}>등록된 사진이 없습니다</div>
        )}
        {images.map((src,i)=>(
          <img key={i} src={src} alt="" style={{width:'100%',borderRadius:10,display:'block'}}/>
        ))}
      </div>
    </div>
  )
}

// 읽기용 썸네일 모음 (누르면 확대)
export function PhotoGrid({ images, label }) {
  const [open, setOpen] = useState(false)
  if (!images || images.length === 0) return null
  return (
    <>
      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}>
        {images.map((src,i)=>(
          <img key={i} src={src} alt="" onClick={()=>setOpen(true)}
            style={{width:84,height:84,objectFit:'cover',borderRadius:8,cursor:'pointer',
              border:'1px solid #272a3d'}}/>
        ))}
      </div>
      {open && <Lightbox images={images} label={label} onClose={()=>setOpen(false)}/>}
    </>
  )
}

// 폰에서 받기: QR 세션을 만들고, 폰이 보낸 사진을 실시간으로 받아서 onAdd로 넘김
function PhoneReceiveModal({ onAdd, onClose, attachedText }) {
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
        const url = `${window.location.origin}/upload/${sid}`
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
  },[])

  return (
    <div onClick={onClose}
      style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.8)',zIndex:1000,
        display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div onClick={e=>e.stopPropagation()}
        style={{background:'#12141f',border:'1px solid #f9b934',borderRadius:14,padding:22,
          maxWidth:340,width:'100%',textAlign:'center'}}>
        <div style={{fontSize:15,fontWeight:800,color:'#f9b934',marginBottom:4}}>📲 폰에서 사진 받기</div>
        <div style={{fontSize:11,color:'#5e6585',marginBottom:14}}>폰 카메라로 아래 QR을 찍어보세요 (10분간 유효)</div>
        {status==='creating' && <div style={{color:'#5e6585',fontSize:12,padding:'60px 0'}}>QR 만드는 중...</div>}
        {status==='error' && (
          <div style={{color:'#f87171',fontSize:12,padding:'30px 0',lineHeight:1.7}}>
            QR을 만들지 못했어요.<br/>Firestore 보안 규칙(photoInbox) 설정을 확인해 주세요.
          </div>
        )}
        {status==='ready' && (
          <>
            <img src={qr} alt="QR" style={{width:220,height:220,background:'#fff',borderRadius:10,padding:6}}/>
            <div style={{fontSize:12,color:'#dde1f2',marginTop:12,lineHeight:1.7}}>
              폰으로 찍으면 이 화면의 사진 칸에 바로 들어와요.<br/>여러 장 연속으로 보내도 돼요.
            </div>
            <div style={{fontSize:13,fontWeight:700,marginTop:10,color: received>0 ? '#34d399' : '#5e6585'}}>
              {received>0 ? `✓ ${received}장 받음` : '사진 기다리는 중...'}
            </div>
            <div style={{fontSize:11,color:'#5e6585',marginTop:2}}>{attachedText}</div>
            {note && <div style={{fontSize:11,color:'#f87171',marginTop:6}}>{note}</div>}
          </>
        )}
        <button onClick={onClose}
          style={{marginTop:16,background:'#f9b934',color:'#000',border:'none',borderRadius:8,
            padding:'9px 28px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
          완료
        </button>
      </div>
    </div>
  )
}

// 쓰기용: 📷 촬영 / 🖼 앨범 선택 / 📲 폰에서 받기 + 미리보기·삭제
export function PhotoPicker({ images, onChange, max = 4 }) {
  const camRef = useRef(null)
  const galRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [phoneOpen, setPhoneOpen] = useState(false)
  const imagesRef = useRef(images)
  useEffect(()=>{ imagesRef.current = images })

  // 폰에서 받은 사진을 첨부 목록에 추가 (장수·용량 한도 적용). 안내 문구를 반환.
  function addFromPhone(fresh) {
    let next = [...imagesRef.current]
    let msg = ''
    for (const url of fresh) {
      if (next.length >= max) { msg = `최대 ${max}장까지만 첨부돼요. 넘친 사진은 버려졌어요`; break }
      if (next.join('').length + url.length > MAX_TOTAL_CHARS) { msg = '용량 한도를 넘은 사진은 버려졌어요'; break }
      next.push(url)
    }
    imagesRef.current = next
    onChange(next)
    return msg
  }

  async function handleFiles(fileList) {
    setErr('')
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'))
    if (files.length === 0) return
    setBusy(true)
    try {
      let next = [...images]
      for (const f of files) {
        if (next.length >= max) { setErr(`사진은 최대 ${max}장까지 첨부할 수 있어요`); break }
        const url = await compressImage(f)
        if (next.join('').length + url.length > MAX_TOTAL_CHARS) {
          setErr('사진 용량이 너무 커요. 몇 장 빼고 다시 시도하세요'); break
        }
        next = [...next, url]
      }
      onChange(next)
    } catch (e) {
      console.error(e)
      setErr('사진을 처리하지 못했어요. 다른 사진으로 시도해 주세요')
    }
    setBusy(false)
  }

  const btn = {
    background:'#191c2b',border:'1px solid #272a3d',color:'#dde1f2',borderRadius:7,
    padding:'7px 12px',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit'
  }

  return (
    <div style={{marginBottom:10}}>
      <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
        <button type="button" style={btn} disabled={busy||images.length>=max} onClick={()=>camRef.current?.click()}>📷 촬영</button>
        <button type="button" style={btn} disabled={busy||images.length>=max} onClick={()=>galRef.current?.click()}>🖼 앨범에서 선택</button>
        <button type="button" style={{...btn,borderColor:'rgba(249,185,52,0.5)',color:'#f9b934'}}
          disabled={busy||images.length>=max} onClick={()=>setPhoneOpen(true)}>📲 폰에서 받기</button>
        <span style={{fontSize:10,color:'#5e6585'}}>
          {busy ? '사진 처리 중...' : `${images.length}/${max}장 · 자동으로 용량이 줄어들어요`}
        </span>
      </div>
      <input ref={camRef} type="file" accept="image/*" capture="environment"
        style={{display:'none'}}
        onChange={e=>{ handleFiles(e.target.files); e.target.value='' }}/>
      <input ref={galRef} type="file" accept="image/*" multiple
        style={{display:'none'}}
        onChange={e=>{ handleFiles(e.target.files); e.target.value='' }}/>
      {err && <div style={{fontSize:11,color:'#f87171',marginTop:6}}>{err}</div>}
      {phoneOpen && (
        <PhoneReceiveModal onAdd={addFromPhone} onClose={()=>setPhoneOpen(false)}
          attachedText={`현재 첨부 ${images.length}/${max}장`}/>
      )}
      {images.length > 0 && (
        <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:8}}>
          {images.map((src,i)=>(
            <div key={i} style={{position:'relative'}}>
              <img src={src} alt="" style={{width:72,height:72,objectFit:'cover',borderRadius:8,border:'1px solid #272a3d'}}/>
              <button type="button" onClick={()=>onChange(images.filter((_,j)=>j!==i))}
                style={{position:'absolute',top:-6,right:-6,width:20,height:20,borderRadius:999,border:'none',
                  background:'#f87171',color:'#000',fontSize:11,fontWeight:900,cursor:'pointer',lineHeight:'20px',padding:0}}>
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
