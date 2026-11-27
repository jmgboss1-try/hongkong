// 사진 첨부 (Astryx): PhotoAttach 의 PhotoPicker / PhotoGrid 와 같은 동작을 새 디자인으로
// 확대 보기(Lightbox)와 폰에서 받기(PhoneReceiveModal)는 화면 전체를 덮는 창이라 예전 모양 그대로 씀
import { useEffect, useRef, useState } from 'react'
import { HStack, VStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Button } from '@astryxdesign/core/Button'
import { Thumbnail } from '@astryxdesign/core/Thumbnail'
import { compressImage, Lightbox, PhoneReceiveModal, MAX_TOTAL_CHARS } from '../components/PhotoAttach'
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
      {open && <Legacy><Lightbox images={images} label={label} onClose={() => setOpen(false)}/></Legacy>}
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
        {phoneOpen && <PhoneReceiveModal onAdd={addFromPhone} onClose={() => setPhoneOpen(false)} attachedText={`현재 첨부 ${images.length}/${max}장`}/>}
      </Legacy>
      {err && <Text type="supporting" color="accent">{err}</Text>}
      {images.length > 0 && (
        <HStack gap={2} wrap="wrap">
          {images.map((src, i) => <Thumbnail key={i} src={src} alt="" label={`첨부 사진 ${i + 1}`} showRemoveOn="always" onRemove={() => onChange(images.filter((_, j) => j !== i))}/>)}
        </HStack>
      )}
    </VStack>
  )
}
