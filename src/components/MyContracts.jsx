import { useEffect, useRef, useState } from 'react'
import ContractDoc from './ContractDoc'
import { STATEMENT_PRINT_CSS } from './WageStatements'
import { useBizInfo, useSeal } from '../lib/bizInfo'
import { KIND_LABELS, loadContracts, signContract } from '../lib/contracts'
import { loadMyPrivate } from '../lib/privateInfo'
import { VStack, HStack } from '@astryxdesign/core/Layout'
import { Text } from '@astryxdesign/core/Text'
import { Badge } from '@astryxdesign/core/Badge'
import { Banner } from '@astryxdesign/core/Banner'
import { Button } from '@astryxdesign/core/Button'
import { TextInput } from '@astryxdesign/core/TextInput'
import { List, ListItem } from '@astryxdesign/core/List'
import { Legacy, LedgerCard } from '../astryx/AstryxPage'

// 내 급여 → 근로계약서 (직원): 사장님이 보낸 계약서를 읽고 주소·연락처를 적은 뒤 손가락으로 서명. 서명한 계약서는 언제든 인쇄·PDF
const T = { ink:'#1D1B18', sub:'#6E6A63', rule:'#DCD7CE', soft:'#ECE8E1', accent:'var(--hk-accent)', green:'#2E7D45', amber:'#B45309' }
// 손가락·마우스 서명 칸 → PNG (투명 바탕)
function SignPad({ onChange }) {
  const ref = useRef(null), drawing = useRef(false), drawn = useRef(false)
  useEffect(() => {
    const c = ref.current, r = c.getBoundingClientRect(), k = window.devicePixelRatio || 1
    c.width = r.width * k; c.height = r.height * k
    const g = c.getContext('2d'); g.scale(k, k); g.lineWidth = 2.6; g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = '#1D1B18'
  }, [])
  const pos = e => { const r = ref.current.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top] }
  const down = e => { e.preventDefault(); ref.current.setPointerCapture(e.pointerId); drawing.current = true; const g = ref.current.getContext('2d'); g.beginPath(); g.moveTo(...pos(e)) }
  const move = e => { if (!drawing.current) return; const g = ref.current.getContext('2d'); g.lineTo(...pos(e)); g.stroke(); drawn.current = true }
  const up = () => { if (!drawing.current) return; drawing.current = false; if (drawn.current) onChange(ref.current.toDataURL('image/png')) }
  const clear = () => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); drawn.current = false; onChange(null) }
  return (
    <div>
      <canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        style={{width:'100%', height:150, background:'#FFFFFF', border:`1.5px dashed ${T.ink}`, borderRadius:6, touchAction:'none', display:'block'}}/>
      <div style={{display:'flex', justifyContent:'space-between', fontSize:12, color:T.sub, marginTop:4}}>
        <span>위 칸에 손가락으로 이름을 써 주세요</span>
        <button type="button" onClick={clear} style={{background:'none', border:'none', color:'#2B5C9E', fontSize:12, cursor:'pointer', fontFamily:'inherit', textDecoration:'underline'}}>다시 쓰기</button>
      </div>
    </div>
  )
}

export default function MyContracts({ uid, phone }) {
  const biz = useBizInfo(), seal = useSeal()
  const [list, setList] = useState(null)
  const [open, setOpen] = useState(null)       // 보고 있는 계약서
  const [sign, setSign] = useState(null)
  const [address, setAddress] = useState('')
  const [tel, setTel] = useState(phone || '')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const reload = () => loadContracts(uid).then(setList).catch(() => setList([]))
  useEffect(() => { if (uid) reload() }, [uid]) // eslint-disable-line react-hooks/exhaustive-deps
  // 연락처는 내 개인 문서에서 미리 채움
  useEffect(() => { if (uid && !phone) loadMyPrivate(uid).then(p => { if (p.phone) setTel(t => t || p.phone) }) }, [uid, phone])

  if (!list || list.length === 0) return null
  const pending = list.filter(c => c.status !== 'signed')

  const submit = async () => {
    if (!address.trim()) return setMsg('주소를 적어 주세요')
    if (!sign) return setMsg('서명 칸에 서명해 주세요')
    if (!window.confirm('이 내용으로 근로계약서에 서명할까요? 서명한 뒤에는 고칠 수 없어요.')) return
    setBusy(true)
    try { await signContract(uid, open.id, { sign, address: address.trim(), phone: tel.trim() }); setMsg('서명했어요. 사장님과 같은 계약서를 함께 보관해요'); setOpen(null); setSign(null); reload() }
    catch (e) { console.error(e); setMsg('서명하지 못했어요. 잠시 뒤 다시 해 주세요') }
    setBusy(false)
  }

  return (
    <LedgerCard title="근로계약서" right={pending.length > 0 && <Badge variant="warning" label={`서명할 계약서 ${pending.length}건`}/>}>
      <Legacy><style>{STATEMENT_PRINT_CSS}</style></Legacy>
      {msg && <Banner status="warning" title={msg}/>}
      {open ? (
        <VStack gap={3}>
          <HStack gap={2}>
            <Button label="목록으로" onClick={() => { setOpen(null); setSign(null); setMsg('') }}/>
            {open.status === 'signed' && <Button label="인쇄 · PDF로 저장" onClick={() => window.print()}/>}
          </HStack>
          <Legacy><ContractDoc c={open.status === 'signed' ? open : { ...open, empAddress: address, empPhone: tel, empSign: sign }} biz={biz} seal={seal}/></Legacy>
          {open.status !== 'signed' && (
            <VStack gap={3} maxWidth={520}>
              <TextInput label="주소" value={address} onChange={v => setAddress(v)}/>
              <TextInput type="tel" label="연락처" inputMode="tel" value={tel} onChange={v => setTel(v)}/>
              <Legacy><SignPad onChange={setSign}/></Legacy>
              <Button variant="primary" size="lg" width="100%" label={busy ? '서명하는 중…' : '내용을 확인했고 서명합니다'} isDisabled={busy} onClick={submit}/>
            </VStack>
          )}
        </VStack>
      ) : (
        <List hasDividers edge="flush">
          {list.map(c => (
            <ListItem key={c.id} label={<Text weight="bold">{KIND_LABELS[c.kind]}</Text>} description={`${c.startDate}부터`}
              endContent={<HStack gap={2} vAlign="center">
                <Badge variant={c.status === 'signed' ? 'success' : 'warning'} label={c.status === 'signed' ? '서명 완료' : '서명 필요'}/>
                <Button size="sm" variant={c.status === 'signed' ? 'secondary' : 'primary'} label={c.status === 'signed' ? '보기' : '읽고 서명하기'} onClick={() => { setOpen(c); setMsg('') }}/>
              </HStack>}/>
          ))}
        </List>
      )}
    </LedgerCard>
  )
}
