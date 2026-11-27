import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
// Astryx 디자인 시스템 (도입 0단계). legacyCompat.css 를 reset 보다 먼저 불러와야 아직 안 옮긴 화면이 예전 모양 그대로 보임
import './astryx/legacyCompat.css'
import '@astryxdesign/core/reset.css'
import '@astryxdesign/core/astryx.css'
import '@astryxdesign/theme-neutral/theme.css'
import './appView.css'
import { applyTheme, getTheme, applyView, getMode } from './lib/dashTheme'

// 이 기기에서 고른 색 테마를 첫 화면(로그인 포함)부터 적용
applyTheme(getTheme())
document.documentElement.dataset.mode = getMode()   // 다크면 Layout 이 body 바탕도 어둡게
applyView('card')   // 장부형은 없앰: 모든 화면이 카드형

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)