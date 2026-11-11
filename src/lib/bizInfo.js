// 사업장 정보 (임금명세서·원천징수영수증에 찍힘): rewards/bizInfo = { name, bizNo, ceo, address }
// rewards 는 직원·매장계정이 읽을 수 있고 사장님만 쓸 수 있어서, 직원 화면의 임금명세서에도 그대로 나옴 (규칙 변경 없음)
// 예전에 meta/bizInfo (사장님만 읽음)에 저장했던 값은 사장님 화면에서만 대신 읽어 줌
import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'

export const DEFAULT_BIZ = { name:'홍콩반점 중앙대점', bizNo:'', ceo:'', address:'' }
export async function loadBizInfo() {
  try {
    const s = await getDoc(doc(db, 'rewards', 'bizInfo'))
    if (s.exists()) return { ...DEFAULT_BIZ, ...s.data() }
  } catch { /* 못 읽음 */ }
  try {
    const old = await getDoc(doc(db, 'meta', 'bizInfo'))   // 예전 위치 (사장님만 읽힘)
    if (old.exists()) return { ...DEFAULT_BIZ, ...old.data() }
  } catch { /* 직원은 여기서 막힘 */ }
  return DEFAULT_BIZ
}
export const saveBizInfo = biz => setDoc(doc(db, 'rewards', 'bizInfo'), biz)
export function useBizInfo() {
  const [biz, setBiz] = useState(DEFAULT_BIZ)
  useEffect(() => { let off = false; loadBizInfo().then(b => { if (!off) setBiz(b) }); return () => { off = true } }, [])
  return biz
}

// 직인 이미지: rewards/bizSeal = { img: 'data:image/png;base64,…' } (임금명세서·원천징수영수증의 '(서명 또는 인)' 위에 찍힘)
// 명세서를 받는 직원 화면에도 찍혀야 해서 직원이 읽을 수 있는 rewards 에 둠 (쓰기는 사장님만)
export async function loadSeal() {
  try { const s = await getDoc(doc(db, 'rewards', 'bizSeal')); return s.exists() ? (s.data().img || null) : null } catch { return null }
}
export const saveSeal = img => setDoc(doc(db, 'rewards', 'bizSeal'), { img: img || null, at: new Date().toISOString() })
export function useSeal() {
  const [seal, setSeal] = useState(null)
  useEffect(() => { let off = false; loadSeal().then(s => { if (!off) setSeal(s) }); return () => { off = true } }, [])
  return seal
}
// 사진 → 직인 PNG: 최대 280px, 흰 바탕(밝고 색이 옅은 점)은 투명하게, 인주색은 남김
export function makeSealPng(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image()
    img.onload = () => {
      const k = Math.min(1, 280 / Math.max(img.width, img.height))
      const w = Math.round(img.width * k), h = Math.round(img.height * k)
      const c = document.createElement('canvas'); c.width = w; c.height = h
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h)
      const d = g.getImageData(0, 0, w, h), px = d.data
      for (let i = 0; i < px.length; i += 4) {
        const r = px[i], gg = px[i + 1], b = px[i + 2]
        const red = r - (gg + b) / 2           // 붉은 정도
        const light = (r + gg + b) / 3
        if (red < 28 || light > 240) px[i + 3] = 0                        // 바탕 → 투명
        else { px[i + 3] = Math.min(255, Math.round((red - 20) * 4)); px[i] = 196; px[i + 1] = 30; px[i + 2] = 36 } // 인주색으로 진하게
      }
      g.putImageData(d, 0, 0); URL.revokeObjectURL(url)
      resolve(c.toDataURL('image/png'))
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 열 수 없어요')) }
    img.src = url
  })
}
// 서명란 위에 직인 겹치기
export const sealStyle = { position:'absolute', right:-6, top:'50%', transform:'translateY(-50%)', width:66, height:66, objectFit:'contain', pointerEvents:'none', opacity:0.95 }
