import { BrowserWebSocketTransport, ImpairmentQueue } from '../src/foundation/networking/Transport'
import { describe, expect, it } from 'vitest'

describe('synthetic transport impairment', () => {
    it('queues latency/jitter in order and holds all traffic during a stall', () => {
        const queue = new ImpairmentQueue<string>(() => 1)
        queue.schedule('a', 100, { latencyMs: 50, jitterMs: 10, stalled: false })
        queue.schedule('b', 100, { latencyMs: 10, jitterMs: 0, stalled: false })
        expect(queue.drain(200, true)).toEqual([])
        expect(queue.size).toBe(2)
        expect(queue.drain(159, false)).toEqual([])
        expect(queue.drain(160, false)).toEqual(['a', 'b'])
    })

    it('models 100 ms latency with plus or minus 20 ms jitter without reordering', () => {
        const samples = [0, 1, 0.5]
        const queue = new ImpairmentQueue<string>(() => samples.shift() ?? 0.5)
        queue.schedule('early', 0, { latencyMs: 100, jitterMs: 20, stalled: false })
        queue.schedule('late', 0, { latencyMs: 100, jitterMs: 20, stalled: false })
        queue.schedule('ordered', 0, { latencyMs: 100, jitterMs: 20, stalled: false })
        expect(queue.drain(79, false)).toEqual([])
        expect(queue.drain(80, true)).toEqual([])
        expect(queue.drain(80, false)).toEqual(['early'])
        expect(queue.drain(119, false)).toEqual([])
        expect(queue.drain(120, false)).toEqual(['late', 'ordered'])
        expect(queue.size).toBe(0)
    })

    it('passes the full discovery URL to WebSocket without reconstruction', () => {
        const original = globalThis.WebSocket
        let received = ''
        class FakeWebSocket {
            static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSING = 2
            readyState = 0; binaryType = ''; onopen = null; onmessage = null; onerror = null; onclose = null
            constructor(url: string) { received = url }
            close() {} send() {}
        }
        Object.assign(globalThis, { WebSocket: FakeWebSocket })
        try {
            new BrowserWebSocketTransport().connect('wss://edge.example/game/socket?ticket=abc', { open() {}, message() {}, close() {}, error() {} })
            expect(received).toBe('wss://edge.example/game/socket?ticket=abc')
        } finally { Object.assign(globalThis, { WebSocket: original }) }
    })
})
