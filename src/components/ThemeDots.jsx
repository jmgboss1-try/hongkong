import { THEMES, setTheme, useTheme } from '../lib/dashTheme'

// 강조색 고르기 (동그라미 4개). 고르면 앱 전체·로그인 화면 색이 바로 바뀌고 이 기기에 기억됨
export default function ThemeDots({ size = 20, label = false, style }) {
  const cur = useTheme()
  return (
    <div role="group" aria-label="색 테마" style={{display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', ...style}}>
      {label && <span style={{fontSize:12, color:'#6E6A63', marginRight:2}}>색</span>}
      {Object.entries(THEMES).map(([k, t]) => (
        <button key={k} type="button" title={t.name} aria-label={`색 테마 ${t.name}`} aria-pressed={cur === k} onClick={() => setTheme(k)}
          style={{width:size, height:size, borderRadius:size / 2, background:t.accent, cursor:'pointer', padding:0, flexShrink:0,
            border: cur === k ? '2px solid #1D1B18' : '2px solid #FFFFFF', boxShadow:'0 0 0 1px #DCD7CE'}}/>
      ))}
    </div>
  )
}
