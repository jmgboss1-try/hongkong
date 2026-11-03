// 메뉴 묶음마다 색: 돈 = 파랑, 사람 = 보라, 매장 운영 = 주황, 대시보드 = 먹색
export const NAV_GROUPS = {
  home:  { label:'한눈에',    color:'#1D1B18' },
  money: { label:'돈',        color:'#2B5C9E' },
  people:{ label:'사람',      color:'#6B4FA0' },
  store: { label:'매장 운영', color:'#B45309' },
}

// 메뉴 경로 → 묶음
export const navGroupOf = path => {
  if (path === '/') return 'home'
  if (['/staff','/our-store','/work-manage','/members','/team','/substitute','/my-schedule'].includes(path)) return 'people'
  if (['/checklist','/notice'].includes(path)) return 'store'
  return 'money'
}

