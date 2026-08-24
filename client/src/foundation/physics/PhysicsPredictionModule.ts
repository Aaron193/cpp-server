import type Jolt from 'jolt-physics/wasm-compat'
import type { CollisionMeshData } from '../assets/CollisionMesh'
import type {
    ClientModule,
    ClientModuleContext,
    FrameUpdate,
} from '../lifecycle'
import { INPUT, PHYSICS } from '../services'
import { JoltCharacterWorld, type PhysicsPosition } from './JoltCharacterWorld'
import { DEFAULT_MOVEMENT_TUNING, FixedStepAccumulator, type MovementTuning } from './Movement'
import type { MovementCommand } from './Movement'
import { ProfileStats } from '../performance/ProfileStats'

type JoltRuntime = Awaited<ReturnType<typeof Jolt>>

export class PhysicsPredictionModule implements ClientModule {
    readonly name = 'physics-prediction'
    readonly fixedStepSeconds = 1 / 60
    private currentTuning: MovementTuning
    private context?: ClientModuleContext
    private runtimePromise?: Promise<JoltRuntime>
    private readonly accumulator = new FixedStepAccumulator(this.fixedStepSeconds)
    private world?: JoltCharacterWorld
    private collision?: CollisionMeshData
    private externallyDriven = false
    private simulatedSteps = 0
    private profilingEnabled = false
    private readonly stepTimes = new ProfileStats(240)
    private readonly zero = { x: 0, y: 0, z: 0 }

    constructor(tuning: Partial<MovementTuning> = {}) {
        this.currentTuning = Object.freeze({ ...DEFAULT_MOVEMENT_TUNING, ...tuning })
    }

    initialize(context: ClientModuleContext): void {
        this.context = context
        context.services.provide(PHYSICS, this)
    }

    /** Lazily loads the official single-threaded embedded-WASM distribution. */
    ensureRuntime(): Promise<JoltRuntime> {
        this.runtimePromise ??= import('jolt-physics/wasm-compat').then(
            ({ default: initializeJolt }) => initializeJolt()
        )
        return this.runtimePromise
    }

    async createWorld(collision: CollisionMeshData, spawn: PhysicsPosition): Promise<void> {
        this.world?.dispose()
        this.collision = collision
        this.world = new JoltCharacterWorld(await this.ensureRuntime(), collision, spawn, this.currentTuning)
        this.accumulator.reset()
        this.simulatedSteps = 0
    }

    update(frame: FrameUpdate): void {
        if (!this.context || !this.world || this.externallyDriven) return
        const input = this.context.services.get(INPUT)
        this.accumulator.consume(frame.deltaSeconds, (dt) => {
            const snapshot = input.snapshot()
            this.profileStep({ ...snapshot, yaw: input.angles.yaw }, dt)
            this.simulatedSteps++
        })
    }

    stepCommand(command: MovementCommand, dt = this.fixedStepSeconds): void {
        this.profileStep(command, dt)
        if (this.world) this.simulatedSteps++
    }

    setAuthoritativeState(position: PhysicsPosition, velocity: PhysicsPosition): void {
        this.world?.setState(position, velocity)
    }

    async applyAuthoritativeTuning(tuning: MovementTuning): Promise<void> {
        this.currentTuning = Object.freeze({ ...tuning })
        if (!this.world || !this.collision) return
        const position = this.world.position
        const velocity = this.world.velocity
        this.world.dispose()
        this.world = new JoltCharacterWorld(await this.ensureRuntime(), this.collision, position, this.currentTuning)
        this.world.setState(position, velocity)
    }

    setExternalDrive(enabled: boolean): void {
        this.externallyDriven = enabled
        this.accumulator.reset()
    }

    get position(): PhysicsPosition { return this.world?.position ?? this.zero }
    get velocity(): PhysicsPosition { return this.world?.velocity ?? this.zero }
    get grounded(): boolean { return this.world?.grounded ?? false }
    get tuning(): MovementTuning { return this.currentTuning }
    get stepCount(): number { return this.simulatedSteps }
    get isWorldReady(): boolean { return this.world !== undefined }
    setProfilingEnabled(enabled: boolean): void { this.profilingEnabled = enabled; if (!enabled) this.stepTimes.clear() }
    get predictionStepP95Ms(): number { return this.stepTimes.snapshot().p95 }

    private profileStep(command: MovementCommand, dt: number): void {
        if (!this.profilingEnabled) { this.world?.step(command, dt); return }
        const started = performance.now(); this.world?.step(command, dt); this.stepTimes.add(performance.now() - started)
    }

    dispose(): void {
        this.world?.dispose()
        this.world = undefined
        this.collision = undefined
        this.externallyDriven = false
        this.context?.services.remove(PHYSICS)
        this.context = undefined
        this.accumulator.reset()
        this.simulatedSteps = 0
    }
}
