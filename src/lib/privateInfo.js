// 개인 정보 분리: 직원끼리 서로 보면 안 되는 것들
//  - userPrivate/{uid} = { ssn, account, phone, wage, wageHistory, fixedSalary }  (본인·사장님만 읽음)
//    users/{uid} 에는 이름·포지션·근무 패턴처럼 스케쥴·우리 매장에 필요한 것만 남김
//  - payslips/{uid}/months/{YYYY-MM} = { pay: payroll[uid], bonuses: bonuses[uid] }  (본인·사장님만 읽음)
//    payroll/{달}·bonuses/{달} 은 사장님만 읽음. 사장님이 급여·상여를 저장할 때마다 syncPayslips 로 복사
//    직원의 '확인함'·'문의'는 payroll/{달}[uid] 와 이 복사본 pay 에 같이 씀 (읽지 않고 그 칸만)
//  - 예전 자료는 사장님 계정이 앱을 열 때 한 번 옮김 (meta/privacy 에 표시)
import { db } from '../firebase'
import { collection, deleteField, doc, FieldPath, getDoc, getDocs, setDoc, updateDoc, writeBatch } from 'firebase/firestore'

export const PRIVATE_FIELDS = ['ssn', 'account', 'phone', 'wage', 'wageHistory', 'fixedSalary', 'insuranceHistory']

// 사장님 화면: users 목록에 개인 정보 합치기
export async function loadPrivateMap() {
  const snap = await getDocs(collection(db, 'userPrivate'))
  const out = {}
  snap.forEach(d => { out[d.id] = d.data() })
  return out
}
export const withPrivate = (u, map) => ({ ...u, ...(map?.[u.uid] || {}) })

// 저장할 값을 users 쪽 / userPrivate 쪽으로 나눔. users 쪽에는 개인 항목 지우기 표시를 넣음
export function splitPrivate(data) {
  const pub = {}, priv = {}
  for (const [k, v] of Object.entries(data)) {
    if (PRIVATE_FIELDS.includes(k)) { if (v !== undefined) priv[k] = v; pub[k] = deleteField() }
    else pub[k] = v
  }
  return [pub, priv]
}
// 사장님이 사람 정보를 저장: users(merge) + userPrivate(merge)
export async function saveUser(uid, data) {
  const [pub, priv] = splitPrivate(data)
  await setDoc(doc(db, 'users', uid), pub, { merge: true })
  if (Object.keys(priv).length) await setDoc(doc(db, 'userPrivate', uid), priv, { merge: true })
}

// 본인 개인 정보 (없으면 users 에 남아 있는 예전 값)
export async function loadMyPrivate(uid, userData) {
  const legacy = Object.fromEntries(PRIVATE_FIELDS.filter(k => userData?.[k] !== undefined).map(k => [k, userData[k]]))
  try { const s = await getDoc(doc(db, 'userPrivate', uid)); return { ...legacy, ...(s.exists() ? s.data() : {}) } }
  catch { return legacy }
}

// ───── 급여 복사본 ─────
export async function syncPayslips(ym) {
  const [p, b] = await Promise.all([getDoc(doc(db, 'payroll', ym)), getDoc(doc(db, 'bonuses', ym))])
  const pd = p.exists() ? p.data() : {}, bd = b.exists() ? b.data() : {}
  const uids = new Set([
    ...Object.keys(pd).filter(k => pd[k] && typeof pd[k] === 'object' && !Array.isArray(pd[k])),
    ...Object.keys(bd).filter(k => Array.isArray(bd[k])),
  ])
  if (!uids.size) return
  const batch = writeBatch(db)
  for (const uid of uids)
    batch.set(doc(db, 'payslips', uid, 'months', ym), { pay: pd[uid] || null, bonuses: Array.isArray(bd[uid]) ? bd[uid] : [], syncedAt: new Date().toISOString() })
  await batch.commit()
}
export const syncPayslipsQuiet = ym => syncPayslips(ym).catch(e => console.warn('급여 복사본을 못 만들었어요', ym, e))

// 직원 화면: 내 급여·상여
export async function loadMyPayslip(uid, ym) {
  try {
    const s = await getDoc(doc(db, 'payslips', uid, 'months', ym))
    const d = s.exists() ? s.data() : {}
    return { pay: d.pay || null, bonuses: Array.isArray(d.bonuses) ? d.bonuses : [] }
  } catch { return { pay: null, bonuses: [] } }
}
// 직원이 급여 확인·문의: 원본과 복사본의 내 칸 그 항목만 바꿈 (다른 사람 급여는 읽지 않음)
export async function writeMyPayFields(uid, ym, fields) {
  const pairs = Object.entries(fields)
  const orig = pairs.flatMap(([k, v]) => [new FieldPath(uid, k), v])
  const copy = pairs.flatMap(([k, v]) => [new FieldPath('pay', k), v])
  await updateDoc(doc(db, 'payroll', ym), ...orig)
  await updateDoc(doc(db, 'payslips', uid, 'months', ym), ...copy).catch(() => {})
}

// ───── 예전 자료 한 번 옮기기 (사장님 계정에서만) ─────
let running = null
export function migratePrivacy() {
  if (!running) running = (async () => {
    const flagRef = doc(db, 'meta', 'privacy')
    const flag = (await getDoc(flagRef)).data() || {}
    if (!flag.users) {
      const [us, privMap] = await Promise.all([getDocs(collection(db, 'users')), loadPrivateMap()])
      for (const d of us.docs) {
        const u = d.data()
        const keys = PRIVATE_FIELDS.filter(k => u[k] !== undefined)
        if (!keys.length) continue
        const have = privMap[d.id] || {}
        const priv = Object.fromEntries(keys.filter(k => have[k] === undefined).map(k => [k, u[k]]))
        if (Object.keys(priv).length) await setDoc(doc(db, 'userPrivate', d.id), priv, { merge: true })
        await updateDoc(doc(db, 'users', d.id), Object.fromEntries(keys.map(k => [k, deleteField()])))
      }
      await setDoc(flagRef, { users: new Date().toISOString() }, { merge: true })
    }
    if (!flag.payslips) {
      const [ps, bs] = await Promise.all([getDocs(collection(db, 'payroll')), getDocs(collection(db, 'bonuses'))])
      const months = new Set([...ps.docs, ...bs.docs].map(d => d.id).filter(id => /^\d{4}-\d{2}$/.test(id)))
      for (const ym of [...months].sort()) await syncPayslips(ym)
      await setDoc(flagRef, { payslips: new Date().toISOString() }, { merge: true })
    }
  })().catch(e => { running = null; console.warn('개인 정보 옮기기 실패', e) })
  return running
}
