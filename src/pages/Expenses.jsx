import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')
const daysIn = ym => { const[y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate() }
const mLabel = ym => { const[y,m]=ym.split('-'); return `${y}년 ${+m}월` }
const wonCell = n => (n&&n!==0) ? n.toLocaleString('ko-KR') : '—'
const DAYS_KR = ['일','월','화','수','목','금','토']

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

const getNowDD = () => {
  const now = new Date()
  return pad(now.getDate())
}

const getYestDD = () => {
  const now = new Date()
  now.setDate(now.getDate()-1)
  return pad(now.getDate())
}

export default function Expenses() {
  const [curMonth, setCurMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  })
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [day, setDay] = useState(getNowDD)
  const [form, setForm] = useState({})
  const [deposit, setDeposit] = useState('') // 실입금액
  const [carryover, setCarryover] = useState('') // 이월 잔액

  const days = daysIn(curMonth)
  const monthOpts = []
  for(let y=2022;y<=2026;y++){const sm=y===2022?10:1;for(let m=sm;m<=12;m++){monthOpts.push(`${y}-${pad(m)}`)}}

  const now = new Date()
  const curYM = `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  const isThisMonth = curMonth === curYM

  async function load() {
    setLoading(true)
    try {
      const snap = await getDoc(doc(db,'expenses',curMonth))
      if(snap.exists()) {
        const d = snap.data()
        setData(d)
        setCarryover(d.carryover||'')
      } else {
        setData({})
        setCarryover('')
      }
    } catch(e) { console.error(e) }
    setLoading(false)
  }

  useEffect(() => { load() }, [curMonth])

  // 날짜 바뀌면 기존 입력값 불러오기
  useEffect(() => {
    const existing = data[day]
    if(existing) {
      const newForm = {}
      FIELDS.forEach(f => { newForm[f.id] = existing[f.id] || '' })
      setForm(newForm)
      setDeposit(existing.deposit || '')
    } else {
      setForm({})
      setDeposit('')
    }
  }, [day, data])

  async function save() {
    setSaving(true)
    try {
      const entry = {}
      FIELDS.forEach(f => { entry[f.id] = +form[f.id]||0 })
      entry.deposit = +deposit||0
      const newData = { ...data, [day]: entry }
      await setDoc(doc(db,'expenses',curMonth), newData)
      setData(newData)
      setForm({})
      setDeposit('')
      alert('저장됐습니다!')
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  async function saveCarryover() {
    try {
      const newData = { ...data, carryover: +carryover||0 }
      await setDoc(doc(db,'expenses',curMonth), newData)
      setData(newData)
      alert('이월 잔액이 저장됐습니다!')
    } catch(e) { console.error(e) }
  }

  async function del_row(dd) {
    if(!window.confirm(`${+dd}일 지출 내역을 삭제하시겠습니까?`)) return
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
  const totalDeposit = Object.values(data).reduce((a,e)=>a+(e.deposit||0),0)
  const realProfit = totalDeposit - grand
  const carryoverAmt = data.carryover || 0
  const currentBalance = carryoverAmt + totalDeposit - grand

  const inp = (id) => (
    <input type="number" value={form[id]||''} onChange={e=>setForm(p=>({...p,[id]:e.target.value}))}
      placeholder="0" min="0"
      style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
        padding:'8px 10px',fontSize:12,outline:'none',width:'100%'}}/>
  )

  const secs = ['재료비','관리비','인건비']
  const secIcons = {'재료비':'📦','관리비':'🏢','인건비':'💼'}

  const getDow = (dd) => {
    const [y,m] = curMonth.split('-').map(Number)
    return DAYS_KR[new Date(y,m-1,+dd).getDay()]
  }
  const getDowColor = (dd) => {
    const [y,m] = curMonth.split('-').map(Number)
    const dow = new Date(y,m-1,+dd).getDay()
    return dow===0?'#f87171':dow===6?'#93c5fd':'#dde1f2'
  }

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

      {/* 월별 실수익 요약 */}
      <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:12,marginBottom:18}}>
        {[
          {label:'전월 이월 잔액', val:carryoverAmt, color:'#93c5fd'},
          {label:'총 실입금액',   val:totalDeposit,  color:'#34d399'},
          {label:'총 지출',       val:grand,          color:'#f87171'},
          {label:'현재 잔액',     val:currentBalance, color:currentBalance>=0?'#f9b934':'#f87171'},
        ].map(k=>(
          <div key={k.label} style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'14px 16px',position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',top:0,left:0,right:0,height:3,background:k.color}}></div>
            <div style={{fontSize:10,fontWeight:600,color:'#5e6585',marginBottom:6}}>{k.label}</div>
            <div style={{fontSize:18,fontWeight:700,color:k.color,fontFamily:'DM Mono,monospace'}}>
              {k.val.toLocaleString()}원
            </div>
          </div>
        ))}
      </div>

      {/* 입력 */}
      <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,marginBottom:18}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>지출 입력</div>
        <div style={{padding:18}}>

          {/* 이월 잔액 설정 */}
          <div style={{background:'rgba(147,197,253,0.08)',border:'1px solid rgba(147,197,253,0.2)',borderRadius:10,padding:'14px 16px',marginBottom:16}}>
            <label style={{fontSize:11,fontWeight:700,color:'#93c5fd',display:'block',marginBottom:8}}>
              💳 전월 이월 잔액
            </label>
            <div style={{display:'flex',gap:10,alignItems:'center'}}>
              <input type="number" value={carryover} onChange={e=>setCarryover(e.target.value)}
                placeholder="전달에서 이월된 계좌 잔액"
                style={{flex:1,background:'#191c2b',border:'1px solid rgba(147,197,253,0.3)',borderRadius:7,
                  color:'#93c5fd',padding:'10px 12px',fontSize:14,outline:'none',
                  fontFamily:'DM Mono,monospace',fontWeight:700}}/>
              <button onClick={saveCarryover}
                style={{background:'#93c5fd',color:'#000',border:'none',borderRadius:7,
                  padding:'10px 16px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',whiteSpace:'nowrap'}}>
                저장
              </button>
            </div>
            <div style={{fontSize:10,color:'#5e6585',marginTop:6}}>
              이월잔액 {carryoverAmt.toLocaleString()}원 + 실입금 {totalDeposit.toLocaleString()}원 - 지출 {grand.toLocaleString()}원 = 현재잔액 <span style={{color:currentBalance>=0?'#f9b934':'#f87171',fontWeight:700}}>{currentBalance.toLocaleString()}원</span>
            </div>
          </div>

          {/* 날짜 선택 */}
          <div style={{marginBottom:16}}>
            <label style={{fontSize:10,color:'#5e6585',fontWeight:600,display:'block',marginBottom:8}}>날짜</label>
            <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
              {isThisMonth && (
                <>
                  <button onClick={()=>setDay(getNowDD())}
                    style={{padding:'7px 14px',borderRadius:7,border:'none',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                      background:day===getNowDD()?'#f9b934':'#191c2b',
                      color:day===getNowDD()?'#000':'#5e6585'}}>
                    오늘 ({+getNowDD()}일)
                  </button>
                  <button onClick={()=>setDay(getYestDD())}
                    style={{padding:'7px 14px',borderRadius:7,border:'none',fontSize:12,fontWeight:600,cursor:'pointer',fontFamily:'inherit',
                      background:day===getYestDD()?'#f9b934':'#191c2b',
                      color:day===getYestDD()?'#000':'#5e6585'}}>
                    어제 ({+getYestDD()}일)
                  </button>
                </>
              )}
              <select value={day} onChange={e=>setDay(e.target.value)}
                style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',
                  padding:'7px 10px',fontSize:12,fontFamily:'inherit',outline:'none'}}>
                {Array.from({length:days},(_,i)=><option key={i} value={pad(i+1)}>{i+1}일 ({getDow(pad(i+1))})</option>)}
              </select>
            </div>
          </div>

          {/* 실입금액 */}
          <div style={{background:'rgba(52,211,153,0.08)',border:'1px solid rgba(52,211,153,0.2)',borderRadius:10,padding:'14px 16px',marginBottom:16}}>
            <label style={{fontSize:11,fontWeight:700,color:'#34d399',display:'block',marginBottom:8}}>
              💳 실입금액 (계좌 실제 입금액)
            </label>
            <input type="number" value={deposit} onChange={e=>setDeposit(e.target.value)}
              placeholder="수수료 제외 실제 입금된 금액"
              style={{background:'#191c2b',border:'1px solid rgba(52,211,153,0.3)',borderRadius:7,color:'#34d399',
                padding:'10px 12px',fontSize:14,outline:'none',width:'100%',fontFamily:'DM Mono,monospace',fontWeight:700}}/>
            <div style={{fontSize:10,color:'#5e6585',marginTop:6}}>배달 플랫폼 정산금, 카드 정산금 등 수수료 제외 실입금</div>
          </div>

          {/* 지출 항목 */}
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

          {/* 당일 소계 */}
          {(+deposit>0 || FIELDS.some(f=>+form[f.id]>0)) && (
            <div style={{marginTop:16,background:'#191c2b',borderRadius:10,padding:'12px 14px',display:'flex',flexDirection:'column',gap:6}}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}>
                <span style={{color:'#5e6585'}}>당일 지출 합계</span>
                <span style={{color:'#f87171',fontFamily:'DM Mono,monospace',fontWeight:700}}>
                  -{FIELDS.reduce((a,f)=>a+(+form[f.id]||0),0).toLocaleString()}원
                </span>
              </div>
              {+deposit>0 && (
                <div style={{display:'flex',justifyContent:'space-between',fontSize:12}}>
                  <span style={{color:'#5e6585'}}>당일 실입금</span>
                  <span style={{color:'#34d399',fontFamily:'DM Mono,monospace',fontWeight:700}}>
                    +{(+deposit).toLocaleString()}원
                  </span>
                </div>
              )}
              {+deposit>0 && (
                <div style={{borderTop:'1px solid #272a3d',paddingTop:6,display:'flex',justifyContent:'space-between',fontSize:13}}>
                  <span style={{fontWeight:700}}>당일 실수익</span>
                  <span style={{
                    color:(+deposit-FIELDS.reduce((a,f)=>a+(+form[f.id]||0),0))>=0?'#f9b934':'#f87171',
                    fontFamily:'DM Mono,monospace',fontWeight:700,fontSize:15
                  }}>
                    {(+deposit-FIELDS.reduce((a,f)=>a+(+form[f.id]||0),0)).toLocaleString()}원
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
        <div style={{padding:'0 18px 18px'}}>
          <button onClick={save} disabled={saving}
            style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'9px 20px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
            {saving ? '저장 중...' : '저 장'}
          </button>
        </div>
      </div>

      {/* 내역 테이블 */}
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
                  {['날짜','실입금','지출합계','실수익',...FIELDS.map(f=>f.label),''].map(h=>(
                    <th key={h} style={{padding:'8px 10px',fontSize:10,fontWeight:600,color:'#5e6585',
                      textAlign:h==='날짜'?'left':'right',whiteSpace:'nowrap'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.keys(data).sort().map(dd=>{
                  const e = data[dd]
                  const expSum = FIELDS.reduce((a,f)=>a+(e[f.id]||0),0)
                  const dep = e.deposit||0
                  const profit = dep - expSum
                  if(!expSum && !dep) return null
                  return(
                    <tr key={dd}>
                      <td style={{padding:'8px 10px',borderBottom:'1px solid #272a3d',color:getDowColor(dd),fontWeight:600}}>
                        {+dd}일 ({getDow(dd)})
                      </td>
                      <td style={{padding:'8px 10px',borderBottom:'1px solid #272a3d',textAlign:'right',
                        color:'#34d399',fontFamily:'DM Mono,monospace',fontWeight:700}}>
                        {dep>0?dep.toLocaleString():'—'}
                      </td>
                      <td style={{padding:'8px 10px',borderBottom:'1px solid #272a3d',textAlign:'right',
                        color:'#f87171',fontFamily:'DM Mono,monospace',fontWeight:700}}>
                        {expSum>0?expSum.toLocaleString():'—'}
                      </td>
                      <td style={{padding:'8px 10px',borderBottom:'1px solid #272a3d',textAlign:'right',
                        color:profit>=0?'#f9b934':'#f87171',fontFamily:'DM Mono,monospace',fontWeight:700}}>
                        {dep>0?profit.toLocaleString():'—'}
                      </td>
                      {FIELDS.map(f=>(
                        <td key={f.id} style={{padding:'8px 10px',borderBottom:'1px solid #272a3d',
                          textAlign:'right',fontFamily:'DM Mono, monospace',color:'#dde1f2'}}>
                          {wonCell(e[f.id])}
                        </td>
                      ))}
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
                  <tr><td colSpan={FIELDS.length+5} style={{padding:28,textAlign:'center',color:'#5e6585'}}>입력된 데이터가 없습니다</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr style={{background:'#1f2236'}}>
                  <td style={{padding:'10px',fontWeight:700,color:'#f9b934'}}>합 계</td>
                  <td style={{padding:'10px',textAlign:'right',fontWeight:700,color:'#34d399',fontFamily:'DM Mono,monospace'}}>{totalDeposit.toLocaleString()}</td>
                  <td style={{padding:'10px',textAlign:'right',fontWeight:700,color:'#f87171',fontFamily:'DM Mono,monospace'}}>{grand.toLocaleString()}</td>
                  <td style={{padding:'10px',textAlign:'right',fontWeight:700,color:realProfit>=0?'#f9b934':'#f87171',fontFamily:'DM Mono,monospace'}}>{realProfit.toLocaleString()}</td>
                  {FIELDS.map(f=>(
                    <td key={f.id} style={{padding:'10px',textAlign:'right',fontWeight:700,color:'#f9b934',fontFamily:'DM Mono, monospace'}}>{wonCell(tot[f.id])}</td>
                  ))}
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
