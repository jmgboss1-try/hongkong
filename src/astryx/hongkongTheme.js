// 홍콩반점 Astryx 테마 (도입 0단계)
//  기본 테마(neutral)를 물려받고 홍콩반점 장부 느낌만 바꿈: 종이색 바탕, 먹색 글자, 옅은 괘선,
//  강조색 4가지(lib/dashTheme.js THEMES: 짬뽕 빨강·초록·남색·먹색) 그대로, 굵은 숫자(display 글자 800),
//  꽉 찬 강조 카드(Card variant="red" 를 '강조색으로 꽉 찬 카드'로 바꿔 씀 — 색 이름과 상관없이 고른 강조색이 칠해짐),
//  둥근 카드(16px). 모든 색은 [라이트, 다크] 두 값.
//  화면 코드는 색을 직접 쓰지 않고 Astryx 부품과 토큰(var(--color-*))만 씀 → 테마만 바꾸면 전체가 바뀜
import { defineTheme } from '@astryxdesign/core/theme'
import { neutralTheme } from '@astryxdesign/theme-neutral/built'
import { THEMES, getTheme } from '../lib/dashTheme'

// 다크 모드에서 쓸 강조색 (어두운 바탕에서 잘 보이게 한 단계 밝게)
const DARK_ACCENT = { red:'#E5675E', green:'#5FBF8A', navy:'#8FA2EE', ink:'#EDE9E1' }
// 차트 막대 등 '중간 진하기' 강조색 (라이트는 THEMES 의 mid, 다크는 어두운 바탕용)
const DARK_MID = { red:'#8A3A33', green:'#2F6B4A', navy:'#46548A', ink:'#6E6A63' }

function make(key) {
  const t = THEMES[key] || THEMES.red
  const dark = DARK_ACCENT[key] || DARK_ACCENT.red
  return defineTheme({
    name: `hongkong-${key}`,
    extends: neutralTheme,
    typography: {
      body: { family: 'Noto Sans KR', fallbacks: "-apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" },
    },
    tokens: {
      // 강조색 (테마 4가지)
      '--color-accent': [t.accent, dark],
      '--color-text-accent': [t.accent, dark],
      '--color-icon-accent': [t.accent, dark],
      '--color-accent-muted': [t.soft, `color-mix(in srgb, ${dark} 22%, transparent)`],
      // 강조색 위 글자: 라이트는 흰색, 다크는 강조색이 밝아지므로 먹색
      '--color-on-accent': ['#FFFFFF', '#15130F'],
      // 종이 장부 바탕과 글자
      '--color-background-body': ['#FAF9F6', '#15130F'],
      '--color-background-surface': ['#FFFFFF', '#1E1C18'],
      '--color-background-card': ['#FFFFFF', '#1E1C18'],
      '--color-background-muted': ['#F3F1EC', '#2A2722'],
      '--color-border': ['#E6E2DA', '#3A362F'],
      '--color-text-primary': ['#1D1B18', '#F3F1EC'],
      '--color-text-secondary': ['#6E6A63', '#A8A39A'],
      // 상태색 (기존 화면과 같은 초록·빨강·주황)
      '--color-success': ['#2E7D45', '#5FBF8A'],
      '--color-error': ['#B42318', '#F07167'],
      '--color-warning': ['#B45309', '#F2A65A'],
      // 굵은 숫자
      '--text-display-1-weight': '800',
      '--text-display-2-weight': '800',
      '--text-display-3-weight': '800',
    },
    // 홍콩반점 전용 토큰 (Astryx 기본 토큰에 없는 것): 차트 막대 색
    localTokens: {
      '--hk-chart-bar': [t.mid, DARK_MID[key] || DARK_MID.red],
    },
    components: {
      card: {
        base: { borderRadius: '16px' },
        // 꽉 찬 강조 카드: 바탕 = 강조색, 글자 = 강조색 위 글자색
        'variant:red': { backgroundColor: 'var(--color-accent)', color: 'var(--color-on-accent)', borderColor: 'transparent' },
      },
    },
  })
}

// 4가지를 한 번만 만들어 둠 (화면이 다시 그려질 때마다 새로 만들지 않게)
const CACHE = {}
export function hongkongTheme(key = getTheme()) {
  if (!CACHE[key]) CACHE[key] = make(key)
  return CACHE[key]
}
