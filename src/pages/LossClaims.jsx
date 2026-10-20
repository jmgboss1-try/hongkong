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
  { key:'store',    label:'매장',   color:'#f87171' },
  { key:'rider',    label:'라이더', color:'#f9b934' },
  { key:'customer', label:'고객',   color:'#93c5fd' },
]

// 기록 하나의 단계 — 예전 기록(승인/최종확인/처리완료 따로 관리)도 그대로 읽을 수 있게 변환
//   open: 진행중 / paid: 보상완료 / rejected: 거절 / closed: 금액 없이 완료 처리된 예전 기록
function stageOf(r) {
  if(r.claimStatus === 'rejected') return 'rejected'
  if(r.finalConfirmed) return 'paid'
  if(r.status === 'done') return 'closed'
  return 'open'
}
const STAGE_BADGE = {
  open:     { label:'⏳ 진행중',   color:'#f9b934' },
  paid:     { label:'🟢 보상완료', color:'#34d399' },
  rejected: { label:'🔴 거절',     color:'#f87171' },
  closed:   { label:'완료',        color:'#5e6585' },
}

function emptyForm() {
  return { date: todayStr(), platform:'baemin', lossAmount:'', memo:'',
    orderNo:'', orderAmount:'', type:'', cause:'' }
}

const inputStyle = {
  background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
  padding:'8px 10px',fontSize:12,outline:'none',fontFamily:'inherit',width:'100%'
}
const labelStyle = { fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:6 }
const smallBtn = (bg, color, border='none') => ({
  background:bg,color,border,padding:'6px 12px',fontSize:11,fontWeight:700,
  borderRadius:6,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'
})

function ToggleGroup({ options, value, onChange, allowEmpty }) {
  return (
    <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
      {options.map(opt=>{
        const key = opt.key ?? opt
        const label = opt.label ?? opt
        const color = opt.color || '#f9b934'
        const selected = value === key
        return (
          <button key={key} type="button" onClick={()=>onChange(selected && allowEmpty ? '' : key)}
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

// 등록/수정 공용 폼 — 기본 4칸 + 접을 수 있는 상세
function ClaimForm({ value, onChange }) {
  const [showDetail, setShowDetail] = useState(!!(value.orderNo || value.orderAmount || value.type || value.cause))
  const set = (k,v) => onChange({ ...value, [k]: v })
  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10}}>
        <div>
          <label style={labelStyle}>날짜</label>
          <input type="date" value={value.date} onChange={e=>set('date',e.target.value)} style={inputStyle}/>
        </div>
        <div>
          <label style={labelStyle}>손실 금액 (원)</label>
          <input type="number" value={value.lossAmount} onChange={e=>set('lossAmount',e.target.value)}
            placeholder="0" style={inputStyle}/>
        </div>
      </div>
      <div>
        <label style={labelStyle}>플랫폼</label>
        <ToggleGroup options={PLATFORMS} value={value.platform} onChange={v=>set('platform',v)}/>
      </div>
      <div>
        <label style={labelStyle}>내용</label>
        <input value={value.memo} onChange={e=>set('memo',e.target.value)}
          placeholder="예: 짬뽕 누락, 라이더 오배송" style={inputStyle}/>
      </div>

      <button type="button" onClick={()=>setShowDetail(v=>!v)}
        style={{alignSelf:'flex-start',background:'transparent',border:'none',color:'#5e6585',
          fontSize:11,cursor:'pointer',fontFamily:'inherit',padding:0}}>
        {showDetail ? '▾ 상세 접기' : '▸ 상세 (주문번호·주문금액·유형·원인) — 선택'}
      </button>
      {showDetail && (
        <div style={{display:'flex',flexDirection:'column',gap:12,paddingLeft:10,borderLeft:'2px solid #272a3d'}}>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(150px,1fr))',gap:10}}>
            <div>
              <label style={labelStyle}>주문번호</label>
              <input value={value.orderNo} onChange={e=>set('orderNo',e.target.value)} style={inputStyle}/>
            </div>
            <div>
              <label style={labelStyle}>주문 금액 (원)</label>
              <input type="number" value={value.orderAmount} onChange={e=>set('orderAmount',e.target.value)}
                placeholder="0" style={inputStyle}/>
            </div>
          </div>
          <div>
            <label style={labelStyle}>유형</label>
            <ToggleGroup options={TYPES} value={value.type} onChange={v=>set('type',v)} allowEmpty/>
          </div>
          <div>
            <label style={labelStyle}>원인</label>
            <ToggleGroup options={CAUSES} value={value.cause} onChange={v=>set('cause',v)} allowEmpty/>
          </div>
        </div>
      )}
    </div>
  )
}

export default function LossClaims() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [tab, setTab]         = useState('open') // 'open' | 'done'

  const [showForm, setShowForm] = useState(false)
  const [form, setForm]         = useState(emptyForm())
  const [editId, setEditId]     = useState(null)
  const [editForm, setEditForm] = useState(null)

  // 카드 안 인라인 입력: { id, kind:'paid'|'rejected', date, amount, reason }
  const [action, setAction] = useState(null)

  useEffect(()=>{
    getDoc(doc(db,'lossClaims','records'))
      .then(snap=>setRecords(snap.exists() ? (snap.data().list||[]) : []))
      .catch(e=>console.error(e))
      .finally(()=>setLoading(false))
  },[])

  // 저장 직전 최신 목록을 다시 읽어서 변경 적용 — 포스기와 사장님 폰에서 동시에 써도 서로 덮어쓰지 않도록
  async function update(fn) {
    setSaving(true)
    try {
      const snap = await getDoc(doc(db,'lossClaims','records'))
      const latest = snap.exists() ? (snap.data().list||[]) : []
      const next = fn(latest)
      await setDoc(doc(db,'lossClaims','records'), { list: next })
      setRecords(next)
      return true
    } catch(e) { console.error(e); alert('저장 중 오류가 발생했습니다.'); return false }
    finally { setSaving(false) }
  }
  const patch = (id, fields) => update(list => list.map(r => r.id===id ? { ...r, ...fields } : r))

  const toNumbers = f => ({ ...f, lossAmount:+f.lossAmount||0, orderAmount:+f.orderAmount||0 })

  async function addRecord() {
    if(!form.date) return alert('날짜를 입력해주세요')
    const ok = await update(list => [...list, {
      id: Date.now().toString(), ...toNumbers(form),
      claimStatus:'pending', status:'active', createdAt:new Date().toISOString(),
    }])
    if(ok) { setForm(emptyForm()); setShowForm(false); setTab('open') }
  }

  async function saveEdit() {
    const ok = await patch(editId, toNumbers(editForm))
    if(ok) { setEditId(null); setEditForm(null) }
  }

  async function saveAction() {
    if(action.kind === 'paid') {
      const amount = +action.amount || 0
      if(amount <= 0) return alert('받은 보상 금액을 입력해주세요')
      const ok = await patch(action.id, {
        claimStatus:'approved', approvedDate: action.date,
        finalConfirmed:true, finalConfirmedDate: action.date, finalAmount: amount, status:'done',
      })
      if(ok) setAction(null)
    } else {
      const ok = await patch(action.id, { claimStatus:'rejected', rejectReason: action.reason||'', status:'done' })
      if(ok) setAction(null)
    }
  }

  async function reopen(id) {
    if(!window.confirm('다시 진행중으로 되돌릴까요?')) return
    await patch(id, { claimStatus:'pending', finalConfirmed:false, status:'active' })
  }

  async function deleteRecord(id) {
    if(!window.confirm('이 기록을 삭제하시겠습니까?')) return
    await update(list => list.filter(r => r.id!==id))
  }

  const openList = records.filter(r => stageOf(r)==='open')
  const doneList = records.filter(r => stageOf(r)!=='open')
  const shown = (tab==='open' ? openList : doneList).slice().sort((a,b)=>b.date.localeCompare(a.date))

  const openLoss  = openList.reduce((a,r)=>a+(r.lossAmount||0),0)
  const paidTotal = records.filter(r=>stageOf(r)==='paid').reduce((a,r)=>a+(r.finalAmount||0),0)

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:18,flexWrap:'wrap',gap:10}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>📋 손실보상</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>배달 사고 등록 → 보상 받으면 금액만 입력</div>
        </div>
        <button onClick={()=>{ setShowForm(v=>!v); setForm(emptyForm()) }}
          style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,
            padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
          {showForm ? '닫기' : '+ 사고 등록'}
        </button>
      </div>

      {/* 요약 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,marginBottom:18}}>
        {[
          { label:'진행중', val:`${openList.length}건`, color:'#f9b934' },
          { label:'진행중 손실 금액', val:`${wonFmt(openLoss)}원`, color:'#f87171' },
          { label:'지금까지 받은 보상', val:`${wonFmt(paidTotal)}원`, color:'#34d399' },
        ].map(k=>(
          <div key={k.label} style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'14px 16px',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:k.color}}/>
            <div style={{fontSize:10,fontWeight:600,color:'#5e6585',marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:16,fontWeight:700,color:k.color,fontFamily:'DM Mono,monospace'}}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* 등록 폼 */}
      {showForm && (
        <div style={{background:'#12141f',border:'1px solid #f9b934',borderRadius:12,marginBottom:18,padding:18}}>
          <ClaimForm value={form} onChange={setForm}/>
          <button onClick={addRecord} disabled={saving}
            style={{marginTop:16,background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'9px 22px',
              fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
            {saving?'등록 중...':'등록'}
          </button>
        </div>
      )}

      {/* 진행중 / 완료 */}
      <div style={{display:'flex',gap:8,marginBottom:14}}>
        {[['open',`진행중 (${openList.length})`],['done',`완료 (${doneList.length})`]].map(([key,label])=>(
          <button key={key} onClick={()=>setTab(key)}
            style={{padding:'7px 14px',borderRadius:7,border:'none',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
              background:tab===key?'#f9b934':'#191c2b',color:tab===key?'#000':'#5e6585'}}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{textAlign:'center',color:'#5e6585',padding:60}}>로딩 중...</div>
      ) : shown.length === 0 ? (
        <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:40,textAlign:'center',color:'#5e6585'}}>
          {tab==='open' ? '진행중인 사고가 없습니다' : '완료된 사고가 없습니다'}
        </div>
      ) : (
        <div style={{display:'flex',flexDirection:'column',gap:10}}>
          {shown.map(r=>{
            const pf = PLATFORMS.find(p=>p.key===r.platform)
            const cause = CAUSES.find(c=>c.key===r.cause)
            const stage = stageOf(r)
            const badge = STAGE_BADGE[stage]
            const act = action?.id===r.id ? action : null
            const fee = stage==='paid' && r.orderAmount>0 ? r.orderAmount - (r.finalAmount||0) : null

            if(editId === r.id) return (
              <div key={r.id} style={{background:'#12141f',border:'1px solid #f9b934',borderRadius:12,padding:18}}>
                <ClaimForm value={editForm} onChange={setEditForm}/>
                <div style={{display:'flex',gap:8,marginTop:16}}>
                  <button onClick={saveEdit} disabled={saving} style={smallBtn('#f9b934','#000')}>{saving?'저장 중...':'저장'}</button>
                  <button onClick={()=>{setEditId(null);setEditForm(null)}} style={smallBtn('#191c2b','#5e6585','1px solid #272a3d')}>취소</button>
                </div>
              </div>
            )

            return (
              <div key={r.id} style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'14px 18px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10,flexWrap:'wrap'}}>
                  <div style={{flex:1,minWidth:200}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:6}}>
                      <span style={{fontSize:13,fontWeight:700}}>{r.date}</span>
                      <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:4,
                        background:`${pf?.color}18`,color:pf?.color}}>{pf?.label}</span>
                      <span style={{fontSize:11,fontWeight:700,color:badge.color}}>{badge.label}</span>
                    </div>
                    {r.memo && <div style={{fontSize:12,color:'#dde1f2',marginBottom:6}}>{r.memo}</div>}
                    <div style={{display:'flex',gap:12,flexWrap:'wrap',fontSize:11,color:'#5e6585'}}>
                      <span>손실 <b style={{color:'#f87171'}}>{wonFmt(r.lossAmount)}원</b></span>
                      {stage==='paid' && <span>보상 <b style={{color:'#34d399'}}>{wonFmt(r.finalAmount)}원</b> ({r.finalConfirmedDate})</span>}
                      {fee!==null && <span>수수료 <b style={{color:'#f87171'}}>-{wonFmt(fee)}원</b></span>}
                      {stage==='rejected' && r.rejectReason && <span>사유 <b style={{color:'#f87171'}}>{r.rejectReason}</b></span>}
                      {r.orderNo && <span style={{fontFamily:'DM Mono,monospace'}}>#{r.orderNo}</span>}
                      {r.type && <span>{r.type}</span>}
                      {cause && <span>원인: {cause.label}</span>}
                    </div>
                  </div>

                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    {stage==='open' && !act && (
                      <>
                        <button onClick={()=>setAction({ id:r.id, kind:'paid', date:todayStr(), amount:'' })}
                          style={smallBtn('#34d399','#000')}>💰 보상 받음</button>
                        <button onClick={()=>setAction({ id:r.id, kind:'rejected', reason:'' })}
                          style={smallBtn('transparent','#f87171','1px solid #3d1f1f')}>거절됨</button>
                      </>
                    )}
                    {stage!=='open' && (
                      <button onClick={()=>reopen(r.id)} style={smallBtn('transparent','#5e6585','1px solid #272a3d')}>되돌리기</button>
                    )}
                    <button onClick={()=>{ setEditId(r.id); setEditForm({ ...emptyForm(), ...r }) }}
                      style={smallBtn('transparent','#dde1f2','1px solid #272a3d')}>수정</button>
                    <button onClick={()=>deleteRecord(r.id)}
                      style={smallBtn('transparent','#f87171','1px solid #3d1f1f')}>삭제</button>
                  </div>
                </div>

                {act && (
                  <div style={{marginTop:12,background:'#191c2b',borderRadius:8,padding:12,
                    display:'flex',gap:8,alignItems:'flex-end',flexWrap:'wrap'}}>
                    {act.kind==='paid' ? (
                      <>
                        <div>
                          <label style={labelStyle}>받은 날짜</label>
                          <input type="date" value={act.date} onChange={e=>setAction({...act,date:e.target.value})} style={inputStyle}/>
                        </div>
                        <div>
                          <label style={labelStyle}>받은 보상 금액 (원)</label>
                          <input type="number" autoFocus value={act.amount} onChange={e=>setAction({...act,amount:e.target.value})}
                            onKeyDown={e=>e.key==='Enter' && saveAction()} placeholder="0" style={inputStyle}/>
                        </div>
                      </>
                    ) : (
                      <div style={{flex:1,minWidth:180}}>
                        <label style={labelStyle}>거절 사유 (선택)</label>
                        <input autoFocus value={act.reason} onChange={e=>setAction({...act,reason:e.target.value})}
                          onKeyDown={e=>e.key==='Enter' && saveAction()} style={inputStyle}/>
                      </div>
                    )}
                    <button onClick={saveAction} disabled={saving} style={smallBtn('#f9b934','#000')}>{saving?'저장 중...':'완료'}</button>
                    <button onClick={()=>setAction(null)} style={smallBtn('transparent','#5e6585','1px solid #272a3d')}>취소</button>
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
