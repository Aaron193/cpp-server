#!/usr/bin/env node
// Deterministic original sound design for cpp-server. No samples or external media.
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const output = resolve(import.meta.dirname, '../client/public/audio')
mkdirSync(output, { recursive: true })
const rate = 22050
let seed = 0x51f15e
const noise = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 0x80000000 - 1 }
function wav(name, seconds, synth) {
    const count = Math.floor(rate * seconds), bytes = Buffer.alloc(44 + count * 2)
    bytes.write('RIFF', 0); bytes.writeUInt32LE(36 + count * 2, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(count * 2, 40)
    for (let i = 0; i < count; i++) bytes.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(synth(i / rate, i / count) * 32767))), 44 + i * 2)
    writeFileSync(resolve(output, `${name}.wav`), bytes)
}
const decay = (p, amount) => Math.exp(-p * amount)
wav('rifle-fire', .19, (t, p) => (noise() * .62 + Math.sin(t * 920) * .21 + Math.sin(t * 210) * .17) * decay(p, 8))
wav('shotgun-fire', .32, (t, p) => (noise() * .72 + Math.sin(t * 490) * .16 + Math.sin(t * 115) * .22) * decay(p, 6))
wav('impact', .12, (t, p) => (noise() * .38 + Math.sin(t * 2100) * .18) * decay(p, 10))
wav('ui-hit', .11, (t, p) => Math.sin(t * (680 + p * 720) * Math.PI * 2) * .38 * Math.sin(p * Math.PI))
wav('ui-damage', .18, (t, p) => (Math.sin(t * 155 * Math.PI * 2) + noise() * .18) * .3 * Math.sin(p * Math.PI))
wav('ui-round', .42, (t, p) => Math.sin(t * (440 + Math.floor(p * 3) * 110) * Math.PI * 2) * .22 * Math.sin(Math.min(1, p * 8) * Math.PI / 2) * decay(p, 1.8))
wav('ui-reload', .16, (t, p) => (noise() * .12 + Math.sin(t * 930 * Math.PI * 2) * .12) * Math.sin(p * Math.PI))
wav('ui-reject', .13, (t, p) => Math.sin(t * (260 - p * 90) * Math.PI * 2) * .2 * Math.sin(p * Math.PI))
console.log(`Generated original Phase 6 audio in ${output}`)
