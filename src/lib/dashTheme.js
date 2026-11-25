// 앱 전체 강조색 테마 (하나만 바꾸면 모든 탭·로그인 화면 색이 같이 바뀜)
//  화면 코드는 강조색을 CSS 변수로 씀: var(--hk-accent), 투명도는 rgba(var(--hk-accent-rgb), 0.1)
//  고른 테마는 기기마다 localStorage 'app.theme' (예전 'dash.theme'도 읽음). 로그인 전에도 그 기기의 테마가 적용됨
//  손님용 QR 메뉴·사진 보내기 화면, 인쇄 서류(임금명세서·원천징수·재직증명서), 아바타 그림은 원래 색 그대로
import { useEffect, useState } from 'react'

export const THEMES = {
  red:   { name:'짬뽕 빨강', accent:'#C3261C', rgb:'195,38,28',  soft:'#F6DEDB', mid:'#E08A82' },
  green: { name:'초록',     accent:'#1F5C3A', rgb:'31,92,58',   soft:'#DCEBE1', mid:'#6FA584' },
  navy:  { name:'남색',     accent:'#23367A', rgb:'35,54,122',  soft:'#DDE3F4', mid:'#7A8CC8' },
  ink:   { name:'먹색',     accent:'#1D1B18', rgb:'29,27,24',   soft:'#E6E3DD', mid:'#8C877F' },
}
const KEY = 'app.theme'

export function getTheme() {
  try { const k = localStorage.getItem(KEY) || localStorage.getItem('dash.theme'); return THEMES[k] ? k : 'red' } catch { return 'red' }
}
export function applyTheme(key) {
  const t = THEMES[key] || THEMES.red
  const r = document.documentElement.style
  r.setProperty('--hk-accent', t.accent)
  r.setProperty('--hk-accent-rgb', t.rgb)
  r.setProperty('--hk-accent-soft', t.soft)
  r.setProperty('--hk-accent-mid', t.mid)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t.accent)
}
export function setTheme(key) {
  try { localStorage.setItem(KEY, key) } catch { /* 저장 못 해도 이번엔 바뀜 */ }
  applyTheme(key)
  window.dispatchEvent(new CustomEvent('hk-theme', { detail: key }))
}
// 지금 테마 이름 (바뀌면 다시 그림)
export function useTheme() {
  const [k, setK] = useState(getTheme)
  useEffect(() => {
    const on = e => setK(e.detail)
    window.addEventListener('hk-theme', on)
    return () => window.removeEventListener('hk-theme', on)
  }, [])
  return k
}

// 화면 모양: 'card' 카드형(둥근 칸·그림자) / 'ledger' 장부형(괘선 장부). 기기마다 localStorage 'app.view' (예전 'dash.view'의 bento도 읽음)
//  <html data-view="card"> 를 달면 index.css 가 모든 탭의 칸·섹션·버튼을 카드 모양으로 바꿈
const VKEY = 'app.view'
export function getView() {
  try { const v = localStorage.getItem(VKEY) || (localStorage.getItem('dash.view') === 'ledger' ? 'ledger' : 'card'); return v === 'ledger' ? 'ledger' : 'card' } catch { return 'card' }
}
export function applyView(v) { document.documentElement.dataset.view = v === 'ledger' ? 'ledger' : 'card' }
export function setView(v) {
  try { localStorage.setItem(VKEY, v) } catch { /* 저장 못 해도 이번엔 바뀜 */ }
  applyView(v)
  window.dispatchEvent(new CustomEvent('hk-view', { detail: v }))
}
export function useView() {
  const [v, setV] = useState(getView)
  useEffect(() => {
    const on = e => setV(e.detail)
    window.addEventListener('hk-view', on)
    return () => window.removeEventListener('hk-view', on)
  }, [])
  return v
}
