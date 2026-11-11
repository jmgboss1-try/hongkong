import { DOW, DOW_ORDER, KIND_LABELS, krDate, dayMinutes, hm, toMin, todayISO } from '../lib/contracts'
import { sealStyle } from '../lib/bizInfo'

// 표준근로계약서 (고용노동부 양식 내용). 인쇄용 id="wage-statement-print" (WageStatements 의 인쇄 CSS 재사용)
const T = { ink:'#1D1B18', sub:'#6E6A63', rule:'#1D1B18' }
const won = n => `${Math.round(+n || 0).toLocaleString('ko-KR')}원`
const box = on => <span style={{display:'inline-block', width:12, height:12, border:`1px solid ${T.ink}`, textAlign:'center', lineHeight:'11px', fontSize:11, marginRight:3, verticalAlign:'-1px'}}>{on ? '✓' : ''}</span>
const t12 = s => { const m = toMin(s); return m == null ? '    시    분' : `${Math.floor(m / 60)}시 ${pad2(m % 60)}분` }
const pad2 = n => String(n).padStart(2, '0')

export default function ContractDoc({ c, biz, seal, printId = 'wage-statement-print' }) {
  const isPart = c.kind === 'part'
  const title = isPart ? '단시간근로자 표준근로계약서' : `표준근로계약서 (${c.kind === 'fixed' ? '기간의 정함이 있는 경우' : '기간의 정함이 없는 경우'})`
  const bizName = biz?.name || '홍콩반점 중앙대점'
  const days = DOW_ORDER.filter(d => c.days?.[d])
  const weekTotal = days.reduce((a, d) => a + (dayMinutes(c.days[d]) || 0), 0)
  const contractDay = (c.createdAt || todayISO()).slice(0, 10)
  let n = 0
  const item = (label, body) => (
    <div style={{display:'flex', flexWrap:'wrap', columnGap:6, padding:'6px 0', fontSize:13, lineHeight:1.7}}>
      <b style={{whiteSpace:'nowrap'}}>{++n}. {label} :</b><div style={{flex:'1 1 260px', minWidth:0}}>{body}</div>
    </div>
  )
  const cell = { border:`1px solid ${T.rule}`, padding:'4px 4px', textAlign:'center', fontSize:12, whiteSpace:'nowrap' }

  return (
    <div id={printId} style={{background:'#FFFFFF', color:T.ink, padding:'26px 28px', border:'1px solid #DCD7CE', borderRadius:6, maxWidth:720, margin:'0 auto'}}>
      <div style={{textAlign:'center', fontSize:20, fontWeight:900, letterSpacing:3, marginBottom:4}}>{title}</div>
      <div style={{textAlign:'center', fontSize:11, color:T.sub, marginBottom:16}}>{KIND_LABELS[c.kind]}</div>
      <div style={{fontSize:13, lineHeight:1.8, marginBottom:8}}>
        <u>&nbsp;{bizName}&nbsp;</u>(이하 "사업주"라 함)과(와) <u>&nbsp;{c.name}&nbsp;</u>(이하 "근로자"라 함)은 다음과 같이 근로계약을 체결한다.
      </div>

      {item(c.kind === 'regular' ? '근로개시일' : '근로계약기간',
        c.kind === 'regular' ? `${krDate(c.startDate)}부터` : `${krDate(c.startDate)}부터 ${c.endDate ? `${krDate(c.endDate)}까지` : '(종료일 정함 없음)'}`)}
      {item('근무장소', c.place)}
      {item('업무의 내용', c.job)}
      {isPart ? item('근로일 및 근로일별 근로시간', <>
        <table style={{borderCollapse:'collapse', width:'100%', marginTop:2}}>
          <tbody>
            <tr><th style={cell}></th>{days.map(d => <th key={d} style={cell}>{DOW[d]}요일</th>)}</tr>
            <tr><th style={cell}>근로시간</th>{days.map(d => <td key={d} style={cell}>{hm(dayMinutes(c.days[d])) || ''}</td>)}</tr>
            <tr><th style={cell}>시업</th>{days.map(d => <td key={d} style={cell}>{c.days[d].start || ''}</td>)}</tr>
            <tr><th style={cell}>종업</th>{days.map(d => <td key={d} style={cell}>{c.days[d].end || ''}</td>)}</tr>
            <tr><th style={cell}>휴게시간</th>{days.map(d => <td key={d} style={cell}>{+c.days[d].breakMin ? `${c.days[d].breakMin}분` : '없음'}</td>)}</tr>
          </tbody>
        </table>
        <div style={{marginTop:4}}>○ 주 소정근로시간: {hm(weekTotal) || '      시간'} &nbsp; ○ 주휴일: 매주 {DOW[c.hours?.weeklyHoliday ?? 0]}요일</div>
      </>) : <>
        {item('소정근로시간', `${t12(c.hours?.start)}부터 ${t12(c.hours?.end)}까지 (휴게시간: ${+c.hours?.breakMin || 0}분)`)}
        {item('근무일/휴일', `매주 ${(c.hours?.workDays || []).length}일(${DOW_ORDER.filter(d => (c.hours?.workDays || []).includes(d)).map(d => DOW[d]).join('·')}) 근무, 주휴일 매주 ${DOW[c.hours?.weeklyHoliday ?? 0]}요일`)}
      </>}
      {item('임금', <div>
        <div>- {c.wage?.type === 'monthly' ? '월급' : '시간급'} : {won(c.wage?.amount)}</div>
        <div>- 상여금 : {box(c.bonus?.has)}있음 {c.bonus?.has ? `(${won(c.bonus.amount)})` : '(          원)'} &nbsp; {box(!c.bonus?.has)}없음</div>
        <div>- 기타급여(제수당 등) : {box(c.weeklyPay || c.otherPay)}있음 {[c.weeklyPay && '주휴수당(주 15시간 이상 근무 시)', c.otherPay].filter(Boolean).join(', ')} &nbsp; {box(!c.weeklyPay && !c.otherPay)}없음</div>
        {isPart && <div>- 초과근로에 대한 가산임금률 : 정해진 근로시간을 넘겨 일하는 시간에 대하여 통상임금의 50% 이상을 가산하여 지급</div>}
        <div>- 임금지급일 : 매월 {c.payDay || '  '}일 (휴일의 경우에는 전일 지급)</div>
        <div>- 지급방법 : {box(c.payMethod === 'direct')}근로자에게 직접지급 &nbsp; {box(c.payMethod !== 'direct')}근로자 명의 예금통장에 입금</div>
      </div>)}
      {item('연차유급휴가', isPart ? '통상근로자의 근로시간에 비례하여 연차유급휴가 부여' : '연차유급휴가는 근로기준법에서 정하는 바에 따라 부여함')}
      {item('사회보험 적용여부', <>{box(c.insurance?.employ)}고용보험 &nbsp;{box(c.insurance?.accident)}산재보험 &nbsp;{box(c.insurance?.pension)}국민연금 &nbsp;{box(c.insurance?.health)}건강보험</>)}
      {item('근로계약서 교부', '사업주는 근로계약을 체결함과 동시에 본 계약서를 사본하여 근로자의 교부요구와 관계없이 근로자에게 교부함 (근로기준법 제17조 이행)')}
      {item('근로계약, 취업규칙 등의 성실한 이행의무', '사업주와 근로자는 각자가 근로계약, 취업규칙, 단체협약을 지키고 성실하게 이행하여야 함')}
      {item('기타', <>이 계약에 정함이 없는 사항은 근로기준법령에 의함{c.extra ? <div style={{whiteSpace:'pre-wrap', marginTop:2}}>{c.extra}</div> : null}</>)}

      <div style={{textAlign:'center', fontSize:14, margin:'18px 0 14px'}}>{krDate(contractDay)}</div>
      <div style={{display:'grid', gridTemplateColumns:'60px 1fr', rowGap:4, fontSize:13, lineHeight:1.8}}>
        <b>(사업주)</b>
        <div>
          사업체명 : {bizName} {biz?.bizNo ? ` (사업자등록번호 ${biz.bizNo})` : ''}<br/>
          주 소 : {biz?.address || ''}<br/>
          대 표 자 : {biz?.ceo || ''} &nbsp;<span style={{position:'relative', display:'inline-block'}}>(서명 또는 인){seal && <img src={seal} alt="직인" style={sealStyle}/>}</span>
        </div>
        <b style={{marginTop:8}}>(근로자)</b>
        <div style={{marginTop:8}}>
          주 소 : {c.empAddress || ''}<br/>
          연 락 처 : {c.empPhone || ''}<br/>
          성 명 : {c.name} &nbsp;<span style={{position:'relative', display:'inline-block'}}>(서명)
            {c.empSign && <img src={c.empSign} alt="근로자 서명" style={{position:'absolute', left:-10, top:'50%', transform:'translateY(-55%)', height:46, maxWidth:150, objectFit:'contain', pointerEvents:'none'}}/>}</span>
          {c.empSignedAt && <span style={{fontSize:11, color:T.sub, marginLeft:8}}>전자서명 {c.empSignedAt.slice(0, 16).replace('T', ' ')}</span>}
        </div>
      </div>
    </div>
  )
}
