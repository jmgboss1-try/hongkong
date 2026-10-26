// 매출입력 사진 인식 — 마감 출력물 사진을 Claude로 읽어 키오스크·배달·포스 금액을 돌려줌
//
// Vercel 서버 함수 (POST /api/read-receipt)
//   요청: Authorization: Bearer <Firebase ID 토큰>, body { image: 'data:image/jpeg;base64,...' }
//   응답: { kiosk, baemin, coupang, yogiyo, ddangyeo, pos, 앱별 주문 건수(baeminOrders…), delivery, total, date, notes }
// Vercel 환경변수: ANTHROPIC_API_KEY (필수). 로그인 확인용 Firebase 프로젝트 ID는 VITE_FIREBASE_PROJECT_ID, 없으면 앱의 .env와 같은 값
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import { createRemoteJWKSet, jwtVerify } from 'jose'

const FIREBASE_KEYS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'))

const amount = z.number().int().nullable()
const Receipt = z.object({
  kiosk:    amount.describe('키오스크 매출 (손글씨 "키")'),
  baemin:   amount.describe('배달의민족 매출 (인쇄된 매출요약의 총 결제금액)'),
  coupang:  amount.describe('쿠팡이츠 매출 (손글씨 "c")'),
  yogiyo:   amount.describe('요기요 매출 (손글씨 "y")'),
  ddangyeo: amount.describe('땡겨요 매출 (손글씨 "d")'),
  pos:      amount.describe('포스(현장) 매출 (손글씨 "포")'),
  baeminOrders:   amount.describe('배달의민족 주문 건수 (인쇄된 매출요약의 총 주문건수)'),
  coupangOrders:  amount.describe('쿠팡이츠 주문 건수 (손글씨 "c" 옆 건수)'),
  yogiyoOrders:   amount.describe('요기요 주문 건수 (손글씨 "y" 옆 건수)'),
  ddangyeoOrders: amount.describe('땡겨요 주문 건수 (손글씨 "d" 옆 건수)'),
  delivery: amount.describe('손글씨 "배" 배달 합계'),
  total:    amount.describe('맨 위 손글씨 하루 전체 합계'),
  date:     z.string().nullable().describe('출력물의 날짜 YYYY-MM-DD (연도는 출력 시각 기준)'),
  notes:    z.string().describe('읽기 애매했던 숫자나 확인할 점 (한국어, 없으면 빈 문자열)'),
})

const PROMPT = `홍콩반점 중앙대점의 마감 출력물 사진이에요. 숫자를 읽어 매출 입력 칸에 맞게 돌려주세요.

이 가게 출력물의 규칙:
- 인쇄된 "매출요약"은 배달의민족 것이에요. 맨 위 "총 결제금액"이 배달의민족(baemin) 매출이에요.
- 손글씨 배달앱 매출: "c" = 쿠팡이츠(coupang), "y" = 요기요(yogiyo), "d" = 땡겨요(ddangyeo). 배달 줄 옆에 "ㄴ 금액"으로만 적혀 있으면 쿠팡이츠예요.
- 손글씨 합계: "키" = 키오스크(kiosk), "배" = 배달 플랫폼 합계(delivery), "포" = 포스(pos) 매출이에요.
- 맨 위 손글씨 큰 숫자는 하루 전체 합계(total)예요. 보통 키 + 배 + 포 = 합계, 배 = 배민 + c + y + d 예요.
- 주문 건수: 배달의민족은 인쇄된 "총 주문건수", 다른 앱은 금액 옆에 손으로 쓴 "9건" 같은 숫자예요. 금액과 건수를 헷갈리지 마세요 (건수는 보통 두 자리 이하).
- 적혀 있지 않은 항목은 null.
- 손글씨 숫자는 위 합계 관계로 맞는지 검산하고, 안 맞거나 흐린 숫자가 있으면 notes에 적어주세요.
- 금액은 원 단위 정수(쉼표 없이). 보이지 않는 값은 null.`

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST만 가능해요' })
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: '서버에 ANTHROPIC_API_KEY가 설정되지 않았어요' })

  // 앱에 로그인한 사람만 (Firebase ID 토큰 확인)
  const projectId = process.env.VITE_FIREBASE_PROJECT_ID || 'terry-hongkong'
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  try {
    await jwtVerify(token, FIREBASE_KEYS, { issuer: `https://securetoken.google.com/${projectId}`, audience: projectId })
  } catch {
    return res.status(401).json({ error: '로그인이 필요해요' })
  }

  const m = String(req.body?.image || '').match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/)
  if (!m) return res.status(400).json({ error: '사진 형식이 올바르지 않아요' })

  try {
    const client = new Anthropic()
    // 비용 때문에 Haiku (사진 1장당 1원 미만)
    const response = await client.messages.parse({
      model: 'claude-haiku-5-5',
      max_tokens: 16000,
      output_config: { effort: 'low', format: zodOutputFormat(Receipt) },
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
          { type: 'text', text: PROMPT },
        ],
      }],
    })
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      return res.status(422).json({ error: '사진에서 숫자를 읽지 못했어요. 다시 찍어 주세요' })
    }
    return res.status(200).json(response.parsed_output)
  } catch (err) {
    console.error(err)
    if (err instanceof Anthropic.AuthenticationError) return res.status(500).json({ error: '서버의 Anthropic API 키가 올바르지 않아요' })
    if (err instanceof Anthropic.RateLimitError) return res.status(429).json({ error: '요청이 많아요. 잠시 후 다시 시도해 주세요' })
    if (err instanceof Anthropic.APIError) return res.status(502).json({ error: `사진 인식 서버 오류 (${err.status})` })
    return res.status(500).json({ error: '사진을 읽는 중 오류가 발생했어요' })
  }
}
