import { Entity } from './graphics/Entity'
import { Interpolator } from './Interpolator'
import { Renderer } from './Renderer'
import { TerrainGenerator } from './TerrainGenerator'
import { Terrain } from './graphics/Terrain'

export class World {
    renderer: Renderer
    interpolator: Interpolator = new Interpolator(this)
    entities: Map<number, Entity> = new Map()
    // maybe we can rethink these two identifiers... maybe a controlled entity id, and a camera entity id?
    cameraEntityId: number = -1
    active: boolean = false // actively in world vs non active in world, eg: spectator vs player
    terrainGenerator: TerrainGenerator | null = null
    terrain: Terrain | null = null

    private constructor(renderer: Renderer) {
        this.renderer = renderer
    }

    public static async create(): Promise<World> {
        const renderer = await Renderer.create()
        const world = new World(renderer)
        renderer.setWorld(world)
        return world
    }

    isControllingPlayer() {
        return this.active && this.entities.has(this.cameraEntityId)
    }

    initializeTerrain(
        seed: number,
        worldSize: number,
        rivers?: Array<{path: Array<{x: number, y: number}>}>
    ) {
        console.log('Initializing terrain with seed:', seed, 'worldSize:', worldSize, 'rivers:', rivers?.length)
        
        // Create terrain generator with optional server river data
        this.terrainGenerator = new TerrainGenerator(seed, worldSize)
        this.terrainGenerator.generate(rivers)

        // Create terrain renderer
        this.terrain = new Terrain(this.terrainGenerator)
        this.renderer.addTerrain(this.terrain)

        // Initialize minimap with terrain data
        this.renderer.hud.minimap.initializeTerrain(this.terrainGenerator)
    }

    update(delta: number, tick: number, now: number) {
        this.interpolator.update(delta, tick, now)

        this.entities.forEach((entity) => {
            entity.update(delta, tick, now)
        })

        const cameraEntity = this.entities.get(this.cameraEntityId)

        if (cameraEntity) {
            this.renderer.centerCamera(
                cameraEntity.position.x,
                cameraEntity.position.y
            )

            // Update terrain based on camera position
            if (this.terrain) {
                const viewWidth = this.renderer.app.renderer.width
                const viewHeight = this.renderer.app.renderer.height
                this.terrain.update(
                    cameraEntity.position.x,
                    cameraEntity.position.y,
                    viewWidth,
                    viewHeight
                )
            }
        }

        this.renderer.update(delta, tick, now)
        this.renderer.render()
    }
}
