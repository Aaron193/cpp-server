#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const lockPath = resolve(root, 'protocol/fixtures/phase0-fixture-lock.json')
const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
if (lock.format !== 'cpp-server-phase0-fixture-lock' || lock.formatVersion !== 1) throw new Error('Unsupported fixture lock format')
const digest = (path) => createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex')
let drift = false
for (const [path, expected] of Object.entries(lock.files)) {
    const actual = digest(path)
    if (actual === expected) continue
    drift = true
    if (process.argv.includes('--update')) lock.files[path] = actual
    else console.error(`${path}: expected ${expected}, received ${actual}`)
}
if (process.argv.includes('--update')) {
    writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`)
    console.log('Updated Phase 0 fixture lock after explicit request.')
} else if (drift) {
    console.error('Protocol/map fixture drift detected. Regenerate and review both language paths before running with --update.')
    process.exitCode = 1
} else {
    console.log(`Phase 0 fixture lock OK (${Object.keys(lock.files).length} files)`)
}
