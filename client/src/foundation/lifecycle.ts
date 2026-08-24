export interface FrameUpdate {
    readonly deltaSeconds: number
    readonly elapsedSeconds: number
    readonly frame: number
}

export interface ServiceToken<T> {
    readonly key: symbol
    /** Compile-time token type only. */
    readonly valueType?: T
}

export function createServiceToken<T>(description: string): ServiceToken<T> {
    return { key: Symbol(description) }
}

export class ServiceRegistry {
    private readonly values = new Map<symbol, unknown>()

    provide<T>(token: ServiceToken<T>, value: T): void {
        if (this.values.has(token.key)) {
            throw new Error(`Service already provided: ${String(token.key)}`)
        }
        this.values.set(token.key, value)
    }

    get<T>(token: ServiceToken<T>): T {
        const value = this.values.get(token.key)
        if (value === undefined) {
            throw new Error(`Service is unavailable: ${String(token.key)}`)
        }
        return value as T
    }

    optional<T>(token: ServiceToken<T>): T | undefined {
        return this.values.get(token.key) as T | undefined
    }

    remove<T>(token: ServiceToken<T>): void {
        this.values.delete(token.key)
    }
}

export interface ClientModuleContext {
    readonly canvas: HTMLCanvasElement
    readonly hudRoot: HTMLElement
    readonly services: ServiceRegistry
}

export interface ClientModule {
    readonly name: string
    initialize(context: ClientModuleContext): void | Promise<void>
    start?(): void | Promise<void>
    update?(frame: FrameUpdate): void
    stop?(): void | Promise<void>
    dispose?(): void | Promise<void>
}

/** Runs modules in dependency order and tears them down in reverse order. */
export class ModuleLifecycle {
    private initialized: ClientModule[] = []
    private started = false

    constructor(private readonly modules: readonly ClientModule[]) {}

    async initialize(context: ClientModuleContext): Promise<void> {
        if (this.initialized.length > 0) {
            throw new Error('Client modules are already initialized')
        }
        try {
            for (const module of this.modules) {
                // Track before awaiting so a partially initialized module can
                // release listeners/services/resources when initialization fails.
                this.initialized.push(module)
                await module.initialize(context)
            }
        } catch (error) {
            await this.dispose()
            throw error
        }
    }

    async start(): Promise<void> {
        if (this.started) return
        for (const module of this.initialized) await module.start?.()
        this.started = true
    }

    update(frame: FrameUpdate): void {
        if (!this.started) return
        for (const module of this.initialized) module.update?.(frame)
    }

    async stop(): Promise<void> {
        if (!this.started) return
        for (const module of [...this.initialized].reverse()) {
            await module.stop?.()
        }
        this.started = false
    }

    async dispose(): Promise<void> {
        await this.stop()
        for (const module of [...this.initialized].reverse()) {
            await module.dispose?.()
        }
        this.initialized = []
    }
}
