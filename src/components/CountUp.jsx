import { useEffect, useRef, useState } from 'react'

// 금액이 0(또는 이전 값)에서 새 값까지 굴러가듯 바뀜. 움직임 줄이기 설정이면 바로 바뀜
//  <CountUp value={12345}/> → "12,345"
export default function CountUp({ value, ms = 650 }) {
  const n = Math.round(+value || 0)
  const [v, setV] = useState(n)
  const from = useRef(0)
  useEffect(() => {
    const reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const dur = reduce ? 1 : ms
    const start = performance.now(), a = from.current, b = n
    let raf
    const step = t => {
      const k = Math.min(1, (t - start) / dur), e = 1 - Math.pow(1 - k, 3)
      const cur = Math.round(a + (b - a) * e)
      from.current = cur
      setV(cur)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [n, ms])
  return <>{v.toLocaleString('ko-KR')}</>
}
