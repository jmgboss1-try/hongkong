// 우리 매장 손님 이야기 (우리 매장 탭). 시각(초)만으로 정해져서 포스·폰 어디서 봐도 같은 장면
//  손님 한 무리 (테이블마다 5분 한 바퀴, 테이블마다 시작 시각이 다름):
//   들어옴(직원 "어서오세요") → 한 명이 키오스크에서 주문 (가끔 현금·이벤트 쿠폰이면 포스로) → 나머지는 자리로
//   → 주방 "네~ 들어갑니다" → 누군가 셀프바에서 단무지·김치 → 홀 직원이 음식을 들고 와서 "맛있게 드세요 / 그릇은 퇴식구에"
//   → 먹으면서 한마디 → "잘 먹었습니다" → 각자 그릇을 퇴식구에 갖다 놓고 나감(직원 "안녕히 가세요") → 직원이 테이블 닦기
//  가끔: 입구에서 미끄러짐, 손님끼리 수다
//  매장 전체: 포스에서 배달앱 주문 알림, 주방 직원 실수(메뉴 잘못 나감·허둥지둥·그릇 떨어뜨림) → 사장님 반응(다그치기·다독이기·위로)
//  사장님이 고치는 설정: rewards/storeLife = { lines:{키:[대사]}, freq:{slip,chat,selfbar,delivery,mistake}, kioskRate, tone, react:{id,tone} }
import { TABLES, seatNode, seatAisle } from './storeMap'

export const CYCLE = 300
const hashOf = str => { let h = 7; for (const ch of String(str)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h }
const pickOf = (list, n) => list?.length ? list[n % list.length] : null

const TABLE_ORDER = ['2', '1', '3', '4', '5', '6', 'A1', 'A2', 'B2', 'B1', 'B3']
export const DISHES = { jjamppong: '짬뽕', jjajang: '짜장', tangsu: '탕수육' }

// 고칠 수 있는 대사: [키, 이름, 누가 말하나, 기본 대사]. '/'는 두 줄, 수다는 '>'로 두 사람 (말1 > 말2)
export const LINE_DEFS = [
  ['welcome', '손님이 들어올 때', '직원', ['어서오세요~!', '어서오세요! 홍콩반점입니다']],
  ['bye', '손님이 나갈 때', '직원', ['안녕히 가세요~', '감사합니다~ 또 오세요!']],
  ['kiosk', '키오스크 앞에서', '손님', ['뭐 먹지…', '오늘은 짬뽕이다!', '탕수육도 시킬까?']],
  ['posOrder', '포스에 와서 주문', '손님', ['현금으로 할게요~', '이벤트 쿠폰 쓸 수 있죠?']],
  ['posReply', '포스 주문 받을 때', '직원', ['네~ 쿠폰 확인해 드릴게요', '네, 현금 결제 도와드릴게요']],
  ['kitchenAck', '주문이 들어오면', '주방', ['네~ 들어갑니다!', '짬뽕 들어갑니다~']],
  ['selfbar', '셀프바에서', '손님', ['단무지 많이 가져가야지', '김치 맛있겠다']],
  ['serve', '음식을 내갈 때', '직원', ['맛있게 드세요!/다 드신 그릇은 퇴식구에 반납 부탁드려요']],
  ['wow', '음식을 받았을 때', '손님', ['와 맛있겠다!', '냄새 좋다~']],
  ['eat', '먹는 동안', '손님', ['음~ 맛있다!', '국물 진짜 시원하다', '탕수육 바삭하네', '면 쫄깃하다']],
  ['chat', '손님끼리 수다 (말1 > 말2)', '손님', ['여기 짬뽕 진짜 맛있대 > 오 기대된다', '배고파 죽겠다 > 나도ㅠㅠ', '곱빼기 시킬 걸 > 그러게ㅋㅋ']],
  ['done', '다 먹었을 때', '손님', ['잘 먹었습니다!', '배부르다~']],
  ['slip', '입구에서 미끄러질 때', '손님', ['꽈당!', '으악!']],
  ['worry', '미끄러진 손님에게', '직원', ['괜찮으세요?!', '어이쿠, 다치신 데 없으세요?']],
  ['okay', '일어나면서', '손님', ['괜찮아요 ㅎㅎ', '바닥이 좀 미끄럽네요']],
  ['delivery', '포스 배달 주문 알림', '포스', ['쿠팡이츠~ 주문!', '배달의민족 주문~!', '요기요! 주문!', '땡겨요 주문이요~']],
  ['deliveryAck', '배달 주문 확인', '직원', ['네~ 확인!', '배달 들어갑니다~']],
  ['mWrong', '실수: 메뉴 잘못 나감', '주방 직원', ['헉, 짜장인데 짬뽕 나갔어요!', '앗 메뉴 잘못 나갔다…']],
  ['mFluster', '실수: 허둥지둥', '주방 직원', ['어어 잠깐만요!!', '주문이 너무 밀려요ㅠㅠ']],
  ['mDrop', '실수: 그릇 떨어뜨림', '주방 직원', ['쨍그랑!', '앗 그릇 떨어뜨렸어요!']],
  ['sorry', '실수하고 나서', '주방 직원', ['죄송합니다!', '바로 다시 할게요!']],
  ['scold', '사장님: 다그치기', '사장님', ['주문서 다시 확인하자!', '정신 차리고! 집중!']],
  ['pat', '사장님: 다독이기', '사장님', ['괜찮아, 천천히 하자', '다음엔 한 번 더 확인하자~']],
  ['comfort', '사장님: 위로', '사장님', ['바쁠 땐 그럴 수 있어', '괜찮아, 내가 도와줄게']],
  ['afterScold', '다그침 받고', '주방 직원', ['네! 조심하겠습니다!']],
  ['afterKind', '다독임·위로 받고', '주방 직원', ['감사합니다 사장님ㅠㅠ', '힘낼게요!']],
]
export const DEFAULT_LINES = Object.fromEntries(LINE_DEFS.map(([k, , , v]) => [k, v]))
// 얼마나 자주: 0 안 함, 1 드물게, 2 가끔, 3 자주
export const FREQ_DEFS = [['slip', '입구에서 미끄러짐'], ['chat', '손님끼리 수다'], ['selfbar', '셀프바 다녀오기'], ['delivery', '포스 배달 주문 알림'], ['mistake', '주방 실수']]
export const FREQ_LABELS = ['안 함', '드물게', '가끔', '자주']
export const TONES = [['random', '그때그때 다르게'], ['scold', '다그치기'], ['pat', '다독이기'], ['comfort', '위로']]
export const DEFAULT_LIFE = { freq: { slip: 2, chat: 2, selfbar: 2, delivery: 2, mistake: 1 }, kioskRate: 80, tone: 'random' }
export const lifeConfig = raw => {
  const lines = { ...DEFAULT_LINES }
  for (const [k, v] of Object.entries(raw?.lines || {})) if (Array.isArray(v) && v.some(x => String(x).trim())) lines[k] = v.filter(x => String(x).trim())
  return { ...DEFAULT_LIFE, ...(raw || {}), freq: { ...DEFAULT_LIFE.freq, ...(raw?.freq || {}) }, lines }
}
// 자주 할수록 잘 일어남: 테이블 이벤트는 '이번 바퀴에 일어날 확률'
const chance = f => [0, 0.15, 0.35, 0.6][f] ?? 0
const happens = (h, f) => (h % 1000) / 1000 < chance(f)

export function activeTables(guests) {
  const k = Math.min(TABLE_ORDER.length, Math.ceil(Math.max(0, guests) / 2.2))
  return TABLE_ORDER.slice(0, k).map(id => TABLES.find(t => t.id === id))
}

function partyOf(table, n) {
  const h = hashOf(`${table.id}#${n}`)
  const size = table.bar ? 1 : 1 + (h % table.seats.length)
  const seats = Array.from({ length: size }, (_, i) => i)
  const dishes = seats.map(i => (hashOf(`${table.id}#${n}#${i}`) % 3 === 0 ? 'jjajang' : 'jjamppong'))
  const shared = size >= 2 && h % 2 === 0 ? 'tangsu' : null
  return { h, size, seats, dishes, shared, look: i => hashOf(`${table.id}#${n}#${i}#look`) }
}

// crew = { servers:[uid], cooks:[uid], counter:[uid], delivery:[uid], owner:uid|null } (지금 일하는 사람)
// 돌려줌: customers, food, tasks{uid:{to,hold,say,sweat}}, shouts{uid:말}, posSay, mistake
export function storeLife(t, tables, crew, rawCfg) {
  const cfg = rawCfg?.lines ? rawCfg : lifeConfig(rawCfg)
  const L = (key, n) => pickOf(cfg.lines[key], n)
  const customers = [], food = {}, wants = [], shouts = {}
  const greeter = crew.counter[0] || crew.servers[0] || crew.owner
  const cook = crew.cooks[0] || crew.owner
  const shout = (uid, text) => { if (uid && text && !shouts[uid]) shouts[uid] = text }

  for (const table of tables) {
    const off = (hashOf(table.id) * 37) % CYCLE
    const n = Math.floor((t + off) / CYCLE), s = (t + off) % CYCLE
    const p = partyOf(table, n), k = p.h
    const aisle0 = seatAisle(table.id, 0)
    const slip = happens(hashOf(`slip${k}`), cfg.freq.slip)
    const chat = p.size >= 2 && happens(hashOf(`chat${k}`), cfg.freq.chat)
    const bar = happens(hashOf(`bar${k}`), cfg.freq.selfbar)
    const atPos = (hashOf(`pos${k}`) % 100) >= (cfg.kioskRate ?? 80)
    const orderAt = atPos ? 'g1' : 'ko'
    const barGuy = p.size - 1
    const say = {}
    const want = (pri, from, to, task) => s >= from && s < to && wants.push({ pri, table: table.id, ...task })

    // ── 손님이 어디 있나 ──
    for (const i of p.seats) {
      const base = { tableId: table.id, seat: i, node: seatNode(table.id, i), look: p.look(i), off: [i * 9, i * 3] }
      const id = `${table.id}-${n}-${i}`
      if (s < 30) {
        // 들어오기: 0번은 주문하러 (키오스크·포스) 갔다가 자리로, 나머지는 바로 자리로
        const fallen = slip && i === 0 && s >= 2 && s < 7
        const wait = slip ? s < 10 : s < i * 1.5
        const to = wait ? 'door' : i === 0 ? (s < 22 ? orderAt : base.node) : base.node
        customers.push({ ...base, key: id + '-in', mode: 'walk', start: 'door', to, fallen })
      } else if (bar && i === barGuy && s >= 40 && s < 62) {
        customers.push({ ...base, key: id + '-bar', mode: 'walk', start: base.node, to: s < 54 ? 'sb' : base.node })
      } else if (s < 245 + i * 2) {
        customers.push({ ...base, key: id, mode: 'sit' })
      } else if (s < 282) {
        // 그릇 들고 퇴식구에 놓고 나가기
        const toReturn = s < 258 + i * 2
        customers.push({ ...base, key: id + '-out', mode: 'walk', start: base.node, to: toReturn ? 'c5' : 'door', hold: toReturn ? 'dishes' : null })
      }
    }

    // ── 장면 ──
    if (s >= 1 && s < 6) shout(greeter, L('welcome', k))
    if (slip && s < 12) {
      if (s >= 2 && s < 6) say[0] = L('slip', k)
      if (s >= 7 && s < 12) say[0] = L('okay', k)
      want(5, 2, 12, { to: 'd1', say: s >= 3 && s < 8 ? L('worry', k) : null })
    }
    if (s >= 12 && s < 17) say[0] = atPos ? L('posOrder', k) : L('kiosk', k)
    // 포스 주문: 카운터 직원이 포스 앞으로 와서 받음
    if (atPos) want(4, 12, 24, { who: 'counter', to: 'c1', say: s >= 17 && s < 22 ? L('posReply', k) : null })
    if (s >= 24 && s < 29) shout(cook, L('kitchenAck', k))
    if (bar && s >= 50 && s < 55) say[barGuy] = L('selfbar', k)
    if (chat) {
      const [a, b] = String(L('chat', k) || '').split('>').map(x => x.trim())
      if (a && s >= 70 && s < 75) say[0] = a
      if (b && s >= 78 && s < 83) say[1] = b
    }
    want(4, 110, 118, { to: 'c3' })
    want(4, 118, 140, { to: aisle0, hold: p.dishes[0], say: s >= 127 && s < 134 ? L('serve', k) : null })
    if (s >= 134 && s < 139) say[p.size > 1 ? 1 : 0] = L('wow', k)
    if (s >= 150 && s < 238 && (s + (k % 40)) % 40 < 5) say[(s >> 3) % p.size] = L('eat', s >> 3)
    if (s >= 239 && s < 244) say[0] = L('done', k)
    if (s >= 262 && s < 267) shout(greeter, L('bye', k))
    want(2, 284, 296, { to: aisle0, hold: 'towel' })

    for (const c of customers) if (c.tableId === table.id && say[c.seat] && !c.key.endsWith('-out')) c.say = say[c.seat]

    // 테이블 위: 물컵 → 반찬(셀프바) → 음식 → 빈 그릇 (손님이 들고 가면 없어짐)
    const side = bar && s >= 56
    if (s >= 24 && s < 130) food[table.id] = { state: 'water', dishes: p.dishes, side }
    else if (s >= 130 && s < 239) food[table.id] = { state: 'food', dishes: p.dishes, shared: p.shared, side: true }
    else if (s >= 239 && s < 250) food[table.id] = { state: 'empty', dishes: p.dishes, shared: p.shared }
  }

  // 일 나누기 (급한 것부터)
  const tasks = {}
  if (crew.servers.length || crew.counter.length) {
    wants.sort((a, b) => b.pri - a.pri)
    for (const w of wants) {
      const cu = w.who === 'counter' ? crew.counter.find(u => !tasks[u]) : null
      if (cu) { tasks[cu] = w; continue }
      if (!crew.servers.length) continue
      const first = hashOf(w.table) % crew.servers.length
      for (let j = 0; j < crew.servers.length; j++) {
        const uid = crew.servers[(first + j) % crew.servers.length]
        if (!tasks[uid]) { tasks[uid] = w; break }
      }
    }
  }

  // ── 포스 배달 주문 알림 ──
  let posSay = null
  const dPeriod = [0, 180, 90, 45][cfg.freq.delivery] || 0
  if (dPeriod) {
    const dn = Math.floor(t / dPeriod), ds = t % dPeriod, at = hashOf(`d${dn}`) % Math.max(1, dPeriod - 12)
    if (ds >= at && ds < at + 5) posSay = { id: `d${dn}`, text: L('delivery', hashOf(`dl${dn}`)) }
    if (ds >= at + 3 && ds < at + 8) shout(crew.delivery[0] || crew.counter[0] || crew.owner, L('deliveryAck', dn))
  }

  // ── 주방 실수 → 사장님 반응 ──
  let mistake = null
  const mPeriod = [0, 600, 300, 150][cfg.freq.mistake] || 0
  const staffPool = crew.cooks.filter(u => u !== crew.owner).length ? crew.cooks.filter(u => u !== crew.owner) : crew.all.filter(u => u !== crew.owner)
  if (mPeriod && staffPool.length && crew.owner) {
    const mn = Math.floor(t / mPeriod), ms = t % mPeriod, at = hashOf(`m${mn}`) % Math.max(1, mPeriod - 30)
    const e = ms - at
    if (e >= 0 && e < 26) {
      const id = `m${mn}`, kind = ['mWrong', 'mFluster', 'mDrop'][hashOf(id) % 3]
      const actor = staffPool[hashOf(id + 'a') % staffPool.length]
      const chosen = cfg.react?.id === id ? cfg.react.tone : null
      const tone = chosen || (cfg.tone && cfg.tone !== 'random' ? cfg.tone : ['scold', 'pat', 'comfort'][hashOf(id + 't') % 3])
      mistake = { id, kind, actor, tone, chosen: !!chosen, phase: e < 12 ? 'oops' : 'react', left: 12 - e }
      const spot = kind === 'mWrong' ? 'c3' : kind === 'mFluster' ? ['kmyeon', 'kfry', 'kw1', 'ksink'][(e >> 1) % 4] : null
      const actorSay = e < 5 ? L(kind, hashOf(id)) : e < 10 ? L('sorry', hashOf(id)) : e >= 20 ? L(tone === 'scold' ? 'afterScold' : 'afterKind', hashOf(id)) : null
      tasks[actor] = { ...(spot ? { to: spot } : {}), hold: kind === 'mWrong' ? 'jjamppong' : kind === 'mDrop' && e < 10 ? 'none' : undefined, say: actorSay, sweat: true, stay: !spot }
      if (e >= 10) tasks[crew.owner] = { near: actor, say: e >= 12 && e < 19 ? L(tone, hashOf(id + tone)) : null }
      if (kind === 'mDrop' && e < 14) mistake.shards = actor
    }
  }
  return { customers, food, tasks, shouts, posSay, mistake }
}
