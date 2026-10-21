import { useEffect, useRef, useState } from 'react'
import { db } from '../firebase'
import { doc, getDoc, setDoc } from 'firebase/firestore'

// 은행 거래내역 엑셀(.xls/.xlsx/.csv) 또는 PDF(국민은행 '계좌 거래내역 조회', 비밀번호 가능)를 읽어
// 출금은 지출 카테고리로 더하고, 입금은 조회기간의 날짜별 실입금액(deposit)을 PDF 합계로 '맞춤'(더하지 않고 바꿈)
//  - 같은 출금을 두 번 올려도 중복 반영되지 않도록 반영한 거래 키를 expenses/{YYYY-MM}.importedKeys 에 같이 저장
//    (지출과 같은 문서에 한 번에 쓰므로, 지출만 저장되고 중복 방지 기록은 빠지는 일이 없음)
//  - 사용자가 고른 카테고리는 expenseImportRules/default 에 "내용 → 카테고리" 규칙으로 저장해 다음 달부터 자동 선택
//    (규칙 저장이 안 돼도 지출 반영에는 영향 없음)
//  - 지출·실입금이 아닌 돈(대여금·투자/정산·개인 이체 등)은 '영업 외 거래'로 expenses/{YYYY-MM}.nonOp 에 기록
//    예금주(김기억 = 앱의 '형')와 주고받은 돈은 기본으로 대여금 → '형과의 단기 대여금' 장부(loans/hyung)에도 기록
//    (장부에 같은 날짜·금액·종류가 이미 있으면 장부에는 다시 쓰지 않음)
//  - 올린 거래는 모두 expenses/{YYYY-MM}.bankSeen 에 남겨서 그 달 통장 시작/끝 잔액을 계산 (통장 잔액 맞추기)

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
  const compact = all.replace(/\s+/g,'')
  const pm = compact.match(/조회기간:?(\d{4})\.(\d{2})\.(\d{2})~(\d{4})\.(\d{2})\.(\d{2})/)
  const hm = compact.match(/예금주([^(（]+)/)
  const check = { out: total(/총출금금액([\d,]+)원/), in: total(/총입금금액([\d,]+)원/),
    period: pm ? [`${pm[1]}-${pm[2]}-${pm[3]}`, `${pm[4]}-${pm[5]}-${pm[6]}`] : null,
    holder: hm ? hm[1] : '' }
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

// 규칙: 출금은 { keyword, categoryId }(카테고리 id 또는 '__loan'·'__nonop_*'),
//       입금은 { keyword, categoryId:'in:<include|__loan|__nonop_*|none>' } (예전 '__skip_in'·'__in'도 읽음)
const isDepositRule = x => { const c = String(x.categoryId||''); return c.startsWith('in:') || c==='__skip_in' || c==='__in' }
const depRuleValue = c => c==='__skip_in' ? '__nonop_other' : c==='__in' ? 'include' : String(c||'').slice(3)
function ruleFor(rules, tx) {
  const text = norm(tx.matchText) + '|' + norm(tx.desc)
  let best = null
  for (const r of rules) {
    const k = norm(r.keyword)
    if (k && text.includes(k) && (!best || k.length > norm(best.keyword).length)) best = r
  }
  return best?.categoryId || ''
}

// 지출관리 '고정지출'(임대료 등)과 같은 출금 찾기 — 같은 달, 같은 금액, 납부 예정일에 가장 가까운 1건
//  - 이미 고정지출에서 납부 처리했으면 그 금액이 지출에 들어가 있으므로 중복이라 기본 제외
//  - 아직 납부 처리 전이면, 반영할 때 고정지출도 그 날짜로 납부 처리 (지출은 한 번만 더해짐)
function matchFixed(txs, fixedItems, paysByMonth) {
  const out = new Map()
  for (const ym of new Set(txs.map(t=>t.date.slice(0,7)))) {
    const pays = paysByMonth[ym] || {}
    for (const item of fixedItems) {
      if (!item.amount) continue
      const cands = txs.filter(t => t.out === item.amount && t.date.startsWith(ym) && !out.has(t.key))
      if (!cands.length) continue
      const best = cands.sort((a,b)=>Math.abs(+a.date.slice(8)-(item.dueDay||1)) - Math.abs(+b.date.slice(8)-(item.dueDay||1)))[0]
      const p = pays[item.id]
      out.set(best.key, { id:item.id, label:item.label, categoryId:item.categoryId || 'omg', paid: !!p?.paid, paidDate: p?.paidDate || '' })
    }
  }
  return out
}

const NONOP_KINDS = [
  { value:'__loan',           kind:'loan',     label:'🤝 대여금(형)' },
  { value:'__nonop_invest',   kind:'invest',   label:'💼 투자·정산' },
  { value:'__nonop_personal', kind:'personal', label:'👤 개인 이체' },
  { value:'__nonop_other',    kind:'other',    label:'📎 기타 영업외' },
]
const kindOf = v => NONOP_KINDS.find(k=>k.value===v)?.kind
// 대여금 장부(loans/{id})와 연결되는 종류 · 보낸분/받는분 이름으로 자동 인식
//   형(김기억) = 예금주 이름. '홍콩반점0410 상'(상암점 계좌)으로 오간 돈도 결국 형이 가져가는 돈이라 같은 형 대여금으로 봄
const LEDGERS = { '__loan': 'hyung' }
const isSangam = t => norm(t.matchText).startsWith('홍콩반점0410상')
// 기본 카테고리 (사용자가 고른 규칙이 없을 때): '홍콩반점0410중'은 본사 물류대금 가상계좌 → 본사발주
const builtinCat = (t, categories) => norm(t.matchText).startsWith('홍콩반점0410중') && categories.some(c=>c.id==='hq') ? 'hq' : ''
const isNonOp = v => !!kindOf(v)

const selStyle = {background:'#12141f',border:'1px solid #272a3d',borderRadius:6,color:'#dde1f2',
  padding:'5px 8px',fontSize:11,outline:'none',fontFamily:'inherit'}

export default function BankImport({ categories, onSaved }) {
  const fileRef = useRef(null)
  const [rules, setRules]   = useState([])
  const [rows, setRows]     = useState(null)
  const [fileName, setFileName] = useState('')
  const [busy, setBusy]     = useState(false)
  const [err, setErr]       = useState('')
  const [withDeposits, setWithDeposits] = useState(true)  // 실입금액을 PDF 입금으로 맞출지
  const [existingDep, setExistingDep]   = useState({})    // 'YYYY-MM-DD' → 지금 앱에 적힌 실입금액
  const [period, setPeriod]             = useState(null)  // [시작일, 끝일]
  const [showDepRows, setShowDepRows]   = useState(false)
  const [done, setDone]     = useState('')
  const [check, setCheck]   = useState(null)  // PDF 총액과 읽은 합계 비교
  const [pwFile, setPwFile] = useState(null)  // 비밀번호가 필요한 PDF
  const [password, setPassword] = useState('')
  const [rulesOk, setRulesOk]   = useState(true)  // 카테고리 기억 규칙을 읽고 쓸 수 있는지

  useEffect(()=>{
    getDoc(doc(db,'expenseImportRules','default'))
      .then(s=>{ if(s.exists()) setRules(s.data().list||[]) })
      .catch(e=>{ console.error(e); setRulesOk(false) })
  },[])

  async function handleFile(file, pw) {
    if (!file) return
    setErr(''); setDone(''); setBusy(true); setFileName(file.name); setCheck(null)
    try {
      const { list: txs, check: chk } = await readTransactions(file, pw)
      setPwFile(null); setPassword('')
      setCheck(chk)
      if (!txs.length) throw new Error('읽을 거래가 없어요.')
      const months = [...new Set(txs.map(t=>t.date.slice(0,7)))]
      const snaps = await Promise.all(months.map(ym=>getDoc(doc(db,'expenses',ym))))
      const docs = snaps.map(s=>s.exists() ? s.data() : {})
      const importedKeys = new Set(docs.flatMap(d=>d.importedKeys||[]))
      const nonOpByKey = new Map(docs.flatMap(d=>(d.nonOp||[]).map(x=>[x.key, x])))
      const dep = {}
      docs.forEach((d,i)=>{
        for (const [dd, e] of Object.entries(d)) if (/^\d{2}$/.test(dd) && e?.deposit) dep[`${months[i]}-${dd}`] = e.deposit
      })
      setExistingDep(dep)
      const dates = txs.map(t=>t.date).sort()
      setPeriod(chk?.period || [dates[0], dates[dates.length-1]])
      setShowDepRows(false)
      const depRules = rules.filter(isDepositRule), outRules = rules.filter(x=>!isDepositRule(x))
      const holder = norm(chk?.holder)
      const isHolder = t => holder && norm(t.matchText) === holder
      // 대여금 장부(형·상암점): 이미 있는 기록(직접 적었거나 전에 가져온 것)과 겹치는지 확인용
      const ledgers = {}
      for (const id of Object.values(LEDGERS)) {
        try { const ls = await getDoc(doc(db,'loans',id)); ledgers[id] = ls.exists() ? (ls.data().list||[]) : [] }
        catch(e) { console.error(e); ledgers[id] = [] }
      }
      const ledgerKeys = new Set(Object.values(ledgers).flat().map(x=>x.bankKey).filter(Boolean))
      const ledgerHas = (t, type, id='hyung') => ledgerKeys.has(t.key) ||
        ledgers[id].some(x=>x.type===type && x.date===t.date && x.amount===(type==='lent'?t.out:t.in))
      // 고정지출 항목·이번 달 납부 기록 (못 읽어도 가져오기는 계속)
      let fixedMap = new Map()
      try {
        const [cfg, ...paySnaps] = await Promise.all([getDoc(doc(db,'fixedExpenses','config')), ...months.map(ym=>getDoc(doc(db,'fixedExpenses',ym)))])
        const items = cfg.exists() ? (cfg.data().list||[]) : []
        const pays = Object.fromEntries(months.map((ym,i)=>[ym, paySnaps[i].exists() ? paySnaps[i].data() : {}]))
        fixedMap = matchFixed(txs.filter(t=>t.out && !importedKeys.has(t.key) && !nonOpByKey.has(t.key)), items, pays)
      } catch(e) { console.error(e) }
      const kindValue = k => k==='loan_sangam' ? '__loan' : (NONOP_KINDS.find(x=>x.kind===k)?.value || '__nonop_other')
      setRows(txs.map(t=>{
        const rec = nonOpByKey.get(t.key)
        if (!t.out) {
          // 입금: 실입금은 날짜별로 다시 맞추는 방식. 영업 외로 뺄 입금은 종류(kind)를 골라 기록
          if (rec) return { ...t, include:false, kind: kindValue(rec.kind), recorded:true }
          const rv = depRuleValue(ruleFor(depRules, t))
          if (rv === 'include') return { ...t, include:true, kind:'__nonop_other' }
          if (rv && rv !== 'none') return { ...t, include:false, kind: rv }
          if (rv === 'none') return { ...t, include:false, kind:'' }
          if (isHolder(t)) return { ...t, include:false, kind:'__loan', selfTransfer:true, loanDup: ledgerHas(t,'received') }
          if (isSangam(t)) return { ...t, include:false, kind:'__loan', sangam:true, loanDup: ledgerHas(t,'received') }
          return { ...t, include:true, kind:'__nonop_other' }
        }
        if (rec) return { ...t, imported:true, cat: kindValue(rec.kind), include:false }
        // 예전 버전에서 대여금 장부로만 보낸 출금: 영업 외 거래 기록이 없으니 다시 반영할 수 있게 (장부에는 다시 안 씀)
        if (importedKeys.has(t.key) && ledgerKeys.has(t.key)) return { ...t, cat:'__loan', include:true, loanDup:true }
        const imported = importedKeys.has(t.key)
        if (imported) return { ...t, imported:true, cat:'', include:false }
        if (isHolder(t)) return { ...t, cat:'__loan', include:true, loanDup: ledgerHas(t,'lent') }
        if (isSangam(t)) return { ...t, cat:'__loan', include:true, sangam:true, loanDup: ledgerHas(t,'lent') }
        const fixed = fixedMap.get(t.key)
        if (fixed) return { ...t, fixed, cat: fixed.paid ? 'skip' : fixed.categoryId, include: !fixed.paid }
        return { ...t, cat: ruleFor(outRules, t) || builtinCat(t, categories), include:true }
      }))
    } catch(e) {
      console.error(e); setRows(null)
      if (e.needPassword) setPwFile(file)
      setErr(e.message || '파일을 읽지 못했어요.')
    }
    setBusy(false)
  }

  // 카테고리를 고르면 그 줄만 바뀜. 같은 이름의 다른 줄은 아직 아무것도 안 고른 빈칸일 때만 같이 채움
  // (동명이인·같은 업체라도 목적이 다를 수 있어서, 이미 골라진 줄은 건드리지 않음)
  function setCat(i, cat) {
    setRows(prev=>{
      const target = norm(prev[i].matchText)
      return prev.map((r,j)=> (j===i || (cat && cat!=='skip' && target && !r.imported && !r.fixed && r.out && !r.cat && r.include && norm(r.matchText)===target))
        ? { ...r, cat, include: cat!=='skip' } : r)
    })
  }
  const toggle = i => setRows(prev=>prev.map((r,j)=>j===i ? { ...r, include: !r.include } : r))
  // 입금 포함/제외·종류 — 그 줄만 바뀜 (같은 이름이라도 목적이 다를 수 있음)
  const updateDeposit = (i, patch) => setRows(prev=>prev.map((r,j)=> j===i ? { ...r, ...patch, selfTransfer:false } : r))

  const outs = rows ? rows.map((r,i)=>({ ...r, i })).filter(r=>r.out) : []
  const ins  = rows ? rows.map((r,i)=>({ ...r, i })).filter(r=>r.in) : []
  const pickedOut = outs.filter(r=>!r.imported && r.include && r.cat!=='skip')
  const unassigned = pickedOut.filter(r=>!r.cat).length
  const expOut   = pickedOut.filter(r=>r.cat && !isNonOp(r.cat))
  const nonOpOut = pickedOut.filter(r=>isNonOp(r.cat))
  const nonOpIn  = ins.filter(r=>!r.include && !r.recorded && isNonOp(r.kind))

  // 조회기간 날짜별: 지금 적힌 실입금액 vs PDF 입금 합계(제외한 건 빼고)
  const depDays = []
  if (rows && period) {
    const pdfByDay = {}
    for (const r of ins) if (r.include) pdfByDay[r.date] = (pdfByDay[r.date]||0) + r.in
    for (let d = new Date(period[0]+'T00:00:00'); ; d.setDate(d.getDate()+1)) {
      const key = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`
      if (key > period[1]) break
      depDays.push({ date:key, cur: existingDep[key]||0, pdf: pdfByDay[key]||0 })
    }
  }
  const depChanged = withDeposits ? depDays.filter(d=>d.cur!==d.pdf) : []

  async function save() {
    if (!expOut.length && !nonOpOut.length && !nonOpIn.length && !depChanged.length) {
      // 처리할 게 없어도 통장 잔액 맞추기용 거래 기록(bankSeen)은 남김
      if (!window.confirm(unassigned ? '카테고리를 고른 출금이 없어요. 통장 잔액 맞추기용 거래 기록만 저장할까요?' : '바뀔 내용은 없어요. 통장 잔액 맞추기용 거래 기록만 저장할까요?')) return
    } else if (unassigned && !window.confirm(`카테고리를 안 고른 출금 ${unassigned}건은 빼고 나머지만 지금 반영할까요?\n빠진 건은 화면에 남아 있고, 나중에 같은 파일을 다시 올려도 다시 나와요.`)) return
    setBusy(true)
    try {
      const months = [...new Set(rows.map(r=>r.date.slice(0,7)))].sort()
      const savedKeys = new Set()
      for (const ym of months) {
        // 저장 직전 최신 데이터 다시 읽기 (다른 화면에서 입력한 지출을 덮어쓰지 않도록)
        const snap = await getDoc(doc(db,'expenses',ym))
        const data = snap.exists() ? snap.data() : {}
        const keys = [...(data.importedKeys||[])], keySet = new Set(keys)
        const nonOp = [...(data.nonOp||[])], nonOpKeys = new Set(nonOp.map(x=>x.key))
        for (const r of expOut.filter(r=>r.date.startsWith(ym))) {
          if (keySet.has(r.key)) { savedKeys.add(r.key); continue }
          const dd = r.date.slice(8,10)
          const entry = { ...(data[dd]||{}) }
          categories.forEach(c=>{ if(entry[c.id]===undefined) entry[c.id]=0 })
          entry[r.cat] = (entry[r.cat]||0) + r.out
          data[dd] = entry
          keys.push(r.key); keySet.add(r.key); savedKeys.add(r.key)
        }
        // 이미 납부 처리된 고정지출과 같은 출금: 지출은 이미 들어가 있으니 금액은 더하지 않고 연결만 (통장 잔액 맞추기에서 '정리 안 된 출금'으로 안 나오게)
        for (const r of rows.filter(r=>r.out && r.fixed?.paid && r.cat==='skip' && r.date.startsWith(ym)))
          if (!keySet.has(r.key)) { keys.push(r.key); keySet.add(r.key) }
        // 영업 외 거래 (지출·실입금에 안 들어가는 돈) — 통장 잔액 맞추기에 쓰임
        for (const r of [...nonOpOut, ...nonOpIn].filter(r=>r.date.startsWith(ym))) {
          savedKeys.add(r.key)
          if (nonOpKeys.has(r.key)) continue
          nonOp.push({ key:r.key, date:r.date, dir: r.out ? 'out' : 'in', amount: r.out || r.in,
            kind: kindOf(r.out ? r.cat : r.kind), desc: r.desc })
          nonOpKeys.add(r.key)
        }
        // 실입금액: 조회기간 날짜는 PDF 입금 합계로 바꿈 (더하지 않으므로 여러 번 올려도 같음)
        for (const d of depChanged.filter(d=>d.date.startsWith(ym))) {
          const dd = d.date.slice(8,10)
          if (!data[dd] && !d.pdf) continue
          const entry = { ...(data[dd]||{}) }
          categories.forEach(c=>{ if(entry[c.id]===undefined) entry[c.id]=0 })
          entry.deposit = d.pdf
          data[dd] = entry
        }
        // 통장 거래 기록 (여러 번 나눠 올려도 합쳐짐)
        data.bankSeen = [...new Set([...(data.bankSeen||[]), ...rows.filter(r=>r.date.startsWith(ym)).map(r=>r.key)])]
        if (keys.length) data.importedKeys = keys
        if (nonOp.length) data.nonOp = nonOp
        await setDoc(doc(db,'expenses',ym), data)
        // 고정지출과 연결된 출금은 고정지출도 실제 출금일로 납부 처리 (지출관리에서 다시 '납부'를 눌러 중복되는 일이 없게)
        const fixedPaid = {}
        for (const r of expOut) if (r.date.startsWith(ym) && r.fixed && !r.fixed.paid) fixedPaid[r.fixed.id] = { paid:true, paidDate: r.date.slice(8,10), amount: r.out }
        if (Object.keys(fixedPaid).length) await setDoc(doc(db,'fixedExpenses',ym), fixedPaid, { merge:true })
      }
      // 대여금 장부(형·상암점)에 기록 (저장 직전 다시 읽고, 이미 있는 거래는 건너뜀)
      let loanCount = 0
      let n = Date.now()
      for (const [value, id] of Object.entries(LEDGERS)) {
        const loanNew = [
          ...nonOpOut.filter(r=>r.cat===value && !r.loanDup).map(r=>({ type:'lent', amount:r.out, r })),
          ...nonOpIn.filter(r=>r.kind===value && !r.loanDup).map(r=>({ type:'received', amount:r.in, r })),
        ]
        if (!loanNew.length) continue
        const ls = await getDoc(doc(db,'loans',id))
        const list = ls.exists() ? (ls.data().list||[]) : []
        const have = new Set(list.map(x=>x.bankKey).filter(Boolean))
        for (const { type, amount, r } of loanNew) {
          if (have.has(r.key)) continue
          list.push({ id: String(n++), date: r.date, type, amount, memo: `${r.sangam ? '[상암점 계좌] ' : ''}계좌내역 자동 기록 (${r.desc})`, bankKey: r.key })
          have.add(r.key); loanCount++
        }
        list.sort((a,b)=>a.date.localeCompare(b.date))
        await setDoc(doc(db,'loans',id), { list })
      }
      // 고른 카테고리·종류를 규칙으로 저장. 실패해도 반영은 이미 끝남
      const newRules = [...rules]
      const upsert = (kw, categoryId, deposit) => {
        if (norm(kw).length < 2) return
        const ex = newRules.findIndex(x=>norm(x.keyword)===norm(kw) && isDepositRule(x)===deposit)
        if (ex >= 0) newRules[ex] = { keyword: kw, categoryId }
        else newRules.push({ keyword: kw, categoryId })
      }
      // 같은 이름에 이번에 서로 다른 걸 골랐으면 기억하지 않음 (다음에 엉뚱하게 자동 선택되지 않게) + 기존 기억도 지움
      const removeRule = (kw, deposit) => {
        const ex = newRules.findIndex(x=>norm(x.keyword)===norm(kw) && isDepositRule(x)===deposit)
        if (ex >= 0) newRules.splice(ex, 1)
      }
      const outChoices = new Map()
      for (const r of pickedOut) if (r.cat && !r.fixed) {
        const kw = String(r.matchText||'').trim()
        ;(outChoices.get(norm(kw)) || outChoices.set(norm(kw), { kw, set:new Set() }).get(norm(kw))).set.add(r.cat)
      }
      for (const { kw, set } of outChoices.values()) set.size === 1 ? upsert(kw, [...set][0], false) : removeRule(kw, false)
      const inChoices = new Map()
      for (const r of ins) {
        if (r.recorded || r.selfTransfer || r.sangam) continue
        const kw = String(r.matchText||'').trim()
        ;(inChoices.get(norm(kw)) || inChoices.set(norm(kw), { kw, set:new Set() }).get(norm(kw))).set.add(r.include ? 'include' : (r.kind || 'none'))
      }
      for (const { kw, set } of inChoices.values()) {
        const hadRule = newRules.some(x=>isDepositRule(x) && norm(x.keyword)===norm(kw))
        if (set.size > 1) { removeRule(kw, true); continue }
        const v = [...set][0]
        if (v !== 'include') upsert(kw, `in:${v}`, true)
        else if (hadRule) upsert(kw, 'in:include', true)
      }
      setRules(newRules)
      try { await setDoc(doc(db,'expenseImportRules','default'), { list: newRules }); setRulesOk(true) }
      catch(e) { console.error(e); setRulesOk(false) }

      const parts = []
      if (expOut.length) parts.push(`지출 ${expOut.length}건 ${wonFmt(expOut.reduce((a,r)=>a+r.out,0))}원`)
      if (nonOpOut.length + nonOpIn.length) parts.push(`영업 외 거래 ${nonOpOut.length + nonOpIn.length}건${loanCount?`(대여금 장부 ${loanCount}건 포함)`:''}`)
      if (depChanged.length) parts.push(`실입금액 ${depChanged.length}일치를 PDF 기준으로 맞춤`)
      setDone(`${months.map(m=>`${+m.slice(5)}월`).join('·')} 지출관리에 ${parts.length ? parts.join(', ') + ' 반영했어요.' : '통장 거래 기록을 저장했어요.'}`)
      setExistingDep(prev=>{ const n = { ...prev }; for (const d of depChanged) n[d.date] = d.pdf; return n })
      const remaining = rows.filter(r=>r.out && !savedKeys.has(r.key) && !r.imported && r.cat!=='skip')
      if (remaining.length === 0) { setRows(null); setFileName(''); if (fileRef.current) fileRef.current.value = '' }
      else setRows(prev=>prev.map(r=> !savedKeys.has(r.key) ? r : r.out ? { ...r, imported:true, include:false } : { ...r, recorded:true }))
      onSaved?.(months)
    } catch(e) {
      console.error(e)
      alert(e?.code === 'permission-denied'
        ? '저장 권한이 없어요. Firebase 보안 규칙에서 expenses 쓰기가 허용돼 있는지 확인해 주세요.'
        : '저장 중 오류가 발생했어요. 다시 시도해 주세요.')
    }
    setBusy(false)
  }

  const secs = ['재료비','관리비','인건비']
  const nonOpOptions = NONOP_KINDS.map(k=><option key={k.value} value={k.value}>{k.label}</option>)
  const renderRow = (r, amount, color, showCat) => {
    const dim = r.imported || r.recorded || (!r.out && !r.include) || r.cat==='skip'
    return (
      <div key={r.key} style={{background:'#191c2b',borderRadius:8,padding:'8px 12px',display:'flex',alignItems:'center',gap:10,
        flexWrap:'wrap',opacity: dim ? (r.fixed?.paid || (!r.out && !r.recorded) ? 0.8 : 0.45) : 1}}>
        <input type="checkbox" checked={r.out ? (!r.imported && r.include && r.cat!=='skip') : r.include}
          disabled={r.imported || r.recorded}
          onChange={()=> !r.out ? updateDeposit(r.i, { include: !r.include })
            : r.cat==='skip' ? setCat(r.i, r.fixed?.categoryId || '') : toggle(r.i)}
          style={{width:16,height:16,cursor:r.imported||r.recorded?'default':'pointer',flexShrink:0}}/>
        <span style={{fontSize:11,color:'#5e6585',fontFamily:'DM Mono,monospace',minWidth:80}}>{r.date.slice(5)} {r.time.slice(0,5)}</span>
        <span style={{flex:1,fontSize:12,color:'#dde1f2',minWidth:120}}>
          {r.desc || '—'}
          {r.fixed && (
            <span style={{display:'block',fontSize:10,marginTop:2,color: r.fixed.paid ? '#5e6585' : '#93c5fd'}}>
              📌 고정지출 '{r.fixed.label}' {r.fixed.paid
                ? `— ${+r.fixed.paidDate || ''}일 납부 처리돼 있어서 중복이라 제외했어요`
                : '— 반영하면 고정지출도 이 날짜로 납부 처리돼요'}
            </span>
          )}
          {r.loanDup && !r.imported && !r.recorded && (
            <span style={{display:'block',fontSize:10,marginTop:2,color:'#5e6585'}}>대여금 장부에 이미 같은 기록이 있어서 장부에는 다시 쓰지 않아요</span>
          )}
          {r.selfTransfer && <span style={{display:'block',fontSize:10,marginTop:2,color:'#5e6585'}}>예금주(형) 본인 이체라 실입금에서 뺐어요</span>}
          {r.sangam && !r.imported && !r.recorded && <span style={{display:'block',fontSize:10,marginTop:2,color:'#93c5fd'}}>상암점 계좌로 형과 주고받은 돈이라 형과의 대여금으로 보내요</span>}
        </span>
        <span style={{fontSize:13,fontWeight:700,color,fontFamily:'DM Mono,monospace',minWidth:90,textAlign:'right'}}>{wonFmt(amount)}원</span>
        {(r.imported || r.recorded) ? (
          <span style={{fontSize:10,color:'#5e6585',minWidth:110,textAlign:'center'}}>
            ✓ 이미 반영됨{(r.recorded || isNonOp(r.cat)) ? ` (${NONOP_KINDS.find(k=>k.value===(r.out?r.cat:r.kind))?.label||'영업외'})` : ''}
          </span>
        ) : showCat ? (
          <select value={r.cat} onChange={e=>setCat(r.i, e.target.value)}
            style={{...selStyle, minWidth:110, borderColor: r.include && !r.cat ? '#f87171' : '#272a3d'}}>
            <option value="">— 카테고리 —</option>
            {secs.map(sec=>(
              <optgroup key={sec} label={sec}>
                {categories.filter(c=>c.sec===sec).map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
              </optgroup>
            ))}
            <optgroup label="영업 외 (지출 아님 · 통장 잔액 맞추기에만)">{nonOpOptions}</optgroup>
            <option value="skip">반영 안 함 (이미 직접 적은 지출 등)</option>
          </select>
        ) : !r.include && (
          <select value={r.kind||''} onChange={e=>updateDeposit(r.i, { kind: e.target.value })}
            style={{...selStyle, minWidth:150}}>
            <optgroup label="영업 외 입금으로 기록">{nonOpOptions}</optgroup>
            <option value="">기록 안 함</option>
          </select>
        )}
      </div>
    )
  }

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
          {pickedOut.length + depChanged.length + nonOpIn.length > 0 && (
            <div style={{fontSize:11,marginBottom:12,padding:'8px 12px',borderRadius:8,background:'rgba(249,185,52,0.08)',color:'#f9b934'}}>
              ⚠️ 아직 저장 전이에요. 카테고리를 고른 뒤 맨 아래 <b>"지출관리에 반영"</b>을 눌러야 지출관리에 들어가요. 다 못 골라도 고른 것만 먼저 반영할 수 있어요.
            </div>
          )}
          {!rulesOk && (
            <div style={{fontSize:11,marginBottom:12,color:'#5e6585'}}>
              ℹ️ 카테고리 기억 기능을 쓸 수 없어요(Firebase 보안 규칙에 expenseImportRules 허용 필요). 지출 반영은 정상적으로 돼요.
            </div>
          )}
          {ins.length > 0 && period && (()=>{
            const curSum = depDays.reduce((a,d)=>a+d.cur,0), pdfSum = depDays.reduce((a,d)=>a+d.pdf,0)
            const excluded = ins.filter(r=>!r.include)
            const shownDays = depDays.filter(d=>d.cur || d.pdf)
            return (
              <div style={{marginBottom:16,background:'rgba(52,211,153,0.04)',border:'1px solid rgba(52,211,153,0.2)',borderRadius:10,padding:12}}>
                <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,fontWeight:600,color:'#34d399',cursor:'pointer'}}>
                  <input type="checkbox" checked={withDeposits} onChange={e=>setWithDeposits(e.target.checked)} style={{width:16,height:16}}/>
                  💰 실입금액을 PDF 입금으로 맞추기 ({+period[0].slice(5,7)}/{+period[0].slice(8)} ~ {+period[1].slice(5,7)}/{+period[1].slice(8)})
                </label>
                <div style={{fontSize:10,color:'#5e6585',margin:'6px 0 10px 24px',lineHeight:1.6}}>
                  이 기간 날짜별 실입금액을 아래 'PDF' 금액으로 <b>바꿔요</b>(더하지 않아요). 직접 적어둔 금액은 PDF 금액으로 대체돼요.<br/>
                  매출이 아닌 입금(형 대여금·투자금·개인 이체 등)은 아래 입금 내역에서 체크를 빼고 종류를 고르면 '영업 외 거래'로 기록돼요. 다음부터 자동으로 빠져요.
                </div>
                {withDeposits && (
                  <>
                    <div style={{display:'flex',gap:16,flexWrap:'wrap',fontSize:12,marginBottom:8}}>
                      <span style={{color:'#5e6585'}}>지금 적힌 합계 <b style={{color:'#dde1f2',fontFamily:'DM Mono,monospace'}}>{wonFmt(curSum)}원</b></span>
                      <span style={{color:'#5e6585'}}>PDF 기준 합계 <b style={{color:'#34d399',fontFamily:'DM Mono,monospace'}}>{wonFmt(pdfSum)}원</b></span>
                      <span style={{color: depChanged.length ? '#f9b934' : '#34d399'}}>{depChanged.length ? `${depChanged.length}일 금액이 달라요` : '✅ 모든 날짜가 일치해요'}</span>
                    </div>
                    <div style={{maxHeight:240,overflowY:'auto',border:'1px solid #272a3d',borderRadius:8,marginBottom:8}}>
                      <table style={{width:'100%',borderCollapse:'collapse',fontSize:11}}>
                        <thead><tr style={{background:'#191c2b',color:'#5e6585'}}>
                          {['날짜','지금 적힌 금액','PDF 금액','차이'].map((h,i)=><th key={h} style={{padding:'6px 10px',textAlign:i?'right':'left',fontWeight:600}}>{h}</th>)}
                        </tr></thead>
                        <tbody>
                          {shownDays.map(d=>{
                            const diff = d.pdf - d.cur
                            return (
                              <tr key={d.date} style={{background: diff ? 'rgba(249,185,52,0.06)' : 'transparent'}}>
                                <td style={{padding:'5px 10px',borderTop:'1px solid #272a3d',color:'#dde1f2'}}>{+d.date.slice(5,7)}/{+d.date.slice(8)}</td>
                                <td style={{padding:'5px 10px',borderTop:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace',color:'#5e6585'}}>{d.cur?wonFmt(d.cur):'—'}</td>
                                <td style={{padding:'5px 10px',borderTop:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace',color:'#34d399'}}>{wonFmt(d.pdf)}</td>
                                <td style={{padding:'5px 10px',borderTop:'1px solid #272a3d',textAlign:'right',fontFamily:'DM Mono,monospace',
                                  color: diff>0 ? '#f9b934' : diff<0 ? '#f87171' : '#5e6585'}}>{diff ? `${diff>0?'+':''}${wonFmt(diff)}` : '일치'}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <button type="button" onClick={()=>setShowDepRows(v=>!v)}
                      style={{background:'transparent',border:'none',color:'#93c5fd',fontSize:11,cursor:'pointer',fontFamily:'inherit',padding:0}}>
                      {showDepRows ? '▾ 입금 내역 접기' : `▸ 입금 내역 ${ins.length}건 보기`}{excluded.length ? ` (제외 ${excluded.length}건 · ${wonFmt(excluded.reduce((a,r)=>a+r.in,0))}원)` : ''}{nonOpIn.length ? ` · 영업 외 입금 ${nonOpIn.length}건 기록 예정` : ''}
                    </button>
                    {showDepRows && (
                      <div style={{display:'flex',flexDirection:'column',gap:6,marginTop:8}}>
                        {ins.map(r=>renderRow(r, r.in, '#34d399', false))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )
          })()}

          <div style={{fontSize:12,fontWeight:600,marginBottom:8,display:'flex',justifyContent:'space-between',flexWrap:'wrap',gap:6}}>
            <span style={{color:'#f87171'}}>💸 출금 {outs.length}건</span>
            <span style={{color:'#5e6585',fontWeight:400}}>
              지출 {expOut.length}건 · {wonFmt(expOut.reduce((a,r)=>a+r.out,0))}원{nonOpOut.length ? ` / 영업 외 ${nonOpOut.length}건 · ${wonFmt(nonOpOut.reduce((a,r)=>a+r.out,0))}원` : ''}
              {unassigned>0 && <b style={{color:'#f87171',marginLeft:6}}>미분류 {unassigned}건</b>}
            </span>
          </div>
          <div style={{display:'flex',flexDirection:'column',gap:6,marginBottom:16}}>
            {outs.map(r=>renderRow(r, r.out, '#f87171', true))}
          </div>

          <div style={{display:'flex',gap:8}}>
            <button onClick={save} disabled={busy}
              style={{flex:1,background:'#34d399',color:'#000',border:'none',borderRadius:8,padding:'11px',
                fontSize:13,fontWeight:700,cursor:'pointer',fontFamily:'inherit'}}>
              {busy ? '저장 중...' : `💾 지출관리에 반영 (지출 ${expOut.length}건${depChanged.length?` · 실입금 ${depChanged.length}일`:''}${nonOpOut.length+nonOpIn.length?` · 영업외 ${nonOpOut.length+nonOpIn.length}건`:''})`}
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
