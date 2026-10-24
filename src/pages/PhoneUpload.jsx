import { useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { db } from '../firebase'
import { doc, updateDoc, arrayUnion } from 'firebase/firestore'
import { compressImage } from '../components/PhotoAttach'

const MAX_PER_SESSION = 6

// 로그인 없이 접속하는 폰 전용 업로드 페이지 (포스에서 만든 QR로 진입)
export default function PhoneUpload() {
  const { sid } = useParams()
  const [params] = useSearchParams()
  const hiRes = params.get('hi') === '1' // 매출 출력물처럼 글씨를 읽어야 하는 사진은 크게
  const camRef = useRef(null)
  const galRef = useRef(null)
  const [sent, setSent] = useState([])   // 전송 완료된 썸네일
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [dead, setDead] = useState(false) // 만료/잘못된 QR

  async function handleFiles(fileList) {
    setErr('')
    const files = Array.from(fileList || []).filter(f => f.type.startsWith('image/'))
    if (files.length === 0) return
    setBusy(true)
    for (const f of files) {
      if (sent.length >= MAX_PER_SESSION) { setErr(`한 번에 최대 ${MAX_PER_SESSION}장까지 보낼 수 있어요`); break }
      try {
        const url = hiRes ? await compressImage(f, 1600, 450) : await compressImage(f)
        await updateDoc(doc(db,'photoInbox',sid), { images: arrayUnion(url) })
        setSent(prev => [...prev, url])
      } catch(e) {
        console.error(e)
        if (e?.code === 'permission-denied' || e?.code === 'not-found') setDead(true)
        else setErr('전송에 실패했어요. 다시 시도해 주세요')
        break
      }
    }
    setBusy(false)
  }

  const bigBtn = {
    width:'100%',border:'none',borderRadius:14,padding:'20px 0',fontSize:18,fontWeight:800,
    cursor:'pointer',fontFamily:'inherit'
  }

  return (
    <div style={{minHeight:'100vh',background:'#0b0d16',color:'#dde1f2',padding:'28px 18px',
      fontFamily:'inherit',maxWidth:480,margin:'0 auto'}}>
      <div style={{fontSize:20,fontWeight:800,marginBottom:4}}>📲 사진 보내기</div>
      <div style={{fontSize:12,color:'#5e6585',marginBottom:24}}>찍은 사진이 매장 포스 화면으로 바로 전송돼요</div>

      {dead ? (
        <div style={{background:'rgba(248,113,113,0.10)',border:'1.5px solid rgba(248,113,113,0.35)',
          borderRadius:12,padding:20,fontSize:14,color:'#f87171',lineHeight:1.7,fontWeight:600}}>
          만료됐거나 잘못된 QR이에요.<br/>포스 화면에서 "폰에서 받기"를 다시 눌러 새 QR을 만들어 주세요.
        </div>
      ) : (
        <>
          <div style={{display:'flex',flexDirection:'column',gap:12,marginBottom:20}}>
            <button style={{...bigBtn,background:'#f9b934',color:'#000'}} disabled={busy}
              onClick={()=>camRef.current?.click()}>📷 사진 찍기</button>
            <button style={{...bigBtn,background:'#191c2b',color:'#dde1f2',border:'1px solid #272a3d',fontSize:15,padding:'14px 0'}}
              disabled={busy} onClick={()=>galRef.current?.click()}>🖼 앨범에서 선택</button>
          </div>
          <input ref={camRef} type="file" accept="image/*" capture="environment" style={{display:'none'}}
            onChange={e=>{ handleFiles(e.target.files); e.target.value='' }}/>
          <input ref={galRef} type="file" accept="image/*" multiple style={{display:'none'}}
            onChange={e=>{ handleFiles(e.target.files); e.target.value='' }}/>

          {busy && <div style={{fontSize:13,color:'#93c5fd',marginBottom:12}}>전송 중...</div>}
          {err && <div style={{fontSize:13,color:'#f87171',marginBottom:12}}>{err}</div>}

          {sent.length > 0 && (
            <>
              <div style={{fontSize:13,fontWeight:700,color:'#34d399',marginBottom:10}}>
                ✓ {sent.length}장 전송 완료 — 포스 화면을 확인하세요
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {sent.map((src,i)=>(
                  <img key={i} src={src} alt="" style={{width:84,height:84,objectFit:'cover',borderRadius:10,border:'1px solid #272a3d'}}/>
                ))}
              </div>
              <div style={{fontSize:11,color:'#5e6585',marginTop:14}}>더 보낼 사진이 있으면 위 버튼을 다시 누르세요. 다 보냈으면 이 창을 닫아도 돼요.</div>
            </>
          )}
        </>
      )}
    </div>
  )
}
