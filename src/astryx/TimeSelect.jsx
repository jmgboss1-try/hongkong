// 시각 고르기 (시·분 두 칸, Astryx). TimePick 과 같은 동작: 시 칸에서 '시'(빈칸)를 고르면 지워짐, clearable 이면 '지우기'
// 기본 06~24시 5분 단위, 실제 찍은 시각은 step={1} allHours (00~23시, 1분 단위)
import { HStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Button } from '@astryxdesign/core/Button'
import { Selector } from '@astryxdesign/core/Selector'

const HOURS = Array.from({length:19}, (_,i)=>String(i+6).padStart(2,'0'))
const ALL_HOURS = Array.from({length:24}, (_,i)=>String(i).padStart(2,'0'))
const minsBy = step => Array.from({length:Math.ceil(60/step)}, (_,i)=>String(i*step).padStart(2,'0'))

export default function TimeSelect({ value, onChange, label, clearable, step = 5, allHours }) {
  const [h, m] = (value || '').split(':')
  const MINS = minsBy(step), hours = allHours ? ALL_HOURS : HOURS
  const mins = m && !MINS.includes(m) ? [...MINS, m].sort() : MINS
  const hourOpts = [{ value:'', label:'시' }, ...(h && !hours.includes(h) ? [...hours, h].sort() : hours).map(x => ({ value:x, label:x }))]
  return (
    <HStack gap={1} vAlign="center">
      <Selector label={`${label} 시`} isLabelHidden size="sm" value={h || ''} onChange={v => onChange(v ? `${v}:${m || '00'}` : '')} options={hourOpts}/>
      <Text color="secondary">:</Text>
      <Selector label={`${label} 분`} isLabelHidden size="sm" isDisabled={!h} value={h ? (m || '00') : undefined} placeholder="분"
        onChange={v => v && onChange(`${h}:${v}`)} options={mins.map(x => ({ value:x, label:x }))}/>
      {clearable && value && <Button size="sm" variant="ghost" label="지우기" onClick={() => onChange('')}/>}
    </HStack>
  )
}
