// 우리 매장 캐릭터
// users/{uid}.avatar = { hair, hairColor, skin, shirt, acc }   직원이 내 기록에서 꾸밈
// users/{uid}.position = 'wok' | 'kitchen' | 'hall' | 'counter' | 'delivery'   사장님이 인원관리에서 정함

export const HAIRS = [
  { id:'short', label:'짧은 머리' }, { id:'long', label:'긴 머리' }, { id:'bun', label:'올림머리' },
  { id:'spiky', label:'삐죽 머리' }, { id:'cap', label:'모자' }, { id:'bald', label:'민머리' },
]
export const HAIR_COLORS = ['#1D1B18', '#5A3A22', '#8B5A2B', '#D9A441', '#B42318', '#2B5C9E', '#C77DA6', '#E8E4DC']
export const SKINS = ['#F6D7B8', '#EBC29B', '#D3A274', '#A9744A', '#7A4E2E']
export const SHIRTS = ['#C3261C', '#1D1B18', '#2B5C9E', '#2E7D45', '#B45309', '#6B4FA0', '#E8E4DC', '#D9A441']
export const ACCS = [
  { id:'none', label:'없음' }, { id:'glasses', label:'안경' }, { id:'band', label:'두건' },
  { id:'mask', label:'마스크' }, { id:'blush', label:'볼터치' },
]
export const POSITIONS = [
  { id:'wok', label:'웍 (조리)' }, { id:'kitchen', label:'주방 (준비·설거지)' }, { id:'hall', label:'홀 (서빙)' },
  { id:'counter', label:'카운터' }, { id:'delivery', label:'배달·포장' },
]

// 꾸미지 않은 직원: uid로 정해지는 기본 모습 (매번 같음)
export function defaultLook(uid = '') {
  let h = 0
  for (const ch of String(uid)) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  const pick = (list, k) => list[(h >>> k) % list.length]
  return { hair: pick(HAIRS, 1).id === 'bald' ? 'short' : pick(HAIRS, 1).id, hairColor: pick(HAIR_COLORS.slice(0, 4), 3),
    skin: pick(SKINS.slice(0, 3), 5), shirt: pick(SHIRTS, 7), acc: 'none' }
}
export const lookOf = user => ({ ...defaultLook(user?.uid), ...(user?.avatar || {}) })

// 캐릭터·매장 움직임 (한 번만 넣으면 됨). 기기에서 '동작 줄이기'를 켜면 모두 멈춤
export const AVATAR_CSS = `
@keyframes avBob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-1.5px) } }
@keyframes avArm { 0%,100% { transform: rotate(0deg) } 50% { transform: rotate(-40deg) } }
@keyframes avFlame { 0%,100% { opacity: .95; transform: scaleY(1) } 50% { opacity: .6; transform: scaleY(.7) } }
@keyframes avFloat { 0% { opacity: 0; transform: translateY(0) } 30% { opacity: 1 } 100% { opacity: 0; transform: translateY(-14px) } }
@keyframes avPace { 0%,100% { transform: translateX(0) } 50% { transform: translateX(var(--pace, 60px)) } }
.av-bob { animation: avBob .8s ease-in-out infinite }
.av-walk { animation: avBob .3s ease-in-out infinite }
.av-arm { animation: avArm .5s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 0% }
.av-flame { animation: avFlame .35s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 100% }
.av-float { animation: avFloat 2.4s ease-out infinite }
.av-pace { animation: avPace 7s ease-in-out infinite }
.os-move { transition: transform 3s linear }
@media (prefers-reduced-motion: reduce) {
  .av-bob, .av-walk, .av-arm, .av-flame, .av-float, .av-pace { animation: none !important }
  .os-move { transition: none !important }
}
`
