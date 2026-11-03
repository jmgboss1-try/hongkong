// 시각 고르기 (시·분 두 칸)
// 폰(아이폰)에서 type="time" 칸은 표 칸보다 넓어져 잘리고, 빈칸이면 회색으로만 보이고, Reset 버튼으로 비울 수도 없어서 이걸 씀
// 시 칸에서 '시'(빈칸)를 고르면 시각이 지워짐. clearable 이면 옆에 '지우기'도 보여줌
const HOURS = Array.from({length:19}, (_,i)=>String(i+6).padStart(2,'0'))     // 06 ~ 24
const MINS = Array.from({length:12}, (_,i)=>String(i*5).padStart(2,'0'))      // 5분 단위

export default function TimePick({ value, onChange, label, clearable, width }) {
  const [h, m] = (value || '').split(':')
  const mins = m && !MINS.includes(m) ? [...MINS, m].sort() : MINS
  const sel = { flex:1, minWidth:0, width:'100%', fontSize:13, padding:'4px 2px', border:'1px solid #CBC5BA', borderRadius:4,
    background:'#FFFFFF', color:'#1D1B18', fontFamily:'inherit', fontVariantNumeric:'tabular-nums' }
  return (
    <div style={{display:'flex', alignItems:'center', gap:2, width}} aria-label={label}>
      <select value={h || ''} onChange={e=>onChange(e.target.value ? `${e.target.value}:${m || '00'}` : '')} aria-label={`${label} 시`} style={sel}>
        <option value="">시</option>
        {HOURS.map(x=><option key={x} value={x}>{x}</option>)}
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
