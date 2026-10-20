import { useEffect, useRef, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'

// 은행 거래내역 엑셀(.xls/.xlsx/.csv) 또는 PDF(국민은행 '계좌 거래내역 조회', 비밀번호 가능)를 읽어 출금은 지출 카테고리로, 입금은 실입금액(deposit)으로 반영
//  - 같은 거래를 두 번 올려도 중복 반영되지 않도록 expenseImports/{YYYY-MM}.keys 에 반영한 거래 키를 남김
//  - 사용자가 고른 카테고리는 expenseImportRules/default 에 "내용 → 카테고리" 규칙으로 저장해 다음 달부터 자동 선택

const pad = n => String(n).padStart(2,'0')
const wonFmt = n => (n||0).toLocaleString('ko-KR')
const norm = s => String(s??'').replace(/\s+/g,'')

// 헤더 이름으로 열 찾기 (은행마다 이름이 조금씩 다름)
const COLS = {
  date:     /거래일시|거래일자|거래일|일자|날짜/,
  time:     /거래시간|시간/,
  out:      /출금|찾으신|지급금액|지급액/,
  in:       /입금|맡기신/,
  balance:  /잔액/,
  summary:  /적요|구분/,
  party:    /보낸분|받는분|기재내용|거래내용|내용|의뢰인|수취인|거래처/,
  memo:     /메모/,
}

function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 40); i++) {
    const cells = rows[i].map(norm)
    const idx = {}
    for (const [k, re] of Object.entries(COLS)) {
      const j = cells.findIndex(c => c && re.test(c))
      if (j >= 0) idx[k] = j
    }
    // '입금'이 '출금입금' 같은 합친 열에 먼저 걸리지 않도록 출금/입금 열이 같으면 무시
    if (idx.in === idx.out) delete idx.in
    if (idx.date !== undefined && idx.out !== undefined) return { row: i, idx }
  }
  return null
}

function parseDate(v) {
  if (v instanceof Date && !isNaN(v)) return `${v.getFullYear()}-${pad(v.getMonth()+1)}-${pad(v.getDate())}`
  if (typeof v === 'number' && v > 30000 && v < 80000) { // 엑셀 날짜 숫자
    const d = new Date(Math.round((v - 25569) * 86400000))
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`
  }
  const m = String(v??'').match(/(\d{4})\D{0,3}(\d{1,2})\D{0,3}(\d{1,2})/)
  return m ? `${m[1]}-${pad(+m[2])}-${pad(+m[3])}` : null
}
const parseTime = v => (String(v??'').match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/) || [''])[0]
const parseAmount = v => typeof v === 'number' ? Math.round(Math.abs(v)) : (+String(v??'').replace(/[^0-9]/g,'') || 0)

// 거래 한 줄을 공통 형태로 — 같은 날 같은 금액·같은 내용 거래가 여러 건이어도 구분되도록 순번을 붙임
function makeTxBuilder() {
  const seen = {}
  return ({ date, time, summary='', party='', memo='', out, inn, balance='' }) => {
    if (memo === '-') memo = ''
    const desc = [summary, party, memo].filter(Boolean).filter((v,i,a)=>a.indexOf(v)===i).join(' · ')
    const base = [date, time, out, inn, balance, norm(desc)].join('|')
    seen[base] = (seen[base]||0) + 1
    return { key: `${base}|${seen[base]}`, date, time, desc, matchText: party || summary || memo, out, in: inn }
  }
}
const byDateTime = (a,b)=> (a.date+a.time).localeCompare(b.date+b.time)

// PDF: 글자를 줄 단위로 다시 모은 뒤 "날짜 시간 적요 받는분 출금 입금 잔액 메모 거래점" 모양의 줄을 읽음
const PDF_ROW = /^(\d{4})\.(\d{2})\.(\d{2})\s*(\d{2}:\d{2}:\d{2})\s+(\S+)\s+(?:(.*?)\s+)?([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+(.*?)\s+(\S+)$/
async function readPdfTransactions(file, password) {
  const pdfjs = await import('pdfjs-dist')
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
  const data = new Uint8Array(await file.arrayBuffer())
  let pdf
  try {
    pdf = await pdfjs.getDocument({ data, password: password || undefined }).promise
  } catch(e) {
    if (e?.name === 'PasswordException') {
      const err = new Error(password ? '비밀번호가 맞지 않아요.' : '비밀번호가 걸린 PDF예요. 비밀번호를 입력해 주세요.')
      err.needPassword = true
      throw err
    }
    throw e
  }
  const lines = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n)
    const { items } = await page.getTextContent()
    const rows = []
    for (const it of items) {
      if (!it.str?.trim()) continue
      const y = it.transform[5], x = it.transform[4]
      let row = rows.find(r => Math.abs(r.y - y) < 3)
      if (!row) { row = { y, parts: [] }; rows.push(row) }
      row.parts.push({ x, w: it.width || 0, s: it.str })
    }
    rows.sort((a,b)=>b.y-a.y)
    // 글자가 한 자씩 따로 들어있는 PDF도 있어서, 실제 간격이 벌어진 곳에만 띄어쓰기를 넣음
    for (const r of rows) {
      let line = '', end = null
      for (const p of r.parts.sort((a,b)=>a.x-b.x)) {
        if (end !== null && p.x - end > 0.8) line += ' '
        line += p.s
        end = p.x + p.w
      }
      lines.push(line.replace(/\s+/g,' ').trim())
    }
  }
  const build = makeTxBuilder()
  const list = []
  for (const l of lines) {
    const m = l.match(PDF_ROW)
    if (!m) continue
    const out = parseAmount(m[7]), inn = parseAmount(m[8])
    if (!out && !inn) continue
    list.push(build({ date:`${m[1]}-${m[2]}-${m[3]}`, time:m[4], summary:m[5], party:(m[6]||'').trim(), memo:m[10].trim(),
      out, inn, balance: parseAmount(m[9]) }))
  }
  if (!list.length) throw new Error('PDF에서 거래내역을 찾지 못했어요. 은행 거래내역 PDF인지 확인해 주세요.')
  // 맨 위 '총 출금금액 / 총 입금금액'과 읽은 합계 비교
  const all = lines.join(' ')
  const total = re => { const m = all.replace(/\s+/g,'').match(re); return m ? parseAmount(m[1]) : null }
  const check = { out: total(/총출금금액([\d,]+)원/), in: total(/총입금금액([\d,]+)원/) }
  return { list: list.sort(byDateTime), check }
}

async function readTransactions(file, password) {
  if (/\.pdf$/i.test(file.name)) return readPdfTransactions(file, password)
  const XLSX = await import('xlsx')
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type:'array', cellDates:true })
  for (const name of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header:1, raw:true, defval:'' })
    const h = findHeader(rows)
    if (!h) continue
    const { idx } = h
    const build = makeTxBuilder()
    const list = []
    for (const r of rows.slice(h.row + 1)) {
      const date = parseDate(r[idx.date])
      if (!date) continue
      const out = parseAmount(r[idx.out])
      const inn = idx.in !== undefined ? parseAmount(r[idx.in]) : 0
      if (!out && !inn) continue
      const time = parseTime(idx.time !== undefined ? r[idx.time] : r[idx.date])
      const summary = idx.summary !== undefined ? String(r[idx.summary]).trim() : ''
      const party   = idx.party   !== undefined ? String(r[idx.party]).trim()   : ''
      const memo    = idx.memo    !== undefined ? String(r[idx.memo]).trim()    : ''
      const balance = idx.balance !== undefined ? parseAmount(r[idx.balance]) : ''
      list.push(build({ date, time, summary, party, memo, out, inn, balance }))
    }
    // 은행 엑셀은 최신순인 경우가 많아 날짜·시간 순으로 정렬
    return { list: list.sort(byDateTime), check: null }
  }
  throw new Error('거래내역 표를 찾지 못했어요. 거래일자·출금 열이 있는 은행 엑셀인지 확인해 주세요.')
}

function ruleFor(rules, tx) {
  const text = norm(tx.matchText) + '|' + norm(tx.desc)
  let best = null
  for (const r of rules) {
    const k = norm(r.keyword)
    if (k && text.includes(k) && (!best || k.length > norm(best.keyword).length)) best = r
  }
  return best?.categoryId || ''
}

const selStyle = {background:'#12141f',border:'1px solid #272a3d',borderRadius:6,color:'#dde1f2',
  padding:'5px 8px',fontSize:11,outline:'none',fontFamily:'inherit'}

export default function BankImport({ categories, onSaved }) {
  const fileRef = useRef(null)
  const [rules, setRules]   = useState([])
  const [rows, setRows]     = useState(null)   // [{...tx, cat, include, imported}]
  const [fileName, setFileName] = useState('')
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState('')
  const [withDeposits, setWithDeposits] = useState(false)
  const [done, setDone]     = useState('')
  const [check, setCheck]   = useState(null)  // PDF 총액과 읽은 합계 비교
  const [pwFile, setPwFile] = useState(null)  // 비밀번호가 필요한 PDF
  const [password, setPassword] = useState('')

  useEffect(()=>{
    getDoc(doc(db,'expenseImportRules','default'))
      .then(s=>{ if(s.exists()) setRules(s.data().list||[]) })
      .catch(e=>console.error(e))
  },[])

  async function handleFile(file, pw) {
    if (!file) return
    setErr(''); setDone(''); setBusy(true); setFileName(file.name); setCheck(null)
    try {
      const { list: txs, check: chk } = await readTransactions(file, pw)
      setPwFile(null); setPassword('')
      setCheck(chk)
      if (!txs.length) throw new Error('읽을 거래가 없어요.')
      // 이미 반영한 거래 표시
      const months = [...new Set(txs.map(t=>t.date.slice(0,7)))]
      const snaps = await Promise.all(months.map(ym=>getDoc(doc(db,'expenseImports',ym))))
      const importedKeys = new Set(snaps.flatMap(s=>s.exists() ? (s.data().keys||[]) : []))
      setRows(txs.map(t=>{
        const imported = importedKeys.has(t.key)
        return { ...t, imported, cat: t.out ? ruleFor(rules, t) : '', include: !imported }
      }))
    } catch(e) {
      console.error(e); setRows(null)
      if (e.needPassword) setPwFile(file)
      setErr(e.message || '파일을 읽지 못했어요.')
    }
    setBusy(false)
  }

  // 카테고리를 고르면 같은 내용의 (아직 반영 안 된) 출금 거래에 모두 적용
  function setCat(i, cat) {
    setRows(prev=>{
      const target = norm(prev[i].matchText)
      return prev.map((r,j)=> (j===i || (target && !r.imported && r.out && norm(r.matchText)===target)) ? { ...r, cat, include: cat!=='skip' } : r)
    })
  }
  const toggle = i => setRows(prev=>prev.map((r,j)=>j===i ? { ...r, include: !r.include } : r))

  const outs = rows ? rows.map((r,i)=>({ ...r, i })).filter(r=>r.out) : []
  const ins  = rows ? rows.map((r,i)=>({ ...r, i })).filter(r=>r.in) : []
  const pickedOut = outs.filter(r=>!r.imported && r.include && r.cat!=='skip')
  const pickedIn  = withDeposits ? ins.filter(r=>!r.imported && r.include) : []
  const unassigned = pickedOut.filter(r=>!r.cat).length

  async function save() {
    if (unassigned) return alert(`카테고리를 고르지 않은 출금이 ${unassigned}건 있어요. 고르거나 '반영 안 함'으로 바꿔주세요.`)
    if (!pickedOut.length && !pickedIn.length) return alert('반영할 거래가 없어요.')
    setBusy(true)
    try {
      const byMonth = {}
      for (const r of [...pickedOut, ...pickedIn]) (byMonth[r.date.slice(0,7)] ||= []).push(r)
      for (const [ym, list] of Object.entries(byMonth)) {
        // 저장 직전 최신 데이터 다시 읽기 (다른 화면에서 입력한 지출을 덮어쓰지 않도록)
        const [expSnap, impSnap] = await Promise.all([getDoc(doc(db,'expenses',ym)), getDoc(doc(db,'expenseImports',ym))])
        const data = expSnap.exists() ? expSnap.data() : {}
        const keys = impSnap.exists() ? (impSnap.data().keys||[]) : []
        const keySet = new Set(keys)
        for (const r of list) {
          if (keySet.has(r.key)) continue
          const dd = r.date.slice(8,10)
          const entry = { ...(data[dd]||{}) }
          categories.forEach(c=>{ if(entry[c.id]===undefined) entry[c.id]=0 })
          if (r.out) entry[r.cat] = (entry[r.cat]||0) + r.out
          else entry.deposit = (entry.deposit||0) + r.in
          data[dd] = entry
          keys.push(r.key); keySet.add(r.key)
        }
        await setDoc(doc(db,'expenses',ym), data)
        await setDoc(doc(db,'expenseImports',ym), { keys })
      }
      // 고른 카테고리를 규칙으로 저장 (내용 → 카테고리)
      const newRules = [...rules]
      for (const r of pickedOut) {
        const kw = String(r.matchText||'').trim()
        if (norm(kw).length < 2) continue
        const ex = newRules.findIndex(x=>norm(x.keyword)===norm(kw))
        if (ex >= 0) newRules[ex] = { keyword: kw, categoryId: r.cat }
        else newRules.push({ keyword: kw, categoryId: r.cat })
      }
      await setDoc(doc(db,'expenseImportRules','default'), { list: newRules })
      setRules(newRules)
      const outSum = pickedOut.reduce((a,r)=>a+r.out,0)
      const inSum  = pickedIn.reduce((a,r)=>a+r.in,0)
      setDone(`출금 ${pickedOut.length}건 ${wonFmt(outSum)}원${pickedIn.length?`, 입금 ${pickedIn.length}건 ${wonFmt(inSum)}원`:''} 반영했어요.`)
      setRows(null); setFileName('')
      if (fileRef.current) fileRef.current.value = ''
      onSaved?.()
    } catch(e) { console.error(e); alert('저장 중 오류가 발생했어요. 다시 시도해 주세요.') }
    setBusy(false)
  }

  const secs = ['재료비','관리비','인건비']
  const renderRow = (r, amount, color, showCat) => (
    <div key={r.key} style={{display:'contents'}}>
    
    <div style={{background:'#191c2b',borderRadius:8,padding:'8px 12px',display:'flex',alignItems:'center',gap:10,
      flexWrap:'wrap',opacity:r.imported || !r.include || r.cat==='skip' ? 0.45 : 1}}>
      <input type="checkbox" checked={!r.imported && r.include && r.cat!=='skip'} disabled={r.imported}
        onChange={()=> r.cat==='skip' ? setCat(r.i,'') : toggle(r.i)}
        style={{width:16,height:16,cursor:r.imported?'default':'pointer',flexShrink:0}}/>
      <span style={{fontSize:11,color:'#5e6585',fontFamily:'DM Mono,monospace',minWidth:80}}>{r.date.slice(5)} {r.time.slice(0,5)}</span>
      <span style={{flex:1,fontSize:12,color:'#dde1f2',minWidth:120}}>{r.desc || '—'}</span>
      <span style={{fontSize:13,fontWeight:700,color,fontFamily:'DM Mono,monospace',minWidth:90,textAlign:'right'}}>{wonFmt(amount)}원</span>
      {r.imported ? (
        <span style={{fontSize:10,color:'#5e6585',minWidth:110,textAlign:'center'}}>✓ 이미 반영됨</span>
      ) : showCat && (
        <select value={r.cat} onChange={e=>setCat(r.i, e.target.value)}
          style={{...selStyle, minWidth:110, borderColor: r.include && !r.cat ? '#f87171' : '#272a3d'}}>
          <option value="">— 카테고리 —</option>
          {secs.map(sec=>(
            <optgroup key={sec} label={sec}>
              {categories.filter(c=>c.sec===sec).map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
            </optgroup>
          ))}
          <option value="skip">반영 안 함</option>
        </select>
      )}
    </div>
    </div>
  )

  return (
    <div style={{padding:18}}>
      <div style={{fontSize:12,color:'#5e6585',marginBottom:14,lineHeight:1.7}}>
        인터넷뱅킹에서 받은 <b style={{color:'#dde1f2'}}>거래내역 엑셀(.xls / .xlsx / .csv) 또는 PDF</b>를 올리면 출금을 지출 카테고리별로 정리해요.<br/>
        한 번 고른 카테고리는 기억해서 다음부터 자동으로 골라줘요. 같은 파일을 다시 올려도 중복 반영되지 않아요.
      </div>

      <div onClick={()=>!busy && fileRef.current?.click()}
        style={{border:'2px dashed #272a3d',borderRadius:10,padding:'24px',textAlign:'center',cursor:busy?'default':'pointer',marginBottom:14}}>
        <div style={{fontSize:28,marginBottom:6}}>📑</div>
        <div style={{fontSize:13,color:'#dde1f2'}}>{busy ? '읽는 중...' : fileName || '클릭해서 거래내역 파일 선택 (엑셀·PDF)'}</div>
      </div>
      <input ref={fileRef} type="file" accept=".xls,.xlsx,.csv,.pdf" style={{display:'none'}}
        onChange={e=>handleFile(e.target.files?.[0])}/>
      {err && <div style={{fontSize:12,color:'#f87171',marginBottom:12}}>{err}</div>}
      {pwFile && (
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',marginBottom:14}}>
          <input type="password" autoFocus value={password} onChange={e=>setPassword(e.target.value)}
            onKeyDown={e=>e.key==='Enter' && handleFile(pwFile, password)}
            placeholder="PDF 비밀번호" autoComplete="off"
            style={{...selStyle,padding:'8px 10px',fontSize:12,width:180}}/>
          <button onClick={()=>handleFile(pwFile, password)} disabled={busy||!password}
            style={{background:'#f9b934',color:'#000',border:'none',borderRadius:7,padding:'8px 16px',
              fontSize:12,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>열기</button>
          <span style={{fontSize:10,color:'#5e6585'}}>비밀번호는 이 화면에서 파일을 여는 데만 쓰고 저장하지 않아요</span>
        </div>
      )}
      {done && <div style={{fontSize:12,color:'#34d399',marginBottom:12}}>✅ {done}</div>}

      {rows && (
        <>
          {check && (check.out!==null || check.in!==null) && (()=>{
            const outSum = outs.reduce((a,r)=>a+r.out,0), inSum = ins.reduce((a,r)=>a+r.in,0)
            const ok = (check.out===null || check.out===outSum) && (check.in===null || check.in===inSum)
            return (
              <div style={{fontSize:11,marginBottom:12,padding:'8px 12px',borderRadius:8,
                background: ok ? 'rgba(52,211,153,0.08)' : 'rgba(248,113,113,0.1)', color: ok ? '#34d399' : '#f87171'}}>
                {ok ? '✅ PDF의 총 출금·입금 금액과 읽은 합계가 일치해요'
                    : `⚠️ PDF 총액과 다르게 읽혔어요 (총 출금 ${wonFmt(check.out)}원 / 읽은 출금 ${wonFmt(outSum)}원, 총 입금 ${wonFmt(check.in)}원 / 읽은 입금 ${wonFmt(inSum)}원). 빠진 거래가 있을 수 있으니 알려주세요.`}
              </div>
            )
          })()}
          <div style={{fontSize:12,fontWeight:600,marginBottom:8,display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:6}}>
            <span style={{color:'#f87171'}}>💸 출금 {outs.length}건</span>
            <span style={{color:'#5e6585',fontWeight:400}}>
              반영 예정 {pickedOut.length}건 · {wonFmt(pickedOut.reduce((a,r)=>a+r.out,0))}원
              {unassigned>0 && <b style={{color:'#f87171',marginLeft:6}}>미분류 {unassigned}건</b>}
            </span>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:16}}>
            {outs.map(r=>renderRow(r, r.out, '#f87171', true))}
          </div>

          {ins.length > 0 && (
            <div style={{marginBottom:16}}>
              <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,fontWeight:600,color:'#34d399',cursor:'pointer',marginBottom:8}}>
                <input type="checkbox" checked={withDeposits} onChange={e=>setWithDeposits(e.target.checked)} style={{width:16,height:16}}/>
                💰 입금 {ins.length}건도 '실입금액'에 반영
                <span style={{fontSize:10,color:'#5e6585',fontWeight:400}}>(배달앱 정산·카드 입금 등. 대여금처럼 매출이 아닌 입금은 체크 해제)</span>
              </label>
              {withDeposits && (
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  {ins.map(r=>renderRow(r, r.in, '#34d399', false))}
                </div>
              )}
            </div>
          )}

          <div style={{display:'flex',gap:8}}>
            <button onClick={save} disabled={busy}
              style={{flex:1,background:'#34d399',color:'#000',border:'none',borderRadius:8,padding:'11px',
                fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              {busy ? '저장 중...' : '💾 지출관리에 반영'}
            </button>
            <button onClick={()=>{ setRows(null); setFileName(''); if(fileRef.current) fileRef.current.value='' }}
              style={{background:'#191c2b',color:'#5e6585',border:'1px solid #272a3d',borderRadius:8,
                padding:'11px 16px',fontSize:12,cursor:'pointer',fontFamily:'inherit'}}>
              취소
            </button>
          </div>
        </>
      )}
    </div>
  )
}
