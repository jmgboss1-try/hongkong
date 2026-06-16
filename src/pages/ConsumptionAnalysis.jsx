import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'

const pad = n => String(n).padStart(2, '0')
const wonFmt = n => (n || 0).toLocaleString('ko-KR') + '원'

const ITEMS = [
  { key: 'tang',   label: '탕소스', color: '#f9b934', emoji: '🍜' },
  { key: 'cho',    label: '초단맛', color: '#f87171', emoji: '🌶️' },
  { key: 'noodle', label: '면',     color: '#93c5fd', emoji: '🍝' },
]

const TAGS = ['평일', '주말', '이벤트', '명절', '기타']

// 두 날짜 사이의 모든 날짜 배열 반환
function getDatesInRange(start, end) {
  const dates = []
  const s = new Date(start)
  const e = new Date(end)
  while (s <= e) {
    dates.push(s.toISOString().slice(0, 10))
    s.setDate(s.getDate() + 1)
  }
  return dates
}

// 매출 데이터에서 특정 날짜 범위 합산
async function fetchRevenueForRange(startDate, endDate) {
  const dates = getDatesInRange(startDate, endDate)
  // 관련 월들 추출 (YYYY-MM)
  const months = [...new Set(dates.map(d => d.slice(0, 7)))]

  let total = 0
  for (const month of months) {
    try {
      const snap = await getDoc(doc(db, 'revenue', month))
      if (!snap.exists()) continue
      const data = snap.data()
      for (const date of dates) {
        if (date.slice(0, 7) !== month) continue
        const dd = pad(+date.slice(8, 10))
        const r = data[dd]
        if (!r) continue
        // kiosk/del/pos 합산 (마감 기준)
        total += (r.kiosk || 0) + (r.del || 0) + (r.pos || 0)
      }
    } catch(e) { console.error(e) }
  }
  return total
}

export default function ConsumptionAnalysis() {
  const [records, setRecords]         = useState([])
  const [loading, setLoading]         = useState(true)
  const [saving, setSaving]           = useState(false)
  const [showForm, setShowForm]       = useState(false)
  const [fetchingRevenue, setFetchingRevenue] = useState(false)

  // 입력 폼
  const [form, setForm] = useState({
    label: '', tag: '이벤트',
    startDate: '', endDate: '',
    revenue: '',
    tang: '', cho: '', noodle: '',
    memo: '',
  })

  // 백테스팅
  const [testRevenue, setTestRevenue] = useState('')

  async function load() {
    setLoading(true)
    try {
      const snap = await getDoc(doc(db, 'consumption', 'records'))
      setRecords(snap.exists() ? (snap.data().list || []) : [])
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // 기간 선택 시 매출 자동 불러오기
  async function handleDateChange(key, value) {
    const newForm = { ...form, [key]: value }
    setForm(newForm)

    const start = key === 'startDate' ? value : newForm.startDate
    const end   = key === 'endDate'   ? value : newForm.endDate

    if (start && end && start <= end) {
      setFetchingRevenue(true)
      try {
        const rev = await fetchRevenueForRange(start, end)
        setForm(f => ({ ...f, [key]: value, revenue: rev || '' }))
      } catch(e) { console.error(e) }
      setFetchingRevenue(false)
    }
  }

  function setF(key, val) { setForm(f => ({ ...f, [key]: val })) }

  async function saveRecord() {
    if (!form.label.trim())    return alert('상황명을 입력해주세요')
    if (!form.startDate)       return alert('시작일을 입력해주세요')
    if (!form.endDate)         return alert('종료일을 입력해주세요')
    if (!form.revenue)         return alert('매출을 확인해주세요')
    if (!form.tang && !form.cho && !form.noodle) return alert('소비량을 입력해주세요')

    setSaving(true)
    try {
      const days = getDatesInRange(form.startDate, form.endDate).length
      const newRecord = {
        id:        Date.now().toString(),
        label:     form.label,
        tag:       form.tag,
        startDate: form.startDate,
        endDate:   form.endDate,
        days,
        revenue:   +form.revenue,
        tang:      +form.tang   || 0,
        cho:       +form.cho    || 0,
        noodle:    +form.noodle || 0,
        memo:      form.memo,
        createdAt: new Date().toISOString(),
      }
      const newList = [...records, newRecord].sort((a, b) => a.startDate > b.startDate ? -1 : 1)
      await setDoc(doc(db, 'consumption', 'records'), { list: newList })
      setRecords(newList)
      setForm({ label:'', tag:'이벤트', startDate:'', endDate:'', revenue:'', tang:'', cho:'', noodle:'', memo:'' })
      setShowForm(false)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  async function deleteRecord(id) {
    if (!window.confirm('이 기록을 삭제하시겠습니까?')) return
    const newList = records.filter(r => r.id !== id)
    await setDoc(doc(db, 'consumption', 'records'), { list: newList })
    setRecords(newList)
  }

  // 전체 평균 소비율 계산 (매출 100만원당 봉 수)
  const totalRevenue = records.reduce((a, r) => a + r.revenue, 0)
  const avgPer100 = {}
  for (const item of ITEMS) {
    const totalConsumed = records.reduce((a, r) => a + (r[item.key] || 0), 0)
    avgPer100[item.key] = totalRevenue > 0
      ? (totalConsumed / totalRevenue * 1000000)
      : 0
  }

  // 백테스팅 계산
  const testAmt = +testRevenue || 0
  const testResult = {}
  for (const item of ITEMS) {
    testResult[item.key] = avgPer100[item.key] > 0
      ? Math.ceil(avgPer100[item.key] * testAmt / 1000000)
      : null
  }

  const hasData = records.length > 0

  return (
    <div>
      {/* 헤더 */}
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>📊 소비분석</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>
            재료 소비 패턴 분석 · 발주 수량 예측
          </div>
        </div>
        <button onClick={() => setShowForm(v => !v)}
          style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,
            padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
          + 소비 기록
        </button>
      </div>

      {/* 입력 폼 */}
      {showForm && (
        <div style={{background:'#12141f',border:'1px solid #f9b934',borderRadius:12,
          marginBottom:18,padding:18}}>
          <div style={{fontSize:13,fontWeight:600,color:'#f9b934',marginBottom:16}}>
            📝 소비 기록 입력
          </div>

          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:12,marginBottom:12}}>
            {/* 상황명 */}
            <div style={{gridColumn:'1/-1'}}>
              <label style={{fontSize:10,color:'#5e6585',display:'block',marginBottom:4}}>상황명</label>
              <input value={form.label} onChange={e=>setF('label',e.target.value)}
                placeholder="예: 5월 이벤트, 어버이날 주말"
                style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                  padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
            </div>

            {/* 태그 */}
            <div style={{gridColumn:'1/-1'}}>
              <label style={{fontSize:10,color:'#5e6585',display:'block',marginBottom:6}}>태그</label>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {TAGS.map(t=>(
                  <button key={t} onClick={()=>setF('tag',t)}
                    style={{padding:'5px 12px',borderRadius:6,border:'none',fontSize:11,
                      fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                      background: form.tag===t ? '#f9b934' : '#191c2b',
                      color: form.tag===t ? '#000' : '#5e6585',
                      outline: form.tag===t ? 'none' : '1px solid #272a3d'}}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* 시작일 */}
            <div>
              <label style={{fontSize:10,color:'#5e6585',display:'block',marginBottom:4}}>시작일</label>
              <input type="date" value={form.startDate}
                onChange={e=>handleDateChange('startDate',e.target.value)}
                style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                  padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
            </div>

            {/* 종료일 */}
            <div>
              <label style={{fontSize:10,color:'#5e6585',display:'block',marginBottom:4}}>종료일</label>
              <input type="date" value={form.endDate}
                onChange={e=>handleDateChange('endDate',e.target.value)}
                style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                  padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
            </div>

            {/* 매출 (자동 연동) */}
            <div>
              <label style={{fontSize:10,color:'#5e6585',display:'block',marginBottom:4}}>
                기간 매출 (원)
                {fetchingRevenue && <span style={{marginLeft:6,color:'#f9b934'}}>불러오는 중...</span>}
                {!fetchingRevenue && form.revenue && <span style={{marginLeft:6,color:'#34d399'}}>✓ 자동연동</span>}
              </label>
              <input type="number" value={form.revenue} onChange={e=>setF('revenue',e.target.value)}
                placeholder="날짜 선택 시 자동입력"
                style={{background:'#191c2b',
                  border:`1px solid ${form.revenue?'rgba(52,211,153,0.4)':'#272a3d'}`,
                  borderRadius:7,color:'#dde1f2',padding:'8px 10px',
                  fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
            </div>
          </div>

          {/* 소비량 입력 */}
          <div style={{background:'#191c2b',borderRadius:10,padding:14,marginBottom:12}}>
            <div style={{fontSize:11,fontWeight:600,color:'#dde1f2',marginBottom:12}}>
              재료 소비량 (봉)
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:10}}>
              {ITEMS.map(item=>(
                <div key={item.key}>
                  <label style={{fontSize:10,color:item.color,display:'block',marginBottom:4,fontWeight:600}}>
                    {item.emoji} {item.label}
                  </label>
                  <div style={{position:'relative'}}>
                    <input type="number" value={form[item.key]}
                      onChange={e=>setF(item.key,e.target.value)}
                      placeholder="0" min="0"
                      style={{background:'#12141f',border:`1px solid ${item.color}44`,borderRadius:7,
                        color:'#dde1f2',padding:'8px 10px',paddingRight:28,fontSize:13,
                        outline:'none',width:'100%',fontFamily:'DM Mono,monospace'}}/>
                    <span style={{position:'absolute',right:10,top:'50%',transform:'translateY(-50%)',
                      fontSize:10,color:'#5e6585'}}>봉</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 메모 */}
          <div style={{marginBottom:14}}>
            <label style={{fontSize:10,color:'#5e6585',display:'block',marginBottom:4}}>메모 (선택)</label>
            <input value={form.memo} onChange={e=>setF('memo',e.target.value)}
              placeholder="특이사항, 날씨, 행사 규모 등"
              style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                padding:'8px 10px',fontSize:12,outline:'none',width:'100%',fontFamily:'inherit'}}/>
          </div>

          <div style={{display:'flex',gap:8}}>
            <button onClick={saveRecord} disabled={saving}
              style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,
                padding:'9px 20px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              {saving ? '저장 중...' : '저 장'}
            </button>
            <button onClick={()=>setShowForm(false)}
              style={{background:'transparent',border:'1px solid #272a3d',color:'#5e6585',
                borderRadius:8,padding:'9px 16px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
              취소
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div style={{textAlign:'center',color:'#5e6585',padding:60}}>로딩 중...</div>
      ) : !hasData ? (
        <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,
          padding:'50px 20px',textAlign:'center'}}>
          <div style={{fontSize:36,marginBottom:14}}>📊</div>
          <div style={{fontSize:15,fontWeight:700,color:'#dde1f2',marginBottom:8}}>
            아직 기록된 데이터가 없어요
          </div>
          <div style={{fontSize:12,color:'#5e6585'}}>
            소비 기록을 입력하면 발주 예측이 자동으로 계산됩니다
          </div>
        </div>
      ) : (
        <>
          {/* 평균 소비율 카드 */}
          <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,
            padding:'18px 20px',marginBottom:18}}>
            <div style={{fontSize:12,fontWeight:600,color:'#5e6585',marginBottom:14}}>
              📈 매출 100만원당 평균 소비량 ({records.length}건 데이터 기준)
            </div>
            <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
              {ITEMS.map(item=>(
                <div key={item.key} style={{background:'#191c2b',borderRadius:10,padding:'14px 16px',
                  border:`1px solid ${item.color}33`}}>
                  <div style={{fontSize:13,marginBottom:4}}>{item.emoji} {item.label}</div>
                  <div style={{fontSize:22,fontWeight:700,color:item.color,
                    fontFamily:'DM Mono,monospace',marginBottom:4}}>
                    {avgPer100[item.key] > 0 ? avgPer100[item.key].toFixed(1) : '—'}
                    <span style={{fontSize:12,fontWeight:400,color:'#5e6585',marginLeft:4}}>봉</span>
                  </div>
                  <div style={{fontSize:10,color:'#5e6585'}}>100만원 매출 기준</div>
                </div>
              ))}
            </div>
          </div>

          {/* 발주 예측 (백테스팅) */}
          <div style={{background:'#12141f',border:'1px solid rgba(52,211,153,0.3)',
            borderRadius:12,padding:'18px 20px',marginBottom:18}}>
            <div style={{fontSize:12,fontWeight:600,color:'#34d399',marginBottom:14}}>
              🔮 발주 수량 예측
            </div>
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16,flexWrap:'wrap'}}>
              <div style={{flex:1,minWidth:200}}>
                <label style={{fontSize:10,color:'#5e6585',display:'block',marginBottom:4}}>
                  예상 매출 입력 (원)
                </label>
                <input type="number" value={testRevenue}
                  onChange={e=>setTestRevenue(e.target.value)}
                  placeholder="예: 2000000"
                  style={{background:'#191c2b',border:'1px solid rgba(52,211,153,0.3)',borderRadius:7,
                    color:'#dde1f2',padding:'10px 12px',fontSize:13,outline:'none',
                    width:'100%',fontFamily:'DM Mono,monospace'}}/>
              </div>
              {testAmt > 0 && (
                <div style={{fontSize:13,color:'#5e6585',paddingTop:16}}>
                  → {wonFmt(testAmt)} 예상 시
                </div>
              )}
            </div>

            {testAmt > 0 && (
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:12}}>
                {ITEMS.map(item=>{
                  const qty = testResult[item.key]
                  return (
                    <div key={item.key} style={{background:'#191c2b',borderRadius:10,
                      padding:'14px 16px',border:`1px solid ${item.color}44`,textAlign:'center'}}>
                      <div style={{fontSize:16,marginBottom:4}}>{item.emoji}</div>
                      <div style={{fontSize:12,color:'#5e6585',marginBottom:8}}>{item.label}</div>
                      {qty !== null ? (
                        <>
                          <div style={{fontSize:28,fontWeight:700,color:item.color,
                            fontFamily:'DM Mono,monospace'}}>
                            {qty}
                          </div>
                          <div style={{fontSize:11,color:'#5e6585',marginTop:2}}>봉 준비</div>
                          <div style={{fontSize:10,color:'#3d4060',marginTop:4}}>
                            (±{Math.ceil(qty*0.1)}봉 여유 권장)
                          </div>
                        </>
                      ) : (
                        <div style={{fontSize:12,color:'#3d4060'}}>데이터 부족</div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {testAmt === 0 && (
              <div style={{textAlign:'center',color:'#3d4060',fontSize:12,padding:'10px 0'}}>
                예상 매출을 입력하면 필요 발주량이 자동으로 계산됩니다
              </div>
            )}
          </div>

          {/* 기록 목록 */}
          <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden'}}>
            <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,
              display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <span>📋 소비 기록 ({records.length}건)</span>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:0}}>
              {records.map((r,i)=>{
                const days = getDatesInRange(r.startDate, r.endDate).length
                const perDay = {
                  tang:   r.tang   / days,
                  cho:    r.cho    / days,
                  noodle: r.noodle / days,
                }
                return (
                  <div key={r.id} style={{
                    padding:'16px 18px',
                    borderBottom: i < records.length-1 ? '1px solid #272a3d' : 'none',
                  }}>
                    <div style={{display:'flex',justifyContent:'space-between',
                      alignItems:'flex-start',flexWrap:'wrap',gap:10}}>
                      <div style={{flex:1}}>
                        {/* 헤더 */}
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'}}>
                          <span style={{fontSize:14,fontWeight:700,color:'#dde1f2'}}>{r.label}</span>
                          <span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:4,
                            background:'rgba(249,185,52,0.15)',color:'#f9b934'}}>{r.tag}</span>
                          <span style={{fontSize:10,color:'#5e6585'}}>
                            {r.startDate} ~ {r.endDate} ({days}일)
                          </span>
                        </div>

                        {/* 매출 */}
                        <div style={{fontSize:13,fontWeight:700,color:'#34d399',
                          fontFamily:'DM Mono,monospace',marginBottom:10}}>
                          {wonFmt(r.revenue)}
                        </div>

                        {/* 소비량 */}
                        <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                          {ITEMS.map(item=>(
                            <div key={item.key} style={{background:'#191c2b',borderRadius:7,
                              padding:'8px 12px',border:`1px solid ${item.color}33`}}>
                              <div style={{fontSize:10,color:'#5e6585',marginBottom:2}}>
                                {item.emoji} {item.label}
                              </div>
                              <div style={{fontSize:14,fontWeight:700,color:item.color,
                                fontFamily:'DM Mono,monospace'}}>
                                {r[item.key]}봉
                              </div>
                              <div style={{fontSize:9,color:'#3d4060',marginTop:1}}>
                                일평균 {perDay[item.key].toFixed(1)}봉
                              </div>
                            </div>
                          ))}
                        </div>

                        {r.memo && (
                          <div style={{fontSize:11,color:'#5e6585',marginTop:8}}>
                            💬 {r.memo}
                          </div>
                        )}
                      </div>

                      <button onClick={()=>deleteRecord(r.id)}
                        style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',
                          padding:'4px 10px',fontSize:10,borderRadius:4,cursor:'pointer',
                          fontFamily:'inherit',flexShrink:0}}>
                        삭제
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
