// 사진 첨부 (Astryx): PhotoAttach 의 PhotoPicker / PhotoGrid 와 같은 동작을 새 디자인으로
// 확대 보기(PhotoViewer)와 폰에서 받기(PhoneReceiveDialog)도 Astryx Dialog. 받는 동작은 PhotoAttach 의 usePhoneInbox
import { useEffect, useRef, useState } from 'react'
import { HStack, VStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Button } from '@astryxdesign/core/Button'
import { Thumbnail } from '@astryxdesign/core/Thumbnail'
import { Dialog, DialogHeader } from '@astryxdesign/core/Dialog'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { compressImage, MAX_TOTAL_CHARS } from '../components/PhotoAttach'
import { usePhoneInbox } from '../lib/phoneInbox'
import { Legacy } from './AstryxPage'

// 읽기용 썸네일 (누르면 확대)
export function PhotoThumbs({ images, label }) {
  const [open, setOpen] = useState(false)
  if (!images || images.length === 0) return null
  return (
    <>
      <HStack gap={2} wrap="wrap">
        {images.map((src, i) => <Thumbnail key={i} src={src} alt="" label={`${label} ${i + 1}`} onClick={() => setOpen(true)}/>)}
      </HStack>
      {open && <PhotoViewer images={images} label={label} onClose={() => setOpen(false)}/>}
    </>
  )
}

// 쓰기용: 촬영 / 앨범에서 선택 / 폰에서 받기 + 미리보기·빼기
export function PhotoField({ images, onChange, max = 4 }) {
  const camRef = useRef(null), galRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [phoneOpen, setPhoneOpen] = useState(false)
  const imagesRef = useRef(images)
  useEffect(() => { imagesRef.current = images })

  function addFromPhone(fresh) {
    let next = [...imagesRef.current], msg = ''
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
    if (!files.length) return
    setBusy(true)
    try {
      let next = [...images]
      for (const f of files) {
        if (next.length >= max) { setErr(`사진은 최대 ${max}장까지 첨부할 수 있어요`); break }
        const url = await compressImage(f)
        if (next.join('').length + url.length > MAX_TOTAL_CHARS) { setErr('사진 용량이 너무 커요. 몇 장 빼고 다시 시도하세요'); break }
        next = [...next, url]
      }
      onChange(next)
    } catch (e) { console.error(e); setErr('사진을 처리하지 못했어요. 다른 사진으로 시도해 주세요') }
    setBusy(false)
  }
  const full = busy || images.length >= max
  return (
    <VStack gap={2}>
      <HStack gap={2} vAlign="center" wrap="wrap">
        <Button size="sm" label="촬영" isDisabled={full} onClick={() => camRef.current?.click()}/>
        <Button size="sm" label="앨범에서 선택" isDisabled={full} onClick={() => galRef.current?.click()}/>
        <Button size="sm" label="폰에서 받기" isDisabled={full} onClick={() => setPhoneOpen(true)}/>
        <Text type="supporting" color="secondary">{busy ? '사진 처리 중...' : `${images.length}/${max}장 · 자동으로 용량이 줄어들어요`}</Text>
      </HStack>
      <Legacy>
        <input ref={camRef} type="file" accept="image/*" capture="environment" style={{display:'none'}} onChange={e => { handleFiles(e.target.files); e.target.value = '' }}/>
        <input ref={galRef} type="file" accept="image/*" multiple style={{display:'none'}} onChange={e => { handleFiles(e.target.files); e.target.value = '' }}/>
      </Legacy>
      {phoneOpen && <PhoneReceiveDialog onAdd={addFromPhone} onClose={() => setPhoneOpen(false)} attachedText={`현재 첨부 ${images.length}/${max}장`}/>}
      {err && <Text type="supporting" color="accent">{err}</Text>}
      {images.length > 0 && (
        <HStack gap={2} wrap="wrap">
          {images.map((src, i) => <Thumbnail key={i} src={src} alt="" label={`첨부 사진 ${i + 1}`} showRemoveOn="always" onRemove={() => onChange(images.filter((_, j) => j !== i))}/>)}
        </HStack>
      )}
    </VStack>
  )
}

// 사진 크게 보기 (예전 Lightbox)
export function PhotoViewer({ images, label, onClose }) {
  const close = o => { if (!o) onClose() }
  return (
    <Dialog isOpen onOpenChange={close} width={760} maxHeight="94dvh">
      <DialogHeader title={label || '사진'} onOpenChange={close}/>
      <VStack gap={3} padding={4}>
        {images.length === 0 ? <Text color="secondary">등록된 사진이 없어요</Text>
          : images.map((src, i) => <img key={i} src={src} alt={`${label || '사진'} ${i + 1}`}/>)}
        <HStack><Button label="닫기" onClick={onClose}/></HStack>
      </VStack>
    </Dialog>
  )
}

// 폰에서 사진 받기 (QR). 예전 PhoneReceiveModal 과 같은 props
export function PhoneReceiveDialog({ onAdd, onClose, attachedText, title = '폰에서 사진 받기', hint, hiRes = false }) {
  const { qr, status, received, note } = usePhoneInbox({ onAdd, hiRes })
  const close = o => { if (!o) onClose() }
  return (
    <Dialog isOpen onOpenChange={close} width={400}>
      <DialogHeader title={title} subtitle="폰 카메라로 아래 QR을 찍어보세요 (10분간 유효)" onOpenChange={close}/>
      <VStack gap={3} padding={4} hAlign="center">
        {status === 'creating' && <Text color="secondary">QR 만드는 중...</Text>}
        {status === 'error' && <Banner status="error" title="QR을 만들지 못했어요" description="Firestore 보안 규칙(photoInbox) 설정을 확인해 주세요."/>}
        {status === 'ready' && <>
          <img src={qr} alt="사진 보낼 QR"/>
          <Text type="supporting" justify="center">{hint || '폰으로 찍으면 이 화면의 사진 칸에 바로 들어와요. 여러 장 연속으로 보내도 돼요.'}</Text>
          <Badge variant={received > 0 ? 'success' : 'neutral'} label={received > 0 ? `${received}장 받음` : '사진 기다리는 중...'}/>
          {attachedText && <Text type="supporting" color="secondary">{attachedText}</Text>}
          {note && <Text type="supporting" color="accent">{note}</Text>}
        </>}
        <Button variant="primary" label="완료" onClick={onClose}/>
      </VStack>
    </Dialog>
  )
}
