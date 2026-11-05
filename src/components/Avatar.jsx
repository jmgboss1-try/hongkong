// 우리 매장 캐릭터 한 명 (16 x 20 픽셀 그림). pose: idle | work | walk | rest
// 움직임은 CSS 클래스(av-*)로 줌. 화면에 lib/avatar.js 의 AVATAR_CSS 를 한 번 넣어야 움직임
// look: lib/avatar.js 의 LOOK_BASE 항목들 (얼굴·머리·모자·옷·앞치마·바지·신발·드는 것·소품·꾸밈)
// role: 포지션 (hold 가 'auto' 일 때 드는 물건을 정함). try: 사장님이 입어 보는 특별 아이템 [goldApron, crown, sparkle]
import { HOLD_BY_POSITION, LOOK_BASE } from '../lib/avatar'

const INK = '#1D1B18'
const GOLD = '#D9A441'

export default function Avatar({ look: rawLook, pose = 'idle', size = 48, x = 0, y = 0, title, apron: withApron = true, role, try: tryOn = [] }) {
  const u = size / 16
  const px = (cx, cy, w, h, fill, key) => <rect key={key} x={cx*u} y={cy*u} width={w*u} height={h*u} fill={fill}/>
  const look = { ...LOOK_BASE, ...rawLook }
  const { hair, hairColor: hc, skin, shirt, acc, eyes, brows, mouth, mark, top, pants, shoes, tip } = look
  const deco = new Set([...(look.deco || []), ...(acc === 'blush' ? ['blush'] : [])])
  const hat = tryOn.includes('crown') ? 'crown' : look.hat
  const apronColor = tryOn.includes('goldApron') ? GOLD : look.apron
  const hold = look.hold === 'auto' ? (HOLD_BY_POSITION[role] || 'none') : look.hold
  const body = top === 'chef' ? '#F4F4F2' : shirt
  const shaved = hc + '66'

  // ── 머리카락 ──
  const H = []
  const cap = (k, ...a) => H.push(px(...a, k))
  if (['short','bun','long','ponytail','twin','bob'].includes(hair)) { cap('h1',4,2,8,2,hc); cap('h2',3,3,1,3,hc); cap('h3',12,3,1,3,hc) }
  if (hair === 'long') { cap('h4',3,6,1,4,hc); cap('h5',12,6,1,4,hc) }
  if (hair === 'bun') cap('h6',7,0,2,2,hc)
  if (hair === 'ponytail') { cap('p1',13,4,1,4.5,hc); cap('p2',12.6,3.4,1.2,0.8,'#C3261C') }
  if (hair === 'twin') { cap('t1',2,4,1,4,hc); cap('t2',13,4,1,4,hc); cap('t3',2.2,3.6,1,0.7,'#C3261C'); cap('t4',12.8,3.6,1,0.7,'#C3261C') }
  if (hair === 'bob') { cap('b1',4,4,8,0.7,hc); cap('b2',3,5,1,4,hc); cap('b3',12,5,1,4,hc) }
  if (hair === 'twoblock') { cap('w1',4,1.2,8,2.8,hc); cap('w2',3,3.4,1,2.4,shaved); cap('w3',12,3.4,1,2.4,shaved) }
  if (hair === 'curly') {
    cap('c0',4,1.6,8,2.4,hc); cap('c5',3,3,1,4,hc); cap('c6',12,3,1,4,hc)
    ;[[3,2],[5,1],[7,0.8],[9,1],[11,1.2],[2.4,4.4],[12.6,4.4]].forEach(([a,b],i) => cap('cb'+i,a,b,1.2,1.2,hc))
  }
  if (hair === 'spiky') { cap('s1',4,2,8,2,hc); cap('s2',4,1,1,1,hc); cap('s3',6,0,1,2,hc); cap('s4',8,1,1,1,hc); cap('s5',10,0,1,2,hc); cap('s6',3,3,1,2,hc); cap('s7',12,3,1,2,hc) }
  if (hair === 'mohawk') { cap('m1',4,2.4,8,1.2,shaved); cap('m2',7,-0.6,2,3.6,hc) }
  if (hair === 'cap') { cap('k1',4,1,8,3,shirt); cap('k2',3,3,11,1,shirt); cap('k3',3,4,1,1,hc); cap('k4',12,4,1,1,hc) }
  if (tip && hair !== 'bald' && hair !== 'cap') cap('tip',9,1.8,2,2.2,tip)   // 브릿지

  // ── 모자 ──
  const HT = []
  if (hat === 'chef') HT.push(px(4,-0.6,8,2.6,'#FFFFFF','hc1'), px(3.6,-2,3,1.8,'#FFFFFF','hc2'), px(6.5,-2.6,3,2,'#FFFFFF','hc3'), px(9.4,-2,3,1.8,'#FFFFFF','hc4'), px(4,1.6,8,0.9,'#DCD7CE','hc5'))
  if (hat === 'bandana') HT.push(px(3.6,2,8.8,1.6,'#C3261C','hb1'), px(5,2.5,0.5,0.5,'#FFFFFF','hb2'), px(8,2.7,0.5,0.5,'#FFFFFF','hb3'), px(10.5,2.4,0.5,0.5,'#FFFFFF','hb4'), px(12.2,2.8,1.2,1.2,'#C3261C','hb5'), px(12.8,3.8,0.8,1.3,'#C3261C','hb6'))
  if (hat === 'beanie') HT.push(px(3.6,0.6,8.8,2.8,shirt,'hn1'), px(3.6,2.6,8.8,1,'#00000033','hn2'), px(7.2,-0.6,1.6,1.4,'#F4F4F2','hn3'))
  if (hat === 'backcap') HT.push(px(4,0.8,8,2.8,shirt,'hk1'), px(12,2.8,2.6,0.8,shirt,'hk2'), px(7.6,0.6,0.8,0.5,'#FFFFFF','hk3'))
  if (hat === 'crown') HT.push(px(4.2,0.4,7.6,2,GOLD,'hw1'), px(4.2,-0.8,1.2,1.4,GOLD,'hw2'), px(7.4,-1.3,1.2,1.9,GOLD,'hw3'), px(10.6,-0.8,1.2,1.4,GOLD,'hw4'), px(7.7,1,0.6,0.7,'#C3261C','hw5'), px(5,1.1,0.5,0.5,'#2B5C9E','hw6'), px(10.5,1.1,0.5,0.5,'#2B5C9E','hw7'))

  // ── 눈·눈썹·입·얼굴 표시 ──
  const F = []
  if (pose === 'rest') F.push(px(5,6,2,0.6,INK,'e1'), px(9,6,2,0.6,INK,'e2'))
  else if (eyes === 'smile') F.push(px(5.4,6,0.8,0.6,INK,'e1'), px(6.1,5.4,0.8,0.6,INK,'e2'), px(6.8,6,0.8,0.6,INK,'e3'), px(8.4,6,0.8,0.6,INK,'e4'), px(9.1,5.4,0.8,0.6,INK,'e5'), px(9.8,6,0.8,0.6,INK,'e6'))
  else if (eyes === 'sleepy') F.push(px(5.6,6,1.8,0.6,INK,'e1'), px(8.6,6,1.8,0.6,INK,'e2'), px(5.6,5.4,1.8,0.4,'#00000022','e3'), px(8.6,5.4,1.8,0.4,'#00000022','e4'))
  else if (eyes === 'wink') F.push(px(6,5,1,2,INK,'e1'), px(8.6,5.9,1.8,0.6,INK,'e2'))
  else if (eyes === 'big') F.push(px(5.4,4.8,1.7,2.2,INK,'e1'), px(8.9,4.8,1.7,2.2,INK,'e2'), px(5.6,5,0.6,0.6,'#FFFFFF','e3'), px(9.1,5,0.6,0.6,'#FFFFFF','e4'))
  else F.push(px(6,5,1,2,INK,'e1'), px(9,5,1,2,INK,'e2'))
  if (brows === 'normal') F.push(px(5.6,4,1.6,0.5,hc,'w1'), px(8.8,4,1.6,0.5,hc,'w2'))
  if (brows === 'thick') F.push(px(5.4,3.8,2,0.9,hc,'w1'), px(8.6,3.8,2,0.9,hc,'w2'))
  if (brows === 'angry') F.push(px(5.4,3.7,0.9,0.6,hc,'w1'), px(6.3,4.1,0.9,0.6,hc,'w2'), px(8.8,4.1,0.9,0.6,hc,'w3'), px(9.7,3.7,0.9,0.6,hc,'w4'))
  if (mouth === 'grin') F.push(px(6.5,7.8,3,1.2,'#7A2A20','m1'), px(6.8,7.8,2.4,0.5,'#FFFFFF','m2'))
  else if (mouth === 'flat') F.push(px(7,8.2,2,0.5,INK,'m1'))
  else if (mouth === 'tongue') F.push(px(7,8,2,0.8,'#7A2A20','m1'), px(7.6,8.6,1,0.9,'#E8899A','m2'))
  else F.push(px(7,8,2,1,'#B4513C','m1'))
  if (mark === 'mustache') F.push(px(6,7.2,4,0.7,hc,'k1'))
  if (mark === 'beard') F.push(px(4,8,1,2,hc,'k1'), px(11,8,1,2,hc,'k2'), px(5,9.3,6,0.7,hc,'k3'))
  if (mark === 'freckles') F.push(px(5,7.2,0.5,0.5,'#A0674B','k1'), px(5.8,7.6,0.5,0.5,'#A0674B','k2'), px(10,7.2,0.5,0.5,'#A0674B','k3'), px(10.6,7.6,0.5,0.5,'#A0674B','k4'))
  if (mark === 'mole') F.push(px(10.2,8,0.6,0.6,INK,'k1'))
  if (deco.has('blush')) F.push(px(5,7,1,1,'#E8899A','bl1'), px(10,7,1,1,'#E8899A','bl2'))

  // ── 손에 드는 것 (오른손, 팔과 같이 움직임) ──
  const HOLD = {
    ladle: [px(12.3,11.4,0.45,3.6,'#9AA0A6','o1'), px(11.7,15,1.6,1,'#9AA0A6','o2')],
    wok:   [px(12.4,13.6,3.6,1.4,'#2F2B28','o1'), px(12.4,13.6,3.6,0.4,'#5E6268','o2'), px(16,14,1.6,0.5,'#5A4636','o3')],
    tray:  [px(11.4,13.4,4.4,0.6,'#9AA0A6','o1'), px(12.4,12.2,2.2,1.2,'#FFFFFF','o2'), px(12.7,12.3,1.6,0.5,'#C3261C','o3')],
    towel: [px(12,14.4,1.4,2.6,'#FFFFFF','o1'), px(12,15.2,1.4,0.4,'#2B5C9E','o2')],
    bag:   [px(12.2,14.6,3,3,'#FFFFFF','o1'), px(12.2,15.4,3,0.6,'#C3261C','o2'), px(12.8,14,1.8,0.6,'#B8B2A7','o3')],
    menu:  [px(12.2,11.6,2.6,3.4,'#C3261C','o1'), px(12.6,12.2,1.8,0.3,'#FFFFFF','o2'), px(12.6,12.9,1.8,0.3,'#FFFFFF','o3')],
    phone: [px(12.2,12.8,1.3,2.2,INK,'o1'), px(12.4,13.1,0.9,1.5,'#7FB2D9','o2')],
  }[hold] || null

  // 소매: 반팔이면 팔뚝이 보임
  const sleeve = top === 'tee' ? 1.6 : 4
  const shoeColor = shoes === 'white' ? '#F4F4F2' : shoes === 'boots' ? '#E8E4DC' : INK

  return (
    <g transform={`translate(${x},${y})`}>
      {title && <title>{title}</title>}
      <ellipse cx={8*u} cy={19.6*u} rx={5*u} ry={1.2*u} fill="#00000022"/>
      <g className={pose === 'walk' ? 'av-walk' : pose === 'work' ? 'av-bob' : undefined}>
        {/* 다리·신발 */}
        {px(5,16,2,3,pants,'l1')}{px(9,16,2,3,pants,'l2')}
        {shoes === 'boots'
          ? <>{px(5,17.4,2,2.6,shoeColor,'f1')}{px(9,17.4,2,2.6,shoeColor,'f2')}</>
          : <>{px(5,19,2,1,shoeColor,'f1')}{px(9,19,2,1,shoeColor,'f2')}</>}
        {shoes === 'white' && <>{px(5,19.7,2,0.3,'#8D9297','f3')}{px(9,19.7,2,0.3,'#8D9297','f4')}</>}
        {/* 몸 */}
        {px(4,10,8,6,body,'b')}
        {top === 'hoodie' && <>{px(4.2,9.4,7.6,0.9,shirt,'hd1')}{px(4.2,9.4,7.6,0.9,'#00000026','hd2')}{px(6.6,10.3,0.4,1.6,'#F4F4F2','hd3')}{px(9,10.3,0.4,1.6,'#F4F4F2','hd4')}{px(5.5,13.8,5,1.4,'#00000022','hd5')}</>}
        {top === 'chef' && <>{px(5,10,6,0.8,shirt,'cf1')}{px(6.6,11.1,0.6,0.6,INK,'cf2')}{px(8.8,11.1,0.6,0.6,INK,'cf3')}</>}
        {withApron && apronColor !== 'none' && <>{px(5,12,6,4,apronColor,'ap')}{px(5,11,1,1,apronColor,'ap1')}{px(10,11,1,1,apronColor,'ap2')}</>}
        {withApron && deco.has('nametag') && <>{px(9.6,10.4,1.9,1,'#FFFFFF','nt1')}{px(9.6,10.4,1.9,0.3,'#C3261C','nt2')}</>}
        {/* 팔 */}
        {px(3,10,1,sleeve,top === 'chef' ? '#F4F4F2' : shirt,'a1')}{sleeve < 4 && px(3,10 + sleeve,1,4 - sleeve,skin,'a1s')}{px(3,14,1,1,skin,'hd1')}
        <g className={pose === 'work' ? 'av-arm' : undefined}>
          {px(12,10,1,sleeve,top === 'chef' ? '#F4F4F2' : shirt,'a2')}{sleeve < 4 && px(12,10 + sleeve,1,4 - sleeve,skin,'a2s')}{px(12,14,1,1,skin,'hd2')}
          {pose !== 'rest' && HOLD}
        </g>
        {/* 얼굴 */}
        {px(4,3,8,7,skin,'face')}
        {px(4,9,8,1,skin,'chin')}
        {F}
        {acc === 'glasses' && <><rect x={5*u} y={5*u} width={2*u} height={2*u} fill="none" stroke={INK} strokeWidth={u*0.5}/><rect x={9*u} y={5*u} width={2*u} height={2*u} fill="none" stroke={INK} strokeWidth={u*0.5}/>{px(7,5.5,2,0.5,INK,'g3')}</>}
        {acc === 'sunglasses' && <>{px(4.8,4.9,2.4,1.7,INK,'sg1')}{px(8.8,4.9,2.4,1.7,INK,'sg2')}{px(7.2,5.3,1.6,0.4,INK,'sg3')}{px(5.2,5.1,0.7,0.4,'#FFFFFF88','sg4')}{px(9.2,5.1,0.7,0.4,'#FFFFFF88','sg5')}</>}
        {acc === 'mask' && px(5,7,6,2,'#FFFFFF','mk')}
        {H}
        {acc === 'band' && px(4,3,8,1,'#C3261C','bd')}
        {HT}
        {deco.has('hairpin') && <>{px(9.8,2.4,1.6,0.7,'#E8899A','hp1')}{px(10.3,2.1,0.6,1.3,'#E8899A','hp2')}</>}
        {deco.has('earring') && <>{px(3.3,7,0.6,0.9,GOLD,'er1')}{px(12.1,7,0.6,0.9,GOLD,'er2')}</>}
        {acc === 'headset' && <>{px(3.6,1.4,8.8,0.6,INK,'hs1')}{px(3.1,1.8,0.6,4.4,INK,'hs2')}{px(12.3,1.8,0.6,4.4,INK,'hs3')}{px(2.7,5.2,1.3,1.8,INK,'hs4')}{px(12,5.2,1.3,1.8,INK,'hs5')}{px(3.6,7.8,2.8,0.4,INK,'hs6')}{px(6.2,7.6,0.7,0.8,'#5E6268','hs7')}</>}
        {apronColor === GOLD && withApron && <rect className="av-twinkle" x={6.5*u} y={12.5*u} width={0.8*u} height={0.8*u} fill="#FFFFFF"/>}
      </g>
      {tryOn.includes('sparkle') && [[0,2,0],[14.5,4,0.5],[1,13,0.9],[15,15,0.3]].map(([a,b,d],i) => (
        <g key={'sp'+i} transform={`translate(${a*u},${b*u})`}>
          <polygon className="av-twinkle" style={{animationDelay:`${d}s`}} points={`0,${-u} ${u*0.3},${-u*0.3} ${u},0 ${u*0.3},${u*0.3} 0,${u} ${-u*0.3},${u*0.3} ${-u},0 ${-u*0.3},${-u*0.3}`} fill={GOLD}/>
        </g>
      ))}
    </g>
  )
}
