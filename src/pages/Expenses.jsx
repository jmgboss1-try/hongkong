import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')
const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const wonCell = n => (n&&n!==0) ? n.toLocaleString('ko-KR') : '—'

const FIELDS = [
  { id:'hq',    label:'본사발주',   sec:'재료비' },
  { id:'veg',   label:'야채',       sec:'재료비' },
  { id:'oil',   label:'기름',       sec:'재료비' },
  { id:'box',   label:'용기&기타',  sec:'재료비' },
  { id:'gas',   label:'가스비',     sec:'관리비' },
  { id:'elec',  label:'전기',       sec:'관리비' },
  { id:'omg',   label:'기타관리',   sec:'관리비' },
  { id:'rent',  label:'임대료',     sec:'관리비' },
  { id:'dfee',  label:'배달대행비', sec:'관리비' },
  { id:'meal',  label:'식대',       sec:'인건비' },
  { id:'sal',   label:'급여',       sec:'인건비' },
]

export default function Expenses() {
  const [curMonth, setCurMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [day, setDay] = useState('01')
  const [form, setForm] = useState({})

  const days = daysIn(curMonth)
  const monthOpts = []
  for(let y=2022;y<=2026;y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  async function load() {
    setLoading(true)
    try {
      const snap = await getDoc(doc(db,'expenses',curMonth))
      setData(snap.exists() ? snap.data() : {})
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [curMonth])

  async function save() {
    setSaving(true)
    try {
      const entry = {}
      FIELDS.forEach(f => { entry[f.id] = +form[f.id]||0 })
      const newData = { ...data, [day]: entry }
      await setDoc(doc(db,'expenses',curMonth), newData)
      setData(newData)
      setForm({})
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  async function del_row(dd) {
    const newData = { ...data }
    delete newData[dd]
    await setDoc(doc(db,'expenses',curMonth), newData)
    setData(newData)
  }

  // 합계 계산
  const tot = FIELDS.reduce((acc,f) => {
    acc[f.id] = Object.values(data).reduce((s,e)=>s+(e[f.id]||0),0)
    return acc
  }, {})
  const grand = Object.values(tot).reduce((a,b)=>a+b,0)

  const inp = (id) => (
    <input type="number" value={form[id]||''} onChange={e=>setForm(p=>({...p,[id]:e.target.value}))}
      placeholder="0" min="0"
      style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
        padding:'8px 10px',fontSize:12,outline:'none',width:'100%'}}/>
  )

  const secs = ['재료비','관리비','인건비']
  const secIcons = {'재료비':'📦','관리비':'🏢','인건비':'💼'}

  return (
    <div>
      <div style={{display:'flex',alignItems:'flex-end',justifyContent:'space-between',marginBottom:22}}>
        <div>
          <div style={{fontSize:20,fontWeight:700}}>📋 지출관리</div>
          <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>{mLabel(curMonth)}</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:12}}>
          <div style={{fontSize:18,fontWeight:700,color:'#f87171',fontFamily:'DM Mono, monospace'}}>{grand.toLocaleString()}원</div>
          <select value={curMonth} onChange={e=>setCurMonth(e.target.value)}
            style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:8,color:'#dde1f2',padding:'8px 12px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
            {monthOpts.map(m=><option key={m} value={m}>{mLabel(m)}</option>)}
          </select>
        </div>
      </div>

      {/* 입력 */}
      <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,marginBottom:18}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>지출 입력</div>
        <div style={{padding:18}}>
          <div style={{display:'flex',flexDirection:'column',gap:4,marginBottom:14,width:120}}>
            <label style={{fontSize:10,color:'#5e6585',fontWeight:600}}>날짜</label>
            <select value={day} onChange={e=>setDay(e.target.value)}
              style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',padding:'8px 10px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
              {Array.from({length:days},(_,i)=><option key={i} value={pad(i+1)}>{i+1}일</option>)}
            </select>
          </div>
          {secs.map(sec=>(
            <div key={sec}>
              <div style={{fontSize:10,fontWeight:600,color:'#5e6585',textTransform:'uppercase',letterSpacing:.8,
                margin:'14px 0 8px',paddingBottom:6,borderBottom:'1px solid #272a3d'}}>
                {secIcons[sec]} {sec}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:10}}>
                {FIELDS.filter(f=>f.sec===sec).map(f=>(
                  <div key={f.id} style={{display:'flex',flexDirection:'column',gap:4}}>
                    <label style={{fontSize:10,color:'#5e6585',fontWeight:600}}>{f.label}</label>
                    {inp(f.id)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{padding:'0 18px 18px'}}>
          <button onClick={save} disabled={saving}
            style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'9px 20px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
            {saving ? '저장 중...' : '저 장'}
          </button>
        </div>
      </div>

      {/* 내역 */}
      <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,overflow:'hidden'}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600,display:'flex',justifyContent:'space-between'}}>
          <span>{mLabel(curMonth)} 지출 내역</span>
          <span style={{color:'#f87171',fontFamily:'DM Mono, monospace'}}>{grand.toLocaleString()}원</span>
        </div>
        {loading ? <div style={{textAlign:'center',color:'#5e6585',padding:40}}>로딩 중...</div> : (
          <div style={{overflowX:'auto'}}>
            <table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}>
              <thead>
                <tr style={{background:'#191c2b'}}>
                  {['날짜',...FIELDS.map(f=>f.label),'합계',''].map(h=>(
                    <th key={h} style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#5e6585',
                      textAlign:h==='날짜'?'left':'right',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.keys(data).sort().map(dd=>{
                  const e=data[dd]
                  const s=FIELDS.reduce((a,f)=>a+(e[f.id]||0),0)
                  if(!s) return null
                  return(
                    <tr key={dd}>
                      <td style={{padding:'8px 10px',borderBottom:'1px solid #272a3d',color:'#dde1f2'}}>{+dd}일</td>
                      {FIELDS.map(f=>(
                        <td key={f.id} style={{padding:'8px 10px',borderBottom:'1px solid #272a3d',
                          textAlign:'right',fontFamily:'DM Mono, monospace',color:'#dde1f2'}}>
                          {wonCell(e[f.id])}
                        </td>
                      ))}
                      <td style={{padding:'8px 10px',borderBottom:'1px solid #272a3d',textAlign:'right',color:'#f87171',fontFamily:'DM Mono, monospace'}}>{s.toLocaleString()}</td>
                      <td style={{padding:'8px 10px',borderBottom:'1px solid #272a3d',textAlign:'right'}}>
                        <button onClick={()=>del_row(dd)}
                          style={{background:'transparent',border:'1px solid #3d1f1f',color:'#f87171',padding:'3px 8px',fontSize:10,borderRadius:4,cursor:'pointer',fontFamily:'inherit'}}>
                          삭제
                        </button>
                      </td>
                    </tr>
                  )
                })}
                {Object.keys(data).length===0&&(
                  <tr><td colSpan={FIELDS.length+3} style={{padding:28,textAlign:'center',color:'#5e6585'}}>입력된 데이터가 없습니다</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr style={{background:'#1f2236'}}>
                  <td style={{padding:'10px',fontWeight:700,color:'#f9b934'}}>합 계</td>
                  {FIELDS.map(f=>(
                    <td key={f.id} style={{padding:'10px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{wonCell(tot[f.id])}</td>
                  ))}
                  <td style={{padding:'10px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{grand.toLocaleString()}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}