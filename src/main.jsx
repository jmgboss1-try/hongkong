import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { applyTheme, getTheme } from './lib/dashTheme'

// 이 기기에서 고른 색 테마를 첫 화면(로그인 포함)부터 적용
applyTheme(getTheme())

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
)