import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useAuth } from '../AuthContext'

const pad = n => String(n).padStart(2,'0')
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }

export default function MyPayroll() {
  const { user } = useAuth()
  const [curMonth, setCurMonth] = useState(()=>{
    const now=new Date(); return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [payroll, setPayroll]           = useState(null)
  const [loading, setLoading]           = useState(true)
  const [showInquiryForm, setShowInquiryForm] = useState(false)
  const [inquiryText, setInquiryText]   = useState('')
  const [saving, setSaving]             = useState(false)

  const monthOpts=[]
  for(let y=2022;y<=2026;y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  async function load() {
    if(!user) return
    setLoading(true)
    try {
      const snap = await getDoc(doc(db,'payroll',curMonth))
      const data = snap.exists() ? snap.data() : {}
      setPayroll(data[user.uid] || null)
    } catch(e){ console.error(e) }
    setLoading(false)
  }

  useEffect(()=>{ load() },[curMonth, user])

  async function updatePayroll(updater) {
    const snap = await getDoc(doc(db,'payroll',curMonth))
    const full  = snap.exists() ? snap.data() : {}
    const newData = { ...full, [user.uid]: updater(full[user.uid]||{}) }
    await setDoc(doc(db,'payroll',curMonth), newData)
    setPayroll(newData[user.uid])
  }

  async function checkPayroll() {
    if(!window.confirm('급여 내역을 확인하셨습니까?')) return
    setSaving(true)
    try {
      await updatePayroll(prev=>({ ...prev, checkedByEmp:true, checkedAt:new Date().toISOString() }))
    } catch(e){ console.error(e) }
    setSaving(false)
  }

  async function submitInquiry() {
    if(!inquiryText.trim()) return alert('문의 내용을 입력해주세요')
    setSaving(true)
    try {
      await updatePayroll(prev=>({
        ...prev,
        inquiry: {
          message: inquiryText.trim(),
          createdAt: new Date().toISOString(),
          ownerReply: null, repliedAt: null, resolved: false,
        }
      }))
      setShowInquiryForm(false)
      setInquiryText('')
    } catch(e){ console.error(e) }
    setSaving(false)
  }

  const p = payroll

  // 상태 계산
  const isPending  = !p?.confirmedByOwner
  const isInquiry  = p?.inquiry && !p.inquiry.resolved
  const isChecked  = p?.checkedByEmp
  const isPaid     = p?.paid

  return (
    <div>
      {/* 헤더 */}
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>💸 내 급여</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>{mLabel(curMonth)}</div>
        </div>
        <select value={curMonth} onChange={e=>setCurMonth(e.target.value)}
          style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,color:'#dde1f2',
            padding:'8px 12px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
          {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{textAlign:'center',color:'#5e6585',padding:60}}>로딩 중...</div>
      ) : isPending ? (
        /* 급여 미확정 */
        <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,
          padding:'50px 20px',textAlign:'center'}}>
          <div style={{fontSize:36,marginBottom:14}}>⏳</div>
          <div style={{fontSize:15,fontWeight:700,color:'#dde1f2',marginBottom:8}}>급여 집계 중</div>
          <div style={{fontSize:12,color:'#5e6585'}}>사장님이 이달 급여를 확정하면 여기에 표시됩니다</div>
        </div>
      ) : (
        <>
          {/* 급여 카드 */}
          <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,
            overflow:'hidden',marginBottom:14}}>
            {/* 카드 헤더 */}
            <div style={{padding:'14px 20px',borderBottom:'1px solid #272a3d',
              display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{fontSize:13,fontWeight:600}}>{mLabel(curMonth)} 급여 내역</div>
              {isPaid && (
                <span style={{fontSize:11,fontWeight:700,padding:'4px 10px',borderRadius:5,
                  background:'rgba(147,197,253,0.15)',color:'#93c5fd'}}>
                  ✅ 지급완료 ({p.paidAt?.slice(0,10)})
                </span>
              )}
              {!isPaid && isChecked && !isInquiry && (
                <span style={{fontSize:11,fontWeight:700,padding:'4px 10px',borderRadius:5,
                  background:'rgba(52,211,153,0.12)',color:'#34d399'}}>
                  확인 완료 · 지급 대기중
                </span>
              )}
              {isInquiry && (
                <span style={{fontSize:11,fontWeight:700,padding:'4px 10px',borderRadius:5,
                  background:'rgba(248,113,113,0.12)',color:'#f87171'}}>
                  📨 문의 처리중
                </span>
              )}
            </div>

            {/* 상세 지표 */}
            <div style={{padding:'16px 20px',display:'grid',gridTemplateColumns:'repeat(3,1fr)',
              gap:12,borderBottom:'1px solid #272a3d'}}>
              {[
                {label:'총 근무시간', val:`${p.totalHours}h ${p.totalMins>0?p.totalMins+'m':''}`, color:'#f9b934'},
                {label:'기본급',      val:`${(p.basePay||0).toLocaleString()}원`,                 color:'#dde1f2'},
                {label:'주휴수당',    val:`${(p.weeklyHoliday||0).toLocaleString()}원`,           color:'#93c5fd'},
              ].map(k=>(
                <div key={k.label} style={{background:'#191c2b',borderRadius:8,padding:'12px 14px'}}>
                  <div style={{fontSize:10,color:'#5e6585',marginBottom:5}}>{k.label}</div>
                  <div style={{fontSize:13,fontWeight:700,color:k.color,fontFamily:'DM Mono,monospace'}}>{k.val}</div>
                </div>
              ))}
            </div>

            {/* 총액 */}
            <div style={{padding:'16px 20px',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div>
                <div style={{fontSize:11,color:'#5e6585',marginBottom:5}}>이달 월급</div>
                <div style={{fontSize:26,fontWeight:700,color:'#f9b934',fontFamily:'DM Mono,monospace'}}>
                  {(p.totalPay||0).toLocaleString()}원
                </div>
              </div>
              <div style={{fontSize:11,color:'#5e6585',textAlign:'right',lineHeight:2}}>
                시급 {(p.wage||10030).toLocaleString()}원/h<br/>
                확정일 {p.confirmedAt?.slice(0,10)}
              </div>
            </div>
          </div>

          {/* 문의 스레드 */}
          {p.inquiry && (
            <div style={{background:'#12141f',
              border:`1px solid ${p.inquiry.resolved?'rgba(52,211,153,0.3)':'rgba(248,113,113,0.3)'}`,
              borderRadius:12,overflow:'hidden',marginBottom:14}}>
              <div style={{padding:'12px 18px',borderBottom:'1px solid #272a3d',fontSize:12,fontWeight:600,
                color:p.inquiry.resolved?'#34d399':'#f87171',display:'flex',justifyContent:'space-between'}}>
                <span>{p.inquiry.resolved ? '✅ 문의 해결 완료' : '📨 문의 진행중'}</span>
                <span style={{fontSize:10,color:'#5e6585',fontWeight:400}}>{p.inquiry.createdAt?.slice(0,10)}</span>
              </div>
              <div style={{padding:'16px 18px',display:'flex',flexDirection:'column',gap:12}}>
                {/* 내 문의 */}
                <div style={{display:'flex',gap:10,alignItems:'flex-start'}}>
                  <div style={{width:30,height:30,borderRadius:'50%',background:'rgba(94,101,133,0.25)',
                    display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,flexShrink:0}}>👤</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:10,color:'#5e6585',marginBottom:5}}>내 문의</div>
                    <div style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,
                      padding:'10px 14px',fontSize:12,color:'#dde1f2',lineHeight:1.7}}>
                      {p.inquiry.message}
                    </div>
                  </div>
                </div>
                {/* 사장 답변 */}
                {p.inquiry.ownerReply ? (
                  <div style={{display:'flex',gap:10,alignItems:'flex-start',justifyContent:'flex-end'}}>
                    <div style={{flex:1,maxWidth:'82%'}}>
                      <div style={{fontSize:10,color:'#5e6585',marginBottom:5,textAlign:'right'}}>
                        사장님 답변 · {p.inquiry.repliedAt?.slice(0,10)}
                      </div>
                      <div style={{background:'rgba(249,185,52,0.08)',border:'1px solid rgba(249,185,52,0.2)',
                        borderRadius:8,padding:'10px 14px',fontSize:12,color:'#dde1f2',lineHeight:1.7}}>
                        {p.inquiry.ownerReply}
                      </div>
                    </div>
                    <div style={{width:30,height:30,borderRadius:'50%',background:'rgba(249,185,52,0.2)',
                      display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,flexShrink:0}}>👑</div>
                  </div>
                ) : (
                  <div style={{textAlign:'center',fontSize:11,color:'#5e6585',padding:'8px 0'}}>
                    사장님이 문의를 확인 중입니다...
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 확인 / 문의 버튼 영역 */}
          {!isPaid && !isChecked && !p.inquiry && (
            <div style={{display:'flex',gap:10,marginBottom:showInquiryForm?14:0}}>
              <button onClick={checkPayroll} disabled={saving}
                style={{flex:1,background:'#34d399',color:'#000',border:'none',borderRadius:10,
                  padding:'15px',fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                ✅ 확인했습니다
              </button>
              <button onClick={()=>setShowInquiryForm(v=>!v)}
                style={{flex:1,background:'transparent',border:'1px solid #f87171',color:'#f87171',
                  borderRadius:10,padding:'15px',fontSize:13,fontWeight:600,
                  cursor:'pointer',fontFamily:'inherit'}}>
                ❓ 문의하기
              </button>
            </div>
          )}

          {/* 문의 폼 */}
          {showInquiryForm && !p.inquiry && (
            <div style={{background:'#12141f',border:'1px solid rgba(248,113,113,0.3)',borderRadius:12,
              padding:'18px',display:'flex',flexDirection:'column',gap:12}}>
              <div>
                <div style={{fontSize:13,fontWeight:600,color:'#f87171',marginBottom:4}}>📨 급여 문의</div>
                <div style={{fontSize:11,color:'#5e6585'}}>
                  근무시간이나 급여 내역에 다른 부분이 있으면 아래에 상세히 적어주세요.
                  사장님이 확인 후 답변드립니다.
                </div>
              </div>
              <textarea value={inquiryText} onChange={e=>setInquiryText(e.target.value)}
                placeholder="예: 5월 3일(토) 근무시간이 8시간인데 7시간으로 입력되어 있습니다."
                rows={5}
                style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,
                  color:'#dde1f2',padding:'12px',fontSize:12,outline:'none',
                  resize:'vertical',fontFamily:'inherit',lineHeight:1.7}}/>
              <div style={{display:'flex',gap:8}}>
                <button onClick={submitInquiry} disabled={saving}
                  style={{background:'#f87171',color:'#fff',border:'none',borderRadius:8,
                    padding:'10px 20px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                  {saving?'전송 중...':'문의 전송'}
                </button>
                <button onClick={()=>{setShowInquiryForm(false);setInquiryText('')}}
                  style={{background:'transparent',border:'1px solid #272a3d',color:'#5e6585',
                    borderRadius:8,padding:'10px 16px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
                  취소
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
