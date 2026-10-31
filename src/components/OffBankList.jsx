import { useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { parseTxKey, currentClass, classLabel } from '../lib/bankReclass'

const wonFmt = n => (n||0).toLocaleString('ko-KR')
const T = { ink:'#1D1B18', sub:'#6E6A63', faint:'#A8A39A', rule:'#DCD7CE', soft:'#ECE8E1', accent:'#C3261C', red:'#B42318', green:'#2E7D45', blue:'#2B5C9E', amber:'#B45309' }
const num = { fontVariantNumeric:'tabular-nums' }
const md = d => d && d.length >= 10 ? `${+d.slice(5,7)}/${+d.slice(8,10)}` : d
const dayDiff = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000)

// 통장 잔액 맞추기 → '통장 밖 지출'이 어느 날짜·어느 칸에서 생겼는지
//   칸마다: 적힌 금액 − 그 칸으로 들어간 통장 출금 = 통장으로 설명 안 되는 금액
//   근처(±3일) 같은 금액의 통장 출금이 다른 칸·영업 외로 이미 잡혀 있으면 '두 번 적힘' 의심으로 표시
export default function OffBankList({ ym, data, categories, detail, total, onChanged }) {
  const [busy, setBusy] = useState(null)
  const { rows, acks, unknown } = detail
  const outs = (data?.bankSeen||[]).map(parseTxKey).filter(t=>t.out)
  const ackKeys = new Set(acks.map(t=>t.key))
  // '이미 지출에 있음'으로 연결한 출금과 짝이 맞는 칸(같은 금액, 3일 안)은 정상 — 맨 아래로
  const paired = {}, usedAck = new Set()
  for (const r of rows) {
    if (r.amount <= 0) continue
    const t = acks.find(t => !usedAck.has(t.key) && t.amount === r.amount && Math.abs(dayDiff(t.date, r.date)) <= 3)
    if (t) { paired[r.day+r.cat] = t; usedAck.add(t.key) }
  }
  const suspects = r => r.amount > 0 && !paired[r.day+r.cat]
    ? outs.filter(t => t.out === r.amount && Math.abs(dayDiff(t.date, r.date)) <= 3 && !r.txs.some(x=>x.key===t.key) && !ackKeys.has(t.key))
    : []
  const sum = a => a.reduce((s,x)=>s+x.amount,0)
  const plus = rows.filter(r=>r.amount>0 && !paired[r.day+r.cat]), minus = rows.filter(r=>r.amount<0)
  const okRows = rows.filter(r=>paired[r.day+r.cat])
  const restAcks = acks.filter(t=>!usedAck.has(t.key))

  async function takeOut(r) {
    if (!confirm(`${md(r.date)} '${r.label}' 칸에서 ${wonFmt(r.amount)}원을 뺄까요?\n(통장 출금으로 들어온 ${wonFmt(r.bank)}원은 그대로 남아요)`)) return
    setBusy(r.day+r.cat)
    try {
      // 저장 직전 다시 읽기 (다른 화면에서 고쳤을 수 있음)
      const snap = await getDoc(doc(db,'expenses',ym))
      const d = snap.exists() ? snap.data() : {}
      const e = { ...(d[r.day]||{}) }
      const next = (e[r.cat]||0) - r.amount
      if (next < r.bank) throw new Error('그 사이 금액이 바뀌었어요. 화면을 새로 고친 뒤 다시 해 주세요.')
      e[r.cat] = next
      await setDoc(doc(db,'expenses',ym), { [r.day]: e }, { merge:true })
      await onChanged?.()
    } catch(err) { console.error(err); alert(err.message || '저장 중 오류가 발생했어요.') }
    setBusy(null)
  }

  const head = { fontSize:11, color:T.sub, fontWeight:600 }
  return (
    <div style={{marginTop:16, borderTop:`1px solid ${T.ink}`, paddingTop:8}}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', gap:8, flexWrap:'wrap'}}>
        <span style={{fontSize:14, fontWeight:800, color:T.ink}}>통장 밖 지출 찾기</span>
        <span style={{fontSize:14, fontWeight:700, ...num, color:T.accent}}>{wonFmt(total)}원</span>
      </div>
      <div style={{fontSize:12, color:T.sub, margin:'2px 0 8px', lineHeight:1.6}}>
        지출 칸에 적힌 금액 중 통장 출금으로 들어오지 않은 부분이에요. 현금으로 냈다면 맞는 것이고, 직원 지출입력·직접 입력으로 적었는데
        같은 돈이 통장 출금으로도 들어왔다면 <b style={{color:T.ink}}>두 번 적힌 것</b>이라 빼야 해요.
        <b style={{color:T.amber}}> 두 번 적힘 의심</b>은 3일 안에 같은 금액이 통장에서 나간 경우예요.
      </div>

      <div style={{display:'grid', gridTemplateColumns:'38px minmax(50px,1fr) 68px 68px 76px', gap:'0 5px', alignItems:'baseline',
        borderBottom:`1px solid ${T.rule}`, paddingBottom:4}}>
        <span style={head}>날짜</span><span style={head}>칸</span>
        <span style={{...head, textAlign:'right'}}>적힌 금액</span><span style={{...head, textAlign:'right'}}>통장 출금</span>
        <span style={{...head, textAlign:'right'}}>통장 밖</span>
      </div>
      {[...plus, ...minus].map(r => {
        const sus = suspects(r)
        return (
          <div key={r.day+r.cat} style={{borderBottom:`1px solid ${T.soft}`, padding:'6px 0', background: sus.length ? '#B453090D' : 'transparent'}}>
            <div style={{display:'grid', gridTemplateColumns:'38px minmax(50px,1fr) 68px 68px 76px', gap:'0 5px', alignItems:'baseline', fontSize:13}}>
              <span style={{...num, color:T.sub}}>{md(r.date)}</span>
              <span style={{color:T.ink}}>{r.label}</span>
              <span style={{...num, textAlign:'right'}}>{wonFmt(r.entered)}</span>
              <span style={{...num, textAlign:'right', color:T.sub}}>{r.bank ? wonFmt(r.bank) : '—'}</span>
              <b style={{...num, textAlign:'right', color: r.amount>0 ? T.accent : T.red}}>{r.amount>0 ? '+' : '−'}{wonFmt(Math.abs(r.amount))}</b>
            </div>
            {r.amount < 0 && (
              <div style={{fontSize:12, color:T.red, paddingLeft:43, marginTop:2}}>
                칸 금액이 통장 출금보다 적어요. 칸에서 금액을 손으로 줄였을 수 있어요.
              </div>
            )}
            {sus.map(t => (
              <div key={t.key} style={{fontSize:12, color:T.amber, paddingLeft:43, marginTop:2}}>
                두 번 적힘 의심: {md(t.date)} {t.time.slice(0,5)} 통장 출금 '{t.desc||'—'}' {wonFmt(t.out)}원 → 지금 '{classLabel(currentClass(data, t).value, categories)}'
              </div>
            ))}
            {r.amount > 0 && (
              <div style={{paddingLeft:43, marginTop:3}}>
                <button type="button" onClick={()=>takeOut(r)} disabled={busy===r.day+r.cat}
                  style={{background:'#F3F1EC', border:`1px solid ${T.rule}`, borderRadius:4, color:T.ink, padding:'3px 9px',
                    fontSize:12, cursor:'pointer', fontFamily:'inherit'}}>
                  {busy===r.day+r.cat ? '...' : `두 번 적힌 거면 이 칸에서 ${wonFmt(r.amount)}원 빼기`}
                </button>
              </div>
            )}
          </div>
        )
      })}
      {!plus.length && !minus.length && <div style={{fontSize:13, color:T.sub, padding:'8px 0'}}>통장 출금으로 설명 안 되는 칸이 없어요.</div>}

      {okRows.length > 0 && (
        <div style={{marginTop:12}}>
          <div style={{fontSize:13, fontWeight:700, color:T.ink}}>
            통장 출금과 짝이 맞는 칸 {okRows.length}건 <span style={{fontWeight:400, color:T.sub, fontSize:12}}>('이미 지출에 있음'으로 연결한 출금, 정상)</span>
          </div>
          {okRows.map(r=>{ const t = paired[r.day+r.cat]; return (
            <div key={r.day+r.cat} style={{display:'flex', gap:8, fontSize:12, padding:'4px 0', borderBottom:`1px solid ${T.soft}`, color:T.sub, flexWrap:'wrap'}}>
              <span style={{...num, minWidth:38}}>{md(r.date)}</span>
              <span style={{color:T.ink}}>{r.label} {wonFmt(r.amount)}</span>
              <span>= {md(t.date)} 통장 출금 '{t.desc||'—'}'</span>
            </div>
          )})}
        </div>
      )}

      {restAcks.length > 0 && (
        <div style={{marginTop:12}}>
          <div style={{fontSize:13, fontWeight:700, color:T.ink}}>
            '이미 지출에 있음'으로 연결했지만 짝을 못 찾은 통장 출금 {restAcks.length}건 <span style={{...num, color:T.green}}>− {wonFmt(sum(restAcks))}</span>
          </div>
          <div style={{fontSize:12, color:T.sub, margin:'2px 0 4px'}}>
            위 목록의 금액 중 이만큼은 이 출금들로 설명돼요(날짜나 금액이 조금 달라 짝을 못 맞춘 것). 연결한 지출이 실제로 적혀 있는지 확인해 보세요.
          </div>
          {restAcks.map(t=>(
            <div key={t.key} style={{display:'flex', gap:10, fontSize:13, padding:'4px 0', borderBottom:`1px solid ${T.soft}`}}>
              <span style={{...num, color:T.sub, minWidth:84}}>{md(t.date)} {t.time.slice(0,5)}</span>
              <span style={{flex:1}}>{t.desc||'—'}</span>
              <span style={{...num}}>{wonFmt(t.amount)}</span>
            </div>
          ))}
        </div>
      )}
      {unknown.length > 0 && (
        <div style={{marginTop:12}}>
          <div style={{fontSize:13, fontWeight:700, color:T.ink}}>
            어느 칸인지 기록이 없는 통장 출금 {unknown.length}건 <span style={{...num, color:T.green}}>− {wonFmt(sum(unknown))}</span>
          </div>
          <div style={{fontSize:12, color:T.sub, margin:'2px 0 4px'}}>아래 '통장 거래 분류 보기·바꾸기'에서 칸을 확인하면 위 목록이 정확해져요.</div>
          {unknown.map(t=>(
            <div key={t.key} style={{display:'flex', gap:10, fontSize:13, padding:'4px 0', borderBottom:`1px solid ${T.soft}`}}>
              <span style={{...num, color:T.sub, minWidth:84}}>{md(t.date)} {t.time.slice(0,5)}</span>
              <span style={{flex:1}}>{t.desc||'—'}</span>
              <span style={{...num}}>{wonFmt(t.amount)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
