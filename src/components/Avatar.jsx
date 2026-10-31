// 우리 매장 캐릭터 한 명 (16 x 20 픽셀 그림). pose: idle | work | walk | rest
// 움직임은 CSS 클래스(av-*)로 줌. 화면에 lib/avatar.js 의 AVATAR_CSS 를 한 번 넣어야 움직임
const INK = '#1D1B18'

export default function Avatar({ look, pose = 'idle', size = 48, x = 0, y = 0, title, apron: withApron = true }) {
  const u = size / 16
  const px = (cx, cy, w, h, fill, key) => <rect key={key ?? `${cx}-${cy}-${w}-${h}-${fill}`} x={cx*u} y={cy*u} width={w*u} height={h*u} fill={fill}/>
  const { hair, hairColor: hc, skin, shirt, acc } = look
  const pants = '#3B3A38', apron = '#F3F1EC'

  const hairPx = []
  if (hair === 'short' || hair === 'bun' || hair === 'long') {
    hairPx.push(px(4,2,8,2,hc,'h1'), px(3,3,1,3,hc,'h2'), px(12,3,1,3,hc,'h3'))
  }
  if (hair === 'long') hairPx.push(px(3,6,1,4,hc,'h4'), px(12,6,1,4,hc,'h5'))
  if (hair === 'bun') hairPx.push(px(7,0,2,2,hc,'h6'))
  if (hair === 'spiky') hairPx.push(px(4,2,8,2,hc,'s1'), px(4,1,1,1,hc,'s2'), px(6,0,1,2,hc,'s3'), px(8,1,1,1,hc,'s4'), px(10,0,1,2,hc,'s5'), px(3,3,1,2,hc,'s6'), px(12,3,1,2,hc,'s7'))
  if (hair === 'cap') hairPx.push(px(4,1,8,3,shirt,'c1'), px(3,3,11,1,shirt,'c2'), px(3,4,1,1,hc,'c3'), px(12,4,1,1,hc,'c4'))

  return (
    <g transform={`translate(${x},${y})`}>
      {title && <title>{title}</title>}
      <ellipse cx={8*u} cy={19.6*u} rx={5*u} ry={1.2*u} fill="#00000022"/>
      <g className={pose === 'walk' ? 'av-walk' : pose === 'work' ? 'av-bob' : undefined}>
        {/* 다리 */}
        {px(5,16,2,3,pants,'l1')}{px(9,16,2,3,pants,'l2')}
        {px(5,19,2,1,INK,'f1')}{px(9,19,2,1,INK,'f2')}
        {/* 몸·앞치마 */}
        {px(4,10,8,6,shirt,'b')}
        {withApron && <>{px(5,12,6,4,apron,'ap')}{px(5,11,1,1,apron,'ap1')}{px(10,11,1,1,apron,'ap2')}</>}
        {/* 팔 */}
        {px(3,10,1,4,shirt,'a1')}{px(3,14,1,1,skin,'hd1')}
        <g className={pose === 'work' ? 'av-arm' : undefined}>
          {px(12,10,1,4,shirt,'a2')}{px(12,14,1,1,skin,'hd2')}
        </g>
        {/* 머리 */}
        {px(4,3,8,7,skin,'face')}
        {px(4,9,8,1,skin,'chin')}
        {pose === 'rest'
          ? <>{px(6,6,1,1,INK,'e1')}{px(9,6,1,1,INK,'e2')}{px(5,6,1,1,INK,'e1b')}{px(10,6,1,1,INK,'e2b')}</>
          : <>{px(6,5,1,2,INK,'e1')}{px(9,5,1,2,INK,'e2')}</>}
        {px(7,8,2,1,'#B4513C','m')}
        {acc === 'blush' && <>{px(5,7,1,1,'#E8899A','bl1')}{px(10,7,1,1,'#E8899A','bl2')}</>}
        {acc === 'glasses' && <><rect x={5*u} y={5*u} width={2*u} height={2*u} fill="none" stroke={INK} strokeWidth={u*0.5}/><rect x={9*u} y={5*u} width={2*u} height={2*u} fill="none" stroke={INK} strokeWidth={u*0.5}/>{px(7,5.5,2,0.5,INK,'g3')}</>}
        {acc === 'mask' && px(5,7,6,2,'#FFFFFF','mk')}
        {hairPx}
        {acc === 'band' && px(4,3,8,1,'#C3261C','bd')}
      </g>
    </g>
  )
}
