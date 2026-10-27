import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'
import { db } from '../firebase'
import { doc, getDoc, updateDoc, onSnapshot, writeBatch, arrayUnion, Timestamp } from 'firebase/firestore'

// 폰 → 포스 파일 옮기기 (엑셀·PDF·사진 등 아무 파일)
// 사진 받기(photoInbox)와 같은 방식: 포스가 photoInbox/{sid} 와 조각 칸 photoInbox/{sid}-{n} 을 미리 만들고,
// 로그인 없는 폰 페이지(/upload/:sid?f=1)는 그 문서들에 updateDoc 으로 덧붙이기만 한다.
// Firestore 문서는 1MB 제한이 있어서 파일을 600KB씩 잘라 칸 하나에 한 조각씩 넣는다.
const SLOTS = 24
const CHUNK = 600_000
const MAX_TOTAL = SLOTS * CHUNK // 약 14MB
const VALID_MIN = 30

const slotId = (sid, n) => `${sid}-${n}`
const fmtSize = b => b >= 1024*1024 ? `${(b/1024/1024).toFixed(1)}MB` : `${Math.max(1, Math.round(b/1024))}KB`

function toBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] || '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}
function fromBase64(b64) {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}
function saveBlob(url, name) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// ── 포스 쪽: QR을 보여주고 받은 파일을 바로 다운로드 폴더에 저장 ──
export function PhoneFileReceiveModal({ onClose }) {
  const [qr, setQr] = useState('')
  const [status, setStatus] = useState('creating') // creating | ready | error
  const [files, setFiles] = useState([])           // {id, name, size, url?, error?}

  useEffect(()=>{
    let cancelled = false
    let unsub = null
    let sid = null
    const seen = new Set()
    const urls = []

    async function receive(meta) {
      setFiles(prev => [...prev, { id:meta.id, name:meta.name, size:meta.size }])
      try {
        const parts = []
        for (const n of meta.slots) {
          const snap = await getDoc(doc(db,'photoInbox',slotId(sid,n)))
          const list = snap.exists() ? (snap.data().images || []) : []
          for (const s of list) {
            const [fid, idx, b64] = s.split('|')
            if (fid === meta.id) parts[+idx] = b64
          }
        }
        if (parts.length !== meta.n || parts.some(p => p === undefined)) throw new Error('missing chunk')
        const blob = new Blob(parts.map(fromBase64), { type: meta.type || 'application/octet-stream' })
        const url = URL.createObjectURL(blob)
        urls.push(url)
        saveBlob(url, meta.name)
        setFiles(prev => prev.map(f => f.id === meta.id ? { ...f, url } : f))
      } catch(e) {
        console.error(e)
        setFiles(prev => prev.map(f => f.id === meta.id ? { ...f, error:true } : f))
      }
    }

    async function start() {
      try {
        const bytes = new Uint8Array(16)
        crypto.getRandomValues(bytes)
        sid = Array.from(bytes).map(b=>b.toString(16).padStart(2,'0')).join('')
        const base = { images: [], createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + VALID_MIN*60*1000) }
        const batch = writeBatch(db)
        batch.set(doc(db,'photoInbox',sid), base)
        for (let n = 0; n < SLOTS; n++) batch.set(doc(db,'photoInbox',slotId(sid,n)), base)
        await batch.commit()
        if (cancelled) return
        const dataUrl = await QRCode.toDataURL(`${window.location.origin}/upload/${sid}?f=1`, { width:260, margin:1 })
        if (cancelled) return
        setQr(dataUrl)
        setStatus('ready')
        unsub = onSnapshot(doc(db,'photoInbox',sid), snap => {
          const list = snap.exists() ? (snap.data().images || []) : []
          for (const s of list) {
            let meta
            try { meta = JSON.parse(s) } catch { continue }
            if (!meta?.id || seen.has(meta.id)) continue
            seen.add(meta.id)
            receive(meta)
          }
        })
      } catch(e) {
        console.error(e)
        if (!cancelled) setStatus('error')
      }
    }
    start()
    return () => {
      cancelled = true
      if (unsub) unsub()
      if (sid) {
        const batch = writeBatch(db)
        batch.delete(doc(db,'photoInbox',sid))
        for (let n = 0; n < SLOTS; n++) batch.delete(doc(db,'photoInbox',slotId(sid,n)))
        batch.commit().catch(()=>{})
      }
      // 다운로드가 시작될 시간을 준 뒤 정리
      setTimeout(() => urls.forEach(u => URL.revokeObjectURL(u)), 60_000)
    }
  },[])

  return (
    <div onClick={onClose}
      style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',zIndex:1000,
        display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
      <div onClick={e=>e.stopPropagation()}
        style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,padding:22,
          maxWidth:380,width:'100%',textAlign:'center',color:'#1D1B18'}}>
        <div style={{fontSize:16,fontWeight:800,marginBottom:4}}>폰에서 파일 받기</div>
        <div style={{fontSize:12,color:'#6E6A63',marginBottom:14}}>
          폰 카메라로 QR을 찍고 파일을 고르세요 ({VALID_MIN}분간 유효)
        </div>
        {status==='creating' && <div style={{color:'#6E6A63',fontSize:12,padding:'60px 0'}}>QR 만드는 중...</div>}
        {status==='error' && (
          <div style={{color:'#B42318',fontSize:12,padding:'30px 0',lineHeight:1.7}}>
            QR을 만들지 못했어요.<br/>Firestore 보안 규칙(photoInbox) 설정을 확인해 주세요.
          </div>
        )}
        {status==='ready' && (
          <>
            <img src={qr} alt="QR" style={{width:220,height:220,background:'#fff',borderRadius:6,padding:6}}/>
            <div style={{fontSize:12,color:'#1D1B18',marginTop:10,lineHeight:1.7}}>
              엑셀·PDF·사진 등 어떤 파일이든 돼요. 한 번에 {Math.floor(MAX_TOTAL/1024/1024)}MB까지.<br/>
              받은 파일은 이 컴퓨터의 <b>다운로드</b> 폴더에 저장돼요.
            </div>
            <div style={{marginTop:14,borderTop:'1px solid #DCD7CE',textAlign:'left'}}>
              {files.length === 0 && (
                <div style={{fontSize:13,color:'#6E6A63',padding:'10px 0',textAlign:'center'}}>파일 기다리는 중...</div>
              )}
              {files.map(f => (
                <div key={f.id} style={{display:'flex',alignItems:'center',gap:8,padding:'8px 0',borderBottom:'1px solid #EFEBE4',fontSize:13}}>
                  <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</span>
                  <span style={{color:'#6E6A63',fontSize:12,fontVariantNumeric:'tabular-nums'}}>{fmtSize(f.size)}</span>
                  {f.error ? <span style={{color:'#B42318',fontSize:12,fontWeight:700}}>실패</span>
                    : f.url ? (
                      <button onClick={()=>saveBlob(f.url, f.name)}
                        style={{background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,padding:'3px 8px',fontSize:11,cursor:'pointer',fontFamily:'inherit',color:'#2E7D45',fontWeight:700}}>
                        저장됨 · 다시 저장
                      </button>
                    ) : <span style={{color:'#2B5C9E',fontSize:12}}>받는 중</span>}
                </div>
              ))}
            </div>
          </>
        )}
        <button onClick={onClose}
          style={{marginTop:16,width:'100%',background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,
            color:'#1D1B18',padding:'9px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
          닫기
        </button>
      </div>
    </div>
  )
}

// ── 폰 쪽: 파일을 골라 조각내서 보냄 (로그인 없음) ──
export function PhoneFileSend({ sid }) {
  const inputRef = useRef(null)
  const nextRef = useRef(null) // 다음에 쓸 조각 칸 번호 (새로고침해도 이어서 쓰도록 sessionStorage에 보관)
  const [sent, setSent] = useState([]) // {name, size}
  const [progress, setProgress] = useState('')
  const [err, setErr] = useState('')
  const [dead, setDead] = useState(false)

  const storeKey = `fileSend-${sid}`
  if (nextRef.current === null) {
    let v = 0
    try { v = +sessionStorage.getItem(storeKey) || 0 } catch { /* 사용 불가 */ }
    nextRef.current = v
  }
  const setNext = v => {
    nextRef.current = v
    try { sessionStorage.setItem(storeKey, String(v)) } catch { /* 사용 불가 */ }
  }

  async function sendFile(f) {
    const n = Math.ceil(f.size / CHUNK)
    if (n > SLOTS - nextRef.current) {
      throw Object.assign(new Error('full'), { full:true })
    }
    const id = Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b=>b.toString(16).padStart(2,'0')).join('')
    const slots = []
    for (let i = 0; i < n; i++) {
      setProgress(`${f.name} 보내는 중 ${Math.round(i/n*100)}%`)
      const b64 = await toBase64(f.slice(i*CHUNK, (i+1)*CHUNK))
      for (;;) {
        if (nextRef.current >= SLOTS) throw Object.assign(new Error('full'), { full:true })
        const slot = nextRef.current
        try {
          await updateDoc(doc(db,'photoInbox',slotId(sid,slot)), { images: arrayUnion(`${id}|${i}|${b64}`) })
          setNext(slot + 1)
          slots.push(slot)
          break
        } catch(e) {
          // 이미 쓰인 칸이라 1MB를 넘으면 다음 칸으로
          if (e?.code === 'invalid-argument') { setNext(slot + 1); continue }
          throw e
        }
      }
    }
    await updateDoc(doc(db,'photoInbox',sid), {
      images: arrayUnion(JSON.stringify({ id, name:f.name, type:f.type, size:f.size, n, slots })),
    })
  }

  async function handleFiles(fileList) {
    setErr('')
    const files = Array.from(fileList || [])
    for (const f of files) {
      try {
        await sendFile(f)
        setSent(prev => [...prev, { name:f.name, size:f.size }])
      } catch(e) {
        console.error(e)
        if (e?.full) setErr(`${f.name}: 이 QR로 보낼 수 있는 용량(${Math.floor(MAX_TOTAL/1024/1024)}MB)을 넘었어요. 포스에서 새 QR을 만들어 주세요`)
        else if (e?.code === 'permission-denied' || e?.code === 'not-found') setDead(true)
        else setErr(`${f.name}: 전송에 실패했어요. 다시 시도해 주세요`)
        break
      }
    }
    setProgress('')
  }

  const busy = !!progress

  return (
    <div style={{minHeight:'100vh',background:'#FAF9F6',color:'#1D1B18',padding:'28px 18px',
      fontFamily:'inherit',maxWidth:480,margin:'0 auto',textAlign:'left'}}>
      <div style={{fontSize:20,fontWeight:800,marginBottom:4}}>파일 보내기</div>
      <div style={{fontSize:12,color:'#6E6A63',marginBottom:24}}>고른 파일이 매장 포스 컴퓨터에 바로 저장돼요</div>

      {dead ? (
        <div style={{background:'rgba(180,35,24,0.08)',border:'1px solid rgba(180,35,24,0.35)',
          borderRadius:6,padding:20,fontSize:14,color:'#B42318',lineHeight:1.7,fontWeight:600}}>
          만료됐거나 잘못된 QR이에요.<br/>포스 화면에서 "폰에서 파일 받기"를 다시 눌러 새 QR을 만들어 주세요.
        </div>
      ) : (
        <>
          <button disabled={busy} onClick={()=>inputRef.current?.click()}
            style={{width:'100%',border:'none',borderRadius:6,padding:'20px 0',fontSize:18,fontWeight:800,
              cursor:'pointer',fontFamily:'inherit',background:'#C3261C',color:'#FFFFFF',opacity:busy?0.6:1}}>
            파일 고르기
          </button>
          <div style={{fontSize:12,color:'#6E6A63',marginTop:8,marginBottom:18}}>
            엑셀·PDF·사진 등 어떤 파일이든 돼요. 여러 개 골라도 돼요 (모두 합쳐 {Math.floor(MAX_TOTAL/1024/1024)}MB까지)
          </div>
          <input ref={inputRef} type="file" multiple style={{display:'none'}}
            onChange={e=>{ handleFiles(e.target.files); e.target.value='' }}/>

          {progress && <div style={{fontSize:13,color:'#2B5C9E',marginBottom:12}}>{progress}</div>}
          {err && <div style={{fontSize:13,color:'#B42318',marginBottom:12,lineHeight:1.6}}>{err}</div>}

          {sent.length > 0 && (
            <>
              <div style={{fontSize:13,fontWeight:700,color:'#2E7D45',borderBottom:'2px solid #1D1B18',paddingBottom:6}}>
                {sent.length}개 전송 완료
              </div>
              {sent.map((f,i)=>(
                <div key={i} style={{display:'flex',gap:8,padding:'8px 0',borderBottom:'1px solid #DCD7CE',fontSize:14}}>
                  <span style={{flex:1,minWidth:0,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.name}</span>
                  <span style={{color:'#6E6A63',fontVariantNumeric:'tabular-nums'}}>{fmtSize(f.size)}</span>
                </div>
              ))}
              <div style={{fontSize:12,color:'#6E6A63',marginTop:14}}>더 보낼 파일이 있으면 위 버튼을 다시 누르세요. 다 보냈으면 이 창을 닫아도 돼요.</div>
            </>
          )}
        </>
      )}
    </div>
  )
}
