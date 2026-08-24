#!/usr/bin/env node
import { readFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { compileMapGltf, MapCompileError } from './index'

async function main(): Promise<void> {
    const args = process.argv.slice(2)
    const check = args[0] === '--check'
    if (check) args.shift()
    if (args.length !== 2) throw new Error('Usage: map-compiler [--check] <source.gltf> <output-directory>')
    const sourcePath = resolve(args[0]), outputDirectory = resolve(args[1])
    const source = JSON.parse(await readFile(sourcePath, 'utf8')) as unknown
    const compiled = compileMapGltf(source)
    if (!check) await mkdir(outputDirectory, { recursive: true })
    const drift: string[] = []
    for (const [name, contents] of compiled.files) {
        const path = resolve(outputDirectory, name)
        if (check) {
            try {
                const existing = await readFile(path)
                if (!existing.equals(contents)) drift.push(name)
            } catch { drift.push(name) }
        } else await writeFile(path, contents)
    }
    if (check) {
        try {
            const expected = new Set(compiled.files.keys())
            for (const name of await readdir(outputDirectory)) {
                if (!expected.has(name)) drift.push(`${name} (unexpected)`)
            }
        } catch {
            if (drift.length === 0) drift.push('output directory (missing)')
        }
    }
    if (drift.length > 0) throw new Error(`compiled map package drift: ${drift.join(', ')}; run npm run map:compile`)
    console.log(`${check ? 'verified' : 'compiled'} ${compiled.manifest.mapId} ${compiled.manifest.contentHash}`)
}

main().catch((error: unknown) => {
    const prefix = error instanceof MapCompileError ? 'map validation failed' : 'map compiler failed'
    console.error(`${prefix}: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
})
