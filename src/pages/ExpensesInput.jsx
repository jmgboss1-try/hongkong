import { useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'

const pad = n => String(n).padStart(2,'0')

const FIELDS = [
  { id:'hq',   label:'본사발주',   sec:'재료비' },
  { id:'veg',  label:'야채',       sec:'재료비' },
  { id:'oil',  label:'기름',       sec:'재료비' },
  { id:'box',  label:'용기&기타',  sec:'재료비' },
  { id:'gas',  label:'가스비',     sec:'관리비' },
  { id:'elec', label:'전기',       sec:'관리비' },
  { id:'omg',  label:'기타관리',   sec:'관리비' },
  { id:'rent', label:'임대료',     sec:'관리비' },
  { id:'dfee', label:'배달대행비', sec:'관리비' },
  { id:'meal', label:'식대',       sec:'인건비' },
]

export default function ExpensesInput() {
  const now = new Date()
  const today = `${now.getFullYear()}-${pad(now.getMonth()+1)}`
  const todayDD = pad(now.getDate())
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)

  const setF = (key,val) => setForm(f=>({...f,[key]:val}))

  async function save() {
    setSaving(true)
    try {
      const snap = await getDoc(doc(db,'expenses',today))
      const existing = snap.exists() ? snap.data() : {}
      const entry = {}
      FIELDS.forEach(f => { entry[f.id] = +form[f.id]||0 })
      const newData = { ...existing, [todayDD]: entry }
      await setDoc(doc(db,'expenses',today), newData)
      setDone(true)
      setForm({})
    } catch(e) { console.error(e) }
    setSaving(false)
  }

  const secs = ['재료비','관리비','인건비']
  const secIcons = {'재료비':'📦','관리비':'🏢','인건비':'💼'}

  if(done) return (
    <div style={{display:'flex',alignItems:'center',justifyContent:'center',minHeight:'60vh'}}>
      <div style={{textAlign:'center'}}>
        <div style={{fontSize:48,marginBottom:16}}>✅</div>
        <div style={{fontSize:16,fontWeight:700,color:'#34d399',marginBottom:8}}>오늘 지출 입력 완료!</div>
        <div style={{fontSize:12,color:'#5e6585',marginBottom:24}}>{now.getMonth()+1}월 {now.getDate()}일 지출이 저장됐어요.</div>
        <button onClick={()=>setDone(false)}
          style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'10px 24px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
          다시 입력
        </button>
      </div>
    </div>
  )

  return (
    <div>
      <div style={{marginBottom:22}}>
        <div style={{fontSize:20,fontWeight:700}}>📋 오늘 지출 입력</div>
        <div style={{fontSize:12,color:'#5e6585',marginTop:2}}>
          {now.getFullYear()}년 {now.getMonth()+1}월 {now.getDate()}일 — 당일만 입력 가능
        </div>
      </div>

      <div style={{background:'rgba(249,185,52,0.08)',border:'1px solid rgba(249,185,52,0.2)',borderRadius:10,padding:'12px 16px',marginBottom:20,fontSize:12,color:'#f9b934'}}>
        ⚠️ 당일 지출만 입력 가능합니다. 입력한 내역은 사장님만 조회할 수 있어요.
      </div>

      <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12}}>
        <div style={{padding:'14px 18px',borderBottom:'1px solid #272a3d',fontSize:13,fontWeight:600}}>지출 입력</div>
        <div style={{padding:18}}>
          {secs.map(sec=>(
            <div key={sec}>
              <div style={{fontSize:10,fontWeight:600,color:'#5e6585',textTransform:'uppercase',letterSpacing:.8,margin:'14px 0 8px',paddingBottom:6,borderBottom:'1px solid #272a3d'}}>
                {secIcons[sec]} {sec}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:10}}>
                {FIELDS.filter(f=>f.sec===sec).map(f=>(
                  <div key={f.id} style={{display:'flex',flexDirection:'column',gap:4}}>
                    <label style={{fontSize:10,color:'#5e6585',fontWeight:600}}>{f.label}</label>
                    <input type="number" value={form[f.id]||''} onChange={e=>setF(f.id,e.target.value)}
                      placeholder="0" min="0"
                      style={{background:'#191c2b',border:'1px solid #272a3d',borderRadius:7,color:'#dde1f2',padding:'8px 10px',fontSize:12,outline:'none',width:'100%'}}/>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div style={{padding:'0 18px 18px'}}>
          <button onClick={save} disabled={saving}
            style={{background:'#f9b934',color:'#000',border:'none',borderRadius:8,padding:'10px 24px',fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
            {saving?'저장 중...':'오늘 지출 저장'}
          </button>
        </div>
      </div>
    </div>
  )
}
