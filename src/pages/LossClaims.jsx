import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore'
import { PhotoPicker, Lightbox } from '../components/PhotoAttach'

const pad = n => String(n).padStart(2,'0')
const todayStr = () => { const n=new Date(); return `${n.getFullYear()}-${pad(n.getMonth()+1)}-${pad(n.getDate())}` }
const wonFmt = n => (n||0).toLocaleString('ko-KR')

const PLATFORMS = [
  { key:'baemin',   label:'배달의민족', color:'#2E7D45' },
  { key:'coupang',  label:'쿠팡이츠',   color:'#B42318' },
  { key:'yogiyo',   label:'요기요',     color:'#C3261C' },
  { key:'ddangyeo', label:'땡겨요',     color:'#2B5C9E' },
]
const TYPES  = ['오배송','메뉴누락','파손','기타']
const CAUSES = [
  { key:'store',    label:'매장',   color:'#B42318' },
  { key:'rider',    label:'라이더', color:'#C3261C' },
  { key:'customer', label:'고객',   color:'#2B5C9E' },
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
  open:     { label:'진행중',   color:'#C3261C' },
  paid:     { label:'보상완료', color:'#2E7D45' },
  rejected: { label:'거절',     color:'#B42318' },
  closed:   { label:'완료',        color:'#6E6A63' },
}

function emptyForm() {
  return { date: todayStr(), platform:'baemin', lossAmount:'', memo:'',
    orderNo:'', orderAmount:'', type:'', cause:'' }
}

const inputStyle = {
  background:'#F3F1EC',border:'1px solid #DCD7CE',borderRadius:4,color:'#1D1B18',
  padding:'8px 10px',fontSize:12,outline:'none',fontFamily:'inherit',width:'100%'
}
const labelStyle = { fontSize:10,color:'#6E6A63',fontWeight:600,display:'block',marginBottom:6 }
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
        const color = opt.color || '#C3261C'
        const selected = value === key
        return (
          <button key={key} type="button" onClick={()=>onChange(selected && allowEmpty ? '' : key)}
            style={{padding:'6px 12px',borderRadius:4,border:'none',fontSize:11,fontWeight:600,
              cursor:'pointer',fontFamily:'inherit',
              background:selected?`${color}22`:'#F3F1EC',
              color:selected?color:'#6E6A63',
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
        style={{alignSelf:'flex-start',background:'transparent',border:'none',color:'#6E6A63',
          fontSize:11,cursor:'pointer',fontFamily:'inherit',padding:0}}>
        {showDetail ? '▾ 상세 접기' : '▸ 상세 (주문번호·주문금액·유형·원인) — 선택'}
      </button>
      {showDetail && (
        <div style={{display:'flex',flexDirection:'column',gap:12,paddingLeft:10,borderLeft:'2px solid #DCD7CE'}}>
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

// 타임라인 기록 종류 — 플랫폼과 주고받은 과정을 날짜별로 남김
const EVENT_KINDS = [
  { key:'contact',  label:'연락·문의', color:'#2B5C9E' },
  { key:'approved', label:'승인',      color:'#2E7D45' },
  { key:'rejected', label:'반려',      color:'#B42318' },
  { key:'paid',     label:'입금확인',  color:'#2E7D45' },
  { key:'memo',     label:'메모',      color:'#6E6A63' },
]
const eventKindOf = k => EVENT_KINDS.find(e=>e.key===k) || EVENT_KINDS[4]
const receivedOf = r => (r.timeline||[]).filter(e=>e.kind==='paid').reduce((a,e)=>a+(e.amount||0),0)
const mdLabel = d => d ? `${+d.slice(5,7)}/${+d.slice(8,10)}` : ''

// 사진은 lossClaims/records(문서 하나에 모든 건)에 넣으면 1MB 한도를 금방 넘으므로
// 기록마다 lossClaimPhotos/{기록 id} 별도 문서에 저장하고, 기록에는 장수(photoCount)만 남김
function EventPhotos({ eventId, count }) {
  const [images, setImages] = useState(null)
  async function open() {
    try {
      const snap = await getDoc(doc(db,'lossClaimPhotos',eventId))
      setImages(snap.exists() ? (snap.data().images||[]) : [])
    } catch(e) { console.error(e); alert('사진을 불러오지 못했어요') }
  }
  return (
    <>
      <button onClick={open}
        style={{background:'#F3F1EC',border:'1px solid #DCD7CE',color:'#1D1B18',borderRadius:5,
          padding:'1px 7px',fontSize:10,cursor:'pointer',fontFamily:'inherit',marginLeft:6}}>
        {count}
      </button>
      {images && <Lightbox images={images} label="손실보상 첨부 사진" onClose={()=>setImages(null)}/>}
    </>
  )
}

function Timeline({ r, editable, saving, onAdd, onDelete, onNextCheck }) {
  const [ev, setEv] = useState({ date: todayStr(), kind:'contact', amount:'', note:'' })
  const [images, setImages] = useState([])
  const [showPhotos, setShowPhotos] = useState(false)
  const events = (r.timeline||[]).slice().sort((a,b)=>a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
  async function add() {
    if(!ev.note.trim() && !(+ev.amount) && images.length===0) return alert('내용이나 금액, 사진을 입력해주세요')
    const id = Date.now().toString()
    if(images.length) {
      try { await setDoc(doc(db,'lossClaimPhotos',id), { claimId: r.id, images }) }
      catch(e) { console.error(e); return alert('사진 저장에 실패했어요. 다시 시도해 주세요') }
    }
    const ok = await onAdd({ id, date: ev.date, kind: ev.kind, amount: +ev.amount||0, note: ev.note.trim(),
      ...(images.length ? { photoCount: images.length } : {}) })
    if(ok) { setEv(v=>({ ...v, amount:'', note:'' })); setImages([]); setShowPhotos(false) }
  }
  return (
    <div style={{marginTop:12,borderTop:'1px solid #DCD7CE',paddingTop:12}}>
      {events.length===0 && <div style={{fontSize:11,color:'#6E6A63',marginBottom:10}}>아직 기록이 없어요</div>}
      <div style={{display:'flex',flexDirection:'column',gap:0,marginBottom:editable?12:0}}>
        {events.map(e=>{
          const k = eventKindOf(e.kind)
          return (
            <div key={e.id} style={{display:'flex',gap:10,alignItems:'flex-start',padding:'6px 0',
              borderLeft:`2px solid ${k.color}55`,paddingLeft:10,marginLeft:4}}>
              <span style={{fontSize:11,color:'#6E6A63',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',minWidth:74}}>{e.date}</span>
              <span style={{fontSize:11,fontWeight:700,color:k.color,whiteSpace:'nowrap'}}>{k.label}</span>
              <span style={{flex:1,fontSize:12,color:'#1D1B18',lineHeight:1.5}}>
                {e.note}
                {e.amount>0 && <b style={{color:k.color,marginLeft:6,fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{wonFmt(e.amount)}원</b>}
                {e.photoCount>0 && <EventPhotos eventId={e.id} count={e.photoCount}/>}
              </span>
              {editable && (
                <button onClick={()=>onDelete(e.id)} disabled={saving}
                  style={{background:'transparent',border:'none',color:'#6E6A63',fontSize:11,cursor:'pointer',padding:0}}>✕</button>
              )}
            </div>
          )
        })}
      </div>
      {editable && (
        <>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:8}}>
            {EVENT_KINDS.map(k=>(
              <button key={k.key} type="button" onClick={()=>setEv(v=>({...v,kind:k.key}))}
                style={{padding:'4px 10px',borderRadius:6,border:'none',fontSize:11,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                  background:ev.kind===k.key?`${k.color}22`:'#F3F1EC',color:ev.kind===k.key?k.color:'#6E6A63',
                  outline:ev.kind===k.key?`1.5px solid ${k.color}55`:'1.5px solid transparent'}}>
                {k.label}
              </button>
            ))}
          </div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
            <input type="date" value={ev.date} onChange={e=>setEv(v=>({...v,date:e.target.value}))}
              style={{...inputStyle,width:140}}/>
            <input value={ev.note} onChange={e=>setEv(v=>({...v,note:e.target.value}))}
              onKeyDown={e=>e.key==='Enter' && add()}
              placeholder="예: 쿠팡 상담원 - 나머지 금액 자동정산 예정 문자 받음" style={{...inputStyle,flex:1,minWidth:200,width:'auto'}}/>
            <input type="number" value={ev.amount} onChange={e=>setEv(v=>({...v,amount:e.target.value}))}
              placeholder="금액(선택)" style={{...inputStyle,width:110}}/>
            <button type="button" onClick={()=>setShowPhotos(v=>!v)}
              style={smallBtn(showPhotos||images.length?'rgba(195,38,28,0.12)':'transparent','#C3261C','1px solid rgba(195,38,28,0.4)')}>
              사진{images.length?` ${images.length}`:''}
            </button>
            <button onClick={add} disabled={saving} style={smallBtn('#C3261C','#FFFFFF')}>+ 기록</button>
          </div>
          {showPhotos && (
            <div style={{marginTop:8}}>
              <PhotoPicker images={images} onChange={setImages} max={3}/>
            </div>
          )}
          <div style={{display:'flex',gap:8,alignItems:'center',marginTop:10,flexWrap:'wrap'}}>
            <span style={{fontSize:11,color:'#6E6A63'}}>다음 확인일</span>
            <input type="date" value={r.nextCheck||''} onChange={e=>onNextCheck(e.target.value)}
              style={{...inputStyle,width:140}}/>
            {r.nextCheck && (
              <button onClick={()=>onNextCheck('')} style={smallBtn('transparent','#6E6A63','1px solid #DCD7CE')}>지우기</button>
            )}
            <span style={{fontSize:10,color:'#6E6A63'}}>그날이 되면 카드가 빨갛게 표시되고 맨 위로 올라와요</span>
          </div>
        </>
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
  const [openTimeline, setOpenTimeline] = useState({}) // id → 타임라인 펼침 여부

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

  const addEvent = (id, ev) => update(list => list.map(r => r.id===id ? { ...r, timeline: [...(r.timeline||[]), ev] } : r))
  const deleteEvent = async (id, evId) => {
    if(!window.confirm('이 기록을 지울까요?')) return
    const ok = await update(list => list.map(r => r.id===id ? { ...r, timeline: (r.timeline||[]).filter(e=>e.id!==evId) } : r))
    if(ok) deletePhotos([evId])
  }
  // 첨부 사진 문서 삭제 (없는 문서를 지워도 문제없음)
  const deletePhotos = ids => Promise.all(ids.map(id => deleteDoc(doc(db,'lossClaimPhotos',id)).catch(e=>console.error(e))))
  const setNextCheck = (id, date) => patch(id, { nextCheck: date })

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
      const ok = await update(list => list.map(r => r.id===action.id ? { ...r,
        claimStatus:'approved', approvedDate: action.date,
        finalConfirmed:true, finalConfirmedDate: action.date, finalAmount: amount, status:'done', nextCheck:'',
        timeline: [...(r.timeline||[]), { id: Date.now().toString(), date: action.date, kind:'memo', amount, note:'보상완료 처리' }],
      } : r))
      if(ok) setAction(null)
    } else {
      const ok = await update(list => list.map(r => r.id===action.id ? { ...r,
        claimStatus:'rejected', rejectReason: action.reason||'', status:'done', nextCheck:'',
        timeline: [...(r.timeline||[]), { id: Date.now().toString(), date: todayStr(), kind:'rejected', amount:0, note:`거절로 종료${action.reason?` — ${action.reason}`:''}` }],
      } : r))
      if(ok) setAction(null)
    }
  }

  async function reopen(id) {
    if(!window.confirm('다시 진행중으로 되돌릴까요?')) return
    await update(list => list.map(r => r.id===id ? { ...r, claimStatus:'pending', finalConfirmed:false, status:'active',
      timeline: [...(r.timeline||[]), { id: Date.now().toString(), date: todayStr(), kind:'memo', amount:0, note:'다시 진행중으로 되돌림' }],
    } : r))
  }

  async function deleteRecord(id) {
    if(!window.confirm('이 기록을 삭제하시겠습니까?')) return
    const photoIds = (records.find(r=>r.id===id)?.timeline||[]).filter(e=>e.photoCount>0).map(e=>e.id)
    const ok = await update(list => list.filter(r => r.id!==id))
    if(ok) deletePhotos(photoIds)
  }

  const openList = records.filter(r => stageOf(r)==='open')
  const doneList = records.filter(r => stageOf(r)!=='open')
  const today = todayStr()
  const isDue = r => stageOf(r)==='open' && r.nextCheck && r.nextCheck <= today
  const dueCount = openList.filter(isDue).length
  // 확인할 날이 된 건이 맨 위, 나머지는 최신순
  const shown = (tab==='open' ? openList : doneList).slice()
    .sort((a,b)=> (isDue(b)-isDue(a)) || b.date.localeCompare(a.date))

  const openLoss  = openList.reduce((a,r)=>a+(r.lossAmount||0),0)
  const paidTotal = records.filter(r=>stageOf(r)==='paid').reduce((a,r)=>a+(r.finalAmount||0),0)

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:18,flexWrap:'wrap',gap:10}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>손실보상</div>
          <div style={{fontSize:12,color:'#6E6A63',marginTop:2}}>배달 사고 등록 → 보상 받으면 금액만 입력</div>
        </div>
        <button onClick={()=>{ setShowForm(v=>!v); setForm(emptyForm()) }}
          style={{background:'#C3261C',color:'#FFFFFF',border:'none',borderRadius:4,
            padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
          {showForm ? '닫기' : '+ 사고 등록'}
        </button>
      </div>

      {/* 요약 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:12,marginBottom:18}}>
        {[
          { label:'진행중', val:`${openList.length}건`, color:'#C3261C' },
          { label:'진행중 손실 금액', val:`${wonFmt(openLoss)}원`, color:'#B42318' },
          { label:'지금까지 받은 보상', val:`${wonFmt(paidTotal)}원`, color:'#2E7D45' },
          ...(dueCount>0 ? [{ label:'오늘 다시 확인할 건', val:`${dueCount}건`, color:'#B42318' }] : []),
        ].map(k=>(
          <div key={k.label} style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,padding:'14px 16px',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:k.color}}/>
            <div style={{fontSize:10,fontWeight:600,color:'#6E6A63',marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:16,fontWeight:700,color:k.color,fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{k.val}</div>
          </div>
        ))}
      </div>

      {/* 등록 폼 */}
      {showForm && (
        <div style={{background:'#FFFFFF',border:'1px solid #C3261C',borderRadius:6,marginBottom:18,padding:18}}>
          <ClaimForm value={form} onChange={setForm}/>
          <button onClick={addRecord} disabled={saving}
            style={{marginTop:16,background:'#C3261C',color:'#FFFFFF',border:'none',borderRadius:4,padding:'9px 22px',
              fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
            {saving?'등록 중...':'등록'}
          </button>
        </div>
      )}

      {/* 진행중 / 완료 */}
      <div style={{display:'flex',gap:8,marginBottom:14}}>
        {[['open',`진행중 (${openList.length})`],['done',`완료 (${doneList.length})`]].map(([key,label])=>(
          <button key={key} onClick={()=>setTab(key)}
            style={{padding:'7px 14px',borderRadius:4,border:'none',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
              background:tab===key?'#C3261C':'#F3F1EC',color:tab===key?'#FFFFFF':'#6E6A63'}}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{textAlign:'center',color:'#6E6A63',padding:60}}>로딩 중...</div>
      ) : shown.length === 0 ? (
        <div style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,padding:40,textAlign:'center',color:'#6E6A63'}}>
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
            const due = isDue(r)
            const received = receivedOf(r)
            const tlCount = (r.timeline||[]).length
            const tlOpen = !!openTimeline[r.id]

            if(editId === r.id) return (
              <div key={r.id} style={{background:'#FFFFFF',border:'1px solid #C3261C',borderRadius:6,padding:18}}>
                <ClaimForm value={editForm} onChange={setEditForm}/>
                <div style={{display:'flex',gap:8,marginTop:16}}>
                  <button onClick={saveEdit} disabled={saving} style={smallBtn('#C3261C','#FFFFFF')}>{saving?'저장 중...':'저장'}</button>
                  <button onClick={()=>{setEditId(null);setEditForm(null)}} style={smallBtn('#F3F1EC','#6E6A63','1px solid #DCD7CE')}>취소</button>
                </div>
              </div>
            )

            return (
              <div key={r.id} style={{background:'#FFFFFF',border:`1px solid ${due?'rgba(180,35,24,0.6)':'#DCD7CE'}`,borderRadius:6,padding:'14px 18px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:10,flexWrap:'wrap'}}>
                  <div style={{flex:1,minWidth:200}}>
                    <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',marginBottom:6}}>
                      <span style={{fontSize:13,fontWeight:700}}>{r.date}</span>
                      <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:4,
                        background:`${pf?.color}18`,color:pf?.color}}>{pf?.label}</span>
                      <span style={{fontSize:11,fontWeight:700,color:badge.color}}>{badge.label}</span>
                      {stage==='open' && r.nextCheck && (
                        <span style={{fontSize:11,fontWeight:700,padding:'2px 8px',borderRadius:4,
                          background:due?'rgba(180,35,24,0.15)':'#F3F1EC',color:due?'#B42318':'#6E6A63'}}>
                          {due ? '오늘 확인!' : `${mdLabel(r.nextCheck)} 재확인`}
                        </span>
                      )}
                    </div>
                    {r.memo && <div style={{fontSize:12,color:'#1D1B18',marginBottom:6}}>{r.memo}</div>}
                    <div style={{display:'flex',gap:12,flexWrap:'wrap',fontSize:11,color:'#6E6A63'}}>
                      <span>손실 <b style={{color:'#B42318'}}>{wonFmt(r.lossAmount)}원</b></span>
                      {stage==='open' && received>0 && <span>지금까지 입금 <b style={{color:'#2E7D45'}}>{wonFmt(received)}원</b></span>}
                      {stage==='paid' && <span>보상 <b style={{color:'#2E7D45'}}>{wonFmt(r.finalAmount)}원</b> ({r.finalConfirmedDate})</span>}
                      {fee!==null && <span>수수료 <b style={{color:'#B42318'}}>-{wonFmt(fee)}원</b></span>}
                      {stage==='rejected' && r.rejectReason && <span>사유 <b style={{color:'#B42318'}}>{r.rejectReason}</b></span>}
                      {r.orderNo && <span style={{fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>#{r.orderNo}</span>}
                      {r.type && <span>{r.type}</span>}
                      {cause && <span>원인: {cause.label}</span>}
                    </div>
                  </div>

                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    <button onClick={()=>setOpenTimeline(o=>({...o,[r.id]:!o[r.id]}))}
                      style={smallBtn(tlOpen?'rgba(43,92,158,0.15)':'transparent','#2B5C9E','1px solid rgba(43,92,158,0.3)')}>
                      타임라인{tlCount>0?` ${tlCount}`:''}
                    </button>
                    {stage==='open' && !act && (
                      <>
                        <button onClick={()=>setAction({ id:r.id, kind:'paid', date:todayStr(), amount: received ? String(received) : '' })}
                          style={smallBtn('#2E7D45','#FFFFFF')}>보상 받음</button>
                        <button onClick={()=>setAction({ id:r.id, kind:'rejected', reason:'' })}
                          style={smallBtn('transparent','#B42318','1px solid #E8C4BF')}>거절됨</button>
                      </>
                    )}
                    {stage!=='open' && (
                      <button onClick={()=>reopen(r.id)} style={smallBtn('transparent','#6E6A63','1px solid #DCD7CE')}>되돌리기</button>
                    )}
                    {stage==='open' && (
                      <button onClick={()=>{ setEditId(r.id); setEditForm({ ...emptyForm(), ...r }) }}
                        style={smallBtn('transparent','#1D1B18','1px solid #DCD7CE')}>수정</button>
                    )}
                    <button onClick={()=>deleteRecord(r.id)}
                      style={smallBtn('transparent','#B42318','1px solid #E8C4BF')}>삭제</button>
                  </div>
                </div>

                {act && (
                  <div style={{marginTop:12,background:'#F3F1EC',borderRadius:4,padding:12,
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
                    <button onClick={saveAction} disabled={saving} style={smallBtn('#C3261C','#FFFFFF')}>{saving?'저장 중...':'완료'}</button>
                    <button onClick={()=>setAction(null)} style={smallBtn('transparent','#6E6A63','1px solid #DCD7CE')}>취소</button>
                  </div>
                )}

                {tlOpen && (
                  <Timeline r={r} editable={stage==='open'} saving={saving}
                    onAdd={ev=>addEvent(r.id, ev)}
                    onDelete={evId=>deleteEvent(r.id, evId)}
                    onNextCheck={d=>setNextCheck(r.id, d)}/>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
