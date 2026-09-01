import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')
const todayStr = () => { const n=new Date(); return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}` }
const wonFmt = n => (n||0).toLocaleString('ko-KR')

const PLATFORMS = [
  { key:'baemin',   label:'배달의민족', color:'#34d399' },
  { key:'coupang',  label:'쿠팡이츠',   color:'#f87171' },
  { key:'yogiyo',   label:'요기요',     color:'#f9b934' },
  { key:'ddangyeo', label:'땡겨요',     color:'#93c5fd' },
]
const TYPES  = ['오배송','메뉴누락','파손','기타']
const CAUSES = [
  { key:'store',  label:'매장',  color:'#f87171' },
  { key:'rider',  label:'라이더', color:'#f9b934' },
  { key:'customer',label:'고객', color:'#93c5fd' },
]
const CLAIM_STATUS = [
  { key:'pending',  label:'대기중', color:'#5e6585' },
  { key:'approved', label:'승인',   color:'#34d399' },
  { key:'rejected', label:'거절',   color:'#f87171' },
]

function emptyForm() {
  return {
    date: todayStr(),
    platform: 'baemin',
    orderNo: '',
    type: '오배송',
    cause: 'store',
    orderAmount: '',
    lossAmount: '',
    memo: '',
    claimStatus: 'pending',
    approvedDate: '',
    approvedAmount: '',
    depositDate: '',
    rejectReason: '',
  }
}

export default function LossClaims() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm())

  const [editId, setEditId] = useState(null)
  const [editForm, setEditForm] = useState(null)

  const [filterTab, setFilterTab] = useState('active') // 'active' | 'done'

  async function load() {
    setLoading(true)
    try {
      const snap = await getDoc(doc(db,'lossClaims','records'))
      setRecords(snap.exists() ? (snap.data().list||[]) : [])
    } catch(e) { console.error(e) }
    setLoading(false)
  }
  useEffect(()=>{ load() },[])

  async function saveAll(newList) {
    await setDoc(doc(db,'lossClaims','records'), { list:newList })
    setRecords(newList)
  }

  async function addRecord() {
    if(!form.date) return alert('날짜를 입력해주세요')
    setSaving(true)
    try {
      const newRec = {
        id: Date.now().toString(),
        ...form,
        orderAmount: +form.orderAmount||0,
        lossAmount: +form.lossAmount||0,
        approvedAmount: +form.approvedAmount||0,
        status: 'active', // 진행중/완료
        createdAt: new Date().toISOString(),
      }
      await saveAll([...records, newRec])
      setForm(emptyForm())
      setShowForm(false)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  async function deleteRecord(id) {
    if(!window.confirm('이 기록을 삭제하시겠습니까?')) return
    await saveAll(records.filter(r=>r.id!==id))
  }

  async function toggleStatus(id) {
    const newList = records.map(r=>
      r.id===id ? { ...r, status: r.status==='active' ? 'done' : 'active' } : r
    )
    await saveAll(newList)
  }

  function startEdit(r) {
    setEditId(r.id)
    setEditForm({ ...r })
  }

  async function saveEdit() {
    setSaving(true)
    try {
      const newList = records.map(r =>
        r.id === editId ? {
          ...editForm,
          orderAmount: +editForm.orderAmount||0,
          lossAmount: +editForm.lossAmount||0,
          approvedAmount: +editForm.approvedAmount||0,
        } : r
      )
      await saveAll(newList)
      setEditId(null); setEditForm(null)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  function updateClaimStatus(target, key, val) {
    // target: 'form' | 'editForm'
    const setter = target === 'form' ? setForm : setEditForm
    setter(f => {
      const next = { ...f, [key]: val }
      // 승인으로 바꾸는 순간 승인일 기본값을 오늘로
      if(key==='claimStatus' && val==='approved' && !next.approvedDate) {
        next.approvedDate = todayStr()
      }
      return next
    })
  }

  const platformOf = key => PLATFORMS.find(p=>p.key===key)
  const causeOf = key => CAUSES.find(c=>c.key===key)
  const claimStatusOf = key => CLAIM_STATUS.find(s=>s.key===key)

  const filtered = records
    .filter(r => filterTab==='active' ? r.status!=='done' : r.status==='done')
    .sort((a,b)=> b.date.localeCompare(a.date))

  const activeCount = records.filter(r=>r.status!=='done').length
  const doneCount   = records.filter(r=>r.status==='done').length

  const totalLoss     = records.reduce((a,r)=>a+(r.lossAmount||0),0)
  const totalApproved = records.filter(r=>r.claimStatus==='approved').reduce((a,r)=>a+(r.approvedAmount||0),0)
  const totalOrder    = records.reduce((a,r)=>a+(r.orderAmount||0),0)
  const pendingCount  = records.filter(r=>r.claimStatus==='pending').length

  const inputStyle = {
    background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
    padding:'8px 10px',fontSize:12,outline:'none',fontFamily:'inherit',width:'100%'
  }
  const labelStyle = { fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6 }

  function ToggleGroup({ options, value, onChange, colorKey='color' }) {
    return (
      <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
        {options.map(opt=>{
          const key = opt.key ?? opt
          const label = opt.label ?? opt
          const color = opt[colorKey] || '#f9b934'
          const selected = value === key
          return (
            <button key={key} onClick={()=>onChange(key)}
              style={{padding:'6px 12px',borderRadius:7,border:'none',fontSize:11,fontWeight:600,
                cursor:'pointer',fontFamily:'inherit',
                background:selected?`${color}22`:'#191c2b',
                color:selected?color:'#5e6585',
                outline:selected?`1.5px solid ${color}55`:'1.5px solid transparent'}}>
              {label}
            </button>
          )
        })}
      </div>
    )
  }

  function ClaimStatusSection({ f, target }) {
    return (
      <div>
        <label style={labelStyle}>손실보상 상태</label>
        <ToggleGroup options={CLAIM_STATUS} value={f.claimStatus}
          onChange={v=>updateClaimStatus(target, 'claimStatus', v)}/>

        {f.claimStatus === 'approved' && (
          <div style={{marginTop:10,background:'rgba(52,211,153,0.06)',border:'1px solid rgba(52,211,153,0.2)',
            borderRadius:8,padding:12,display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10}}>
            <div>
              <label style={labelStyle}>승인일</label>
              <input type="date" value={f.approvedDate||todayStr()}
                onChange={e=>(target==='form'?setForm:setEditForm)(p=>({...p,approvedDate:e.target.value}))}
                style={inputStyle}/>
            </div>
            <div>
              <label style={labelStyle}>보상 금액 (원)</label>
              <input type="number" value={f.approvedAmount}
                onChange={e=>(target==='form'?setForm:setEditForm)(p=>({...p,approvedAmount:e.target.value}))}
                placeholder="0" style={inputStyle}/>
            </div>
            <div>
              <label style={labelStyle}>입금 확인일 (선택)</label>
              <input type="date" value={f.depositDate||''}
                onChange={e=>(target==='form'?setForm:setEditForm)(p=>({...p,depositDate:e.target.value}))}
                style={inputStyle}/>
            </div>
          </div>
        )}

        {f.claimStatus === 'rejected' && (
          <div style={{marginTop:10}}>
            <label style={labelStyle}>거절 사유</label>
            <input value={f.rejectReason||''}
              onChange={e=>(target==='form'?setForm:setEditForm)(p=>({...p,rejectReason:e.target.value}))}
              placeholder="거절 사유를 입력하세요" style={inputStyle}/>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22,flexWrap:'wrap',gap:10}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>📋 손실보상 관리</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>배달 사고 및 보상 이력</div>
        </div>
        <button onClick={()=>{ setShowForm(v=>!v); setForm(emptyForm()) }}
          style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,
            padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
          + 사고 등록
        </button>
      </div>

      {/* 요약 카드 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,marginBottom:18}}>
        {[
          {label:'총 주문 금액',   val:totalOrder,     color:'#dde1f2'},
          {label:'총 손실 금액',   val:totalLoss,      color:'#f87171'},
          {label:'보상 받은 금액', val:totalApproved,  color:'#34d399'},
          {label:'대기중 건수',    val:pendingCount, isCount:true, color:'#f9b934'},
        ].map(k=>(
          <div key={k.label} style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'14px 16px',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:k.color}}/>
            <div style={{fontSize:10,fontWeight:600,color:'#5e6585',marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:16,fontWeight:700,color:k.color,fontFamily:'DM Mono,monospace'}}>
              {k.isCount ? `${k.val}건` : `${wonFmt(k.val)}원`}
            </div>
          </div>
        ))}
      </div>

      {/* 등록 폼 */}
      {showForm && (
        <div style={{background:'#12141f',border:'1px solid #f9b934',borderRadius:12,marginBottom:18,padding:18}}>
          <div style={{fontSize:13,fontWeight:600,color:'#f9b934',marginBottom:14}}>+ 사고 등록</div>
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:12}}>
              <div>
                <label style={labelStyle}>날짜</label>
                <input type="date" value={form.date} onChange={e=>setForm(f=>({...f,date:e.target.value}))} style={inputStyle}/>
              </div>
              <div>
                <label style={labelStyle}>주문 금액 (원)</label>
                <input type="number" value={form.orderAmount} onChange={e=>setForm(f=>({...f,orderAmount:e.target.value}))}
                  placeholder="0" style={inputStyle}/>
              </div>
              <div>
                <label style={labelStyle}>손실 금액 (원)</label>
                <input type="number" value={form.lossAmount} onChange={e=>setForm(f=>({...f,lossAmount:e.target.value}))}
                  placeholder="0" style={inputStyle}/>
              </div>
            </div>

                        <div>
              <label style={labelStyle}>플랫폼</label>
              <ToggleGroup options={PLATFORMS} value={form.platform} onChange={v=>setForm(f=>({...f,platform:v}))}/>
            </div>
            <div>
              <label style={labelStyle}>주문번호</label>
              <input value={form.orderNo} onChange={e=>setForm(f=>({...f,orderNo:e.target.value}))}
                placeholder="주문번호 입력" style={inputStyle}/>
            </div>
            <div>
              <label style={labelStyle}>유형</label>
              <ToggleGroup options={TYPES.map(t=>({key:t,label:t,color:'#f9b934'}))} value={form.type}
                onChange={v=>setForm(f=>({...f,type:v}))}/>
            </div>
            <div>
              <label style={labelStyle}>원인 제공</label>
              <ToggleGroup options={CAUSES} value={form.cause} onChange={v=>setForm(f=>({...f,cause:v}))}/>
            </div>

            <div>
              <label style={labelStyle}>내용</label>
              <input value={form.memo} onChange={e=>setForm(f=>({...f,memo:e.target.value}))}
                placeholder="어떤 일이 있었는지 적어주세요" style={inputStyle}/>
            </div>

            <ClaimStatusSection f={form} target="form"/>
          </div>

          <div style={{display:'flex',gap:8,marginTop:16}}>
            <button onClick={addRecord} disabled={saving}
              style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'9px 20px',
                fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              {saving?'등록 중...':'등록'}
            </button>
            <button onClick={()=>setShowForm(false)}
              style={{background:'#191c2b',color:'#5e6585',border:'1px solid #272a3d',borderRadius:8,
                padding:'9px 20px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
              취소
            </button>
          </div>
        </div>
      )}

      {/* 진행중/완료 탭 */}
      <div style={{display:'flex',gap:8,marginBottom:14}}>
        {[['active',`🔴 진행중 (${activeCount})`],['done',`🟢 완료 (${doneCount})`]].map(([key,label])=>(
          <button key={key} onClick={()=>setFilterTab(key)}
            style={{padding:'7px 14px',borderRadius:7,border:'none',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
              background:filterTab===key?'#f9b934':'#191c2b',color:filterTab===key?'#000':'#5e6585'}}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{textAlign:'center',color:'#5e6585',padding:60}}>로딩 중...</div>
      ) : filtered.length === 0 ? (
        <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:40,textAlign:'center',color:'#5e6585'}}>
          {filterTab==='active' ? '진행중인 사고 건이 없습니다' : '완료된 사고 건이 없습니다'}
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:12}}>
          {filtered.map(r=>{
            const pf = platformOf(r.platform)
            const cause = causeOf(r.cause)
            const cs = claimStatusOf(r.claimStatus)
            const isEditing = editId === r.id
            const ef = isEditing ? editForm : null

            return (
              <div key={r.id} style={{background:'#12141f',
                border:`1px solid ${isEditing?'#f9b934':'#272a3d'}`,borderRadius:12,overflow:'hidden'}}>

                {!isEditing ? (
                  <>
                    <div style={{padding:'14px 18px',display:'flex',justifyContent:'space-between',
                      alignItems:'flex-start',flexWrap:'wrap',gap:10}}>
                      <div>
                        <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:6}}>
                          <span style={{fontSize:13,fontWeight:700,color:'#dde1f2'}}>{r.date}</span>
                                                    <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:4,
                            background:`${pf?.color}18`,color:pf?.color}}>{pf?.label}</span>
                          {r.orderNo && <span style={{fontSize:11,color:'#5e6585',fontFamily:'DM Mono,monospace'}}>#{r.orderNo}</span>}
                          <span style={{fontSize:11,color:'#5e6585'}}>{r.type}</span>
                          <span style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:4,
                            background:`${cause?.color}18`,color:cause?.color}}>원인: {cause?.label}</span>
                          <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:4,
                            background:`${cs?.color}18`,color:cs?.color}}>{cs?.label}</span>
                        </div>
                        {r.memo && <div style={{fontSize:12,color:'#dde1f2',marginBottom:6}}>{r.memo}</div>}
                        <div style={{display:'flex',gap:14,flexWrap:'wrap',fontSize:11,color:'#5e6585'}}>
                          <span>주문금액 <b style={{color:'#dde1f2'}}>{wonFmt(r.orderAmount)}원</b></span>
                          <span>손실금액 <b style={{color:'#f87171'}}>{wonFmt(r.lossAmount)}원</b></span>
                          {r.claimStatus==='approved' && (
                            <>
                              <span>보상금액 <b style={{color:'#34d399'}}>{wonFmt(r.approvedAmount)}원</b></span>
                              <span>승인일 <b style={{color:'#dde1f2'}}>{r.approvedDate}</b></span>
                              <span>입금확인 <b style={{color: r.depositDate?'#34d399':'#f9b934'}}>{r.depositDate || '미확인'}</b></span>
                            </>
                          )}
                          {r.claimStatus==='rejected' && r.rejectReason && (
                            <span>거절사유 <b style={{color:'#f87171'}}>{r.rejectReason}</b></span>
                          )}
                        </div>
                      </div>
                      <div style={{display:'flex',gap:6,flexShrink:0}}>
                        <button onClick={()=>startEdit(r)}
                          style={{background:'transparent',border:'1px solid #272a3d',color:'#dde1f2',
                            padding:'5px 10px',fontSize:10,borderRadius:5,cursor:'pointer',fontFamily:'inherit'}}>
                          수정
                        </button>
                        <button onClick={()=>toggleStatus(r.id)}
                          style={{background: r.status==='active' ? '#34d399' : 'transparent',
                            border: r.status==='active' ? 'none' : '1px solid #272a3d',
                            color: r.status==='active' ? '#000' : '#5e6585',
                            padding:'5px 12px',fontSize:10,fontWeight:700,borderRadius:5,cursor:'pointer',fontFamily:'inherit'}}>
                          {r.status==='active' ? '처리 완료 ✓' : '다시 처리중으로'}
                        </button>
                        <button onClick={()=>deleteRecord(r.id)}
                          style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',
                            padding:'5px 10px',fontSize:10,borderRadius:5,cursor:'pointer',fontFamily:'inherit'}}>
                          삭제
                        </button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div style={{padding:18}}>
                    <div style={{display:'flex',flexDirection:'column',gap:14}}>
                      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:12}}>
                        <div>
                          <label style={labelStyle}>날짜</label>
                          <input type="date" value={ef.date} onChange={e=>setEditForm(f=>({...f,date:e.target.value}))} style={inputStyle}/>
                        </div>
                        <div>
                          <label style={labelStyle}>주문 금액 (원)</label>
                          <input type="number" value={ef.orderAmount} onChange={e=>setEditForm(f=>({...f,orderAmount:e.target.value}))} style={inputStyle}/>
                        </div>
                        <div>
                          <label style={labelStyle}>손실 금액 (원)</label>
                          <input type="number" value={ef.lossAmount} onChange={e=>setEditForm(f=>({...f,lossAmount:e.target.value}))} style={inputStyle}/>
                        </div>
                      </div>
                                            <div>
                        <label style={labelStyle}>플랫폼</label>
                        <ToggleGroup options={PLATFORMS} value={ef.platform} onChange={v=>setEditForm(f=>({...f,platform:v}))}/>
                      </div>
                      <div>
                        <label style={labelStyle}>주문번호</label>
                        <input value={ef.orderNo} onChange={e=>setEditForm(f=>({...f,orderNo:e.target.value}))} style={inputStyle}/>
                      </div>
                      <div>
                        <label style={labelStyle}>유형</label>
                        <ToggleGroup options={TYPES.map(t=>({key:t,label:t,color:'#f9b934'}))} value={ef.type}
                          onChange={v=>setEditForm(f=>({...f,type:v}))}/>
                      </div>
                      <div>
                        <label style={labelStyle}>원인 제공</label>
                        <ToggleGroup options={CAUSES} value={ef.cause} onChange={v=>setEditForm(f=>({...f,cause:v}))}/>
                      </div>
                      <div>
                        <label style={labelStyle}>내용</label>
                        <input value={ef.memo} onChange={e=>setEditForm(f=>({...f,memo:e.target.value}))} style={inputStyle}/>
                      </div>
                      <ClaimStatusSection f={ef} target="editForm"/>
                    </div>
                    <div style={{display:'flex',gap:8,marginTop:16}}>
                      <button onClick={saveEdit} disabled={saving}
                        style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'9px 20px',
                          fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
                        {saving?'저장 중...':'저장'}
                      </button>
                      <button onClick={()=>{setEditId(null);setEditForm(null)}}
                        style={{background:'#191c2b',color:'#5e6585',border:'1px solid #272a3d',borderRadius:8,
                          padding:'9px 20px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
                        취소
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
