#!/usr/bin/env node
import { readFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { compileMapGltf } from './index'

const maps = (await readdir(resolve('maps'))).filter((name) => name.endsWith('.gltf')).map((name) => name.slice(0, -5)).sort()
if (maps.length === 0) throw new Error('no map sources found')
const check = process.argv.slice(2).includes('--check')
for (const id of maps) {
    const source = JSON.parse(await readFile(resolve('maps', `${id}.gltf`), 'utf8'))
    const compiled = compileMapGltf(source), output = resolve('public/maps', id)
    if (compiled.manifest.mapId !== id) throw new Error(`${id}.gltf declares mismatched map id ${compiled.manifest.mapId}`)
    if (!check) await mkdir(output, { recursive: true })
    const drift: string[] = []
    for (const [name, bytes] of compiled.files) { const path = resolve(output, name); if (check) { try { if (!(await readFile(path)).equals(bytes)) drift.push(name) } catch { drift.push(name) } } else await writeFile(path, bytes) }
    if (check) { try { const expected = new Set(compiled.files.keys()); for (const name of await readdir(output)) if (!expected.has(name)) drift.push(`${name} (unexpected)`) } catch { drift.push('output directory (missing)') } }
    if (drift.length) throw new Error(`${id} package drift: ${drift.join(', ')}`)
    console.log(`${check ? 'verified' : 'compiled'} ${id} ${compiled.manifest.contentHash}`)
}
