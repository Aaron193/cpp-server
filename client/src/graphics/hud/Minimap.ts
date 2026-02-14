import * as PIXI from 'pixi.js'
import { BiomeType } from '../../enums/BiomeType'
import { Renderer } from '../../Renderer'
import { COLORS, STROKE_WIDTH } from '../../utils/constants'
import { TerrainRenderer } from '../TerrainRenderer'

export class Minimap extends PIXI.Container {
    private renderer: Renderer
    private background: PIXI.Graphics
    private maskShape: PIXI.Graphics
    private minimapContainer: PIXI.Container
    private minimapGraphics: PIXI.Graphics
    private terrainTexture: PIXI.RenderTexture | null = null
    private terrainSprite: PIXI.Sprite
    private terrainDirty: boolean = false
    private playerMarker: PIXI.Graphics
    private minimapWidth: number = 200
    private minimapHeight: number = 200
    private readonly baseWidth: number = 200
    private readonly baseHeight: number = 200
    private readonly expandedWidth: number = 720
    private readonly expandedHeight: number = 720
    private readonly margin: number = 10 // space from screen edges
    private readonly markerRadius: number = 3
    private worldToMinimapScale: number = 1
    private offsetX: number = 0
    private offsetY: number = 0
    private minX: number = Infinity
    private maxX: number = -Infinity
    private minY: number = Infinity
    private maxY: number = -Infinity
    private meshes: Array<{
        biome: BiomeType
        vertices: { x: number; y: number }[]
        indices: number[]
    }> = []
    private isExpanded: boolean = false

    constructor(renderer: Renderer) {
        super()
        this.renderer = renderer

        // Create background panel
        this.background = new PIXI.Graphics()
        this.addChild(this.background)

        // Mask for terrain (separate from background so border stays visible)
        this.maskShape = new PIXI.Graphics()
        this.addChild(this.maskShape)

        this.minimapContainer = new PIXI.Container()
        this.minimapContainer.x = 0
        this.minimapContainer.y = 0
        // Clip terrain to panel bounds so large meshes don't spill over
        this.minimapContainer.mask = this.maskShape
        this.addChild(this.minimapContainer)

        // Create terrain graphics
        this.minimapGraphics = new PIXI.Graphics()

        // Cached terrain texture + sprite (we render into texture, display sprite)
        this.terrainTexture = this.createTerrainTexture()
        this.terrainSprite = new PIXI.Sprite(this.terrainTexture)
        this.terrainSprite.anchor.set(0, 0)
        this.minimapContainer.addChild(this.terrainSprite)

        // Create player marker
        this.playerMarker = new PIXI.Graphics()
        this.drawPlayerMarker()
        this.minimapContainer.addChild(this.playerMarker)

        // Initial draw/layout
        this.applyLayout()
    }

    resize() {
        this.applyLayout()
    }

    private drawPlayerMarker() {
        this.playerMarker.clear()
        const inverseScale = this.isExpanded
            ? 1
            : this.expandedWidth / this.baseWidth
        const actualRadius = this.markerRadius * inverseScale

        this.playerMarker.circle(0, 0, actualRadius)
        this.playerMarker.fill({ color: 0xff0000, alpha: 1.0 })
        // Add a white border for better visibility
        this.playerMarker.stroke({
            color: 0xffffff,
            width: inverseScale,
            alpha: 0.8,
        })
    }

    private applyLayout() {
        // Size based on expanded state
        this.minimapWidth = this.isExpanded
            ? this.expandedWidth
            : this.baseWidth
        this.minimapHeight = this.isExpanded
            ? this.expandedHeight
            : this.baseHeight

        // Redraw background/border
        this.background.clear()
        this.background.rect(0, 0, this.minimapWidth, this.minimapHeight)
        this.background.fill({ color: 0x000000, alpha: 0.7 })
        this.background.stroke({
            color: COLORS.STROKE,
            width: STROKE_WIDTH * 2,
        })

        // Update mask to clip inner content
        this.maskShape.clear()
        this.maskShape.rect(0, 0, this.minimapWidth, this.minimapHeight)
        this.maskShape.fill({ color: 0xffffff, alpha: 1 })

        // Position panel
        if (this.isExpanded) {
            this.x =
                0.5 * (this.renderer.renderer.screen.width - this.minimapWidth)
            this.y =
                0.5 *
                (this.renderer.renderer.screen.height - this.minimapHeight)
        } else {
            // Anchor collapsed minimap to top-right with the configured margin
            this.x =
                this.renderer.renderer.screen.width -
                this.minimapWidth -
                this.margin
            this.y = this.margin
        }

        // Scale cached terrain + marker container to fit the current panel size
        const scaleX = this.minimapWidth / this.expandedWidth
        const scaleY = this.minimapHeight / this.expandedHeight
        this.minimapContainer.scale.set(scaleX, scaleY)

        // Redraw player marker with inverse scaling
        this.drawPlayerMarker()

        // Recompute transforms using expanded size (render texture size) but avoid redraw
        this.recomputeTransform()
    }

    private updateBounds(vertices: { x: number; y: number }[]) {
        for (const v of vertices) {
            if (v.x < this.minX) this.minX = v.x
            if (v.x > this.maxX) this.maxX = v.x
            if (v.y < this.minY) this.minY = v.y
            if (v.y > this.maxY) this.maxY = v.y
        }

        this.recomputeTransform()
    }

    private recomputeTransform() {
        if (!isFinite(this.minX) || !isFinite(this.maxX)) return

        // Always compute against the full render texture size so we can scale down cheaply
        const availableWidth = this.expandedWidth
        const availableHeight = this.expandedHeight

        const spanX = Math.max(this.maxX - this.minX, 1)
        const spanY = Math.max(this.maxY - this.minY, 1)

        this.worldToMinimapScale = Math.min(
            availableWidth / spanX,
            availableHeight / spanY
        )

        this.offsetX = 0
        this.offsetY = 0
    }

    /**
     * Update minimap with terrain data from the main terrain renderer
     * This should be called whenever terrain meshes are added
     */
    addTerrainMesh(
        biome: BiomeType,
        vertices: { x: number; y: number }[],
        indices: number[]
    ): void {
        this.meshes.push({ biome, vertices, indices })

        this.updateBounds(vertices)

        this.terrainDirty = true
    }

    private redrawTerrain(force: boolean = false) {
        if (!this.terrainDirty && !force) return

        this.ensureTerrainTexture()

        this.minimapGraphics.clear()

        for (const mesh of this.meshes) {
            const color = TerrainRenderer.getBiomeColor(mesh.biome)
            const { vertices, indices } = mesh

            for (let i = 0; i < indices.length; i += 3) {
                const idx0 = indices[i]
                const idx1 = indices[i + 1]
                const idx2 = indices[i + 2]

                const v0 = vertices[idx0]
                const v1 = vertices[idx1]
                const v2 = vertices[idx2]

                const pox1 =
                    (v0.x - this.minX) * this.worldToMinimapScale + this.offsetX
                const poy1 =
                    (v0.y - this.minY) * this.worldToMinimapScale + this.offsetY
                const pox2 =
                    (v1.x - this.minX) * this.worldToMinimapScale + this.offsetX
                const poy2 =
                    (v1.y - this.minY) * this.worldToMinimapScale + this.offsetY
                const pox3 =
                    (v2.x - this.minX) * this.worldToMinimapScale + this.offsetX
                const poy3 =
                    (v2.y - this.minY) * this.worldToMinimapScale + this.offsetY

                this.minimapGraphics.poly([pox1, poy1, pox2, poy2, pox3, poy3])
                this.minimapGraphics.fill({ color, alpha: 1.0 })
            }
        }

        // Render terrain graphics into the cached texture once; toggles just scale it
        this.renderer.renderer.render({
            container: this.minimapGraphics,
            target: this.terrainTexture!,
            clear: true,
        })

        this.terrainDirty = false
    }

    /**
     * Update player position on minimap
     */
    updatePlayerPosition(worldX: number, worldY: number) {
        this.playerMarker.x =
            (worldX - this.minX) * this.worldToMinimapScale + this.offsetX
        this.playerMarker.y =
            (worldY - this.minY) * this.worldToMinimapScale + this.offsetY

        // Keep marker within render-texture bounds (pre-scale domain)
        const maxX = this.expandedWidth
        const maxY = this.expandedHeight

        if (this.playerMarker.x < 0) this.playerMarker.x = 0
        if (this.playerMarker.x > maxX) this.playerMarker.x = maxX
        if (this.playerMarker.y < 0) this.playerMarker.y = 0
        if (this.playerMarker.y > maxY) this.playerMarker.y = maxY
    }

    toggleExpanded() {
        this.isExpanded = !this.isExpanded
        this.applyLayout()
    }

    private ensureTerrainTexture() {
        // Recreate if missing (context loss) or size mismatch
        if (
            !this.terrainTexture ||
            this.terrainTexture.width !== this.expandedWidth ||
            this.terrainTexture.height !== this.expandedHeight
        ) {
            // Destroy old texture to prevent memory leak
            if (this.terrainTexture) {
                this.terrainTexture.destroy(true)
            }

            this.terrainTexture = this.createTerrainTexture()
            this.terrainSprite.texture = this.terrainTexture
            this.terrainDirty = true
        }
    }

    private createTerrainTexture(): PIXI.RenderTexture {
        return PIXI.RenderTexture.create({
            width: this.expandedWidth,
            height: this.expandedHeight,
            resolution: 1,
        })
    }

    clear() {
        this.meshes = []
        this.minimapGraphics.clear()
        this.terrainDirty = true
        this.redrawTerrain(true)
    }

    update(delta: number, tick: number, now: number) {
        // Redraw terrain if needed
        if (this.terrainDirty) {
            this.redrawTerrain()
        }

        // Update player position if we have a world
        if (this.renderer.world) {
            const player = this.renderer.world.entities.get(
                this.renderer.world.cameraEntityId
            )
            if (player) {
                this.updatePlayerPosition(player.position.x, player.position.y)
            }
        }
    }

    destroy(options?: boolean | PIXI.DestroyOptions) {
        // Clean up render texture
        if (this.terrainTexture) {
            this.terrainTexture.destroy(true)
            this.terrainTexture = null
        }
        super.destroy(options)
    }
}
