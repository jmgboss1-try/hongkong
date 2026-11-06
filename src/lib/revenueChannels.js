// 매출 구분 바뀜 (2026-11-09 월요일부터)
//  예전: 키오스크 · 배달 · 포스(포스 결제 + 쿠폰·이체·서울페이·전화배달)
//  새로: 홀(키오스크 + 포스 결제) · 배달 · 기타(쿠폰·이체·서울페이·전화배달)
// 저장 칸은 그대로 kiosk · del · pos 를 씀 (그날짜부터 kiosk = 홀, pos = 기타). 그래서 합계·배달은 예전과 그대로 이어지고
// 예전 자료는 고치지 않음. 예전 '포스'에는 포스 결제와 기타가 섞여 있어서 홀·기타 비교는 11월 9일부터만 정확함
export const NEW_CHANNELS_FROM = '2026-11-09'
// 매출입력 맨 위 '매출 칸이 바뀌었어요' 안내를 이날까지 보여 줌 (첫 일주일)
export const CHANGE_NOTICE_UNTIL = '2026-11-15'
export const ETC_HINT = '쿠폰·이체·서울페이·전화배달'
const OLD = { kiosk: '키오스크', del: '배달', pos: '포스' }
const NEW = { kiosk: '홀', del: '배달', pos: '기타' }

// date: 'YYYY-MM-DD'
export const isNewChannels = date => String(date) >= NEW_CHANNELS_FROM
export const chLabels = date => (isNewChannels(date) ? NEW : OLD)
// 한 달: 'old' | 'new' | 'mixed' (2026-11 은 8일까지 예전, 9일부터 새로)
export const monthScheme = ym => (`${ym}-01` >= NEW_CHANNELS_FROM ? 'new' : `${ym}-31` < NEW_CHANNELS_FROM ? 'old' : 'mixed')
export const monthLabels = ym => {
  const s = monthScheme(ym)
  return s === 'new' ? NEW : s === 'old' ? OLD : { kiosk: '키오스크·홀', del: '배달', pos: '포스·기타' }
}
// 섞인 달 장부: 바뀌기 전/후 칸 이름 (예: '키오스크 (~8일)', '홀 (9일~)')
const cutDay = +NEW_CHANNELS_FROM.slice(8)
export const mixedLabel = (key, after) => after ? `${NEW[key]} (${cutDay}일~)` : `${OLD[key]} (~${cutDay - 1}일)`
export const isAfterCut = (ym, dd) => isNewChannels(`${ym}-${String(dd).padStart(2, '0')}`)
