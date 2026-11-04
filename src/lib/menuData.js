// QR 메뉴·주문 (명함 뒷면 QR → /menu)
//
// menu/public = { items: [...], settings: {...}, updatedAt }   (로그인 없이 읽기 — Firestore 규칙 필요)
//   item = { id, mode:'pickup'|'delivery', cat, name, price, best, soldOut, hidden, desc,
//            options: [{ id, name, required, multi, choices:[{ name, price }] }] }
// orders/{자동 id} = { createdAt, mode, items:[{ id, name, price, qty, options:[{group,name,price}], total }],
//                     subtotal, deliveryFee, total, phone, address, request, pay:'card'|'cash', pickupIn,
//                     status:'new'|'accepted'|'done'|'canceled', code }
//   손님(로그인 안 함)은 만들기만, 사장님·매장 계정이 보고 상태를 바꿈
// 포스 메뉴 이름의 '포)'·'배)'는 떼고 mode로 나눔, ★는 best(추천)로 바꿈

export const MODES = { pickup:'포장', delivery:'배달' }
export const CATS = ['짬뽕', '짜장', '밥', '요리', '사이드', '음료', '행사']

export const DEFAULT_SETTINGS = {
  phone: '02-824-0410',
  minDelivery: 18000,     // 배달 최소 주문 금액
  freeDelivery: 30000,    // 이 금액 이상이면 배달비 없음
  deliveryFee: 1900,
  open: true,             // 주문 받기 (끄면 메뉴만 보이고 전화 주문 안내)
  notice: '',
  cats: CATS,             // 메뉴 분류 (순서대로 손님 화면에 나옴, 메뉴 고치기에서 추가·이름 바꾸기·순서·삭제)
  hoursOn: false,         // 켜면 아래 영업시간·브레이크에만 주문을 받음
  lastOrder: 30,          // 마감 몇 분 전까지 주문 받기
  // 요일별 (0=일 ~ 6=토) 영업시간과 브레이크. closed 면 그날 쉼
  hours: {
    0: { closed:true, open:'10:30', close:'21:30', bStart:'', bEnd:'' },
    1: { open:'10:30', close:'21:30', bStart:'', bEnd:'' },
    2: { open:'10:30', close:'21:30', bStart:'', bEnd:'' },
    3: { open:'10:30', close:'21:30', bStart:'', bEnd:'' },
    4: { open:'10:30', close:'21:30', bStart:'', bEnd:'' },
    5: { open:'10:30', close:'21:30', bStart:'', bEnd:'' },
    6: { open:'10:30', close:'21:30', bStart:'14:30', bEnd:'16:30' },
  },
}

export const DAYS = ['일','월','화','수','목','금','토']
const toMin = t => { if (!t) return null; const [h,m] = String(t).split(':').map(Number); return h*60 + (m||0) }
const pad2 = n => String(n).padStart(2,'0')
const fromMin = m => `${pad2(Math.floor(m/60) % 24)}:${pad2(m % 60)}`

// 분류 순서: 설정에 있는 순서 + 설정에 없는데 메뉴가 쓰는 분류는 뒤에
export function catsOf(settings, items) {
  const base = settings?.cats?.length ? settings.cats : CATS
  return [...base, ...[...new Set((items||[]).map(i=>i.cat))].filter(c => c && !base.includes(c))]
}

// 지금 주문을 받을 수 있는지 (영업시간·브레이크·주문 마감)
//  → { ok, text: 손님에게 보여줄 말, today: '오늘 10:30~21:30 · 브레이크 14:30~16:30' }
export function openState(settings, now = new Date()) {
  const s = { ...DEFAULT_SETTINGS, ...(settings||{}) }
  const day = { ...(DEFAULT_SETTINGS.hours[now.getDay()]||{}), ...(s.hours?.[now.getDay()]||{}) }
  const O = toMin(day.open), C = toMin(day.close), B0 = toMin(day.bStart), B1 = toMin(day.bEnd)
  const today = day.closed ? '오늘은 쉬는 날' : `오늘 ${day.open}~${day.close}${B0 != null && B1 != null ? ` · 브레이크 ${day.bStart}~${day.bEnd}` : ''}`
  if (s.open === false) return { ok:false, text:'지금은 QR 주문을 받지 않아요. 전화로 주문해 주세요', today }
  if (!s.hoursOn) return { ok:true, text:'', today: '' }
  const n = now.getHours()*60 + now.getMinutes()
  const last = C != null ? C - (+s.lastOrder || 0) : null
  if (day.closed) return { ok:false, text:'오늘은 쉬는 날이에요', today }
  if (O != null && n < O) return { ok:false, text:`아직 영업 전이에요 · ${day.open}부터 주문할 수 있어요`, today }
  if (last != null && n >= last) return { ok:false, text:`오늘 주문은 마감됐어요${+s.lastOrder ? ` (마감 ${s.lastOrder}분 전까지 받아요)` : ''}`, today }
  if (B0 != null && B1 != null && n >= B0 && n < B1) return { ok:false, text:`지금은 브레이크 시간이에요 · ${day.bEnd}부터 다시 주문할 수 있어요`, today }
  return { ok:true, text:'', today, until: last != null ? fromMin(last) : null }
}

// [이름, 가격, 분류] — 포스 화면 사진대로 (2026-11)
const D = [
  ['짜장',8000,'짜장'],['짜장곱빼기',9500,'짜장'],['고추짜장',9500,'짜장'],['고추짜장곱빼기',11000,'짜장'],
  ['★고기짜장',10500,'짜장'],['★고기짜장곱빼기',12000,'짜장'],['쟁반짜장(2인)',19000,'짜장'],
  ['짬뽕',10000,'짬뽕'],['짬뽕곱빼기',11500,'짬뽕'],['고추짬뽕',11000,'짬뽕'],['고추짬뽕곱빼기',12500,'짬뽕'],
  ['★고기짬뽕',12000,'짬뽕'],['★고기짬뽕곱빼기',13500,'짬뽕'],['차돌짬뽕',14000,'짬뽕'],['차돌짬뽕곱빼기',15500,'짬뽕'],
  ['소고기짬뽕',13000,'짬뽕'],['소고기짬뽕곱빼기',14500,'짬뽕'],['슈림프투움바짬뽕',13000,'짬뽕'],
  ['볶음짬뽕(1인분)',11500,'짬뽕'],['볶음짬뽕(2인분)',20000,'짬뽕'],['애호박찌개짬뽕',10000,'짬뽕'],['콩국수',10500,'짬뽕'],
  ['짬뽕밥',10000,'밥'],['고추짬뽕밥',11000,'밥'],['★고기짬뽕밥',12000,'밥'],['차돌짬뽕밥',14000,'밥'],['소고기짬뽕밥',13000,'밥'],
  ['애호박찌개짬뽕밥',10000,'밥'],['볶음밥',11000,'밥'],['볶음밥곱빼기',12500,'밥'],['짜장밥',10000,'밥'],
  ['잡채밥(국물제공)',11000,'밥'],['중화비빔밥',11000,'밥'],
  ['탕수육 미니(1인)',13800,'요리'],['탕수육 소(2인)',17800,'요리'],['탕수육 중(3인)',23800,'요리'],['탕수육 대(4인)',30800,'요리'],
  ['★깐풍새우',21900,'요리'],['크림새우',21900,'요리'],['깐풍기',20900,'요리'],['꿔바로우',20900,'요리'],['멘보샤',10900,'요리'],
  ['군만두',7000,'사이드'],['군만두 반접시',4000,'사이드'],['해물육교자',8000,'사이드'],['해물육교자 반접시',4500,'사이드'],
  ['연유꽃빵5개',5000,'사이드'],['단팥춘권',3000,'사이드'],['해쉬브라운 1개',1000,'사이드'],['해쉬브라운 3개',2500,'사이드'],
  ['계란후라이',900,'사이드'],['공기밥',1000,'사이드'],['짬뽕국물',2000,'사이드'],['짜장소스',4500,'사이드'],
  ['사천식(매콤소스)',1000,'사이드'],['파김치',3000,'사이드'],['단무지',1000,'사이드'],
  ['콜라',2000,'음료'],['제로콜라',2000,'음료'],['사이다 제로',2000,'음료'],['스프라이트',2000,'음료'],['초록매실',1000,'음료'],
  ['돼지국밥짬뽕',9000,'행사'],
]
const P = [
  ['짜장',7000,'짜장'],['짜장곱빼기',8500,'짜장'],['고추짜장',8500,'짜장'],['고추짜장곱빼기',10000,'짜장'],
  ['★고기짜장',9500,'짜장'],['★고기짜장곱빼기',11000,'짜장'],['쟁반짜장(2인)',18000,'짜장'],
  ['짬뽕',9000,'짬뽕'],['짬뽕곱빼기',10500,'짬뽕'],['고추짬뽕',10000,'짬뽕'],['고추짬뽕곱빼기',11500,'짬뽕'],
  ['★고기짬뽕',11000,'짬뽕'],['★고기짬뽕곱빼기',12500,'짬뽕'],['차돌짬뽕',13000,'짬뽕'],['차돌짬뽕곱빼기',14500,'짬뽕'],
  ['슈림프투움바짬뽕',12000,'짬뽕'],['볶음짬뽕(1인분)',10500,'짬뽕'],['볶음짬뽕(2인분)',19000,'짬뽕'],
  ['애호박찌개짬뽕',10000,'짬뽕'],['부대찌개짬뽕',10000,'짬뽕'],['콩국수',9500,'짬뽕'],
  ['짬뽕밥',9000,'밥'],['고추짬뽕밥',10000,'밥'],['★고기짬뽕밥',11000,'밥'],['차돌짬뽕밥',13000,'밥'],
  ['애호박찌개짬뽕밥',10000,'밥'],['부대찌개짬뽕밥',10000,'밥'],['볶음밥',9500,'밥'],['볶음밥곱빼기',11000,'밥'],['짜장밥',9000,'밥'],
  ['잡채밥(국물제공)',10000,'밥'],['중화비빔밥',9500,'밥'],
  ['탕수육 미니(1인)',11800,'요리'],['탕수육 소(2인)',16800,'요리'],['탕수육 중(3인)',22800,'요리'],['탕수육 대(4인)',29800,'요리'],
  ['★깐풍새우',20900,'요리'],['크림새우',20900,'요리'],['깐풍기',19900,'요리'],['꿔바로우',19900,'요리'],['멘보샤',9900,'요리'],
  ['군만두',7000,'사이드'],['군만두 반접시',4000,'사이드'],['해물육교자',8000,'사이드'],['해물육교자 반접시',4500,'사이드'],
  ['연유꽃빵5개',4500,'사이드'],['단팥춘권',3000,'사이드'],['해쉬브라운 1개',1000,'사이드'],['해쉬브라운 3개',2500,'사이드'],
  ['계란후라이',900,'사이드'],['공기밥',1000,'사이드'],['짬뽕국물',1000,'사이드'],['짜장소스',4500,'사이드'],
  ['사천식(매콤소스)',1000,'사이드'],['파김치',3000,'사이드'],['단무지',500,'사이드'],
  ['콜라',2000,'음료'],['제로콜라',2000,'음료'],['사이다 제로',2000,'음료'],['스프라이트',2000,'음료'],['초록매실',1000,'음료'],
  ['애호박찌개짬뽕(행사)',8000,'행사'],['애호박찌개짬뽕밥(행사)',8000,'행사'],
]

const build = (rows, mode) => rows.map(([n, price, cat], i) => ({
  id: `${mode[0]}${String(i+1).padStart(3,'0')}`, mode, cat, price,
  name: n.replace('★',''), best: n.startsWith('★'), soldOut:false, hidden:false, desc:'', options:[],
}))
export const DEFAULT_ITEMS = [...build(P,'pickup'), ...build(D,'delivery')]

export const won = n => `${(n||0).toLocaleString('ko-KR')}원`

// 옵션까지 더한 한 개 가격
export const unitPrice = (item, picked) => item.price + (picked||[]).reduce((a,o)=>a+(o.price||0),0)

// 담은 목록 합계와 배달비
export function totals(cart, mode, settings) {
  const s = { ...DEFAULT_SETTINGS, ...(settings||{}) }
  const subtotal = cart.reduce((a,l)=>a+l.total,0)
  const deliveryFee = mode === 'delivery' && subtotal > 0 && subtotal < s.freeDelivery ? s.deliveryFee : 0
  const short = mode === 'delivery' ? Math.max(0, s.minDelivery - subtotal) : 0
  return { subtotal, deliveryFee, total: subtotal + deliveryFee, short }
}
