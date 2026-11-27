import { useRef, useState } from 'react'
import { TextInput } from '@astryxdesign/core/TextInput'

// 표 칸 안의 입력칸 (Astryx). 예전 <input defaultValue onBlur> 처럼 칸을 벗어나거나 Enter 를 누르면 저장.
// 값이 바뀌었을 때만 onSave(문자열). 밖에서 값이 바뀌면 key 를 바꿔서 다시 그리면 됨. saved 면 초록 테두리로 잠깐 표시
export default function CellInput({ value, onSave, label, placeholder, width, numeric, saved }) {
  const init = value == null || value === 0 ? '' : String(value)
  const [text, setText] = useState(init)
  const last = useRef(init)   // Enter 뒤에 칸을 벗어나도 두 번 저장하지 않게
  const commit = () => { if (text !== last.current) { last.current = text; onSave(text) } }
  return (
    <div onBlur={commit}>
      <TextInput label={label} isLabelHidden size="sm" width={width} placeholder={placeholder}
        inputMode={numeric ? 'decimal' : undefined} value={text}
        onChange={v => setText(numeric ? String(v || '').replace(/[^0-9.]/g, '') : (v || ''))}
        onEnter={commit} status={saved ? { type:'success' } : undefined}/>
    </div>
  )
}
