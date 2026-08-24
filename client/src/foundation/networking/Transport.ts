export type TransportState = 'idle' | 'connecting' | 'open' | 'closed'

export interface TransportCallbacks {
    readonly open: () => void
    readonly message: (data: Uint8Array) => void
    readonly close: (code: number, reason: string) => void
    readonly error: (message: string) => void
}

export interface NetworkTransport {
    readonly state: TransportState
    connect(url: string, callbacks: TransportCallbacks): void
    send(data: Uint8Array): void
    update(nowMs: number): void
    close(code?: number, reason?: string): void
}

export interface SyntheticImpairment {
    readonly latencyMs: number
    readonly jitterMs: number
    readonly stalled: boolean
}

interface Scheduled<T> { readonly at: number; readonly value: T }

export class ImpairmentQueue<T> {
    private readonly queue: Scheduled<T>[] = []
    private head = 0
    private lastScheduledAt = 0
    constructor(private random: () => number = Math.random) {}

    schedule(value: T, nowMs: number, impairment: SyntheticImpairment): void {
        const jitter = (this.random() * 2 - 1) * Math.max(0, impairment.jitterMs)
        const at = Math.max(nowMs, this.lastScheduledAt, nowMs + Math.max(0, impairment.latencyMs + jitter))
        this.lastScheduledAt = at
        this.queue.push({ at, value })
    }

    drainEach(nowMs: number, stalled: boolean, visitor: (value: T) => void): void {
        if (stalled) return
        while (this.head < this.queue.length && this.queue[this.head]!.at <= nowMs) visitor(this.queue[this.head++]!.value)
        if (this.head === this.queue.length) {
            this.queue.length = 0
            this.head = 0
        } else if (this.head >= 64 && this.head * 2 >= this.queue.length) {
            this.queue.splice(0, this.head)
            this.head = 0
        }
    }

    /** Convenience collector for tests and non-frame-loop callers. */
    drain(nowMs: number, stalled: boolean): T[] {
        const values: T[] = []
        this.drainEach(nowMs, stalled, (value) => values.push(value))
        return values
    }

    clear(): void { this.queue.length = 0; this.head = 0; this.lastScheduledAt = 0 }
    get size(): number { return this.queue.length - this.head }
}

export class BrowserWebSocketTransport implements NetworkTransport {
    private socket?: WebSocket
    private callbacks?: TransportCallbacks
    private readonly outgoing = new ImpairmentQueue<Uint8Array>()
    private readonly incoming = new ImpairmentQueue<Uint8Array>()
    private currentState: TransportState = 'idle'
    private impairment: SyntheticImpairment = { latencyMs: 0, jitterMs: 0, stalled: false }
    private readonly sendScheduled = (data: Uint8Array): void => {
        const socket = this.socket
        if (socket?.readyState === WebSocket.OPEN) socket.send(data)
    }
    private readonly deliverScheduled = (data: Uint8Array): void => {
        this.callbacks?.message(data)
    }

    get state(): TransportState { return this.currentState }

    setImpairment(impairment: SyntheticImpairment): void {
        this.impairment = {
            latencyMs: Math.max(0, impairment.latencyMs),
            jitterMs: Math.max(0, impairment.jitterMs),
            stalled: impairment.stalled,
        }
    }

    connect(url: string, callbacks: TransportCallbacks): void {
        if (!/^wss?:\/\//.test(url)) throw new Error('Discovery returned an invalid WebSocket URL')
        this.close(1000, 'reconnect')
        this.callbacks = callbacks
        this.currentState = 'connecting'
        const socket = new WebSocket(url)
        socket.binaryType = 'arraybuffer'
        socket.onopen = () => {
            if (this.socket !== socket) return
            this.currentState = 'open'; callbacks.open()
        }
        socket.onmessage = (event) => {
            if (this.socket !== socket) return
            if (event.data instanceof ArrayBuffer) this.incoming.schedule(new Uint8Array(event.data), performance.now(), this.impairment)
            else if (event.data instanceof Blob) void event.data.arrayBuffer().then((data) => {
                if (this.socket === socket) this.incoming.schedule(new Uint8Array(data), performance.now(), this.impairment)
            })
            else callbacks.error('Server sent a non-binary WebSocket message')
        }
        socket.onerror = () => { if (this.socket === socket) callbacks.error('WebSocket transport error') }
        socket.onclose = (event) => {
            if (this.socket !== socket) return
            this.currentState = 'closed'
            callbacks.close(event.code, event.reason)
        }
        this.socket = socket
    }

    send(data: Uint8Array): void {
        if (this.currentState !== 'open') return
        this.outgoing.schedule(data.slice(), performance.now(), this.impairment)
    }

    update(nowMs: number): void {
        this.outgoing.drainEach(nowMs, this.impairment.stalled, this.sendScheduled)
        this.incoming.drainEach(nowMs, this.impairment.stalled, this.deliverScheduled)
    }

    close(code = 1000, reason = 'client closing'): void {
        const socket = this.socket
        this.socket = undefined
        this.outgoing.clear()
        this.incoming.clear()
        if (socket && socket.readyState < WebSocket.CLOSING) socket.close(code, reason)
        this.currentState = 'closed'
    }
}
