// 왼쪽 메뉴 픽토그램 (24×24 선 그림, 색은 currentColor)

const P = {
  // 장부 (대시보드)
  '/': <><path d="M4 4.5h11a3 3 0 0 1 3 3V20H7a3 3 0 0 1-3-3z"/><path d="M4 17a3 3 0 0 1 3-3h11"/><path d="M8 8h6M8 11h4"/></>,
  // 매출: 동전 더미
  '/revenue': <><ellipse cx="12" cy="6.5" rx="6.5" ry="2.5"/><path d="M5.5 6.5v4c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-4"/><path d="M5.5 10.5v4c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-4"/><path d="M5.5 14.5v3c0 1.4 2.9 2.5 6.5 2.5s6.5-1.1 6.5-2.5v-3"/></>,
  // 매출입력: 영수증 + 더하기
  '/revenue-input': <><path d="M6 3h12v18l-2-1.5-2 1.5-2-1.5-2 1.5-2-1.5L6 21z"/><path d="M12 8v6M9 11h6"/></>,
  // 매출분석: 꺾은선
  '/sales-analysis': <><path d="M4 4v16h16"/><path d="M7 15l3.5-4 3 2.5L19 7"/><circle cx="19" cy="7" r="1"/></>,
  // 지출: 지갑에서 나가는 화살표
  '/expenses': <><path d="M3.5 7.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-12a2 2 0 0 1-2-2z"/><path d="M3.5 7.5l10-3.5 1.5 3.5"/><path d="M15.5 13.5h4"/></>,
  // 지출입력: 영수증 + 연필
  '/expenses-input': <><path d="M6 3h10v8M6 3v18l2-1.5 2 1.5 2-1.5"/><path d="M9 8h4M9 11h2"/><path d="M14 20l1-3 5-5 2 2-5 5z"/></>,
  // 스케쥴: 달력
  '/staff': <><rect x="3.5" y="5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="M7.5 13h2M11 13h2M14.5 13h2M7.5 16.5h2M11 16.5h2"/></>,
  // 우리 매장: 가게 앞 차양
  '/our-store': <><path d="M4 10v10h16V10"/><path d="M3 10l2-6h14l2 6"/><path d="M3 10c0 1.4 1.3 2.5 3 2.5S9 11.4 9 10c0 1.4 1.3 2.5 3 2.5s3-1.1 3-2.5c0 1.4 1.3 2.5 3 2.5s3-1.1 3-2.5"/><path d="M10 20v-4.5h4V20"/></>,
  // 근무관리: 시계
  '/work-manage': <><circle cx="12" cy="12.5" r="8"/><path d="M12 8v4.5l3 2"/><path d="M9.5 2.5h5"/></>,
  // 인원관리: 사람 둘
  '/members': <><circle cx="9" cy="8.5" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="16.5" cy="7.5" r="2.6"/><path d="M16 12.6c2.9 0 5 2.3 5 5.4"/></>,
  // 팀원: 사람 셋
  '/team': <><circle cx="12" cy="8" r="3"/><path d="M6.5 20c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5"/><circle cx="5" cy="10" r="2"/><path d="M2 17.5c0-1.9 1.3-3.4 3-3.4"/><circle cx="19" cy="10" r="2"/><path d="M22 17.5c0-1.9-1.3-3.4-3-3.4"/></>,
  // 대타 구함: 바꾸는 화살표
  '/substitute': <><path d="M4 8h13l-3.5-3.5"/><path d="M20 16H7l3.5 3.5"/></>,
  // 손실보상: 방패
  '/loss-claims': <><path d="M12 3l7.5 3v5.5c0 4.5-3.2 8-7.5 9.5-4.3-1.5-7.5-5-7.5-9.5V6z"/><path d="M12 8v5M12 16v.5"/></>,
  // 체크리스트: 체크 상자 목록
  '/checklist': <><rect x="3.5" y="4" width="5" height="5" rx="1"/><path d="M4.8 6.6l1.2 1.2 2-2.4"/><rect x="3.5" y="14" width="5" height="5" rx="1"/><path d="M11.5 6.5h9M11.5 16.5h9"/></>,
  // 선결제: 표(티켓)
  '/prepaid': <><path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h14A1.5 1.5 0 0 1 20.5 7v2.5a2.5 2.5 0 0 0 0 5V17a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 17v-2.5a2.5 2.5 0 0 0 0-5z"/><path d="M14.5 6v12" strokeDasharray="1.6 2"/></>,
  // 현금시재: 지폐
  '/cash': <><rect x="2.5" y="6" width="19" height="12" rx="1.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/></>,
  // 인건비 / 내 급여: 월급 봉투
  '/payroll': <><rect x="3" y="6" width="18" height="13" rx="1.5"/><path d="M3 7.5l9 6 9-6"/></>,
  '/my-payroll': <><rect x="3" y="6" width="18" height="13" rx="1.5"/><path d="M3 7.5l9 6 9-6"/></>,
  // 투자관리: 원 그래프
  '/investment': <><path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z"/><path d="M15 2.8A8.5 8.5 0 0 1 21.2 9H15z"/></>,
  // 소비분석: 장바구니
  '/consumption': <><path d="M3 4.5h2.5l2.2 11h10.6l2-7.5H6.5"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/></>,
  // 공지·메모: 확성기
  '/notice': <><path d="M4 10v4h3l7 4.5v-13L7 10z"/><path d="M17.5 9a4 4 0 0 1 0 6M7 14l1.5 5.5h2.5L10 15"/></>,
  // 내 기록: 클립보드
  '/my-schedule': <><rect x="5" y="4.5" width="14" height="16.5" rx="1.5"/><path d="M9 4.5V3h6v1.5"/><path d="M8.5 10h7M8.5 13.5h7M8.5 17h4"/></>,
  // 메뉴·주문: 그릇과 젓가락
  '/points': <><circle cx="12" cy="12" r="8.5"/><path d="M10 16.5v-9h3a2.6 2.6 0 0 1 0 5.2h-3"/></>,
  '/avatar-manage': <><circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-4 3.8-6.5 7.5-6.5s6.7 2.5 7.5 6.5"/><path d="M17 3.5l1 2 2 .3-1.5 1.4.4 2-1.9-1-1.9 1 .4-2L14 5.8l2-.3z"/></>,
  '/menu-manage': <><path d="M3.5 12.5h17a8.5 7 0 0 1-17 0z"/><path d="M9 19.5h6"/><path d="M14 3.5l4 7M18.5 3l2 7.5"/></>,
  // 아래 버튼들
  '_file': <><rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M12 7.5v7M9 11.5l3 3 3-3"/></>,
  '_order': <><path d="M8 4v16M4.5 7.5L8 4l3.5 3.5"/><path d="M16 20V4M12.5 16.5L16 20l3.5-3.5"/></>,
  '_logout': <><path d="M14 4h4.5a1.5 1.5 0 0 1 1.5 1.5v13a1.5 1.5 0 0 1-1.5 1.5H14"/><path d="M10 8l-4 4 4 4M6 12h10"/></>,
  '_expand': <><path d="M4 5h16M4 12h10M4 19h16"/><path d="M17 9.5l2.5 2.5-2.5 2.5"/></>,
  '_collapse': <><path d="M4 5h16M10 12h10M4 19h16"/><path d="M7 9.5L4.5 12 7 14.5"/></>,
}

export default function NavIcon({ name, size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{flexShrink:0, display:'block'}}>
      {P[name] || <circle cx="12" cy="12" r="7"/>}
    </svg>
  )
}
