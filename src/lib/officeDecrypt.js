// 비밀번호가 걸린 엑셀(.xlsx) 풀기 — Office "Agile" 암호화 (MS-OFFCRYPTO 2.3.4.10~13)
// 배달앱 사장님 사이트(배민 등)에서 받는 내역서가 이 방식. 브라우저 WebCrypto만 써서 파일이 밖으로 나가지 않음.
//   decryptXlsx(arrayBuffer, password, XLSX) → 풀린 xlsx의 Uint8Array
//   isEncryptedXlsx(arrayBuffer, XLSX) → 비밀번호가 걸린 파일인지

const BLOCK_VERIFIER_INPUT = [0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]
const BLOCK_VERIFIER_VALUE = [0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]
const BLOCK_KEY_VALUE      = [0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]
const SEGMENT = 4096

const subtle = () => globalThis.crypto.subtle
const HASHES = { SHA1:'SHA-1', 'SHA-1':'SHA-1', SHA256:'SHA-256', SHA384:'SHA-384', SHA512:'SHA-512' }
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}
const u32 = n => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255])
const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0))
const utf16le = s => { const out = new Uint8Array(s.length * 2); for (let i = 0; i < s.length; i++) { out[i*2] = s.charCodeAt(i) & 255; out[i*2+1] = s.charCodeAt(i) >> 8 } return out }
const fit = (buf, len, fill) => { const out = new Uint8Array(len).fill(fill); out.set(buf.slice(0, len)); return out }

const digest = async (alg, data) => new Uint8Array(await subtle().digest(alg, data))

// WebCrypto의 AES-CBC는 PKCS#7 패딩을 요구하므로, 패딩 블록 하나를 만들어 붙인 뒤 복호화 (암호문은 블록 크기의 배수)
async function aesCbcDecryptRaw(keyBytes, iv, data) {
  const key = await subtle().importKey('raw', keyBytes, 'AES-CBC', false, ['encrypt', 'decrypt'])
  const last = data.length ? data.slice(data.length - 16) : iv
  const pad = new Uint8Array(await subtle().encrypt({ name:'AES-CBC', iv:last }, key, new Uint8Array(16).fill(16))).slice(0, 16)
  return new Uint8Array(await subtle().decrypt({ name:'AES-CBC', iv }, key, concat(data, pad)))
}

function attrs(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}\\b([^>]*)>`))
  if (!m) return null
  const out = {}
  for (const [, k, v] of m[1].matchAll(/(\w+)="([^"]*)"/g)) out[k] = v
  return out
}

function streams(buf, XLSX) {
  const cfb = XLSX.CFB.read(new Uint8Array(buf), { type:'array' })
  const info = XLSX.CFB.find(cfb, 'EncryptionInfo')
  const pkg = XLSX.CFB.find(cfb, 'EncryptedPackage')
  return { info: info && new Uint8Array(info.content), pkg: pkg && new Uint8Array(pkg.content) }
}

export function isEncryptedXlsx(buf, XLSX) {
  const b = new Uint8Array(buf)
  // 일반 xlsx는 zip(PK)으로 시작, 암호화된 건 OLE 복합 문서(D0 CF 11 E0)
  if (!(b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0)) return false
  try { return !!streams(buf, XLSX).pkg } catch { return false }
}

export async function decryptXlsx(buf, password, XLSX) {
  const { info, pkg } = streams(buf, XLSX)
  if (!info || !pkg) throw new Error('비밀번호가 걸린 엑셀 형식이 아니에요')
  const major = info[0] | (info[1] << 8), minor = info[2] | (info[3] << 8)
  if (!(major === 4 && minor === 4)) throw new Error('이 엑셀의 암호화 방식은 아직 지원하지 않아요')
  const xml = new TextDecoder().decode(info.slice(8))
  const kd = attrs(xml, 'keyData'), pk = attrs(xml, 'p:encryptedKey')
  if (!kd || !pk) throw new Error('암호화 정보를 읽지 못했어요')

  // 비밀번호 → 키 (salt + 비밀번호를 spinCount번 해시)
  const alg = HASHES[pk.hashAlgorithm]
  if (!alg) throw new Error(`지원하지 않는 해시 방식이에요 (${pk.hashAlgorithm})`)
  const keyLen = +pk.keyBits / 8, salt = b64(pk.saltValue)
  let h = await digest(alg, concat(salt, utf16le(String(password))))
  for (let i = 0, n = +pk.spinCount; i < n; i++) h = await digest(alg, concat(u32(i), h))
  const derive = async block => fit(await digest(alg, concat(h, new Uint8Array(block))), keyLen, 0x36)

  // 비밀번호 확인
  const vInput = (await aesCbcDecryptRaw(await derive(BLOCK_VERIFIER_INPUT), salt, b64(pk.encryptedVerifierHashInput))).slice(0, +pk.saltSize)
  const vHash = (await aesCbcDecryptRaw(await derive(BLOCK_VERIFIER_VALUE), salt, b64(pk.encryptedVerifierHashValue))).slice(0, +pk.hashSize)
  const expect = await digest(alg, vInput)
  if (expect.some((x, i) => x !== vHash[i])) throw new Error('비밀번호가 맞지 않아요')

  // 파일 키 → 4096바이트 조각마다 복호화
  const fileKey = (await aesCbcDecryptRaw(await derive(BLOCK_KEY_VALUE), salt, b64(pk.encryptedKeyValue))).slice(0, +kd.keyBits / 8)
  const dataAlg = HASHES[kd.hashAlgorithm], dataSalt = b64(kd.saltValue), bs = +kd.blockSize
  const size = new DataView(pkg.buffer, pkg.byteOffset, 8).getUint32(0, true) + new DataView(pkg.buffer, pkg.byteOffset, 8).getUint32(4, true) * 2 ** 32
  const body = pkg.slice(8)
  const out = new Uint8Array(Math.ceil(body.length / 16) * 16)
  for (let i = 0, off = 0; off < body.length; i++, off += SEGMENT) {
    const iv = fit(await digest(dataAlg, concat(dataSalt, u32(i))), bs, 0x36)
    let chunk = body.slice(off, off + SEGMENT)
    if (chunk.length % 16) chunk = fit(chunk, Math.ceil(chunk.length / 16) * 16, 0)
    out.set(await aesCbcDecryptRaw(fileKey, iv, chunk), off)
  }
  return out.slice(0, size)
}
