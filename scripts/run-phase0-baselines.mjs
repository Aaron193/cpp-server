#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const arguments_ = process.argv.slice(2)
const valueAfter = (name) => {
    const index = arguments_.indexOf(name)
    return index < 0 ? undefined : arguments_[index + 1]
}
const clientReport = valueAfter('--client-report')
const serverReport = valueAfter('--server-report')
const outputPath = valueAfter('--write')
if (!clientReport) {
    throw new Error('Usage: run-phase0-baselines.mjs --client-report <json-lines-file> [--server-report <json-lines-file>] [--write <report.json>]')
}
const readLastJsonLine = (path) => {
    const lines = readFileSync(resolve(path), 'utf8').trim().split('\n')
    for (let index = lines.length - 1; index >= 0; index--) {
        try { return JSON.parse(lines[index]) } catch { /* Skip human-readable benchmark preamble. */ }
    }
    throw new Error(`No JSON object found in ${path}`)
}
const client = readLastJsonLine(clientReport)
const server = serverReport ? readLastJsonLine(serverReport) : {
    status: 'not-run',
    reason: 'Pass --server-report <server_load_benchmark output> to capture native tick and snapshot distributions.',
}
const report = {
    format: 'cpp-server-phase0-baseline-report', formatVersion: 1,
    provenance: {
        phase: 0,
        scenario: 'current pre-integration characterization',
        generatedBy: 'scripts/run-phase0-baselines.mjs',
        wallClockThresholdsAreAcceptanceGates: false,
    },
    client,
    server,
}
const json = `${JSON.stringify(report, null, 2)}\n`
if (outputPath) writeFileSync(resolve(outputPath), json)
process.stdout.write(json)
