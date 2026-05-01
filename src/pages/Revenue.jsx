import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useAuth } from '../AuthContext'

const pad = n => String(n).padStart(2,'0')
const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const wonCell = n => (n != null && n !== 0) ? n.toLocaleString('ko-KR') : '—'
const DAYS = ['일','월','화','수','목','금','토']

// 2025-05 부터 오전/오후 분리
const SPLIT_FROM = '2025-05'

export default function Revenue() {
  const { isOwner } = useAuth()
  const [curMonth, setCurMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // 입력 상태
  const [inputType, setInputType] = useState('morning') // 'morning' | 'close'
  const [day, setDay] = useState('01')
  const [kiosk, setKiosk] = useState('')
  const [del, setDel] = useState('')
  const [pos, setPos] = useState('')
  const [editDay, setEditDay] = useState(null)
  const [editType, setEditType] = useState(null) // 'morning' | 'close'

  const isNewMonth = curMonth >= SPLIT_FROM
  const days = daysIn(curMonth)
  const monthOpts = []
  for(let y=2022;y<=2026;y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  const getDow = (ym, d) => {
    const [y,m] = ym.split('-').map(Number)
    return DAYS[new Date(y, m-1, +d).getDay()]
  }
  const getDowColor = (ym, d) => {
    const [y,m] = ym.split('-').map(Number)
    const dow = new Date(y, m-1, +d).getDay()
    return dow === 0 ? '#f87171' : dow === 6 ? '#93c5fd' : '#dde1f2'
  }

  async function load() {
    setLoading(true)
    try {
      const snap = await getDoc(doc(db,'revenue',curMonth))
      setData(snap.exists() ? snap.data() : {})
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [curMonth])

  // 입력 여부 확인
  const hasMorningData = (dd) => {
    const r = data[dd]; if(!r) return false
    return (r.morningKiosk||0)+(r.morningDel||0)+(r.morningPos||0) > 0
  }
  const hasTotalData = (dd) => {
    const r = data[dd]; if(!r) return false
    return (r.kiosk||0)+(r.del||0)+(r.pos||0) > 0
  }
  const isDuplicateNew = (dd, type) => type === 'morning' ? hasMorningData(dd) : hasTotalData(dd)
  const isDuplicateOld = (dd) => data[dd] && ((data[dd].kiosk||0)+(data[dd].del||0)+(data[dd].pos||0)) > 0

  // 오후 자동계산 (합계 - 오전)
  function getAfternoon(r) {
    const hasMorning = (r.morningKiosk||0)+(r.morningDel||0)+(r.morningPos||0) > 0
    const hasTotal   = (r.kiosk||0)+(r.del||0)+(r.pos||0) > 0
    if (!hasMorning || !hasTotal) return null
    return {
      kiosk: (r.kiosk||0) - (r.morningKiosk||0),
      del:   (r.del||0)   - (r.morningDel||0),
      pos:   (r.pos||0)   - (r.morningPos||0),
    }
  }

  async function save() {
    const targetDay  = editDay || day
    const targetType = editDay ? editType : (isNewMonth ? inputType : 'close')

    // 중복 체크
    if (!editDay) {
      const isDup = isNewMonth ? isDuplicateNew(targetDay, targetType) : isDuplicateOld(targetDay)
      if (isDup) {
        const label = isNewMonth
          ? `${+targetDay}일 ${targetType==='morning'?'오전':'마감'}`
          : `${+targetDay}일`
        alert(`${label}은 이미 입력된 내역이 있습니다.\n수정하려면 해당 행의 수정 버튼을 클릭하세요.`)
        return
      }
    }

    setSaving(true)
    try {
      const existing = data[targetDay] || {}
      let newRow
      if (isNewMonth) {
        if (targetType === 'morning') {
          newRow = { ...existing, morningKiosk:+kiosk||0, morningDel:+del||0, morningPos:+pos||0 }
        } else {
          newRow = { ...existing, kiosk:+kiosk||0, del:+del||0, pos:+pos||0 }
        }
      } else {
        newRow = { kiosk:+kiosk||0, del:+del||0, pos:+pos||0 }
      }

      const newData = { ...data, [targetDay]: newRow }
      await setDoc(doc(db,'revenue',curMonth), newData)
      setData(newData)
      setKiosk(''); setDel(''); setPos('')
      setEditDay(null); setEditType(null)

      // 다음 빈 날짜로 이동
      if (!editDay) {
        const nextDay = Array.from({length:days},(_,i)=>pad(i+1)).find(dd => {
          if (isNewMonth) return !isDuplicateNew(dd, inputType)
          return !isDuplicateOld(dd)
        })
        if (nextDay) setDay(nextDay)
      }
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  function startEdit(dd, type) {
    const r = data[dd]
    setEditDay(dd); setEditType(type); setDay(dd)
    if (type === 'morning') {
      setKiosk(r.morningKiosk || '')
      setDel(r.morningDel || '')
      setPos(r.morningPos || '')
    } else {
      setKiosk(r.kiosk || '')
      setDel(r.del || '')
      setPos(r.pos || '')
    }
    window.scrollTo({top:0, behavior:'smooth'})
  }

  function cancelEdit() {
    setEditDay(null); setEditType(null)
    setKiosk(''); setDel(''); setPos('')
  }

  async function delRow(dd, type) {
    const label = isNewMonth
      ? `${+dd}일 ${type==='morning'?'오전':'마감'} 매출`
      : `${+dd}일 매출`
    if (!window.confirm(`${label} 내역을 삭제하시겠습니까?`)) return
    const newData = { ...data }
    if (isNewMonth) {
      const existing = { ...newData[dd] }
      if (type === 'morning') {
        delete existing.morningKiosk; delete existing.morningDel; delete existing.morningPos
      } else {
        delete existing.kiosk; delete existing.del; delete existing.pos
      }
      const hasAny = Object.values(existing).some(v => v > 0)
      if (!hasAny) delete newData[dd]
      else newData[dd] = existing
    } else {
      delete newData[dd]
    }
    await setDoc(doc(db,'revenue',curMonth), newData)
    setData(newData)
  }

  // 월 합계 (마감 기준)
  const tot = Object.values(data).reduce((a,r)=>({
    kiosk: a.kiosk+(r.kiosk||0),
    del:   a.del  +(r.del  ||0),
    pos:   a.pos  +(r.pos  ||0),
  }), {kiosk:0,del:0,pos:0})
  const grand = tot.kiosk+tot.del+tot.pos

  // 유효 날짜 목록
  const activeDays = Object.keys(data).filter(dd => {
    const r = data[dd]
    return (r.kiosk||0)+(r.del||0)+(r.pos||0)+(r.morningKiosk||0)+(r.morningDel||0)+(r.morningPos||0) > 0
  }).sort()

  // 공통 스타일
  const cellBase  = {fontFamily:'DM Mono, monospace', textAlign:'right'}
  const borderFull = {borderBottom:'1px solid #272a3d'}
  const borderSub  = {borderBottom:'1px solid #1a1d2e'}

  const activeType = editDay ? editType : inputType
  const typeColor  = activeType === 'morning' ? '#f9b934' : '#93c5fd'
  const typeBorder = activeType === 'morning' ? 'rgba(249,185,52,0.35)' : 'rgba(147,197,253,0.35)'

  return (
    <div>
      {/* 헤더 */}
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>💰 매출관리</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>{mLabel(curMonth)}</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{fontSize:18,fontWeight:700,color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{grand.toLocaleString()}원</div>
          <select value={curMonth} onChange={e=>setCurMonth(e.target.value)}
            style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,color:'#dde1f2',
              padding:'8px 12px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
            {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
          </select>
        </div>
      </div>

      {/* ── 입력 폼 ── */}
      {isOwner && (
        <div style={{background:'#12141f',border:`1px solid ${editDay?'#f9b934':'#272a3d'}`,borderRadius:12,marginBottom:18}}>
          {/* 폼 헤더 */}
          <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,
            color:editDay?'#f9b934':'#dde1f2',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span>
              {editDay
                ? `✏️ ${+editDay}일 (${getDow(curMonth,editDay)}) ${editType==='morning'?'오전':'마감'} 수정 중`
                : '매출 입력'}
            </span>
            {editDay && (
              <button onClick={cancelEdit}
                style={{background:'transparent',border:'1px solid #272a3d',color:'#5e6585',
                  borderRadius:6,padding:'4px 10px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>
                취소
              </button>
            )}
          </div>

          {/* 신규 월: 오전 / 마감 탭 */}
          {isNewMonth && !editDay && (
            <div style={{padding:'12px 18px 0',display:'flex',gap:6,alignItems:'center'}}>
              {[['morning','🌅 오전 입력','#f9b934'],['close','🌙 마감 입력','#93c5fd']].map(([t,label,c])=>(
                <button key={t} onClick={()=>setInputType(t)}
                  style={{padding:'7px 16px',borderRadius:7,border:'none',fontSize:12,fontWeight:600,
                    cursor:'pointer',fontFamily:'inherit',transition:'.15s',
                    background: inputType===t ? `${c}22` : '#191c2b',
                    color: inputType===t ? c : '#5e6585',
                    outline: inputType===t ? `1.5px solid ${c}55` : '1.5px solid transparent'}}>
                  {label}
                </button>
              ))}
              {inputType==='close' && (
                <span style={{marginLeft:8,fontSize:10,color:'#5e6585'}}>오후는 자동 계산됩니다</span>
              )}
            </div>
          )}

          {/* 입력 필드 */}
          <div style={{padding:'14px 18px',display:'grid',gridTemplateColumns:'140px repeat(3,1fr)',gap:10}}>
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              <label style={{fontSize:10,color:'#5e6585',fontWeight:600}}>날짜</label>
              {editDay ? (
                <div style={{background:'#191c2b',border:'1px solid #f9b934',borderRadius:7,
                  color:'#f9b934',padding:'8px 10px',fontSize:13,fontWeight:700}}>
                  {+editDay}일 ({getDow(curMonth,editDay)})
                </div>
              ) : (
                <select value={day} onChange={e=>setDay(e.target.value)}
                  style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                    padding:'8px 10px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
                  {Array.from({length:days},(_,i)=>{
                    const dd = pad(i+1)
                    const dup = isNewMonth ? isDuplicateNew(dd, inputType) : isDuplicateOld(dd)
                    return (
                      <option key={i} value={dd} style={{color:dup?'#f87171':'inherit'}}>
                        {i+1}일 ({getDow(curMonth,dd)}){dup?' ⚠중복':''}
                      </option>
                    )
                  })}
                </select>
              )}
            </div>
            {[['🖥️ 키오스크',kiosk,setKiosk],['🛵 배달',del,setDel],['🧾 포스/현장',pos,setPos]].map(([label,val,set])=>(
              <div key={label} style={{display:'flex',flexDirection:'column',gap:4}}>
                <label style={{fontSize:10,fontWeight:600,color:isNewMonth?typeColor:'#5e6585'}}>{label} (원)</label>
                <input type="number" value={val} onChange={e=>set(e.target.value)}
                  placeholder="0" min="0"
                  style={{background:'#191c2b',
                    border:`1px solid ${isNewMonth?typeBorder:'#272a3d'}`,
                    borderRadius:7,color:'#dde1f2',padding:'8px 10px',fontSize:12,outline:'none',width:'100%'}}/>
              </div>
            ))}
          </div>
          <div style={{padding:'0 18px 18px'}}>
            <button onClick={save} disabled={saving}
              style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'9px 20px',
                fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              {saving ? '저장 중...' : editDay ? '수정 완료' : '저 장'}
            </button>
          </div>
        </div>
      )}

      {/* ── 내역 테이블 ── */}
      <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden'}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,
          display:'flex',justifyContent:'space-between'}}>
          <span>{mLabel(curMonth)} 매출 내역</span>
          <span style={{color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{grand.toLocaleString()}원</span>
        </div>

        {loading ? (
          <div style={{textAlign:'center',color:'#5e6585',padding:40}}>로딩 중...</div>
        ) : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead>
                <tr style={{background:'#191c2b'}}>
                  {[
                    '날짜','요일',
                    ...(isNewMonth ? ['구분'] : []),
                    '키오스크','배달','포스','합계',
                    ...(isOwner ? ['관리'] : [])
                  ].map(h=>(
                    <th key={h} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:'#5e6585',
                      textAlign:['날짜','요일','구분'].includes(h)?'left':'right',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {activeDays.length === 0 && (
                  <tr>
                    <td colSpan={isOwner?8:7}
                      style={{padding:28,textAlign:'center',color:'#5e6585'}}>
                      입력된 데이터가 없습니다
                    </td>
                  </tr>
                )}

                {activeDays.map(dd => {
                  const r = data[dd]
                  const hasMorning = hasMorningData(dd)
                  const hasTotal   = hasTotalData(dd)

                  // ── 구버전 月: 단순 1행 ──
                  if (!isNewMonth) {
                    const s = (r.kiosk||0)+(r.del||0)+(r.pos||0)
                    return (
                      <tr key={dd}>
                        <td style={{padding:'9px 14px',...borderFull,color:'#dde1f2',fontFamily:'DM Mono, monospace'}}>{+dd}일</td>
                        <td style={{padding:'9px 14px',...borderFull,color:getDowColor(curMonth,dd),fontWeight:600}}>{getDow(curMonth,dd)}</td>
                        <td style={{padding:'9px 14px',...borderFull,...cellBase}}>{wonCell(r.kiosk)}</td>
                        <td style={{padding:'9px 14px',...borderFull,...cellBase}}>{wonCell(r.del)}</td>
                        <td style={{padding:'9px 14px',...borderFull,...cellBase}}>{wonCell(r.pos)}</td>
                        <td style={{padding:'9px 14px',...borderFull,...cellBase,color:'#f9b934',fontWeight:700}}>{s.toLocaleString()}</td>
                        {isOwner && (
                          <td style={{padding:'9px 14px',...borderFull,textAlign:'right',whiteSpace:'nowrap'}}>
                            <button onClick={()=>startEdit(dd,'close')}
                              style={{background:'transparent',border:'1px solid #272a3d',color:'#dde1f2',padding:'3px 8px',fontSize:10,borderRadius:4,cursor:'pointer',fontFamily:'inherit',marginRight:4}}>수정</button>
                            <button onClick={()=>delRow(dd,'close')}
                              style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',padding:'3px 8px',fontSize:10,borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>삭제</button>
                          </td>
                        )}
                      </tr>
                    )
                  }

                  // ── 신규 月: 오전 / 오후 / 합계 멀티행 ──
                  const afternoon  = getAfternoon(r)
                  const morningSum = (r.morningKiosk||0)+(r.morningDel||0)+(r.morningPos||0)
                  const totalSum   = (r.kiosk||0)+(r.del||0)+(r.pos||0)
                  const aftSum     = afternoon ? afternoon.kiosk+afternoon.del+afternoon.pos : 0
                  const isNeg      = afternoon && (afternoon.kiosk<0||afternoon.del<0||afternoon.pos<0)

                  // 행 구성
                  // Case 1: 오전O + 마감O → 오전 / 오후(자동) / 합계
                  // Case 2: 오전O + 마감X → 오전 / ⚠마감미입력
                  // Case 3: 오전X + 마감O → 합계 1행 (구분='—')
                  const subRows = []
                  if (hasMorning && hasTotal) {
                    subRows.push({id:'morning',   label:'오전', color:'#f9b934',
                      k:r.morningKiosk||0, d:r.morningDel||0, p:r.morningPos||0, sum:morningSum,
                      canEdit:true, eType:'morning', isAuto:false})
                    subRows.push({id:'afternoon', label:'오후', color:isNeg?'#f87171':'#93c5fd',
                      k:afternoon.kiosk, d:afternoon.del, p:afternoon.pos, sum:aftSum,
                      canEdit:false, isAuto:true, isNeg})
                    subRows.push({id:'total',     label:'합계', color:'#34d399',
                      k:r.kiosk||0, d:r.del||0, p:r.pos||0, sum:totalSum,
                      canEdit:true, eType:'close', isAuto:false})
                  } else if (hasMorning) {
                    subRows.push({id:'morning',   label:'오전', color:'#f9b934',
                      k:r.morningKiosk||0, d:r.morningDel||0, p:r.morningPos||0, sum:morningSum,
                      canEdit:true, eType:'morning', isAuto:false})
                    subRows.push({id:'warn',      label:'⚠ 마감미입력', color:'#f87171',
                      k:null, d:null, p:null, sum:null, canEdit:false, isWarn:true})
                  } else {
                    // 오전 없고 마감만 → 합계 단순 1행
                    subRows.push({id:'total',     label:'—',   color:'#dde1f2',
                      k:r.kiosk||0, d:r.del||0, p:r.pos||0, sum:totalSum,
                      canEdit:true, eType:'close', isAuto:false})
                  }

                  const rowCount = subRows.length
                  return subRows.map((row, ri) => {
                    const isLast = ri === rowCount - 1
                    const bStyle = isLast ? borderFull : borderSub
                    const rowBg  =
                      row.id==='morning'   ? 'rgba(249,185,52,0.04)'  :
                      row.id==='afternoon' ? 'rgba(147,197,253,0.04)' :
                      row.id==='total'     ? 'rgba(52,211,153,0.04)'  :
                      row.isWarn           ? 'rgba(248,113,113,0.04)' : 'transparent'

                    return (
                      <tr key={`${dd}-${row.id}`} style={{background:rowBg}}>
                        {ri === 0 && (
                          <>
                            <td rowSpan={rowCount}
                              style={{padding:'9px 14px',...borderFull,color:'#dde1f2',
                                fontFamily:'DM Mono, monospace',verticalAlign:'middle'}}>
                              {+dd}일
                            </td>
                            <td rowSpan={rowCount}
                              style={{padding:'9px 14px',...borderFull,
                                color:getDowColor(curMonth,dd),fontWeight:600,verticalAlign:'middle'}}>
                              {getDow(curMonth,dd)}
                            </td>
                          </>
                        )}

                        {/* 구분 */}
                        <td style={{padding:'6px 14px',...bStyle,fontSize:11,fontWeight:700,
                          color:row.color,whiteSpace:'nowrap'}}>
                          {row.isNeg ? '⚠ 오후(오전>합계)' : row.label}
                          {row.isAuto && !row.isNeg
                            ? <span style={{fontSize:9,color:'#3d4060',marginLeft:4,fontWeight:400}}>자동</span>
                            : null}
                        </td>

                        {/* 키오스크 / 배달 / 포스 */}
                        {[row.k, row.d, row.p].map((v, ci) => (
                          <td key={ci} style={{padding:'6px 14px',...bStyle,...cellBase,
                            color: row.isNeg && row.id==='afternoon' ? '#f87171' : '#dde1f2'}}>
                            {v !== null ? wonCell(v) : '—'}
                          </td>
                        ))}

                        {/* 합계 */}
                        <td style={{padding:'6px 14px',...bStyle,...cellBase,
                          fontWeight: row.id==='total' ? 700 : 500,
                          color: row.id==='total'     ? '#34d399' :
                                 row.id==='morning'   ? '#f9b934' :
                                 row.id==='afternoon' ? (row.isNeg?'#f87171':'#93c5fd') : '#5e6585'}}>
                          {row.sum !== null ? row.sum.toLocaleString() : '—'}
                        </td>

                        {/* 관리 */}
                        {isOwner && (
                          <td style={{padding:'6px 14px',...bStyle,textAlign:'right',whiteSpace:'nowrap'}}>
                            {row.canEdit && (
                              <>
                                <button onClick={()=>startEdit(dd, row.eType)}
                                  style={{background:'transparent',border:'1px solid #272a3d',color:'#dde1f2',
                                    padding:'3px 8px',fontSize:10,borderRadius:4,cursor:'pointer',fontFamily:'inherit',marginRight:4}}>
                                  수정
                                </button>
                                <button onClick={()=>delRow(dd, row.eType)}
                                  style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',
                                    padding:'3px 8px',fontSize:10,borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>
                                  삭제
                                </button>
                              </>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })
                })}
              </tbody>

              <tfoot>
                <tr style={{background:'#1f2236'}}>
                  <td colSpan={isNewMonth?3:2}
                    style={{padding:'10px 14px',fontWeight:700,color:'#f9b934'}}>합 계</td>
                  <td style={{padding:'10px 14px',...cellBase,fontWeight:700,color:'#f9b934'}}>{wonCell(tot.kiosk)}</td>
                  <td style={{padding:'10px 14px',...cellBase,fontWeight:700,color:'#f9b934'}}>{wonCell(tot.del)}</td>
                  <td style={{padding:'10px 14px',...cellBase,fontWeight:700,color:'#f9b934'}}>{wonCell(tot.pos)}</td>
                  <td style={{padding:'10px 14px',...cellBase,fontWeight:700,color:'#f9b934'}}>{grand.toLocaleString()}</td>
                  {isOwner && <td></td>}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
