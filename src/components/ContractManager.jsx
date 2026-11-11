import { useEffect, useState } from 'react'
import ContractDoc from './ContractDoc'
import TimePick from './TimePick'
import { STATEMENT_PRINT_CSS } from './WageStatements'
import { useBizInfo, useSeal } from '../lib/bizInfo'
import { DOW, DOW_ORDER, KIND_LABELS, draftContract, loadContracts, sendContract, deleteContract, dayMinutes, hm } from '../lib/contracts'

// 인원관리 → 직원 → 근로계약서 (사장님): 보낸 계약서 목록, 새로 만들기(직원 정보로 채운 초안 → 고쳐서 보내기), 보기·인쇄
const T = { ink:'#1D1B18', sub:'#6E6A63', rule:'#DCD7CE', chip:'#F3F1EC', accent:'#C3261C', green:'#2E7D45', amber:'#B45309' }
const btn = primary => ({ fontFamily:'inherit', fontSize:13, fontWeight:700, padding:'7px 14px', borderRadius:4, cursor:'pointer',
  border: primary ? 'none' : `1px solid ${T.rule}`, background: primary ? T.accent : '#FFFFFF', color: primary ? '#FFFFFF' : T.ink })
const inp = { fontFamily:'inherit', fontSize:13, padding:'6px 8px', borderRadius:4, border:`1px solid ${T.rule}`, background:'#FFFFFF', color:T.ink, boxSizing:'border-box' }
const lab = { fontSize:12, color:T.sub, display:'block', marginBottom:3 }

export default function ContractManager({ member, onClose }) {
  const biz = useBizInfo(), seal = useSeal()
  const [list, setList] = useState(null)
  const [form, setForm] = useState(null)   // 새로 만드는 계약서
  const [view, setView] = useState(null)   // 보고 있는 계약서
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const reload = () => loadContracts(member.uid).then(setList).catch(e => { console.error(e); setList([]); setMsg('계약서를 불러오지 못했어요 (규칙 확인)') })
  useEffect(() => { reload() }, [member.uid]) // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setIn = (k, sub, v) => setForm(f => ({ ...f, [k]: { ...f[k], [sub]: v } }))
  const setDay = (d, sub, v) => setForm(f => ({ ...f, days: { ...f.days, [d]: { ...(f.days[d] || { start:'', end:'', breakMin:0 }), [sub]: v } } }))
  const toggleDay = d => setForm(f => {
    const days = { ...f.days }; if (days[d]) delete days[d]; else days[d] = { start:'', end:'', breakMin:0 }
    const workDays = f.hours.workDays.includes(d) ? f.hours.workDays.filter(x => x !== d) : [...f.hours.workDays, d]
    return { ...f, days, hours: { ...f.hours, workDays } }
  })
  const send = async () => {
    if (!form.startDate) return setMsg('근로개시일을 넣어 주세요')
    if (form.kind === 'fixed' && !form.endDate) return setMsg('기간의 정함이 있는 계약은 종료일을 넣어 주세요')
    if (!window.confirm(`${member.name}님에게 근로계약서를 보낼까요? 직원이 내 급여에서 확인하고 서명해요.`)) return
    setBusy(true)
    try { await sendContract(member.uid, form); setForm(null); setMsg('보냈어요. 직원이 서명하면 서명 완료로 바뀌어요'); reload() }
    catch (e) { console.error(e); setMsg('보내지 못했어요') }
    setBusy(false)
  }
  const remove = async c => {
    if (!window.confirm(c.status === 'signed' ? '서명까지 끝난 계약서예요. 정말 지울까요?' : '이 계약서를 지울까요?')) return
    await deleteContract(member.uid, c.id); setView(null); reload()
  }

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'rgba(29,27,24,.45)', zIndex:1000, overflowY:'auto', padding:'24px 12px'}}>
      <style>{STATEMENT_PRINT_CSS}</style>
      <div onClick={e => e.stopPropagation()} style={{maxWidth:780, margin:'0 auto', background:'#FAF9F6', borderRadius:6, padding:'14px 16px'}}>
        <div className="ws-noprint" style={{display:'flex', alignItems:'center', gap:8, marginBottom:10, flexWrap:'wrap'}}>
          <b style={{fontSize:15}}>{member.name}님 근로계약서</b>
          <span style={{flex:1}}/>
          {view && <button type="button" onClick={() => window.print()} style={btn(false)}>인쇄 · PDF로 저장</button>}
          {(view || form) && <button type="button" onClick={() => { setView(null); setForm(null) }} style={btn(false)}>목록으로</button>}
          <button type="button" onClick={onClose} style={btn(false)}>닫기</button>
        </div>
        {msg && <div className="ws-noprint" style={{fontSize:13, color:T.amber, marginBottom:8}}>{msg}</div>}

        {view ? <ContractDoc c={view} biz={biz} seal={seal}/>
        : form ? (
          <div className="ws-noprint" style={{display:'grid', gap:12}}>
            <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
              {Object.entries(KIND_LABELS).map(([k, l]) => (
                <button key={k} type="button" onClick={() => set('kind', k)} style={{...btn(false), ...(form.kind === k ? { borderColor:T.accent, color:T.accent } : {})}}>{l}</button>
              ))}
            </div>
            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:10}}>
              <label><span style={lab}>근로개시일</span><input type="date" value={form.startDate} onChange={e => set('startDate', e.target.value)} style={{...inp, width:'100%'}}/></label>
              {form.kind !== 'regular' && <label><span style={lab}>종료일{form.kind === 'part' ? ' (없으면 비움)' : ''}</span><input type="date" value={form.endDate} onChange={e => set('endDate', e.target.value)} style={{...inp, width:'100%'}}/></label>}
              <label style={{gridColumn:'span 2'}}><span style={lab}>근무장소</span><input value={form.place} onChange={e => set('place', e.target.value)} style={{...inp, width:'100%'}}/></label>
              <label style={{gridColumn:'1 / -1'}}><span style={lab}>업무의 내용</span><input value={form.job} onChange={e => set('job', e.target.value)} style={{...inp, width:'100%'}}/></label>
            </div>

            <div>
              <span style={lab}>근무 요일과 시간 {form.kind === 'part' ? '(요일마다 시업·종업·휴게)' : ''}</span>
              <div style={{display:'flex', gap:4, flexWrap:'wrap', marginBottom:6}}>
                {DOW_ORDER.map(d => <button key={d} type="button" onClick={() => toggleDay(d)} style={{...btn(false), padding:'4px 10px', ...(form.days[d] ? { background:T.ink, color:'#FFFFFF', borderColor:T.ink } : {})}}>{DOW[d]}</button>)}
              </div>
              {form.kind === 'part' ? DOW_ORDER.filter(d => form.days[d]).map(d => (
                <div key={d} style={{display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', padding:'3px 0', fontSize:13}}>
                  <b style={{width:20}}>{DOW[d]}</b>
                  <TimePick value={form.days[d].start} onChange={v => setDay(d, 'start', v)} label={`${DOW[d]} 시업`} width={150}/>~
                  <TimePick value={form.days[d].end} onChange={v => setDay(d, 'end', v)} label={`${DOW[d]} 종업`} width={150}/>
                  휴게 <input type="number" min="0" step="10" value={form.days[d].breakMin} onChange={e => setDay(d, 'breakMin', +e.target.value)} style={{...inp, width:64}}/>분
                  <span style={{color:T.sub}}>{hm(dayMinutes(form.days[d]))}</span>
                </div>
              )) : (
                <div style={{display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', fontSize:13}}>
                  소정근로시간 <TimePick value={form.hours.start} onChange={v => setIn('hours', 'start', v)} label="시업" width={150}/>~
                  <TimePick value={form.hours.end} onChange={v => setIn('hours', 'end', v)} label="종업" width={150}/>
                  휴게 <input type="number" min="0" step="10" value={form.hours.breakMin} onChange={e => setIn('hours', 'breakMin', +e.target.value)} style={{...inp, width:64}}/>분
                </div>
              )}
              <div style={{fontSize:13, marginTop:6}}>주휴일 매주
                <select value={form.hours.weeklyHoliday} onChange={e => setIn('hours', 'weeklyHoliday', +e.target.value)} style={{...inp, marginLeft:6}}>
                  {DOW_ORDER.map(d => <option key={d} value={d}>{DOW[d]}요일</option>)}
                </select>
              </div>
            </div>

            <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:10, alignItems:'end'}}>
              <label><span style={lab}>임금</span>
                <select value={form.wage.type} onChange={e => setIn('wage', 'type', e.target.value)} style={{...inp, width:'100%'}}><option value="hourly">시간급</option><option value="monthly">월급</option></select></label>
              <label><span style={lab}>금액 (원)</span><input type="number" value={form.wage.amount} onChange={e => setIn('wage', 'amount', +e.target.value)} style={{...inp, width:'100%'}}/></label>
              <label><span style={lab}>임금지급일 (매월)</span><input type="number" min="1" max="31" value={form.payDay} onChange={e => set('payDay', +e.target.value)} style={{...inp, width:'100%'}}/></label>
              <label><span style={lab}>지급방법</span>
                <select value={form.payMethod} onChange={e => set('payMethod', e.target.value)} style={{...inp, width:'100%'}}><option value="account">근로자 명의 통장 입금</option><option value="direct">직접 지급</option></select></label>
              <label style={{fontSize:13}}><input type="checkbox" checked={form.bonus.has} onChange={e => setIn('bonus', 'has', e.target.checked)}/> 상여금 있음
                {form.bonus.has && <input type="number" value={form.bonus.amount} onChange={e => setIn('bonus', 'amount', +e.target.value)} placeholder="금액" style={{...inp, width:'100%', marginTop:3}}/>}</label>
              <label style={{fontSize:13}}><input type="checkbox" checked={form.weeklyPay} onChange={e => set('weeklyPay', e.target.checked)}/> 주휴수당 지급</label>
              <label style={{gridColumn:'span 2'}}><span style={lab}>기타 수당 (있으면)</span><input value={form.otherPay} onChange={e => set('otherPay', e.target.value)} style={{...inp, width:'100%'}}/></label>
            </div>

            <div style={{fontSize:13}}><span style={lab}>사회보험</span>
              {[['employ','고용보험'],['accident','산재보험'],['pension','국민연금'],['health','건강보험']].map(([k, l]) => (
                <label key={k} style={{marginRight:12}}><input type="checkbox" checked={!!form.insurance[k]} onChange={e => setIn('insurance', k, e.target.checked)}/> {l}</label>
              ))}
            </div>
            <label><span style={lab}>기타 (특약 사항이 있으면)</span><textarea value={form.extra} onChange={e => set('extra', e.target.value)} rows={2} style={{...inp, width:'100%', resize:'vertical'}}/></label>

            <div style={{fontSize:12, color:T.sub, lineHeight:1.6}}>아래는 직원이 받게 될 모습이에요. 사업장 정보·직인은 원천징수영수증 → 사업장 정보에서 바꿔요.</div>
            <ContractDoc c={form} biz={biz} seal={seal} printId="contract-preview"/>
            <div style={{display:'flex', gap:8}}>
              <button type="button" onClick={send} disabled={busy} style={btn(true)}>{busy ? '보내는 중…' : '직원에게 보내기'}</button>
              <button type="button" onClick={() => setForm(null)} style={btn(false)}>취소</button>
            </div>
          </div>
        ) : (
          <div className="ws-noprint">
            {list == null ? <div style={{fontSize:13, color:T.sub}}>불러오는 중…</div>
            : list.length === 0 ? <div style={{fontSize:13, color:T.sub, padding:'8px 0'}}>아직 보낸 근로계약서가 없어요</div>
            : list.map(c => (
              <div key={c.id} style={{display:'flex', alignItems:'center', gap:8, padding:'9px 0', borderBottom:`1px solid ${T.rule}`, fontSize:13, flexWrap:'wrap'}}>
                <b>{KIND_LABELS[c.kind]}</b>
                <span style={{color:T.sub}}>{c.startDate}{c.endDate ? ` ~ ${c.endDate}` : ''} · {(c.createdAt || '').slice(0, 10)} 보냄</span>
                <span style={{flex:1}}/>
                <span style={{fontWeight:700, color: c.status === 'signed' ? T.green : T.amber}}>{c.status === 'signed' ? `서명 완료 ${(c.empSignedAt || '').slice(0, 10)}` : '서명 대기'}</span>
                <button type="button" onClick={() => setView(c)} style={btn(false)}>보기</button>
                <button type="button" onClick={() => remove(c)} style={{...btn(false), color:'#B42318'}}>지우기</button>
              </div>
            ))}
            <button type="button" onClick={() => { setMsg(''); setForm(draftContract(member, biz)) }} style={{...btn(true), marginTop:12}}>새 근로계약서 만들기</button>
            <div style={{fontSize:12, color:T.sub, marginTop:8, lineHeight:1.6}}>
              고용노동부 표준근로계약서 내용으로 만들어요. 직원 정보(입사일·시급·근무 요일·포지션)로 미리 채워지고, 고친 뒤 보내면 직원이 내 급여에서 확인하고 손가락으로 서명해요.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
