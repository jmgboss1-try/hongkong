// 우리 매장 손님 이야기: 테이블마다 손님 무리가 들어와서 주문하고, 음식을 받아 먹고, 나가고, 직원이 치우는 한 바퀴
//  - 시간(초)만으로 정해짐 (같은 시각이면 어느 화면에서 봐도 같은 장면). 테이블마다 시작 시각이 달라서 서로 다른 장면
//  - 가끔 생기는 일: 입구에서 미끄러짐, 손님끼리 수다, 단무지 더 달라고 부르기, 직원과 한마디
//  - 직원 일: 홀 직원이 주문 받고, 조리대(c3)에서 음식을 들고 가서 내려놓고, 다 먹으면 그릇을 퇴식구(c5)로
import { TABLES, seatNode, seatAisle } from './storeMap'

export const CYCLE = 300 // 한 무리 5분
const hashOf = str => { let h = 7; for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h }
const pickOf = (list, n) => list[n % list.length]

// 손님이 앉는 테이블 순서 (가운데부터, 바 자리는 마지막)
const TABLE_ORDER = ['2', '1', '3', '4', '5', '6', 'A1', 'A2', 'B2', 'B1', 'B3']
export const DISHES = { jjamppong: '짬뽕', jjajang: '짜장', tangsu: '탕수육' }
const COUNT = ['', '하나', '둘', '셋', '넷']

// 장면 대사 (사장님이 나중에 아바타 탭에서 바꿀 수 있게 한곳에 모음)
export const LIFE_LINES = {
  callOrder: ['여기요~ 주문할게요!', '저기요, 주문이요!', '사장님, 주문할게요~'],
  takeOrder: ['네! 주문 도와드릴게요', '네~ 뭐 드릴까요?'],
  confirm: ['네~ 금방 나와요!', '네, 바로 준비할게요!'],
  kitchenAck: ['네~!', '네, 들어갑니다!', '오케이~!'],
  serve: ['주문하신 음식 나왔습니다!', '맛있게 드세요~'],
  wow: ['와 맛있겠다!', '냄새 좋다~', '오 빨리 나왔네'],
  eat: ['음~ 맛있다!', '국물 진짜 시원하다', '탕수육 바삭하네', '역시 여기 짬뽕이야', '면 쫄깃하다'],
  chat: [['여기 짬뽕 진짜 맛있대', '오 기대된다'], ['배고파 죽겠다', '나도ㅠㅠ'], ['오늘 뭐 했어?', '그냥 일했지 뭐'], ['곱빼기 시킬 걸', '그러게ㅋㅋ']],
  callStaff: ['여기요! 단무지 좀 더 주세요', '저기요~ 물 좀 주세요', '앞접시 하나만 주세요!'],
  coming: ['네~ 갑니다!', '네! 잠시만요~'],
  handOver: ['여기 있습니다!', '더 필요하시면 불러주세요~'],
  thanks: ['감사합니다~', '고마워요!'],
  done: ['잘 먹었습니다!', '배부르다~', '다음에 또 오자'],
  bye: ['감사합니다~ 또 오세요!', '안녕히 가세요~'],
  slip: ['꽈당!', '으악!'],
  worry: ['괜찮으세요?!', '어이쿠, 다치신 데 없으세요?'],
  okay: ['괜찮아요 ㅎㅎ', '바닥이 좀 미끄럽네요'],
}

// 지금 손님 수(대략) → 앉을 테이블들. 한 테이블에 평균 2명 남짓
export function activeTables(guests) {
  const k = Math.min(TABLE_ORDER.length, Math.ceil(Math.max(0, guests) / 2.2))
  return TABLE_ORDER.slice(0, k).map(id => TABLES.find(t => t.id === id))
}

// 한 테이블의 이번 바퀴 손님 무리
function partyOf(table, n) {
  const h = hashOf(`${table.id}#${n}`)
  const size = table.bar ? 1 : 1 + (h % table.seats.length)
  const seats = Array.from({ length: size }, (_, i) => i)
  const dishes = seats.map(i => (hashOf(`${table.id}#${n}#${i}`) % 3 === 0 ? 'jjajang' : 'jjamppong'))
  const shared = size >= 2 && h % 2 === 0 ? 'tangsu' : null
  return { h, size, seats, dishes, shared, look: i => hashOf(`${table.id}#${n}#${i}#look`) }
}
const orderLine = p => {
  const c = {}
  for (const d of [...p.dishes, ...(p.shared ? [p.shared] : [])]) c[d] = (c[d] || 0) + 1
  return Object.entries(c).map(([d, k]) => `${DISHES[d]} ${COUNT[k] || k}`).join(', ') + '요!'
}

// t: 지금 시각(초). tables: activeTables. servers: 홀 일하는 사람 uid 목록. 돌려주는 것:
//  customers: [{ key, tableId, seat, node, mode:'walk'|'sit', start, to, look, say, fallen }]
//  food: { [tableId]: { state:'water'|'food'|'empty', dishes:[...], shared } }
//  tasks: { [uid]: { to, hold, say } }  ·  kitchenSay: 주방 사람이 할 말
export function storeLife(t, tables, servers) {
  const customers = [], food = {}, wants = []
  let kitchenSay = null
  for (const table of tables) {
    const off = (hashOf(table.id) * 37) % CYCLE
    const n = Math.floor((t + off) / CYCLE), s = (t + off) % CYCLE
    const p = partyOf(table, n)
    const k = p.h, line = (key, i = 0) => pickOf(LIFE_LINES[key], k + i)
    const aisle0 = seatAisle(table.id, 0)
    const slip = k % 4 === 0
    const chat = k % 3 === 0 && p.size >= 2
    const call = k % 3 === 1
    const say = {}   // 손님 번호 → 말
    const want = (pri, from, to, task) => s >= from && s < to && wants.push({ pri, table: table.id, ...task })

    // ── 손님 위치 ──
    for (const i of p.seats) {
      const base = { key: `${table.id}-${n}-${i}`, tableId: table.id, seat: i, node: seatNode(table.id, i), look: p.look(i) }
      if (s < 22) {
        const fallen = slip && i === 0 && s >= 2 && s < 7
        const go = slip ? s >= 10 : s >= i * 1.5
        customers.push({ ...base, mode: 'walk', start: 'door', to: go ? base.node : 'door', fallen })
      } else if (s < 250) customers.push({ ...base, mode: 'sit' })
      else if (s < 266) customers.push({ ...base, mode: 'walk', start: base.node, to: 'door' })
    }

    // ── 장면 ──
    if (slip && s < 12) {
      if (s >= 2 && s < 6) say[0] = line('slip')
      if (s >= 7 && s < 12) say[0] = line('okay')
      want(5, 2, 12, { to: 'd1', say: s >= 3 && s < 8 ? line('worry') : null })
    }
    if (s >= 22 && s < 27) say[0] = line('callOrder')
    want(3, 22, 48, { to: aisle0, hold: 'menu', say: s >= 28 && s < 33 ? line('takeOrder') : s >= 40 && s < 45 ? line('confirm') : null })
    if (s >= 34 && s < 39) say[0] = orderLine(p)
    want(3, 48, 56, { to: 'c3', say: s >= 48 && s < 53 ? orderLine(p) : null })
    if (s >= 52 && s < 57) kitchenSay = line('kitchenAck')
    if (chat) {
      const [a, b] = pickOf(LIFE_LINES.chat, k)
      if (s >= 70 && s < 75) say[0] = a
      if (s >= 78 && s < 83) say[1] = b
    }
    // 음식 가져가기: 조리대에서 들고 테이블로
    want(4, 110, 118, { to: 'c3' })
    want(4, 118, 140, { to: aisle0, hold: p.dishes[0], say: s >= 128 && s < 134 ? line('serve') : null })
    if (s >= 134 && s < 139) say[p.size > 1 ? 1 : 0] = line('wow')
    if (s >= 150 && s < 245 && (s + (k % 40)) % 40 < 5) say[(s >> 3) % p.size] = line('eat', s >> 3)
    if (call) {
      if (s >= 170 && s < 175) say[0] = line('callStaff')
      want(3, 170, 190, { to: aisle0, hold: 'tray', say: s >= 171 && s < 176 ? line('coming') : s >= 182 && s < 187 ? line('handOver') : null })
      if (s >= 188 && s < 193) say[0] = line('thanks')
    }
    if (s >= 245 && s < 250) say[0] = line('done')
    want(1, 248, 256, { to: 'c1', say: s >= 249 && s < 254 ? line('bye') : null })
    // 치우기: 테이블에서 그릇 들고 퇴식구로
    want(2, 266, 278, { to: aisle0 })
    want(2, 278, 292, { to: 'c5', hold: 'dishes' })

    for (const c of customers) if (c.tableId === table.id && say[c.seat]) c.say = say[c.seat]

    // ── 테이블 위 ──
    if (s >= 22 && s < 130) food[table.id] = { state: 'water', dishes: p.dishes, shared: null }
    else if (s >= 130 && s < 245) food[table.id] = { state: 'food', dishes: p.dishes, shared: p.shared }
    else if (s >= 245 && s < 276) food[table.id] = { state: 'empty', dishes: p.dishes, shared: p.shared }
  }

  // 일 나누기: 급한 것부터, 테이블마다 정해진 직원에게 (그 사람이 바쁘면 다른 빈 사람)
  const tasks = {}
  if (servers.length) {
    wants.sort((a, b) => b.pri - a.pri)
    for (const w of wants) {
      const first = hashOf(w.table) % servers.length
      for (let j = 0; j < servers.length; j++) {
        const uid = servers[(first + j) % servers.length]
        if (!tasks[uid]) { tasks[uid] = w; break }
      }
    }
  }
  return { customers, food, tasks, kitchenSay }
}
