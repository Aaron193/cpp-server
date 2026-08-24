import { createHash } from 'node:crypto'

export function canonicalJson(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) {
        return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`
    }
    const record = value as Record<string, unknown>
    return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
        .join(',')}}`
}

export function prettyJson(value: unknown): Uint8Array {
    return new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`)
}

export function sha256(parts: readonly Uint8Array[]): string {
    const hash = createHash('sha256')
    for (const part of parts) hash.update(part)
    return `sha256:${hash.digest('hex')}`
}
