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
