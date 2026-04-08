import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { useAuth } from '../AuthContext'

const pad = n => String(n).padStart(2,'0')
const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const wonCell = n => (n&&n!==0) ? n.toLocaleString('ko-KR') : '—'
const DAYS = ['일','월','화','수','목','금','토']

export default function Revenue() {
  const { isOwner } = useAuth()
  const [curMonth, setCurMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [day, setDay] = useState('01')
  const [kiosk, setKiosk] = useState('')
  const [del, setDel] = useState('')
  const [pos, setPos] = useState('')
  const [editDay, setEditDay] = useState(null)

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

  const isDuplicate = (dd) => data[dd] && ((data[dd].kiosk||0)+(data[dd].del||0)+(data[dd].pos||0)) > 0

  async function save() {
    if (!editDay && isDuplicate(day)) {
      alert(`${+day}일은 이미 입력된 내역이 있습니다.\n수정하려면 해당 행의 수정 버튼을 클릭하세요.`)
      return
    }
    setSaving(true)
    try {
      const targetDay = editDay || day
      const newData = { ...data, [targetDay]: { kiosk:+kiosk||0, del:+del||0, pos:+pos||0 } }
      await setDoc(doc(db,'revenue',curMonth), newData)
      setData(newData)
      setKiosk(''); setDel(''); setPos('')
      setEditDay(null)
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  function startEdit(dd) {
    const r = data[dd]
    setEditDay(dd)
    setDay(dd)
    setKiosk(r.kiosk||'')
    setDel(r.del||'')
    setPos(r.pos||'')
    window.scrollTo({top:0, behavior:'smooth'})
  }

  async function delRow(dd) {
    if (!window.confirm(`${+dd}일 매출 내역을 삭제하시겠습니까?`)) return
    const newData = { ...data }
    delete newData[dd]
    await setDoc(doc(db,'revenue',curMonth), newData)
    setData(newData)
  }

  const tot = Object.values(data).reduce((a,r)=>({
    kiosk:a.kiosk+(r.kiosk||0), del:a.del+(r.del||0), pos:a.pos+(r.pos||0)
  }), {kiosk:0,del:0,pos:0})
  const grand = tot.kiosk+tot.del+tot.pos

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>💰 매출관리</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>{mLabel(curMonth)}</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{fontSize:18,fontWeight:700,color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{grand.toLocaleString()}원</div>
          <select value={curMonth} onChange={e=>setCurMonth(e.target.value)}
            style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,color:'#dde1f2',padding:'8px 12px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
            {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
          </select>
        </div>
      </div>

      {/* 입력 */}
      {isOwner && (
        <div style={{background:'#12141f',border:`1px solid ${editDay?'#f9b934':'#272a3d'}`,borderRadius:12,marginBottom:18}}>
          <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,color:editDay?'#f9b934':'#dde1f2',display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <span>{editDay ? `✏️ ${+editDay}일 (${getDow(curMonth,editDay)}) 수정 중` : '매출 입력'}</span>
            {editDay && <button onClick={()=>{setEditDay(null);setKiosk('');setDel('');setPos('')}}
              style={{background:'transparent',border:'1px solid #272a3d',color:'#5e6585',borderRadius:6,padding:'4px 10px',fontSize:11,cursor:'pointer',fontFamily:'inherit'}}>취소</button>}
          </div>
          <div style={{padding:18,display:'grid',gridTemplateColumns:'140px repeat(3,1fr)',gap:10}}>
            <div style={{display:'flex',flexDirection:'column',gap:4}}>
              <label style={{fontSize:10,color:'#5e6585',fontWeight:600}}>날짜</label>
              {editDay ? (
                <div style={{background:'#191c2b',border:'1px solid #f9b934',borderRadius:7,color:'#f9b934',padding:'8px 10px',fontSize:13,fontWeight:700}}>
                  {+editDay}일 ({getDow(curMonth,editDay)})
                </div>
              ) : (
                <select value={day} onChange={e=>setDay(e.target.value)}
                  style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',padding:'8px 10px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
                  {Array.from({length:days},(_,i)=>{
                    const dd=pad(i+1)
                    const dup=isDuplicate(dd)
                    return <option key={i} value={dd} style={{color:dup?'#f87171':'inherit'}}>
                      {i+1}일 ({getDow(curMonth,dd)}){dup?' ⚠중복':''}
                    </option>
                  })}
                </select>
              )}
            </div>
            {[['🖥️ 키오스크',kiosk,setKiosk],['🛵 배달',del,setDel],['🧾 포스/현장',pos,setPos]].map(([label,val,set])=>(
              <div key={label} style={{display:'flex',flexDirection:'column',gap:4}}>
                <label style={{fontSize:10,color:'#5e6585',fontWeight:600}}>{label} (원)</label>
                <input type="number" value={val} onChange={e=>set(e.target.value)} placeholder="0" min="0"
                  style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',padding:'8px 10px',fontSize:12,outline:'none',width:'100%'}}/>
              </div>
            ))}
          </div>
          <div style={{padding:'0 18px 18px'}}>
            <button onClick={save} disabled={saving}
              style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'9px 20px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              {saving ? '저장 중...' : editDay ? '수정 완료' : '저 장'}
            </button>
          </div>
        </div>
      )}

      {/* 내역 */}
      <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden'}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,display:'flex',justifyContent:'space-between'}}>
          <span>{mLabel(curMonth)} 매출 내역</span>
          <span style={{color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{grand.toLocaleString()}원</span>
        </div>
        {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:40}}>로딩 중...</div> : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead>
                <tr style={{background:'#191c2b'}}>
                  {['날짜','요일','키오스크','배달','포스','합계', isOwner?'관리':''].map(h=>(
                    <th key={h} style={{padding:'8px 14px',fontSize:10,fontWeight:600,color:'#5e6585',textAlign:['날짜','요일'].includes(h)?'left':'right',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.keys(data).filter(dd=>{
                  const r=data[dd]; return (r.kiosk||0)+(r.del||0)+(r.pos||0)>0
                }).sort().map(dd=>{
                  const r=data[dd]
                  const s=(r.kiosk||0)+(r.del||0)+(r.pos||0)
                  return(
                    <tr key={dd}>
                      <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',color:'#dde1f2',fontFamily:'DM Mono, monospace'}}>{+dd}일</td>
                      <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',color:getDowColor(curMonth,dd),fontWeight:600}}>{getDow(curMonth,dd)}</td>
                      <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace'}}>{wonCell(r.kiosk)}</td>
                      <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace'}}>{wonCell(r.del)}</td>
                      <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono, monospace'}}>{wonCell(r.pos)}</td>
                      <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{s.toLocaleString()}</td>
                      {isOwner && (
                        <td style={{padding:'9px 14px',borderBottom:'1px solid #272a3d',textAlign:'right',whiteSpace:'nowrap'}}>
                          <button onClick={()=>startEdit(dd)}
                            style={{background:'transparent',border:'1px solid #272a3d',color:'#dde1f2',padding:'3px 8px',fontSize:10,borderRadius:4,cursor:'pointer',fontFamily:'inherit',marginRight:4}}>
                            수정
                          </button>
                          <button onClick={()=>delRow(dd)}
                            style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',padding:'3px 8px',fontSize:10,borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>
                            삭제
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {Object.keys(data).length===0&&(
                  <tr><td colSpan={isOwner?7:6} style={{padding:28,textAlign:'center',color:'#5e6585'}}>입력된 데이터가 없습니다</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr style={{background:'#1f2236'}}>
                  <td style={{padding:'10px 14px',fontWeight:700,color:'#f9b934'}}>합 계</td>
                  <td></td>
                  <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{wonCell(tot.kiosk)}</td>
                  <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{wonCell(tot.del)}</td>
                  <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{wonCell(tot.pos)}</td>
                  <td style={{padding:'10px 14px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{grand.toLocaleString()}</td>
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
