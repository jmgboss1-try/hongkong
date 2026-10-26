import { useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { bankSummary, NONOP_LABELS, INVEST_OPTIONS, investOption, appendInvestmentRecords } from '../lib/bankRecon'
import BankTxList from './BankTxList'

const wonFmt = n => (n||0).toLocaleString('ko-KR')
const sign = n => n > 0 ? `+${wonFmt(n)}` : n < 0 ? `−${wonFmt(-n)}` : '0'
const md = d => d ? `${+d.slice(5,7)}/${+d.slice(8,10)}` : ''

// 영업 외 종류 → 연결되는 대여금 장부 (BankImport와 같음)
const LEDGER_OF = { loan:'hyung' }

// 통장 거래 키 '날짜|시간|출금|입금|잔액|내용|순번'
const parseKey = k => { const [date, time, out, inn, , desc] = String(k).split('|'); return { key:k, date, time, out:+out||0, in:+inn||0, desc } }

// 지출관리: 영업 잔액(이월+실입금−지출)과 실제 통장 잔액의 차이를 영업 외 거래로 설명
//  + 아직 정리 안 된 출금을 여기서 바로 분류 (PDF를 다시 올리지 않아도 됨)
export default function BankReconCard({ ym, data, categories, onChanged }) {
  const [showList, setShowList] = useState(false)
  const [picks, setPicks] = useState({})   // key → 카테고리 id | 'nonop:<kind>' | 'ack'
  const [saving, setSaving] = useState(false)
  const s = bankSummary(data, categories)
  const b = s.bank
  const nonOp = (data?.nonOp || []).slice().sort((a,b)=>a.date.localeCompare(b.date))

  const line = (label, val, opts={}) => (
    <div style={{display:'flex',justifyContent:'space-between',gap:10,padding:'4px 0',fontSize:12,
      borderTop: opts.total ? '1px solid #DCD7CE' : 'none', marginTop: opts.total ? 4 : 0, paddingTop: opts.total ? 8 : 4}}>
      <span style={{color: opts.total ? '#1D1B18' : '#6E6A63', fontWeight: opts.total ? 700 : 400, paddingLeft: opts.sub ? 14 : 0}}>{label}</span>
      <span style={{fontFamily:'inherit',fontVariantNumeric:'tabular-nums', fontWeight: opts.total ? 700 : 400, color: opts.color || (opts.total ? '#1D1B18' : '#6E6A63')}}>{val}</span>
    </div>
  )
  const kinds = Object.entries(s.byKind)

  // 아직 정리 안 된 출금: 통장에는 있는데 지출(importedKeys)에도 영업 외(nonOp)에도 없는 것
  const handled = new Set([...(data?.importedKeys||[]), ...(data?.nonOp||[]).map(x=>x.key)])
  const unhandled = (data?.bankSeen||[]).map(parseKey).filter(t=>t.out && !handled.has(t.key))
    .sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time))
  const secs = ['재료비','관리비','인건비']

  async function savePicks() {
    const chosen = unhandled.filter(t=>picks[t.key])
    if (!chosen.length) return alert('분류할 출금을 골라주세요')
    setSaving(true)
    try {
      // 저장 직전 최신 데이터 다시 읽기
      const snap = await getDoc(doc(db,'expenses',ym))
      const d = snap.exists() ? snap.data() : {}
      const keys = [...(d.importedKeys||[])], keySet = new Set(keys)
      const bankCls = { ...(d.bankCls||{}) }
      const nonOp = [...(d.nonOp||[])], nonOpKeys = new Set(nonOp.map(x=>x.key))
      const loans = {}, invs = []
      for (const t of chosen) {
        if (keySet.has(t.key) || nonOpKeys.has(t.key)) continue
        const v = picks[t.key]
        const inv = investOption(v)
        if (inv) {
          nonOp.push({ key:t.key, date:t.date, dir:'out', amount:t.out, kind:'invest', desc:t.desc, investor:inv.investor, category:inv.category })
          nonOpKeys.add(t.key)
          invs.push({ key:t.key, date:t.date, amount:t.out, desc:t.desc, investor:inv.investor, category:inv.category })
        } else if (v.startsWith('nonop:')) {
          const kind = v.slice(6)
          nonOp.push({ key:t.key, date:t.date, dir:'out', amount:t.out, kind, desc:t.desc })
          nonOpKeys.add(t.key)
          if (LEDGER_OF[kind]) (loans[LEDGER_OF[kind]] ||= []).push(t)
        } else {
          // 'ack' = 이미 다른 곳(직접 입력·고정지출 납부 등)에서 지출로 적은 출금 → 금액은 더하지 않고 연결만
          if (v !== 'ack') {
            const dd = t.date.slice(8,10)
            const entry = { ...(d[dd]||{}) }
            categories.forEach(c=>{ if(entry[c.id]===undefined) entry[c.id]=0 })
            entry[v] = (entry[v]||0) + t.out
            d[dd] = entry
          }
          keys.push(t.key); keySet.add(t.key); bankCls[t.key] = v
        }
      }
      d.importedKeys = keys
      d.bankCls = bankCls
      if (nonOp.length) d.nonOp = nonOp
      await setDoc(doc(db,'expenses',ym), d)
      // 대여금 장부(형·상암점)에도 기록 — 같은 은행 거래는 한 번만
      let n = Date.now()
      for (const [id, list] of Object.entries(loans)) {
        const ls = await getDoc(doc(db,'loans',id))
        const cur = ls.exists() ? (ls.data().list||[]) : []
        const have = new Set(cur.map(x=>x.bankKey).filter(Boolean))
        for (const t of list) if (!have.has(t.key))
          cur.push({ id:String(n++), date:t.date, type:'lent', amount:t.out, memo:`계좌내역 자동 기록 (${t.desc})`, bankKey:t.key })
        cur.sort((a,b)=>a.date.localeCompare(b.date))
        await setDoc(doc(db,'loans',id), { list: cur })
      }
      await appendInvestmentRecords(invs)
      setPicks({})
      onChanged?.()
    } catch(e) { console.error(e); alert('저장 중 오류가 발생했어요. 다시 시도해 주세요.') }
    setSaving(false)
  }

  return (
    <div style={{background:'#FFFFFF',border:'1px solid #DCD7CE',borderRadius:6,padding:'16px 18px',marginBottom:18}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8,marginBottom:10}}>
        <span style={{fontSize:13,fontWeight:600}}>통장 잔액 맞추기</span>
        {b && b.diff !== null && (
          <span style={{fontSize:12,fontWeight:700,color: b.diff===0 ? '#2E7D45' : '#C3261C'}}>
            {b.diff===0 ? '통장과 일치해요' : `통장과 ${wonFmt(Math.abs(b.diff))}원 차이`}
          </span>
        )}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:18}}>
        <div>
          {line('전월 이월', wonFmt(s.carryover))}
          {line('+ 실입금', wonFmt(s.deposit))}
          {line('− 지출', wonFmt(s.expense))}
          {line('= 영업 잔액', `${wonFmt(s.operating)}원`, { total:true, color: s.operating>=0 ? '#C3261C' : '#B42318' })}
          {line('+ 영업 외 입금', wonFmt(s.nonOpIn))}
          {kinds.filter(([,v])=>v.in).map(([k,v])=>line(NONOP_LABELS[k]||k, wonFmt(v.in), { sub:true }))}
          {line('− 영업 외 출금', wonFmt(s.nonOpOut))}
          {kinds.filter(([,v])=>v.out).map(([k,v])=>line(NONOP_LABELS[k]||k, wonFmt(v.out), { sub:true }))}
          {line('= 계산상 통장 잔액', `${wonFmt(s.expected)}원`, { total:true })}
          {b && b.closing !== null && line(`실제 통장 잔액 (${md(b.to)} 기준)`, `${wonFmt(b.closing)}원`, { total:true, color:'#2B5C9E' })}
        </div>

        <div style={{fontSize:11,color:'#6E6A63',lineHeight:1.7}}>
          {!b ? (
            <>
              위 <b style={{color:'#1D1B18'}}>계좌내역 엑셀</b> 탭에서 이 달 통장 거래내역(PDF·엑셀)을 올리면
              실제 통장 잔액과 비교해 드려요.<br/>
              영업 잔액은 장사 성적(실입금 − 지출)이고, 통장 잔액에는 형 대여금·투자금 같은 영업 외 거래도 들어 있어서 둘은 다를 수 있어요.
            </>
          ) : b.closing === null ? (
            <>이 은행 파일에는 잔액 칸이 없어서 실제 통장 잔액을 계산할 수 없어요. 잔액이 있는 PDF로 올려주세요.</>
          ) : b.diff === 0 ? (
            <>
              <div style={{color:'#2E7D45',fontWeight:600,marginBottom:4}}>장부가 통장과 정확히 맞아요.</div>
              {md(b.from)}~{md(b.to)} 통장 거래 {b.count}건 기준이에요.
            </>
          ) : (
            <>
              <div style={{color:'#1D1B18',fontWeight:600,marginBottom:6}}>차이가 나는 이유 ({md(b.from)}~{md(b.to)} 통장 거래 {b.count}건 기준)</div>
              {[
                [b.reasons.carryover, `통장 시작 잔액은 ${wonFmt(b.opening)}원인데 전월 이월은 ${wonFmt(s.carryover)}원이에요. 전월 이월을 ${wonFmt(b.opening)}원으로 고치면 맞아요.`],
                [b.reasons.unhandledIn, '아직 정리 안 된 입금이 있어요. 계좌내역 탭에서 다시 올려 실입금으로 맞추거나 영업 외 입금으로 기록하세요.'],
                [b.reasons.unhandledOut, '아직 정리 안 된 출금이 있어요. 아래 \'아직 정리 안 된 출금\' 목록에서 바로 골라주세요.'],
                [b.reasons.offBank, '통장이 아닌 곳에서 낸 지출이에요(현금·직접 입력·고정지출 납부 등). 이 중 통장에서 나간 건은 바로 위 \'정리 안 된 출금\'과 서로 상쇄돼요.'],
              ].filter(([v])=>v).map(([v,text],i)=>(
                <div key={i} style={{display:'flex',gap:8,marginBottom:6}}>
                  <b style={{fontFamily:'inherit',fontVariantNumeric:'tabular-nums',color: v>0 ? '#C3261C' : '#B42318',minWidth:96,textAlign:'right'}}>{sign(v)}</b>
                  <span>{text}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {b && unhandled.length > 0 && (
        <div style={{marginTop:14,background:'rgba(195,38,28,0.05)',border:'1px solid rgba(195,38,28,0.25)',borderRadius:6,padding:12}}>
          <div style={{fontSize:12,fontWeight:600,color:'#C3261C',marginBottom:4}}>
            아직 정리 안 된 출금 {unhandled.length}건 · {wonFmt(unhandled.reduce((a,t)=>a+t.out,0))}원
          </div>
          <div style={{fontSize:10,color:'#6E6A63',marginBottom:10,lineHeight:1.6}}>
            여기서 바로 골라서 저장하면 돼요(PDF를 다시 올리지 않아도 돼요).
            임대료처럼 이미 고정지출·직접 입력으로 적어둔 지출이면 <b>'이미 지출에 있음'</b>을 고르세요 — 금액은 더하지 않고 연결만 해요.
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {unhandled.map(t=>(
              <div key={t.key} style={{display:'flex',alignItems:'center',gap:10,background:'#F3F1EC',borderRadius:4,padding:'7px 12px',flexWrap:'wrap'}}>
                <span style={{fontSize:11,color:'#6E6A63',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',minWidth:80}}>{t.date.slice(5)} {t.time.slice(0,5)}</span>
                <span style={{flex:1,fontSize:12,color:'#1D1B18',minWidth:120}}>{t.desc || '—'}</span>
                <span style={{fontSize:13,fontWeight:700,color:'#B42318',fontFamily:'inherit',fontVariantNumeric:'tabular-nums'}}>{wonFmt(t.out)}원</span>
                <select value={picks[t.key]||''} onChange={e=>setPicks(p=>({ ...p, [t.key]: e.target.value }))}
                  style={{background:'#FFFFFF',border:`1px solid ${picks[t.key]?'#DCD7CE':'#B42318'}`,borderRadius:6,color:'#1D1B18',
                    padding:'5px 8px',fontSize:11,outline:'none',fontFamily:'inherit',minWidth:130}}>
                  <option value="">— 골라주세요 —</option>
                  {secs.map(sec=>(
                    <optgroup key={sec} label={sec}>
                      {categories.filter(c=>c.sec===sec).map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                    </optgroup>
                  ))}
                  <optgroup label="영업 외 (지출 아님)">
                    {Object.entries(NONOP_LABELS).map(([k,l])=><option key={k} value={`nonop:${k}`}>{l}</option>)}
                  </optgroup>
                  <optgroup label="투자관리 회수로 기록 (영업 외)">
                    {INVEST_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
                  </optgroup>
                  <option value="ack">이미 지출에 있음 (금액 안 더함)</option>
                </select>
              </div>
            ))}
          </div>
          <button onClick={savePicks} disabled={saving || !Object.values(picks).some(Boolean)}
            style={{marginTop:10,background:'#C3261C',color:'#FFFFFF',border:'none',borderRadius:4,padding:'8px 18px',
              fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit',opacity:Object.values(picks).some(Boolean)?1:0.5}}>
            {saving ? '저장 중...' : `고른 ${Object.values(picks).filter(Boolean).length}건 저장`}
          </button>
        </div>
      )}

      <BankTxList ym={ym} data={data} categories={categories} onChanged={onChanged}/>

      {nonOp.length > 0 && (
        <div style={{marginTop:10}}>
          <button type="button" onClick={()=>setShowList(v=>!v)}
            style={{background:'transparent',border:'none',color:'#2B5C9E',fontSize:11,cursor:'pointer',fontFamily:'inherit',padding:0}}>
            {showList ? '▾ 영업 외 거래 접기' : `▸ 영업 외 거래 ${nonOp.length}건 보기`} <span style={{color:'#6E6A63'}}>(투자·정산은 투자관리 탭에 옮겨 적을 때 참고하세요)</span>
          </button>
          {showList && (
            <div style={{display:'flex',flexDirection:'column',gap:4,marginTop:8}}>
              {nonOp.map(x=>(
                <div key={x.key} style={{display:'flex',gap:10,fontSize:11,background:'#F3F1EC',borderRadius:6,padding:'6px 10px',flexWrap:'wrap'}}>
                  <span style={{color:'#6E6A63',fontFamily:'inherit',fontVariantNumeric:'tabular-nums',minWidth:44}}>{md(x.date)}</span>
                  <span style={{minWidth:96}}>{NONOP_LABELS[x.kind==='loan_sangam'?'loan':x.kind]||x.kind}</span>
                  <span style={{flex:1,color:'#1D1B18'}}>{x.desc}</span>
                  <span style={{fontFamily:'inherit',fontVariantNumeric:'tabular-nums',color: x.dir==='in' ? '#2E7D45' : '#B42318'}}>{x.dir==='in'?'+':'−'}{wonFmt(x.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
