import type initJolt from 'jolt-physics/wasm-compat'
import type { CollisionMeshData } from '../assets/CollisionMesh'
import { MovementMode, Stance, type MovementState } from '../../protocol/generated'
import { DEFAULT_MOVEMENT_TUNING, createMovementState, stepMovementState, type MovementCommand, type MovementTuning } from './Movement'

export interface PhysicsPosition { readonly x: number; readonly y: number; readonly z: number }

type JoltRuntime = Awaited<ReturnType<typeof initJolt>>
const STATIC_LAYER = 0
const CHARACTER_LAYER = 1

/** Thin adapter around one single-threaded Jolt world and capsule CharacterVirtual. */
export class JoltCharacterWorld {
    private readonly joltInterface: any
    private readonly physicsSystem: any
    private readonly bodyInterface: any
    private readonly character: any
    private readonly stanceShapes = new Map<Stance, any>()
    private readonly stanceShapeResources: Array<{ result: any; translated: any; capsule: any }> = []
    private movementStateValue: MovementState = createMovementState()
    private appliedStance = Stance.Standing
    private readonly broadPhaseFilter: any
    private readonly objectLayerFilter: any
    private readonly bodyFilter: any
    private readonly shapeFilter: any
    private readonly updateSettings: any
    private readonly velocityVector: any
    private readonly spawnVector: any
    private readonly staticBodyId: any
    private spawn: PhysicsPosition
    private disposed = false
    private readonly cachedPosition = { x: 0, y: 0, z: 0 }
    private readonly cachedVelocity = { x: 0, y: 0, z: 0 }

    constructor(
        private readonly Jolt: JoltRuntime,
        collision: CollisionMeshData,
        spawn: PhysicsPosition,
        readonly tuning: MovementTuning = DEFAULT_MOVEMENT_TUNING
    ) {
        this.spawn = { ...spawn }
        const objectFilter = new Jolt.ObjectLayerPairFilterTable(2)
        objectFilter.EnableCollision(STATIC_LAYER, CHARACTER_LAYER)
        objectFilter.EnableCollision(CHARACTER_LAYER, CHARACTER_LAYER)
        const staticBroadPhase = new Jolt.BroadPhaseLayer(0)
        const movingBroadPhase = new Jolt.BroadPhaseLayer(1)
        const broadPhaseInterface = new Jolt.BroadPhaseLayerInterfaceTable(2, 2)
        broadPhaseInterface.MapObjectToBroadPhaseLayer(STATIC_LAYER, staticBroadPhase)
        broadPhaseInterface.MapObjectToBroadPhaseLayer(CHARACTER_LAYER, movingBroadPhase)
        const settings = new Jolt.JoltSettings()
        settings.mMaxWorkerThreads = 0
        settings.mObjectLayerPairFilter = objectFilter
        settings.mBroadPhaseLayerInterface = broadPhaseInterface
        settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(broadPhaseInterface, 2, objectFilter, 2)
        this.joltInterface = new Jolt.JoltInterface(settings)
        Jolt.destroy(settings)
        Jolt.destroy(staticBroadPhase)
        Jolt.destroy(movingBroadPhase)
        this.physicsSystem = this.joltInterface.GetPhysicsSystem()
        this.bodyInterface = this.physicsSystem.GetBodyInterface()

        const vertices = new Jolt.VertexList()
        vertices.reserve(collision.vertices.length / 3)
        for (let index = 0; index < collision.vertices.length; index += 3) {
            const vertex = new Jolt.Float3(collision.vertices[index], collision.vertices[index + 1], collision.vertices[index + 2])
            vertices.push_back(vertex)
            Jolt.destroy(vertex)
        }
        const triangles = new Jolt.IndexedTriangleList()
        triangles.reserve(collision.indices.length / 3)
        for (let index = 0; index < collision.indices.length; index += 3) {
            const triangle = new Jolt.IndexedTriangle(collision.indices[index], collision.indices[index + 1], collision.indices[index + 2], 0)
            triangles.push_back(triangle)
            Jolt.destroy(triangle)
        }
        const materials = new Jolt.PhysicsMaterialList()
        const meshSettings = new Jolt.MeshShapeSettings(vertices, triangles, materials)
        const meshResult = meshSettings.Create()
        if (!meshResult.IsValid()) throw new Error('Jolt rejected the authored collision triangle mesh')
        const origin = new Jolt.RVec3(0, 0, 0)
        const identity = Jolt.Quat.prototype.sIdentity()
        const bodySettings = new Jolt.BodyCreationSettings(meshResult.Get(), origin, identity, Jolt.EMotionType_Static, STATIC_LAYER)
        this.staticBodyId = this.bodyInterface.CreateAndAddBody(bodySettings, Jolt.EActivation_DontActivate)
        Jolt.destroy(bodySettings)
        Jolt.destroy(origin)
        meshResult.Clear()
        Jolt.destroy(meshSettings)
        Jolt.destroy(vertices)
        Jolt.destroy(triangles)
        Jolt.destroy(materials)

        const makeStanceShape = (stance: Stance, halfHeight: number, radius: number): any => {
            const shapeOffset = new Jolt.Vec3(0, halfHeight + radius, 0)
            const capsuleSettings = new Jolt.CapsuleShapeSettings(halfHeight, radius)
            const translatedSettings = new Jolt.RotatedTranslatedShapeSettings(shapeOffset, identity, capsuleSettings)
            const result = translatedSettings.Create()
            if (!result.IsValid()) throw new Error(`Jolt rejected movement stance ${stance}`)
            const shape = result.Get()
            this.stanceShapes.set(stance, shape)
            // ShapeResult owns the alternate shape until CharacterVirtual takes
            // a reference during SetShape. Retain all three results for the
            // world lifetime; borrowed Get() wrappers alone do not own a ref.
            this.stanceShapeResources.push({ result, translated: translatedSettings, capsule: capsuleSettings })
            Jolt.destroy(shapeOffset)
            return shape
        }
        const standingShape = makeStanceShape(Stance.Standing, tuning.capsuleHalfHeight, tuning.capsuleRadius)
        makeStanceShape(Stance.Crouched, tuning.crouchCapsuleHalfHeight, tuning.crouchCapsuleRadius)
        makeStanceShape(Stance.Prone, tuning.proneCapsuleHalfHeight, tuning.proneCapsuleRadius)
        const characterSettings = new Jolt.CharacterVirtualSettings()
        characterSettings.mShape = standingShape
        characterSettings.mMaxSlopeAngle = tuning.maxSlopeRadians
        characterSettings.mBackFaceMode = Jolt.EBackFaceMode_CollideWithBackFaces
        characterSettings.mCharacterPadding = 0.02
        characterSettings.mPredictiveContactDistance = 0.1
        characterSettings.mPenetrationRecoverySpeed = 1
        characterSettings.mSupportingVolume = new Jolt.Plane(Jolt.Vec3.prototype.sAxisY(), -tuning.capsuleRadius)
        characterSettings.mMass = 80
        this.spawnVector = new Jolt.RVec3(spawn.x, spawn.y, spawn.z)
        this.character = new Jolt.CharacterVirtual(characterSettings, this.spawnVector, identity, this.physicsSystem)
        Jolt.destroy(characterSettings)

        this.broadPhaseFilter = new Jolt.DefaultBroadPhaseLayerFilter(this.joltInterface.GetObjectVsBroadPhaseLayerFilter(), CHARACTER_LAYER)
        this.objectLayerFilter = new Jolt.DefaultObjectLayerFilter(this.joltInterface.GetObjectLayerPairFilter(), CHARACTER_LAYER)
        this.bodyFilter = new Jolt.BodyFilter()
        this.shapeFilter = new Jolt.ShapeFilter()
        this.updateSettings = new Jolt.ExtendedUpdateSettings()
        this.updateSettings.mWalkStairsStepUp.Set(0, tuning.stepUpHeight, 0)
        this.updateSettings.mStickToFloorStepDown.Set(0, -tuning.stickToFloorDistance, 0)
        this.velocityVector = new Jolt.Vec3()
        const gravity = new Jolt.Vec3(0, -tuning.gravity, 0)
        this.physicsSystem.SetGravity(gravity)
        Jolt.destroy(gravity)
    }

    step(command: MovementCommand, dt: number): void {
        if (this.disposed) return
        const current = this.character.GetLinearVelocity()
        const groundVelocity = this.character.GetGroundVelocity()
        const currentVelocity = { x: current.GetX(), y: current.GetY(), z: current.GetZ() }
        const grounded = this.character.GetGroundState() === this.Jolt.EGroundState_OnGround
        const position = this.position
        const mantleTarget = command.jump && !grounded && this.tuning.mantleEnabled ? this.findMantleTarget(position, command.yaw) : undefined
        const resolvedCommand = mantleTarget ? { ...command, mantleTarget } : command
        const result = stepMovementState(this.movementStateValue, resolvedCommand, {
            grounded, position: { ...position }, horizontalSpeed: Math.hypot(currentVelocity.x, currentVelocity.z),
            canAdoptStance: (stance) => this.applyStance(stance),
        }, dt, this.tuning)
        let nextState = result.state
        if (nextState.stance !== this.appliedStance && !this.applyStance(nextState.stance)) nextState = { ...nextState, stance: this.appliedStance }
        this.movementStateValue = nextState
        if (result.authoredPosition) {
            this.spawnVector.Set(result.authoredPosition.x, result.authoredPosition.y, result.authoredPosition.z)
            this.character.SetPosition(this.spawnVector)
            this.velocityVector.Set(0, 0, 0); this.character.SetLinearVelocity(this.velocityVector)
            this.joltInterface.Step(dt, 1)
            return
        }
        const groundY = groundVelocity.GetY()
        const locked = result.state.mode === MovementMode.Dashing || result.state.mode === MovementMode.Sliding
        const acceleration = grounded ? this.tuning.groundAcceleration : this.tuning.airAcceleration * this.tuning.airControl
        const maxDelta = acceleration * dt
        const approach = (value: number, target: number): number => value < target ? Math.min(value + maxDelta, target) : Math.max(value - maxDelta, target)
        const velocity = {
            x: locked ? result.desiredHorizontal.x : approach(currentVelocity.x, result.desiredHorizontal.x),
            y: currentVelocity.y,
            z: locked ? result.desiredHorizontal.z : approach(currentVelocity.z, result.desiredHorizontal.z),
        }
        if (grounded && currentVelocity.y - groundY < .1) { velocity.y = groundY; if (result.jump) velocity.y += this.tuning.jumpSpeed }
        velocity.y = Math.max(velocity.y - this.tuning.gravity * dt, -this.tuning.terminalVelocity)
        this.velocityVector.Set(velocity.x, velocity.y, velocity.z)
        this.character.SetLinearVelocity(this.velocityVector)
        this.character.ExtendedUpdate(
            dt, this.physicsSystem.GetGravity(), this.updateSettings,
            this.broadPhaseFilter, this.objectLayerFilter, this.bodyFilter,
            this.shapeFilter, this.joltInterface.GetTempAllocator()
        )
        this.joltInterface.Step(dt, 1)
        if (this.position.y < -20) this.teleport(this.spawn)
    }

    teleport(position: PhysicsPosition): void {
        this.setState(position, { x: 0, y: 0, z: 0 })
    }

    setState(position: PhysicsPosition, velocity: PhysicsPosition, movementState?: MovementState): void {
        this.spawn = { ...position }
        this.spawnVector.Set(position.x, position.y, position.z)
        this.character.SetPosition(this.spawnVector)
        // CharacterVirtual caches its contacts and ground state. Reconciliation
        // rewinds to an older authoritative position, so retaining contacts from
        // the newer predicted position can make a grounded jump replay as if the
        // character were still airborne. The native server refreshes contacts in
        // its position setter; do the same here before replaying pending inputs.
        this.character.RefreshContacts(
            this.broadPhaseFilter, this.objectLayerFilter, this.bodyFilter,
            this.shapeFilter, this.joltInterface.GetTempAllocator()
        )
        this.velocityVector.Set(velocity.x, velocity.y, velocity.z)
        this.character.SetLinearVelocity(this.velocityVector)
        if (movementState) {
            const restored = { ...movementState, dashDirection: { ...movementState.dashDirection }, mantleStart: { ...movementState.mantleStart }, mantleTarget: { ...movementState.mantleTarget } }
            if (this.applyStance(restored.stance)) this.movementStateValue = restored
        }
        Object.assign(this.cachedPosition, position); Object.assign(this.cachedVelocity, velocity)
    }

    get position(): PhysicsPosition {
        const value = this.character.GetPosition()
        this.cachedPosition.x = value.GetX(); this.cachedPosition.y = value.GetY(); this.cachedPosition.z = value.GetZ(); return this.cachedPosition
    }
    get velocity(): PhysicsPosition {
        const value = this.character.GetLinearVelocity()
        this.cachedVelocity.x = value.GetX(); this.cachedVelocity.y = value.GetY(); this.cachedVelocity.z = value.GetZ(); return this.cachedVelocity
    }
    get grounded(): boolean { return this.character.GetGroundState() === this.Jolt.EGroundState_OnGround }
    get movementState(): MovementState { return { ...this.movementStateValue, dashDirection: { ...this.movementStateValue.dashDirection }, mantleStart: { ...this.movementStateValue.mantleStart }, mantleTarget: { ...this.movementStateValue.mantleTarget } } }

    private applyStance(stance: Stance): boolean {
        if (stance === this.appliedStance) return true
        const shape = this.stanceShapes.get(stance)
        if (!shape) return false
        const accepted = this.character.SetShape(shape, .04, this.broadPhaseFilter, this.objectLayerFilter, this.bodyFilter, this.shapeFilter, this.joltInterface.GetTempAllocator())
        if (accepted) this.appliedStance = stance
        return accepted
    }

    private castFraction(origin: PhysicsPosition, displacement: PhysicsPosition): number | undefined {
        const rayOrigin = new this.Jolt.RVec3(origin.x, origin.y, origin.z)
        const rayDirection = new this.Jolt.Vec3(displacement.x, displacement.y, displacement.z)
        const ray = new this.Jolt.RRayCast(rayOrigin, rayDirection)
        const settings = new this.Jolt.RayCastSettings()
        const collector = new this.Jolt.CastRayClosestHitCollisionCollector()
        this.physicsSystem.GetNarrowPhaseQuery().CastRay(ray, settings, collector, this.broadPhaseFilter, this.objectLayerFilter, this.bodyFilter, this.shapeFilter)
        const fraction = collector.HadHit() ? collector.mHit.mFraction : undefined
        this.Jolt.destroy(collector); this.Jolt.destroy(settings); this.Jolt.destroy(ray); this.Jolt.destroy(rayDirection); this.Jolt.destroy(rayOrigin)
        return fraction
    }

    private findMantleTarget(feet: PhysicsPosition, yaw: number): PhysicsPosition | undefined {
        const forward = { x: Math.sin(yaw), y: 0, z: -Math.cos(yaw) }
        const right = { x: -forward.z, y: 0, z: forward.x }
        let nearest: number | undefined
        for (const lateral of [0, -.6 * this.tuning.capsuleRadius, .6 * this.tuning.capsuleRadius]) {
            const fraction = this.castFraction({ x: feet.x + right.x * lateral, y: feet.y + this.tuning.mantleMinHeight, z: feet.z + right.z * lateral }, { x: forward.x * this.tuning.mantleReach, y: 0, z: forward.z * this.tuning.mantleReach })
            if (fraction !== undefined && (nearest === undefined || fraction < nearest)) nearest = fraction
        }
        if (nearest === undefined) return undefined
        const distance = nearest * this.tuning.mantleReach + this.tuning.capsuleRadius + .08
        const beyond = { x: feet.x + forward.x * distance, z: feet.z + forward.z * distance }
        const downLength = this.tuning.mantleMaxHeight - this.tuning.mantleMinHeight + .16
        const downOrigin = { x: beyond.x, y: feet.y + this.tuning.mantleMaxHeight + .08, z: beyond.z }
        const topFraction = this.castFraction(downOrigin, { x: 0, y: -downLength, z: 0 })
        if (topFraction === undefined) return undefined
        const target = { x: beyond.x, y: downOrigin.y - downLength * topFraction + .025, z: beyond.z }
        const height = 2 * (this.tuning.capsuleRadius + this.tuning.capsuleHalfHeight)
        for (const offset of [{ x: 0, z: 0 }, { x: right.x * this.tuning.capsuleRadius, z: right.z * this.tuning.capsuleRadius }, { x: -right.x * this.tuning.capsuleRadius, z: -right.z * this.tuning.capsuleRadius }])
            if (this.castFraction({ x: target.x + offset.x, y: target.y + .05, z: target.z + offset.z }, { x: 0, y: height - .05, z: 0 }) !== undefined) return undefined
        return target
    }

    dispose(): void {
        if (this.disposed) return
        this.disposed = true
        this.Jolt.destroy(this.velocityVector)
        this.Jolt.destroy(this.spawnVector)
        this.Jolt.destroy(this.updateSettings)
        this.Jolt.destroy(this.shapeFilter)
        this.Jolt.destroy(this.bodyFilter)
        this.Jolt.destroy(this.objectLayerFilter)
        this.Jolt.destroy(this.broadPhaseFilter)
        this.Jolt.destroy(this.character)
        for (const resource of this.stanceShapeResources) {
            resource.result.Clear()
            this.Jolt.destroy(resource.translated)
            this.Jolt.destroy(resource.capsule)
        }
        this.stanceShapeResources.length = 0
        this.stanceShapes.clear()
        this.bodyInterface.RemoveBody(this.staticBodyId)
        this.bodyInterface.DestroyBody(this.staticBodyId)
        this.Jolt.destroy(this.joltInterface)
    }
}
