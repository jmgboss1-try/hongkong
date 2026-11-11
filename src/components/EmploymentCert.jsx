import { useState } from 'react'
import { STATEMENT_PRINT_CSS } from './WageStatements'
import { useBizInfo, useSeal, sealStyle } from '../lib/bizInfo'
import { jobOf, krDate, todayISO } from '../lib/contracts'

// 인원관리 → 직원 → 재직증명서 (사장님): 직원 정보·사업장 정보·직인으로 채우고 주소·용도만 적어서 인쇄
// 퇴사한 사람은 '경력증명서'로 (재직기간 = 입사일 ~ 퇴사일)
const T = { ink:'#1D1B18', sub:'#6E6A63', rule:'#DCD7CE', accent:'#C3261C' }
const btn = primary => ({ fontFamily:'inherit', fontSize:13, fontWeight:700, padding:'7px 14px', borderRadius:4, cursor:'pointer',
  border: primary ? 'none' : `1px solid ${T.rule}`, background: primary ? T.accent : '#FFFFFF', color: primary ? '#FFFFFF' : T.ink })
const inp = { fontFamily:'inherit', fontSize:13, padding:'6px 8px', borderRadius:4, border:`1px solid ${T.rule}`, background:'#FFFFFF', color:T.ink, boxSizing:'border-box', width:'100%' }

// 주민번호 앞 7자리로 생년월일 (뒤 첫 자리 1·2 → 1900년대, 3·4 → 2000년대)
function birthOf(ssn) {
  const d = String(ssn || '').replace(/[^0-9]/g, '')
  if (d.length < 6) return ''
  const g = d[6], cent = g === '3' || g === '4' || g === '7' || g === '8' ? '20' : '19'
  return `${cent}${d.slice(0, 2)}년 ${+d.slice(2, 4)}월 ${+d.slice(4, 6)}일`
}

export default function EmploymentCert({ member, onClose }) {
  const biz = useBizInfo(), seal = useSeal()
  const retired = member.status === 'retired'
  const [address, setAddress] = useState('')
  const [purpose, setPurpose] = useState('금융기관 제출용')
  const [job, setJob] = useState(`${jobOf(member)} 업무`)
  const [position, setPosition] = useState(member.employType === 'full' ? '정직원' : '아르바이트')
  const [no] = useState(() => `제 ${new Date().getFullYear()}-${String(Date.now()).slice(-4)} 호`)
  const today = todayISO()
  const title = retired ? '경 력 증 명 서' : '재 직 증 명 서'
  const row = (k, v) => (
    <tr><th style={{border:`1px solid ${T.ink}`, background:'#F3F1EC', padding:'9px 10px', width:120, fontSize:13, fontWeight:700, textAlign:'center'}}>{k}</th>
      <td style={{border:`1px solid ${T.ink}`, padding:'9px 12px', fontSize:13}}>{v}</td></tr>
  )

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'rgba(29,27,24,.45)', zIndex:1000, overflowY:'auto', padding:'24px 12px'}}>
      <style>{STATEMENT_PRINT_CSS}</style>
      <div onClick={e => e.stopPropagation()} style={{maxWidth:720, margin:'0 auto', background:'#FAF9F6', borderRadius:6, padding:'14px 16px'}}>
        <div className="ws-noprint" style={{display:'flex', alignItems:'center', gap:8, marginBottom:10, flexWrap:'wrap'}}>
          <b style={{fontSize:15}}>{member.name}님 {retired ? '경력증명서' : '재직증명서'}</b>
          <span style={{flex:1}}/>
          <button type="button" onClick={() => window.print()} style={btn(true)}>인쇄 · PDF로 저장</button>
          <button type="button" onClick={onClose} style={btn(false)}>닫기</button>
        </div>
        <div className="ws-noprint" style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(180px, 1fr))', gap:8, marginBottom:12}}>
          <label style={{fontSize:12, color:T.sub, gridColumn:'1 / -1'}}>직원 주소 (앱에 없어서 여기에 적어요)<input value={address} onChange={e => setAddress(e.target.value)} style={{...inp, marginTop:3}}/></label>
          <label style={{fontSize:12, color:T.sub}}>용도<input value={purpose} onChange={e => setPurpose(e.target.value)} style={{...inp, marginTop:3}}/></label>
          <label style={{fontSize:12, color:T.sub}}>직위<input value={position} onChange={e => setPosition(e.target.value)} style={{...inp, marginTop:3}}/></label>
          <label style={{fontSize:12, color:T.sub}}>담당업무<input value={job} onChange={e => setJob(e.target.value)} style={{...inp, marginTop:3}}/></label>
        </div>

        <div id="wage-statement-print" style={{background:'#FFFFFF', color:T.ink, padding:'34px 34px 40px', border:`1px solid ${T.rule}`, borderRadius:6}}>
          <div style={{fontSize:12, color:T.sub}}>{no}</div>
          <div style={{textAlign:'center', fontSize:26, fontWeight:900, letterSpacing:6, margin:'14px 0 26px'}}>{title}</div>
          <table style={{width:'100%', borderCollapse:'collapse'}}>
            <tbody>
              {row('성 명', member.name)}
              {row('생년월일', birthOf(member.ssn))}
              {row('주 소', address)}
              {row('소 속', biz?.name || '홍콩반점 중앙대점')}
              {row('직 위', position)}
              {row('담당업무', job)}
              {row(retired ? '근무기간' : '재직기간', `${krDate(member.joinDate)} ~ ${retired ? krDate(member.leaveDate) : `${krDate(today)} (현재 재직 중)`}`)}
              {row('용 도', purpose)}
            </tbody>
          </table>
          <div style={{textAlign:'center', fontSize:15, margin:'36px 0 26px', lineHeight:1.8}}>
            위 사람은 당사에 {retired ? '위와 같이 근무하였음' : '위와 같이 재직하고 있음'}을 증명합니다.
          </div>
          <div style={{textAlign:'center', fontSize:15, marginBottom:26}}>{krDate(today)}</div>
          <div style={{fontSize:14, lineHeight:2, paddingLeft:'35%'}}>
            상 호 : {biz?.name || '홍콩반점 중앙대점'}<br/>
            {biz?.bizNo && <>사업자등록번호 : {biz.bizNo}<br/></>}
            {biz?.address && <>소 재 지 : {biz.address}<br/></>}
            대 표 자 : {biz?.ceo || ''} &nbsp;<span style={{position:'relative', display:'inline-block'}}>(인){seal && <img src={seal} alt="직인" style={{...sealStyle, right:-22}}/>}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
