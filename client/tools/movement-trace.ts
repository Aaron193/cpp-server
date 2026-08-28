import { runBrowserMovementTrace } from './movement-trace-adapter'

const checkpoints = await runBrowserMovementTrace()
console.log(JSON.stringify({ adapter: 'browser-wasm-jolt', checkpoints }))
