// 우리 매장 캐릭터
// users/{uid}.avatar = { hair, hairColor, skin, shirt, acc }   직원이 내 기록에서 꾸밈
// users/{uid}.positions = ['wok' | 'kitchen' | 'hall' | 'counter' | 'delivery', ...]   사장님이 인원관리에서 정함 (여러 개 가능, position = 첫 번째)

export const HAIRS = [
  { id:'short', label:'짧은 머리' }, { id:'long', label:'긴 머리' }, { id:'bun', label:'올림머리' },
  { id:'ponytail', label:'포니테일' }, { id:'twin', label:'양갈래' }, { id:'bob', label:'단발 뱅' },
  { id:'twoblock', label:'투블럭' }, { id:'curly', label:'곱슬' }, { id:'spiky', label:'삐죽 머리' },
  { id:'mohawk', label:'모히칸' }, { id:'cap', label:'모자' }, { id:'bald', label:'민머리' },
]
export const HAIR_COLORS = ['#1D1B18', '#5A3A22', '#8B5A2B', '#D9A441', '#B42318', '#2B5C9E', '#C77DA6', '#E8E4DC']
export const TIP_COLORS = ['', '#D9A441', '#B42318', '#2B5C9E', '#C77DA6', '#2E7D45', '#E8E4DC']   // 브릿지 (''은 없음)
export const SKINS = ['#F6D7B8', '#EBC29B', '#D3A274', '#A9744A', '#7A4E2E']
export const SHIRTS = ['#C3261C', '#1D1B18', '#2B5C9E', '#2E7D45', '#B45309', '#6B4FA0', '#E8E4DC', '#D9A441']
export const EYES = [
  { id:'dot', label:'기본' }, { id:'smile', label:'웃는 눈' }, { id:'sleepy', label:'졸린 눈' }, { id:'wink', label:'윙크' }, { id:'big', label:'큰 눈' },
]
export const BROWS = [{ id:'none', label:'없음' }, { id:'normal', label:'보통' }, { id:'thick', label:'진한' }, { id:'angry', label:'화난' }]
export const MOUTHS = [{ id:'smile', label:'미소' }, { id:'grin', label:'활짝' }, { id:'flat', label:'무표정' }, { id:'tongue', label:'메롱' }]
export const MARKS = [{ id:'none', label:'없음' }, { id:'mustache', label:'콧수염' }, { id:'beard', label:'턱수염' }, { id:'freckles', label:'주근깨' }, { id:'mole', label:'점' }]
export const HATS = [
  { id:'none', label:'없음' }, { id:'chef', label:'요리사 모자' }, { id:'bandana', label:'반다나' }, { id:'beanie', label:'비니' }, { id:'backcap', label:'거꾸로 모자' },
]
export const TOPS = [{ id:'long', label:'긴팔' }, { id:'tee', label:'반팔' }, { id:'hoodie', label:'후드' }, { id:'chef', label:'조리복' }]
export const APRONS = ['#F3F1EC', '#FFFFFF', '#1D1B18', '#C3261C', '#2B5C9E', '#3E5A80', 'none']   // none = 앞치마 없음
export const PANTS = ['#3B3A38', '#1D1B18', '#3E5A80', '#C8B48F', '#7A7672']
export const SHOES = [{ id:'black', label:'검정' }, { id:'white', label:'흰 운동화' }, { id:'boots', label:'장화' }]
export const HOLDS = [
  { id:'auto', label:'포지션 따라' }, { id:'none', label:'없음' }, { id:'ladle', label:'국자' }, { id:'wok', label:'웍' }, { id:'tray', label:'쟁반' },
  { id:'towel', label:'행주' }, { id:'bag', label:'배달 봉투' }, { id:'menu', label:'메뉴판' }, { id:'phone', label:'휴대폰' },
]
// 포지션 따라: 웍 담당은 웍, 주방은 국자, 홀은 쟁반, 카운터는 메뉴판, 배달은 봉투
export const HOLD_BY_POSITION = { wok:'wok', kitchen:'ladle', hall:'tray', counter:'menu', delivery:'bag' }
export const ACCS = [
  { id:'none', label:'없음' }, { id:'glasses', label:'안경' }, { id:'sunglasses', label:'선글라스' }, { id:'mask', label:'마스크' },
  { id:'band', label:'두건' }, { id:'headset', label:'헤드셋' },
]
export const DECOS = [{ id:'blush', label:'볼터치' }, { id:'earring', label:'귀걸이' }, { id:'hairpin', label:'머리핀' }, { id:'nametag', label:'명찰' }]
// 특별 아이템 (포상): 사장님이 우리 매장 아래 '특별 아이템 주기'에서 직원별로 줌 (users/{uid}.unlocks).
// 받은 직원만 꾸미기에서 보이고 입을 수 있음 (look.special). 사장님은 다 입어 볼 수 있음
export const LOCKED = [
  { id:'goldApron', label:'금색 앞치마' }, { id:'crown', label:'왕관' }, { id:'sparkle', label:'반짝이' },
  { id:'goldWok', label:'황금 웍' }, { id:'rainbow', label:'무지개 브릿지' },
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
  const basic = ['short','long','bun','spiky','ponytail','bob']
  return { hair: basic[(h >>> 1) % basic.length], hairColor: pick(HAIR_COLORS.slice(0, 4), 3),
    skin: pick(SKINS.slice(0, 3), 5), shirt: pick(SHIRTS, 7), acc: 'none', ...LOOK_BASE }
}
// 새 항목들의 기본값 (예전에 저장한 캐릭터도 그대로 보이게)
export const LOOK_BASE = { eyes:'dot', brows:'none', mouth:'smile', mark:'none', hat:'none', tip:'', top:'long', apron:'#F3F1EC',
  pants:'#3B3A38', shoes:'black', hold:'auto', deco:[], special:[] }
// 얼굴 소품은 여러 개 (예전엔 하나만 저장: 'glasses' 같은 글자)
export const accsOf = acc => Array.isArray(acc) ? acc : acc && acc !== 'none' ? [acc] : []
// 받지 않은(또는 거둬들인) 특별 아이템은 빼고 보여 줌. 사장님은 다 됨
export const lookOf = user => {
  const l = { ...defaultLook(user?.uid), ...(user?.avatar || {}) }
  const ok = user?.role === 'owner' ? null : new Set(user?.unlocks || [])
  return { ...l, special: (l.special || []).filter(id => !ok || ok.has(id)) }
}
// 아무렇게나 섞기 (꾸미기 화면의 '랜덤')
export function randomLook() {
  const r = list => list[Math.floor(Math.random() * list.length)]
  const id = list => r(list).id
  return { hair:id(HAIRS), hairColor:r(HAIR_COLORS), tip: Math.random() < 0.25 ? r(TIP_COLORS.slice(1)) : '', skin:r(SKINS), shirt:r(SHIRTS),
    eyes:id(EYES), brows:id(BROWS), mouth:id(MOUTHS), mark: Math.random() < 0.3 ? id(MARKS) : 'none', hat: Math.random() < 0.4 ? id(HATS) : 'none',
    top:id(TOPS), apron:r(APRONS), pants:r(PANTS), shoes:id(SHOES), hold:'auto', acc: Math.random() < 0.4 ? [id(ACCS.slice(1))] : [],
    deco: DECOS.filter(() => Math.random() < 0.2).map(d => d.id) }
}

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
@keyframes avTwinkle { 0%,100% { opacity: 0; transform: scale(.4) } 50% { opacity: 1; transform: scale(1) } }
@keyframes avDrip { 0% { opacity: 0; transform: translateY(0) } 30% { opacity: 1 } 100% { opacity: 0; transform: translateY(6px) } }
@keyframes avPop { 0% { opacity: 0; transform: scale(.6) } 15%,85% { opacity: 1; transform: scale(1) } 100% { opacity: 0; transform: scale(.9) } }
.av-twinkle { animation: avTwinkle 1.4s ease-in-out infinite; transform-box: fill-box; transform-origin: 50% 50% }
.av-drip { animation: avDrip 1.1s ease-in infinite }
.av-pop { animation: avPop 5s ease-out both; transform-box: fill-box; transform-origin: 0% 100% }
.os-move { transition: transform 2.5s linear }
@media (prefers-reduced-motion: reduce) {
  .av-bob, .av-walk, .av-arm, .av-flame, .av-float, .av-pace, .av-twinkle, .av-drip, .av-pop { animation: none !important }
  .os-move { transition: none !important }
}
`
