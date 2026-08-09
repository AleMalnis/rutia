import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

// Cifrado de la clave BYOK en reposo (spec §6.4 y §8). AES-256-GCM cifra Y
// autentica: un blob manipulado en la BD no descifra a basura silenciosa,
// revienta. La clave simétrica se deriva de LLM_KEY_SECRET, que vive SOLO en
// el entorno del servidor: sin él, las filas de llm_settings son opacas.
//
// Módulo solo de servidor (node:crypto): importarlo desde un componente de
// cliente rompe el build, que es exactamente lo que queremos.

/** Config del servidor rota o ausente: la ruta lo traduce a un 503 amable. */
export class SecretConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SecretConfigError'
  }
}

const BLOB_VERSION = 'v1'

function deriveKey(): Buffer {
  const secret = process.env.LLM_KEY_SECRET
  if (!secret || secret.trim().length < 32) {
    throw new SecretConfigError(
      'Falta LLM_KEY_SECRET (mínimo 32 caracteres) en el entorno del servidor.',
    )
  }
  // sha256 normaliza cualquier longitud de secreto a los 32 bytes de AES-256
  return createHash('sha256').update(secret).digest()
}

export function encryptSecret(plain: string): string {
  const key = deriveKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    BLOB_VERSION,
    iv.toString('base64'),
    data.toString('base64'),
    tag.toString('base64'),
  ].join(':')
}

export function decryptSecret(blob: string): string {
  const key = deriveKey()
  const [version, ivB64, dataB64, tagB64] = blob.split(':')
  if (version !== BLOB_VERSION || !ivB64 || !dataB64 || !tagB64) {
    throw new SecretConfigError('Blob cifrado con formato desconocido.')
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    // secreto rotado o fila manipulada: mismo tratamiento que config rota
    throw new SecretConfigError('No se pudo descifrar la clave guardada.')
  }
}
