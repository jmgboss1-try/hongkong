// QR 주문 알림음 — 브라우저에서 바로 만들어 내는 소리 (파일 없이) + 직접 고른 소리 파일
// 설정은 기기마다 (포스·사장님 폰 따로) localStorage 'orderSound' 에 저장
//   { volume: 0~1, sounds: { new, remind, accept, done, cancel }, remindMin, remindEvery }

export const EVENTS = [
  { id:'new',    label:'새 주문이 들어올 때' },
  { id:'remind', label:'접수 안 한 주문이 있을 때 (경고)' },
  { id:'accept', label:'접수했을 때' },
  { id:'done',   label:'완료했을 때' },
  { id:'cancel', label:'취소했을 때' },
]

// [주파수, 시작(초), 길이(초), 파형]
export const PRESETS = {
  dingdong: { label:'딩동',            notes:[[988,0,0.45,'sine'],[784,0.42,0.7,'sine']] },
  chime:    { label:'차임 (세 번)',     notes:[[1047,0,0.3,'triangle'],[1319,0.25,0.3,'triangle'],[1568,0.5,0.6,'triangle']] },
  bell:     { label:'벨 (계속 울림)',   notes:[0,0.28,0.56,0.84,1.12,1.4].map(t=>[1318,t,0.22,'square']) },
  beep:     { label:'삐삐삐',           notes:[[1760,0,0.12,'square'],[1760,0.2,0.12,'square'],[1760,0.4,0.12,'square']] },
  siren:    { label:'경보 (사이렌)',    notes:[0,0.35,0.7,1.05].flatMap(t=>[[880,t,0.17,'sawtooth'],[1175,t+0.17,0.17,'sawtooth']]) },
  up:       { label:'올라가는 소리',    notes:[[523,0,0.14,'sine'],[659,0.12,0.14,'sine'],[784,0.24,0.14,'sine'],[1047,0.36,0.35,'sine']] },
  down:     { label:'내려가는 소리',    notes:[[784,0,0.16,'triangle'],[587,0.16,0.16,'triangle'],[392,0.32,0.4,'triangle']] },
  tick:     { label:'짧게 똑',          notes:[[1200,0,0.08,'sine']] },
  none:     { label:'소리 없음',        notes:[] },
  custom:   { label:'내 소리 파일',     notes:[] },
}

export const DEFAULT_SOUND = {
  volume: 0.8,
  sounds: { new:'bell', remind:'siren', accept:'tick', done:'up', cancel:'down' },
  remindMin: 2,     // 접수 안 하고 이만큼(분) 지나면 경고
  remindEvery: 30,  // 경고를 몇 초마다 다시
  files: {},        // { 이벤트 id: data URL } 내 소리 파일 (작은 파일만)
}

export function loadSound() {
  try {
    const s = JSON.parse(localStorage.getItem('orderSound') || 'null')
    return s ? { ...DEFAULT_SOUND, ...s, sounds:{ ...DEFAULT_SOUND.sounds, ...(s.sounds||{}) }, files:{ ...(s.files||{}) } } : DEFAULT_SOUND
  } catch { return DEFAULT_SOUND }
}
export function saveSound(s) {
  try { localStorage.setItem('orderSound', JSON.stringify(s)); return true } catch { return false }
}

let ctx = null
// 브라우저는 사람이 한 번 눌러야 소리를 낼 수 있어서, '소리 켜기'를 누를 때 이걸 부름
export function unlockAudio() {
  const AC = window.AudioContext || window.webkitAudioContext
  if (!AC) return false
  ctx = ctx || new AC()
  ctx.resume()
  return true
}
export const audioReady = () => !!ctx && ctx.state === 'running'

// 이벤트 소리 내기 (설정에 따라)
export function playEvent(settings, event) {
  const s = settings || DEFAULT_SOUND
  const key = s.sounds?.[event] || 'none'
  if (key === 'custom') {
    const url = s.files?.[event]
    if (!url) return
    try { const a = new Audio(url); a.volume = Math.min(1, s.volume ?? 0.8); a.play().catch(()=>{}) } catch { /* 소리 못 내도 됨 */ }
    return
  }
  playPreset(key, s.volume ?? 0.8)
}

export function playPreset(key, volume = 0.8) {
  const p = PRESETS[key]
  if (!p || !p.notes.length || !ctx) return
  const t0 = ctx.currentTime + 0.02
  // 압축기를 거쳐 크게 (음량 100%에서도 찢어지지 않게)
  const comp = ctx.createDynamicsCompressor()
  comp.threshold.value = -18; comp.knee.value = 6; comp.ratio.value = 8
  const master = ctx.createGain()
  master.gain.value = Math.max(0, Math.min(1, volume)) * 1.6
  master.connect(comp); comp.connect(ctx.destination)
  for (const [f, t, d, type] of p.notes) {
    const o = ctx.createOscillator(), g = ctx.createGain()
    o.type = type; o.frequency.value = f
    g.gain.setValueAtTime(0.0001, t0 + t)
    g.gain.exponentialRampToValueAtTime(0.9, t0 + t + 0.015)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + t + d)
    o.connect(g); g.connect(master)
    o.start(t0 + t); o.stop(t0 + t + d + 0.05)
  }
}
