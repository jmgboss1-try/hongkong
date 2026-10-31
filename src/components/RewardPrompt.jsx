import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { prevYmOf, monthNum, loadEligible, rewardResults, addRewardBonuses } from '../lib/rewards'
import RewardGame from './RewardGame'

const T = { ink:'#1D1B18', sub:'#6E6A63', rule:'#DCD7CE', soft:'#ECE8E1', accent:'#C3261C', red:'#B42318', green:'#2E7D45', blue:'#2B5C9E', amber:'#B45309' }
const won = n => (n||0).toLocaleString('ko-KR')

function Btn({ children, onClick, kind = 'plain', disabled }) {
  const solid = kind==='primary' || kind==='ok'
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      style={{fontFamily:'inherit', cursor:'pointer', borderRadius:4, whiteSpace:'nowrap', fontSize:13, padding:'6px 12px',
        fontWeight: solid ? 700 : 500, background: kind==='primary' ? T.accent : kind==='ok' ? T.green : '#FFFFFF',
        color: solid ? '#FFFFFF' : T.ink, border: solid ? 'none' : `1px solid ${T.rule}`, opacity: disabled ? 0.6 : 1}}>
      {children}
    </button>
  )
}

// 사장님: 지난달 개근 포상을 할지 묻고(직원이 각자 룰렛 / 지금 사다리 / 안 함), 진행 상황과 상여 넣기
// 대시보드와 근무관리 맨 위에 같은 카드로 나옴. 할 일이 없으면(개근 없음, 끝났고 다 지급) 아무것도 안 보임
export default function RewardPrompt() {
  const ym = prevYmOf()
  const m = monthNum(ym)
  const [rw, setRw] = useState(undefined)   // rewards/{ym} (undefined = 불러오는 중, null = 아직 안 정함)
  const [eligible, setEligible] = useState([])
  const [prizeText, setPrizeText] = useState('3만원, 2만원, 1만원, 꽝')
  const [ladder, setLadder] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let off = false
    ;(async () => {
      try {
        const s = await getDoc(doc(db,'rewards',ym))
        const r = s.exists() ? s.data() : null
        const el = r?.eligible || await loadEligible(ym)
        if (!off) { setRw(r); setEligible(el) }
      } catch(e) { console.error(e); if (!off) setRw(null) }
    })()
    return () => { off = true }
  }, [ym, reload])

  const prizes = prizeText.split(/[,\n]/).map(s=>s.trim()).filter(Boolean)
  async function decide(status) {
    if (status === 'open' && !prizes.length) return alert('룰렛에 들어갈 상품을 적어 주세요')
    setBusy(true)
    try {
      await setDoc(doc(db,'rewards',ym), { status, eligible, ...(status==='open' ? { game:'roulette', prizes, openedAt:new Date().toISOString() } : { decidedAt:new Date().toISOString() }) }, { merge:true })
      setReload(k=>k+1)
    } catch(e) { console.error(e); alert('저장하지 못했어요.') }
    setBusy(false)
  }
  async function payAll(rows) {
    if (!window.confirm(`${rows.map(r=>`${r.name} ${won(r.amount)}원`).join(', ')}을 ${m}월 급여 상여에 넣을까요?`)) return
    setBusy(true)
    try { await addRewardBonuses(ym, rows, rw?.game==='ladder' ? '사다리' : '룰렛'); setReload(k=>k+1) }
    catch(e) { console.error(e); alert('저장하지 못했어요.') }
    setBusy(false)
  }
  async function close() {
    await setDoc(doc(db,'rewards',ym), { status:'done' }, { merge:true }); setReload(k=>k+1)
  }

  if (rw === undefined) return null
  if (!eligible.length) return null
  const results = rewardResults(rw)
  const unpaid = results.filter(r => r.amount > 0 && !r.paid)
  if (rw?.status === 'skip') return null
  if (rw && rw.status !== 'open' && !unpaid.length) return null // 끝났고 다 지급함

  const box = { borderLeft:`4px solid ${T.accent}`, background:'#C3261C0D', borderRadius:'0 4px 4px 0', padding:'12px 14px', marginBottom:20 }
  return (
    <section style={box}>
      {!rw ? (
        <>
          <div style={{fontSize:15, fontWeight:800}}>{m}월 개근 {eligible.length}명 · 포상 게임을 할까요?</div>
          <div style={{fontSize:13, color:T.sub, margin:'2px 0 8px'}}>{eligible.map(e=>e.name).join(', ')}</div>
          <div style={{fontSize:12, color:T.sub, marginBottom:4}}>룰렛 상품 (쉼표로 나눠 적기, 같은 걸 여러 번 적으면 잘 나와요)</div>
          <input value={prizeText} onChange={e=>setPrizeText(e.target.value)} aria-label="상품"
            style={{width:'100%', boxSizing:'border-box', background:'#FFFFFF', border:'1px solid #CBC5BA', borderRadius:4, padding:'7px 10px', fontSize:14, fontFamily:'inherit', marginBottom:8}}/>
          <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
            <Btn kind="primary" onClick={()=>decide('open')} disabled={busy}>직원이 각자 룰렛 돌리기</Btn>
            <Btn onClick={()=>setLadder(true)} disabled={busy}>지금 여기서 사다리로</Btn>
            <Btn onClick={()=>decide('skip')} disabled={busy}>이번 달은 안 함</Btn>
          </div>
          <div style={{fontSize:12, color:T.sub, marginTop:6}}>"각자 룰렛"을 고르면 개근한 직원의 내 기록에 룰렛이 떠서 한 번씩 돌릴 수 있어요. 결과는 여기와 매장 화면에 보여요.</div>
        </>
      ) : (
        <>
          <div style={{fontSize:15, fontWeight:800}}>{m}월 개근 포상 {rw.status==='open' ? '· 직원 룰렛 진행 중' : ''}</div>
          <div style={{margin:'6px 0'}}>
            {eligible.map(e => {
              const r = results.find(x => x.uid === e.uid)
              return (
                <div key={e.uid} style={{display:'flex', gap:10, alignItems:'baseline', fontSize:14, padding:'4px 0', borderBottom:`1px solid ${T.soft}`}}>
                  <b style={{minWidth:64}}>{e.name}</b>
                  <span style={{flex:1, color: r ? T.ink : T.sub}}>{r ? r.prize : '아직 안 돌림'}</span>
                  {r && <span style={{fontVariantNumeric:'tabular-nums'}}>{won(r.amount)}원</span>}
                  {r?.paid && <span style={{fontSize:12, color:T.green, fontWeight:700}}>상여 지급</span>}
                </div>
              )
            })}
          </div>
          <div style={{display:'flex', gap:8, flexWrap:'wrap'}}>
            {unpaid.length > 0 && <Btn kind="ok" onClick={()=>payAll(unpaid)} disabled={busy}>{unpaid.length}명 {m}월 급여 상여에 넣기</Btn>}
            {rw.status === 'open' && <Btn onClick={close} disabled={busy}>룰렛 마감</Btn>}
          </div>
        </>
      )}
      {ladder && <RewardGame ym={ym} people={eligible} onClose={()=>{ setLadder(false); setReload(k=>k+1) }} onSaved={()=>setReload(k=>k+1)}/>}
    </section>
  )
}
