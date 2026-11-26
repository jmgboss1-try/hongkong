// Astryx 로 옮긴 화면의 틀
//  <AstryxPage> : 홍콩반점 테마(기기에서 고른 강조색)로 감쌈. 지금은 라이트만 (다른 화면이 다 옮겨지면 다크도 켬)
//  <Legacy>     : 아직 Astryx 로 안 옮긴 덩어리. 안쪽은 reset 영향 없이 예전 인라인 스타일 그대로 보임 (legacyCompat.css)
//  <Ledger>/<LedgerRow> : 장부 줄 (왼쪽 이름·설명, 오른쪽 금액). 합계 줄은 strong, 아래 줄은 sub
import { Theme } from '@astryxdesign/core/theme'
import { InternationalizationProvider } from '@astryxdesign/core/i18n'
import koKR from '@astryxdesign/core/locales/ko-KR.generated.js'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text, Heading } from '@astryxdesign/core/Text'
import { Divider } from '@astryxdesign/core/Divider'
import { Button } from '@astryxdesign/core/Button'
import { Selector } from '@astryxdesign/core/Selector'
import { Card } from '@astryxdesign/core/Card'
import { hongkongTheme } from './hongkongTheme'
import { useTheme } from '../lib/dashTheme'
import CountUp from '../components/CountUp'

export function AstryxPage({ children }) {
  const key = useTheme()
  // 한국어: 날짜 칸·'선택' 표시·빈 목록 문구 등 Astryx 기본 글자를 한국어로
  return (
    <InternationalizationProvider locale="ko-KR" messages={{ 'ko-KR': koKR }}>
      <Theme theme={hongkongTheme(key)} mode="light">{children}</Theme>
    </InternationalizationProvider>
  )
}

export function Legacy({ children }) {
  return <div className="hk-legacy">{children}</div>
}

// 화면 머리: 제목 + 오른쪽(달 고르기 등)
export function PageHeader({ title, sub, right }) {
  return (
    <HStack hAlign="between" vAlign="center" gap={3} wrap="wrap">
      <VStack gap={0}>
        <Heading level={1}>{title}</Heading>
        {sub && <Text type="supporting" color="secondary">{sub}</Text>}
      </VStack>
      {right && <HStack gap={2} vAlign="center" wrap="wrap">{right}</HStack>}
    </HStack>
  )
}

// 장부 한 줄. tone: 'good' | 'bad' | 'accent'
export function LedgerRow({ label, note, value, text, strong, sub, minus, plus, tone, roll = true }) {
  const color = tone === 'accent' || tone === 'bad' ? 'accent' : 'primary'
  const amount = text ?? <>{minus && value ? '− ' : plus && value ? '+ ' : ''}{roll ? <CountUp value={value}/> : Math.round(value || 0).toLocaleString('ko-KR')}</>
  return (
    <HStack hAlign="between" vAlign="center" gap={3}>
      <HStack gap={2} vAlign="center">
        <Text type={sub ? 'supporting' : strong ? 'large' : 'body'} color={sub ? 'secondary' : 'primary'} weight={strong ? 'bold' : sub ? 'normal' : 'semibold'}>{label}</Text>
        {note && <Text type="supporting" color="secondary">{note}</Text>}
      </HStack>
      <Text type={strong ? 'large' : sub ? 'supporting' : 'body'} color={sub && !tone ? 'secondary' : color} weight={strong ? 'bold' : sub ? 'normal' : 'semibold'} hasTabularNumbers textWrap="nowrap">
        {amount}
      </Text>
    </HStack>
  )
}

// 장부 묶음: 줄들 + (있으면) 합계 위 구분선
export function Ledger({ rows, total }) {
  return (
    <VStack gap={2}>
      {rows}
      {total && <><Divider variant="strong"/>{total}</>}
    </VStack>
  )
}

// 달 옮기기: 이전 · 달 고르기 · 다음. options = ['YYYY-MM', …], label = 'YYYY-MM' → 'YYYY년 M월'
export function MonthNav({ value, options, onChange, label }) {
  const i = options.indexOf(value)
  return (
    <HStack gap={2} vAlign="center">
      <Button label="이전" size="sm" isDisabled={i <= 0} onClick={() => onChange(options[i - 1])}/>
      <Selector label="달 고르기" isLabelHidden size="sm" value={value} onChange={v => v && onChange(v)}
        options={options.map(m => ({ value: m, label: label(m) }))}/>
      <Button label="다음" size="sm" isDisabled={i >= options.length - 1} onClick={() => onChange(options[i + 1])}/>
    </HStack>
  )
}

// 장부 카드: 제목 + 오른쪽 + 내용
export function LedgerCard({ title, right, children }) {
  return (
    <Card>
      <VStack gap={3}>
        <HStack hAlign="between" vAlign="center" gap={2} wrap="wrap">
          <Heading level={4}>{title}</Heading>
          {right && <HStack gap={2} vAlign="center">{right}</HStack>}
        </HStack>
        {children}
      </VStack>
    </Card>
  )
}
