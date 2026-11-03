// 시각 고르기 (시·분 두 칸)
// 폰(아이폰)에서 type="time" 칸은 표 칸보다 넓어져 잘리고, 빈칸이면 회색으로만 보이고, Reset 버튼으로 비울 수도 없어서 이걸 씀
// 시 칸에서 '시'(빈칸)를 고르면 시각이 지워짐. clearable 이면 옆에 '지우기'도 보여줌
// 기본: 06~24시, 5분 단위 (근무 예정용). 실제 찍은 시각을 고칠 땐 step={1} allHours (00~23시, 1분 단위)
const HOURS = Array.from({length:19}, (_,i)=>String(i+6).padStart(2,'0'))     // 06 ~ 24
const ALL_HOURS = Array.from({length:24}, (_,i)=>String(i).padStart(2,'0'))   // 00 ~ 23
const minsBy = step => Array.from({length:Math.ceil(60/step)}, (_,i)=>String(i*step).padStart(2,'0'))

export default function TimePick({ value, onChange, label, clearable, width, step = 5, allHours }) {
  const [h, m] = (value || '').split(':')
  const MINS = minsBy(step), hours = allHours ? ALL_HOURS : HOURS
  const mins = m && !MINS.includes(m) ? [...MINS, m].sort() : MINS
  const sel = { flex:1, minWidth:0, width:'100%', fontSize:13, padding:'4px 2px', border:'1px solid #CBC5BA', borderRadius:4,
    background:'#FFFFFF', color:'#1D1B18', fontFamily:'inherit', fontVariantNumeric:'tabular-nums' }
  return (
    <div style={{display:'flex', alignItems:'center', gap:2, width}} aria-label={label}>
      <select value={h || ''} onChange={e=>onChange(e.target.value ? `${e.target.value}:${m || '00'}` : '')} aria-label={`${label} 시`} style={sel}>
        <option value="">시</option>
        {(h && !hours.includes(h) ? [...hours, h].sort() : hours).map(x=><option key={x} value={x}>{x}</option>)}
      </select>
      <span style={{color:'#6E6A63'}}>:</span>
      <select value={h ? (m || '00') : ''} disabled={!h} onChange={e=>onChange(`${h}:${e.target.value}`)} aria-label={`${label} 분`} style={sel}>
        {!h && <option value="">분</option>}
        {mins.map(x=><option key={x} value={x}>{x}</option>)}
      </select>
      {clearable && value && (
        <button type="button" onClick={()=>onChange('')} aria-label={`${label} 지우기`}
          style={{background:'none', border:'none', color:'#B42318', fontSize:12, cursor:'pointer', fontFamily:'inherit', padding:'0 0 0 4px', whiteSpace:'nowrap'}}>지우기</button>
      )}
    </div>
  )
}
