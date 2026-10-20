import { useState } from 'react'
import { bankSummary, NONOP_LABELS } from '../lib/bankRecon'

const wonFmt = n => (n||0).toLocaleString('ko-KR')
const sign = n => n > 0 ? `+${wonFmt(n)}` : n < 0 ? `−${wonFmt(-n)}` : '0'
const md = d => d ? `${+d.slice(5,7)}/${+d.slice(8,10)}` : ''

// 지출관리: 영업 잔액(이월+실입금−지출)과 실제 통장 잔액의 차이를 영업 외 거래로 설명
export default function BankReconCard({ data, categories }) {
  const [showList, setShowList] = useState(false)
  const s = bankSummary(data, categories)
  const b = s.bank
  const nonOp = (data?.nonOp || []).slice().sort((a,b)=>a.date.localeCompare(b.date))

  const line = (label, val, opts={}) => (
    <div style={{display:'flex',justifyContent:'space-between',gap:10,padding:'4px 0',fontSize:12,
      borderTop: opts.total ? '1px solid #272a3d' : 'none', marginTop: opts.total ? 4 : 0, paddingTop: opts.total ? 8 : 4}}>
      <span style={{color: opts.total ? '#dde1f2' : '#5e6585', fontWeight: opts.total ? 700 : 400, paddingLeft: opts.sub ? 14 : 0}}>{label}</span>
      <span style={{fontFamily:'DM Mono,monospace', fontWeight: opts.total ? 700 : 400, color: opts.color || (opts.total ? '#dde1f2' : '#5e6585')}}>{val}</span>
    </div>
  )
  const kinds = Object.entries(s.byKind)

  return (
    <div style={{background:'#12141f',border:'1px solid #272a3d',borderRadius:12,padding:'16px 18px',marginBottom:18}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:8,marginBottom:10}}>
        <span style={{fontSize:13,fontWeight:600}}>🏦 통장 잔액 맞추기</span>
        {b && b.diff !== null && (
          <span style={{fontSize:12,fontWeight:700,color: b.diff===0 ? '#34d399' : '#f9b934'}}>
            {b.diff===0 ? '✅ 통장과 일치해요' : `⚠️ 통장과 ${wonFmt(Math.abs(b.diff))}원 차이`}
          </span>
        )}
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:18}}>
        <div>
          {line('전월 이월', wonFmt(s.carryover))}
          {line('+ 실입금', wonFmt(s.deposit))}
          {line('− 지출', wonFmt(s.expense))}
          {line('= 영업 잔액', `${wonFmt(s.operating)}원`, { total:true, color: s.operating>=0 ? '#f9b934' : '#f87171' })}
          {line('+ 영업 외 입금', wonFmt(s.nonOpIn))}
          {kinds.filter(([,v])=>v.in).map(([k,v])=>line(NONOP_LABELS[k]||k, wonFmt(v.in), { sub:true }))}
          {line('− 영업 외 출금', wonFmt(s.nonOpOut))}
          {kinds.filter(([,v])=>v.out).map(([k,v])=>line(NONOP_LABELS[k]||k, wonFmt(v.out), { sub:true }))}
          {line('= 계산상 통장 잔액', `${wonFmt(s.expected)}원`, { total:true })}
          {b && b.closing !== null && line(`실제 통장 잔액 (${md(b.to)} 기준)`, `${wonFmt(b.closing)}원`, { total:true, color:'#93c5fd' })}
        </div>

        <div style={{fontSize:11,color:'#5e6585',lineHeight:1.7}}>
          {!b ? (
            <>
              위 <b style={{color:'#dde1f2'}}>📑 계좌내역 엑셀</b> 탭에서 이 달 통장 거래내역(PDF·엑셀)을 올리면
              실제 통장 잔액과 비교해 드려요.<br/>
              영업 잔액은 장사 성적(실입금 − 지출)이고, 통장 잔액에는 형 대여금·투자금 같은 영업 외 거래도 들어 있어서 둘은 다를 수 있어요.
            </>
          ) : b.closing === null ? (
            <>이 은행 파일에는 잔액 칸이 없어서 실제 통장 잔액을 계산할 수 없어요. 잔액이 있는 PDF로 올려주세요.</>
          ) : b.diff === 0 ? (
            <>
              <div style={{color:'#34d399',fontWeight:600,marginBottom:4}}>장부가 통장과 정확히 맞아요.</div>
              {md(b.from)}~{md(b.to)} 통장 거래 {b.count}건 기준이에요.
            </>
          ) : (
            <>
              <div style={{color:'#dde1f2',fontWeight:600,marginBottom:6}}>차이가 나는 이유 ({md(b.from)}~{md(b.to)} 통장 거래 {b.count}건 기준)</div>
              {[
                [b.reasons.carryover, `통장 시작 잔액은 ${wonFmt(b.opening)}원인데 전월 이월은 ${wonFmt(s.carryover)}원이에요. 전월 이월을 ${wonFmt(b.opening)}원으로 고치면 맞아요.`],
                [b.reasons.unhandledIn, '아직 정리 안 된 입금이 있어요. 계좌내역 탭에서 다시 올려 실입금으로 맞추거나 영업 외 입금으로 기록하세요.'],
                [b.reasons.unhandledOut, '아직 정리 안 된 출금이 있어요. 계좌내역 탭에서 카테고리나 영업 외 종류를 골라주세요. (\'반영 안 함\'으로 둔 출금도 여기 들어가요)'],
                [b.reasons.offBank, '통장이 아닌 곳에서 낸 지출이에요(현금·직접 입력·고정지출 납부 등). 이 중 통장에서 나간 건은 바로 위 \'정리 안 된 출금\'과 서로 상쇄돼요.'],
              ].filter(([v])=>v).map(([v,text],i)=>(
                <div key={i} style={{display:'flex',gap:8,marginBottom:6}}>
                  <b style={{fontFamily:'DM Mono,monospace',color: v>0 ? '#f9b934' : '#f87171',minWidth:96,textAlign:'right'}}>{sign(v)}</b>
                  <span>{text}</span>
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {nonOp.length > 0 && (
        <div style={{marginTop:10}}>
          <button type="button" onClick={()=>setShowList(v=>!v)}
            style={{background:'transparent',border:'none',color:'#93c5fd',fontSize:11,cursor:'pointer',fontFamily:'inherit',padding:0}}>
            {showList ? '▾ 영업 외 거래 접기' : `▸ 영업 외 거래 ${nonOp.length}건 보기`} <span style={{color:'#5e6585'}}>(투자·정산은 투자관리 탭에 옮겨 적을 때 참고하세요)</span>
          </button>
          {showList && (
            <div style={{display:'flex',flexDirection:'column',gap:4,marginTop:8}}>
              {nonOp.map(x=>(
                <div key={x.key} style={{display:'flex',gap:10,fontSize:11,background:'#191c2b',borderRadius:6,padding:'6px 10px',flexWrap:'wrap'}}>
                  <span style={{color:'#5e6585',fontFamily:'DM Mono,monospace',minWidth:44}}>{md(x.date)}</span>
                  <span style={{minWidth:96}}>{NONOP_LABELS[x.kind]||x.kind}</span>
                  <span style={{flex:1,color:'#dde1f2'}}>{x.desc}</span>
                  <span style={{fontFamily:'DM Mono,monospace',color: x.dir==='in' ? '#34d399' : '#f87171'}}>{x.dir==='in'?'+':'−'}{wonFmt(x.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
