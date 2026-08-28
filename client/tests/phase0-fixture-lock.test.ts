import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('Phase 0 protocol and map fixture lock', () => {
    it('rejects unreviewed drift in protocol, generated bindings, map goldens, or movement trace', async () => {
        const root = new URL('../../', import.meta.url)
        const lock = JSON.parse(await readFile(new URL('protocol/fixtures/phase0-fixture-lock.json', root), 'utf8'))
        expect(lock.format).toBe('cpp-server-phase0-fixture-lock')
        for (const [path, expected] of Object.entries(lock.files)) {
            const contents = await readFile(new URL(path, root))
            expect(createHash('sha256').update(contents).digest('hex'), path).toBe(expected)
        }
    })
})
