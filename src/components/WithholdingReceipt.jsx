import { useEffect, useState } from 'react'
import { db } from '../firebase'
import { collection, doc, getDoc, getDocs } from 'firebase/firestore'
import { loadPrivateMap } from '../lib/privateInfo'
import { calcDeduction, deductionKind, splitTax, insuranceFor } from '../lib/payDeduction'
import { STATEMENT_PRINT_CSS } from './WageStatements'
import { DEFAULT_BIZ, loadBizInfo, saveBizInfo, loadSeal, saveSeal, makeSealPng, sealStyle } from '../lib/bizInfo'

// 원천징수영수증 (급여관리, 사장님만): 한 사람의 한 해
//  - 3.3% 직원 → 거주자의 사업소득 원천징수영수증 (달마다 지급액·소득세 3%·지방소득세 0.3%)
//  - 4대보험 직원·사장님(정민규) → 근로소득 원천징수 내역 (달마다 급여·상여·보험료·소득세). 연말정산이 들어간 공식
//    근로소득 원천징수영수증은 홈택스·세무사 자료가 필요해서, 여기서는 앱에 있는 지급·공제 내역만 1년치로 모음
//  자료: payroll/{달}[uid] (사장님이 확정한 달만), bonuses/{달}[uid], 사장님은 payrollOwner/{달} (다음 달로 이어짐)
//  징수의무자 정보(상호·사업자등록번호·대표자·주소)는 rewards/bizInfo (src/lib/bizInfo.js, 임금명세서와 같이 씀)
const T = { ink:'#1D1B18', sub:'#6E6A63', rule:'#DCD7CE', soft:'#ECE8E1', chip:'#F3F1EC', accent:'#C3261C', blue:'#2B5C9E' }
const num = { fontVariantNumeric:'tabular-nums' }
const won = n => Math.round(n || 0).toLocaleString('ko-KR')
const pad = n => String(n).padStart(2, '0')
const OWNER = '__owner'
const btn = primary => ({ fontFamily:'inherit', fontSize:13, fontWeight:700, padding:'6px 12px', borderRadius:4, cursor:'pointer',
  border: primary ? 'none' : `1px solid ${T.rule}`, background: primary ? T.accent : '#FFFFFF', color: primary ? '#FFFFFF' : T.ink })
const input = { fontFamily:'inherit', fontSize:13, padding:'5px 8px', borderRadius:4, border:`1px solid ${T.rule}`, background:'#FFFFFF', color:T.ink, boxSizing:'border-box', width:'100%' }

export default function WithholdingReceipt({ defaultYear, onClose }) {
  const thisYear = new Date().getFullYear()
  const [year, setYear] = useState(+defaultYear || thisYear)
  const [who, setWho] = useState(OWNER)
  const [people, setPeople] = useState([])     // [{uid, name, ssn}]
  const [months, setMonths] = useState(null)   // { 'YYYY-MM': { pay, bonus } }
  const [ownerCfgs, setOwnerCfgs] = useState([]) // payrollOwner 문서들 [{id, ...}]
  const [biz, setBiz] = useState(DEFAULT_BIZ)
  const [editBiz, setEditBiz] = useState(false)
  const [seal, setSeal] = useState(null)        // 직인 이미지 (rewards/bizSeal)
  const [sealMsg, setSealMsg] = useState('')
  useEffect(() => { loadSeal().then(setSeal) }, [])
  const pickSeal = async file => {
    if (!file) return
    setSealMsg('직인 만드는 중…')
    try { const png = await makeSealPng(file); await saveSeal(png); setSeal(png); setSealMsg('직인을 저장했어요. 임금명세서와 이 영수증에 찍혀요') }
    catch (e) { console.error(e); setSealMsg('직인을 저장하지 못했어요') }
  }
  const removeSeal = async () => { if (!window.confirm('직인을 지울까요?')) return; await saveSeal(null); setSeal(null); setSealMsg('직인을 지웠어요') }

  // 사람 목록·사장님 급여 설정·징수의무자 정보 (한 번)
  useEffect(() => {
    let off = false
    Promise.all([getDocs(collection(db, 'users')), loadPrivateMap().catch(() => ({})), getDocs(collection(db, 'payrollOwner')),
      loadBizInfo()])
      .then(([us, priv, po, bz]) => {
        if (off) return
        const list = []
        us.forEach(d => { const u = d.data(); if (u.role !== 'owner' && u.role !== 'store' && u.role !== 'investor' && u.name) list.push({ uid:d.id, name:u.name, ssn: priv[d.id]?.ssn || u.ssn || '', ins: priv[d.id]?.insuranceHistory || [] }) })
        list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'))
        setPeople(list)
        setOwnerCfgs(po.docs.filter(d => /^\d{4}-\d{2}$/.test(d.id)).map(d => ({ id:d.id, ...d.data() })).sort((a, b) => a.id < b.id ? -1 : 1))
        setBiz(bz)
      }).catch(e => console.error(e))
    return () => { off = true }
  }, [])

  // 그해 12달 급여·상여
  useEffect(() => {
    let off = false
    const yms = Array.from({ length: 12 }, (_, i) => `${year}-${pad(i + 1)}`)
    const safe = p => p.then(s => s.exists() ? s.data() : {}).catch(() => ({}))
    Promise.all(yms.map(ym => Promise.all([safe(getDoc(doc(db, 'payroll', ym))), safe(getDoc(doc(db, 'bonuses', ym)))])))
      .then(rows => { if (!off) setMonths(Object.fromEntries(yms.map((ym, i) => [ym, { pay: rows[i][0], bonus: rows[i][1] }]))) })
    return () => { off = true }
  }, [year])

  const saveBiz = async () => { await saveBizInfo(biz); setEditBiz(false) }

  // ── 한 사람의 달별 줄 만들기 ──
  const nowYm = `${thisYear}-${pad(new Date().getMonth() + 1)}`
  const rows = []
  if (months) for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${pad(m)}`
    if (who === OWNER) {
      if (ym > nowYm) continue
      const cfg = [...ownerCfgs].reverse().find(c => c.id <= ym)
      if (!cfg || !(cfg.salary > 0)) continue
      const parts = ['pension', 'health', 'care', 'employ', 'incomeTax', 'localTax'].reduce((a, k) => a + (+cfg[k] || 0), 0)
      rows.push({ ym, kind:'full', pay:+cfg.salary, bonus:0, pension:+cfg.pension||0, health:+cfg.health||0, care:+cfg.care||0, employ:+cfg.employ||0,
        income:+cfg.incomeTax||0, local:+cfg.localTax||0, other: parts > 0 ? 0 : (+cfg.deduction||0) })
    } else {
      const p = months[ym]?.pay?.[who]
      if (!p?.confirmedByOwner) continue
      const bonus = (Array.isArray(months[ym]?.bonus?.[who]) ? months[ym].bonus[who] : []).reduce((a, b) => a + (+b.amount || 0), 0)
      const kind = deductionKind(p.deduction)
      const pay = +p.totalPay || 0
      // 실제로 뗀 공제: 상여가 있으면 급여+상여에 같은 방식으로 다시 계산 (급여관리와 같음)
      const d = bonus > 0 && kind !== 'none' ? calcDeduction(pay + bonus, kind, insuranceFor(people.find(x => x.uid === who)?.ins, ym)) : (p.deduction || {})
      const t = splitTax(d.tax || 0, pay + (bonus > 0 ? bonus : 0))
      rows.push({ ym, kind, pay, bonus, pension:d.pension||0, health:d.health||0, care:d.care||0, employ:d.employ||0, income:t.income, local:t.local, other:0 })
    }
  }
  const person = who === OWNER ? { name:'정민규', ssn: [...ownerCfgs].reverse().find(c => c.ssn)?.ssn || '' } : people.find(p => p.uid === who) || { name:'', ssn:'' }
  const bizRows = rows.filter(r => r.kind === 'part')
  const laborRows = rows.filter(r => r.kind === 'full' || r.kind === 'none')
  const today = new Date()
  const issued = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일`

  const cell = (extra = {}) => ({ border:`1px solid ${T.ink}`, padding:'5px 6px', fontSize:12, ...extra })
  const head = (extra = {}) => cell({ background:'#F3F1EC', fontWeight:700, textAlign:'center', ...extra })
  const numCell = v => <td style={cell({ textAlign:'right', ...num })}>{won(v)}</td>
  const sum = (list, k) => list.reduce((a, r) => a + (r[k] || 0), 0)

  const partiesTable = (
    <table style={{width:'100%', borderCollapse:'collapse', marginTop:10}}>
      <tbody>
        <tr><td rowSpan={2} style={head({ width:70 })}>징수<br/>의무자</td>
          <td style={head({ width:90 })}>상호</td><td style={cell()}>{biz.name}</td>
          <td style={head({ width:110 })}>사업자등록번호</td><td style={cell()}>{biz.bizNo || ' '}</td></tr>
        <tr><td style={head()}>대표자</td><td style={cell()}>{biz.ceo}</td>
          <td style={head()}>소재지</td><td style={cell()}>{biz.address || ' '}</td></tr>
        <tr><td rowSpan={2} style={head()}>소득자</td>
          <td style={head()}>성명</td><td style={cell()}>{person.name}</td>
          <td style={head()}>주민등록번호</td><td style={cell(num)}>{person.ssn || ' '}</td></tr>
        <tr><td style={head()}>주소</td><td colSpan={3} style={cell()}>&nbsp;</td></tr>
      </tbody>
    </table>
  )
  const signature = (
    <div style={{marginTop:16, fontSize:13, lineHeight:1.9, textAlign:'right'}}>
      <div style={{textAlign:'left'}}>위의 원천징수세액(수입금액)을 정히 영수(지급)합니다.</div>
      <div>{issued}</div>
      <div>징수(보고)의무자 &nbsp;{biz.name} &nbsp;{biz.ceo} &nbsp;<span style={{position:'relative', display:'inline-block'}}>(서명 또는 인){seal && <img src={seal} alt="직인" style={sealStyle}/>}</span></div>
    </div>
  )

  return (
    <div onClick={onClose} style={{position:'fixed', inset:0, background:'rgba(29,27,24,.45)', zIndex:1000, overflowY:'auto', padding:'24px 12px'}}>
      <style>{STATEMENT_PRINT_CSS}</style>
      <div onClick={e => e.stopPropagation()} style={{maxWidth:760, margin:'0 auto', background:'#FAF9F6', borderRadius:6, padding:'14px 16px'}}>
        <div className="ws-noprint" style={{display:'flex', alignItems:'center', gap:8, flexWrap:'wrap', marginBottom:10}}>
          <b style={{fontSize:15}}>원천징수영수증</b>
          <select value={year} onChange={e => setYear(+e.target.value)} style={{...input, width:'auto'}}>
            {Array.from({ length: 5 }, (_, i) => thisYear - i).map(y => <option key={y} value={y}>{y}년 귀속</option>)}
          </select>
          <select value={who} onChange={e => setWho(e.target.value)} style={{...input, width:'auto'}}>
            <option value={OWNER}>정민규 (사장님)</option>
            {people.map(p => <option key={p.uid} value={p.uid}>{p.name}</option>)}
          </select>
          <span style={{flex:1}}/>
          <button type="button" onClick={() => setEditBiz(v => !v)} style={btn(false)}>사업장 정보</button>
          <button type="button" onClick={() => window.print()} style={btn(false)} disabled={!rows.length}>인쇄 · PDF로 저장</button>
          <button type="button" onClick={onClose} style={btn(false)}>닫기</button>
        </div>

        {editBiz && (
          <div className="ws-noprint" style={{background:T.chip, borderRadius:6, padding:'10px 12px', marginBottom:12, display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px, 1fr))', gap:8, alignItems:'end'}}>
            {[['name','상호'], ['bizNo','사업자등록번호'], ['ceo','대표자'], ['address','사업장 소재지']].map(([k, l]) => (
              <label key={k} style={{fontSize:12, color:T.sub}}>{l}<input value={biz[k] || ''} onChange={e => setBiz(b => ({ ...b, [k]: e.target.value }))} style={{...input, marginTop:3}}/></label>
            ))}
            <button type="button" onClick={saveBiz} style={btn(true)}>저장</button>
            <div style={{gridColumn:'1 / -1', display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', borderTop:`1px solid ${T.rule}`, paddingTop:8}}>
              <span style={{fontSize:12, color:T.sub}}>직인</span>
              {seal ? <img src={seal} alt="직인" style={{width:56, height:56, objectFit:'contain', background:'#FFFFFF', border:`1px solid ${T.rule}`, borderRadius:4}}/> : <span style={{fontSize:12, color:T.sub}}>없음</span>}
              <label style={{...btn(false), display:'inline-block'}}>{seal ? '바꾸기' : '직인 사진 올리기'}
                <input type="file" accept="image/*" style={{display:'none'}} onChange={e => { pickSeal(e.target.files?.[0]); e.target.value = '' }}/>
              </label>
              {seal && <button type="button" onClick={removeSeal} style={btn(false)}>지우기</button>}
              <span style={{fontSize:11, color:T.sub, flexBasis:'100%'}}>흰 종이에 찍은 직인 사진을 올리면 바탕은 투명하게 빼고 빨간 도장만 남겨요. 임금명세서·원천징수영수증의 '(서명 또는 인)' 위에 찍혀요.</span>
              {sealMsg && <span style={{fontSize:12, color:T.ink}}>{sealMsg}</span>}
            </div>
          </div>
        )}

        {!months ? <div style={{fontSize:13, color:T.sub, padding:'20px 0'}}>불러오는 중…</div>
        : rows.length === 0 ? (
          <div style={{fontSize:13, color:T.sub, padding:'20px 0', lineHeight:1.7}}>
            {year}년에 {person.name || '이 사람'}의 확정된 급여가 없어요.{who === OWNER ? ' 세무 보고서 → 정민규 급여 설정에 급여를 적용한 달부터 나와요.' : ' 급여관리에서 급여를 확정한 달만 들어가요.'}
          </div>
        ) : (
          <div id="wage-statement-print" style={{background:'#FFFFFF', border:`1px solid ${T.rule}`, borderRadius:6, padding:'18px 20px', color:T.ink}}>
            {bizRows.length > 0 && (
              <section style={{marginBottom: laborRows.length ? 28 : 0}}>
                <div style={{textAlign:'center', fontSize:17, fontWeight:900, letterSpacing:2}}>거주자의 사업소득 원천징수영수증</div>
                <div style={{textAlign:'center', fontSize:12, color:T.sub, marginTop:2}}>{year}년 귀속 · 소득세법 시행규칙 별지 제23호서식(2) 내용</div>
                {partiesTable}
                <table style={{width:'100%', borderCollapse:'collapse', marginTop:12}}>
                  <thead><tr>{['지급 연월', '지급액', '세율', '소득세', '지방소득세', '계'].map(h => <th key={h} style={head()}>{h}</th>)}</tr></thead>
                  <tbody>
                    {bizRows.map(r => (
                      <tr key={r.ym}>
                        <td style={cell({ textAlign:'center' })}>{r.ym.replace('-', '.')}</td>
                        {numCell(r.pay + r.bonus)}
                        <td style={cell({ textAlign:'center' })}>3%</td>
                        {numCell(r.income)}{numCell(r.local)}{numCell(r.income + r.local)}
                      </tr>
                    ))}
                    <tr style={{fontWeight:800}}>
                      <td style={head()}>합계</td>{numCell(sum(bizRows, 'pay') + sum(bizRows, 'bonus'))}<td style={cell()}/>
                      {numCell(sum(bizRows, 'income'))}{numCell(sum(bizRows, 'local'))}{numCell(sum(bizRows, 'income') + sum(bizRows, 'local'))}
                    </tr>
                  </tbody>
                </table>
                {signature}
              </section>
            )}
            {laborRows.length > 0 && (
              <section>
                <div style={{textAlign:'center', fontSize:17, fontWeight:900, letterSpacing:2}}>근로소득 원천징수 내역</div>
                <div style={{textAlign:'center', fontSize:12, color:T.sub, marginTop:2}}>{year}년 귀속 · 달마다 지급한 급여와 원천징수한 금액</div>
                {partiesTable}
                <table style={{width:'100%', borderCollapse:'collapse', marginTop:12}}>
                  <thead><tr>{['지급 연월', '급여', '상여', '국민연금', '건강보험', '장기요양', '고용보험', '소득세', '지방소득세', ...(laborRows.some(r => r.other) ? ['공제(합계)'] : [])].map(h => <th key={h} style={head({ fontSize:11 })}>{h}</th>)}</tr></thead>
                  <tbody>
                    {laborRows.map(r => (
                      <tr key={r.ym}>
                        <td style={cell({ textAlign:'center' })}>{r.ym.replace('-', '.')}</td>
                        {numCell(r.pay)}{numCell(r.bonus)}{numCell(r.pension)}{numCell(r.health)}{numCell(r.care)}{numCell(r.employ)}{numCell(r.income)}{numCell(r.local)}
                        {laborRows.some(x => x.other) && numCell(r.other)}
                      </tr>
                    ))}
                    <tr style={{fontWeight:800}}>
                      <td style={head()}>합계</td>
                      {['pay', 'bonus', 'pension', 'health', 'care', 'employ', 'income', 'local'].map(k => <td key={k} style={cell({ textAlign:'right', ...num })}>{won(sum(laborRows, k))}</td>)}
                      {laborRows.some(r => r.other) && numCell(sum(laborRows, 'other'))}
                    </tr>
                  </tbody>
                </table>
                <div style={{display:'flex', justifyContent:'flex-end', gap:16, marginTop:8, fontSize:13, ...num}}>
                  <span>총급여 <b>{won(sum(laborRows, 'pay') + sum(laborRows, 'bonus'))}</b>원</span>
                  <span>원천징수 소득세 <b>{won(sum(laborRows, 'income'))}</b>원 · 지방소득세 <b>{won(sum(laborRows, 'local'))}</b>원</span>
                </div>
                {signature}
                <div style={{fontSize:11, color:T.sub, marginTop:10, lineHeight:1.6}}>
                  연말정산 결과(결정세액·공제 내역)가 들어간 근로소득 원천징수영수증(별지 제24호서식)은 홈택스나 세무사가 연말정산한 뒤 발급돼요. 이 표는 앱에 기록된 지급액과 매달 공제한 금액을 모은 것이에요.
                </div>
              </section>
            )}
          </div>
        )}
        <div className="ws-noprint" style={{fontSize:12, color:T.sub, marginTop:8, lineHeight:1.6}}>
          3.3% 직원은 사업소득 원천징수영수증, 4대보험 직원과 사장님은 근로소득 원천징수 내역으로 나와요. 소득자 주소는 앱에 없어서 비워 두었어요 (인쇄 후 직접 적어 주세요).
        </div>
      </div>
    </div>
  )
}
