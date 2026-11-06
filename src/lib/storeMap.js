// 우리 매장 도면 (사장님이 그려 준 실제 배치) + 직원이 걸어 다니는 통로
// 좌표는 그림(960 x 620) 기준. 캐릭터는 통로 점(NODES)과 그 사이 선(EDGES)으로만 움직여서
// 테이블·조리대 위를 가로지르지 않음. 자리를 옮길 때는 통로를 따라 가장 짧은 길로 감 (route)

export const MAP_W = 960, MAP_H = 620

// 통로 점 (발 위치)
export const NODES = {
  // 주방 안 (윗벽 면·싱크와 웍 줄 사이)
  ka0: [86, 74], kw1: [153, 74], kw2: [219, 74], kw3: [285, 74], kmyeon: [380, 70], kfry: [465, 74], ksink: [508, 74],
  kgate: [86, 150],                                   // 선반과 조리대 사이 주방 출입 (점선)
  // 조리대 앞 (POS·조리대·냉장·정수 쪽, 홀에서 보는 면)
  c0: [86, 200], c1: [152, 200], c2: [228, 200], c3: [300, 200], c4: [442, 200], c5: [499, 200],
  // 홀
  g1: [205, 256], g2: [338, 256], g3: [520, 256],
  t2s: [338, 350], m3: [338, 450], t1s: [244, 462], hl: [160, 452],
  m4: [494, 450], d1: [494, 530], door: [494, 610],
  j1: [540, 360], sb: [645, 374], m5: [650, 432], t3s: [610, 468], t4s: [742, 468],
  a1: [800, 380], a2: [815, 528], a0: [760, 300], a5: [712, 210], a6: [712, 82], aB: [800, 170],
  // 브레이크 (술 보관함과 창고 사이)
  r1: [76, 462], r2: [104, 462],
  // 테이블 사이 좁은 통로 (손님이 자리에 앉고 직원이 음식을 내려놓는 곳)
  w3: [680, 585], w56: [712, 133], w5b: [700, 250], w6t: [712, 30], wA1: [840, 318], wA: [845, 452], wA2: [845, 590],
}

const EDGES = [
  ['ka0','kw1'],['kw1','kw2'],['kw2','kw3'],['kw3','kmyeon'],['kmyeon','kfry'],['kfry','ksink'],
  ['ka0','kgate'],['kgate','c0'],
  ['c0','c1'],['c1','c2'],['c2','c3'],['c3','c4'],['c4','c5'],
  ['c2','g1'],['c3','g2'],['c5','g3'],['g1','g2'],['g2','g3'],
  ['g2','t2s'],['t2s','m3'],['m3','t1s'],['t1s','hl'],['hl','r2'],['r2','r1'],
  ['m3','m4'],['m4','d1'],['d1','door'],
  ['g3','j1'],['m4','j1'],['j1','sb'],['sb','m5'],['m4','m5'],['m5','t3s'],['m5','t4s'],
  ['sb','a1'],['a1','a0'],['a0','a5'],['a5','w56'],['w56','a6'],['a0','aB'],['aB','a6'],['a1','a2'],
  ['m5','w3'],['a5','w5b'],['a0','w5b'],['a6','w6t'],['a1','wA1'],['a1','wA'],['a2','wA'],['a2','wA2'],
]

// 의자마다 그 앞 통로 점 (테이블을 가로지르지 않는 가장 가까운 곳). 의자 자체도 통로 점이 됨: s_<테이블>_<번호>
const SEAT_FROM = {
  '1': ['hl','hl','t1s','m3'], '2': ['g1','hl','t2s','t2s'], '3': ['t3s','t3s','d1','w3'], '4': ['t4s','t4s','w3','a2'],
  '5': ['w56','w56','w5b','w5b'], '6': ['w6t','w6t','w56','w56'], 'A1': ['wA1','wA'], 'A2': ['wA','wA2'],
  'B1': ['aB'], 'B2': ['aB'], 'B3': ['aB'],
}
export const seatNode = (tableId, i) => `s_${tableId}_${i}`
export const seatAisle = (tableId, i) => SEAT_FROM[tableId]?.[i] || 'g2'

const ADJ = {}
for (const [a, b] of EDGES) { (ADJ[a] ||= []).push(b); (ADJ[b] ||= []).push(a) }

const dist = (a, b) => Math.hypot(NODES[a][0] - NODES[b][0], NODES[a][1] - NODES[b][1])
export const nodeDist = dist

// 가장 짧은 길 (점 이름 목록, 처음과 끝 포함)
export function route(from, to) {
  if (!NODES[from] || !NODES[to]) return [to]
  if (from === to) return [to]
  const d = { [from]: 0 }, prev = {}, done = new Set()
  for (;;) {
    let u = null
    for (const k in d) if (!done.has(k) && (u === null || d[k] < d[u])) u = k
    if (u === null) return [from, to]
    if (u === to) break
    done.add(u)
    for (const v of ADJ[u] || []) {
      const nd = d[u] + dist(u, v)
      if (d[v] === undefined || nd < d[v]) { d[v] = nd; prev[v] = u }
    }
  }
  const path = [to]
  while (path[0] !== from) path.unshift(prev[path[0]])
  return path
}

// 포지션별 자리, 홀 직원이 돌아다니는 곳
export const SLOTS = {
  wok: ['kw1', 'kw2', 'kw3'],
  kitchen: ['kmyeon', 'ksink', 'kfry', 'c3'],
  counter: ['c1'],
  delivery: ['c2', 'c0'],
  hall: ['g2', 't2s', 'sb'],
  rest: ['r1', 'r2'],
}
export const HALL_POINTS = ['g1','g2','g3','t2s','t1s','m4','sb','t3s','t4s','a1','a2','a5','a6','aB']

// 손님 테이블: 사각형과 의자(손님이 앉는 자리)
export const TABLES = [
  { id:'1',  x:207, y:490, w:62, h:104, seats:[[190,515],[190,570],[288,515],[288,570]] },
  { id:'2',  x:214, y:298, w:62, h:104, seats:[[196,322],[196,378],[294,322],[294,378]] },
  { id:'3',  x:562, y:510, w:98, h:38,  seats:[[585,496],[635,496],[585,562],[635,562]] },
  { id:'4',  x:700, y:512, w:84, h:40,  seats:[[722,498],[762,498],[722,566],[762,566]] },
  { id:'5',  x:592, y:180, w:84, h:40,  seats:[[612,166],[656,166],[612,234],[656,234]] },
  { id:'6',  x:592, y:46,  w:84, h:40,  seats:[[612,32],[656,32],[612,100],[656,100]] },
  { id:'A1', x:862, y:344, w:78, h:66,  seats:[[901,330],[901,424]] },
  { id:'A2', x:862, y:490, w:78, h:66,  seats:[[901,476],[901,570]] },
  { id:'B3', x:874, y:72,  w:70, h:62,  seats:[[845,103]], bar:true },
  { id:'B2', x:874, y:138, w:70, h:62,  seats:[[845,169]], bar:true },
  { id:'B1', x:874, y:204, w:70, h:62,  seats:[[845,235]], bar:true },
]
for (const t of TABLES) t.seats.forEach((xy, i) => {
  const id = seatNode(t.id, i), from = seatAisle(t.id, i)
  NODES[id] = xy; (ADJ[id] ||= []).push(from); (ADJ[from] ||= []).push(id)
})
// 손님이 앉는 순서: 테이블마다 한 명씩 돌아가며 (한쪽에 몰리지 않게)
export const SEAT_ORDER = (() => {
  const order = ['2','1','3','4','5','6','A1','A2','B2','B1','B3']
  const out = []
  for (let r = 0; r < 4; r++) for (const id of order) { const t = TABLES.find(x => x.id === id); if (t.seats[r]) out.push({ table: t, seat: t.seats[r] }) }
  return out
})()
