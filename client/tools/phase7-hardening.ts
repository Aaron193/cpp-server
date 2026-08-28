import { runPhase7Hardening } from '../src/foundation/hardening/Phase7Harness'

const report = runPhase7Hardening()
console.log(JSON.stringify(report, null, 2))
if (!report.passed) process.exitCode = 1
