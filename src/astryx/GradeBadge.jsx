import { Badge } from '@astryxdesign/core/Badge'
import { calcGrade, calcYears } from '../AuthContext'

// 근속 등급 (병아리 / 고오급인력 / ★ 대선배) — AuthContext의 GradeBadge를 Astryx Badge로
export default function GradeBadge({ joinDate }) {
  const grade = calcGrade(joinDate)
  if (!grade) return null
  if (grade === 'chick') return <Badge variant="warning" label="병아리"/>
  if (grade === 'senior') return <Badge variant="error" label="고오급인력"/>
  const stars = Math.max(1, calcYears(joinDate))
  return <Badge variant="warning" label={`${'★'.repeat(Math.min(stars, 5))} 대선배`}/>
}
