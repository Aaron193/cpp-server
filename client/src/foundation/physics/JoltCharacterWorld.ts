import type initJolt from 'jolt-physics/wasm-compat'
import type { CollisionMeshData } from '../assets/CollisionMesh'
import { DEFAULT_MOVEMENT_TUNING, stepMovementVelocity, type MovementCommand, type MovementTuning } from './Movement'

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

        const shapeOffset = new Jolt.Vec3(0, tuning.capsuleHalfHeight + tuning.capsuleRadius, 0)
        const capsuleSettings = new Jolt.CapsuleShapeSettings(tuning.capsuleHalfHeight, tuning.capsuleRadius)
        const translatedSettings = new Jolt.RotatedTranslatedShapeSettings(shapeOffset, identity, capsuleSettings)
        const capsuleResult = translatedSettings.Create()
        if (!capsuleResult.IsValid()) throw new Error('Jolt rejected the player capsule')
        const characterSettings = new Jolt.CharacterVirtualSettings()
        characterSettings.mShape = capsuleResult.Get()
        characterSettings.mMaxSlopeAngle = tuning.maxSlopeRadians
        characterSettings.mBackFaceMode = Jolt.EBackFaceMode_CollideWithBackFaces
        characterSettings.mCharacterPadding = 0.02
        characterSettings.mPredictiveContactDistance = 0.1
        characterSettings.mPenetrationRecoverySpeed = 1
        characterSettings.mSupportingVolume = new Jolt.Plane(Jolt.Vec3.prototype.sAxisY(), -tuning.capsuleRadius)
        characterSettings.mMass = 80
        this.spawnVector = new Jolt.RVec3(spawn.x, spawn.y, spawn.z)
        this.character = new Jolt.CharacterVirtual(characterSettings, this.spawnVector, identity, this.physicsSystem)
        capsuleResult.Clear()
        Jolt.destroy(characterSettings)
        Jolt.destroy(translatedSettings)
        Jolt.destroy(shapeOffset)

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
        const velocity = stepMovementVelocity(
            { x: current.GetX(), y: current.GetY(), z: current.GetZ() }, command,
            this.character.GetGroundState() === this.Jolt.EGroundState_OnGround,
            dt, this.tuning, groundVelocity.GetY()
        )
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

    setState(position: PhysicsPosition, velocity: PhysicsPosition): void {
        this.spawn = { ...position }
        this.spawnVector.Set(position.x, position.y, position.z)
        this.character.SetPosition(this.spawnVector)
        this.velocityVector.Set(velocity.x, velocity.y, velocity.z)
        this.character.SetLinearVelocity(this.velocityVector)
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
        this.bodyInterface.RemoveBody(this.staticBodyId)
        this.bodyInterface.DestroyBody(this.staticBodyId)
        this.Jolt.destroy(this.joltInterface)
    }
}
