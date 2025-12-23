import * as PIXI from 'pixi.js'
import { Biome, TerrainGenerator } from '../../TerrainGenerator'
import { COLORS, STROKE_WIDTH } from '../../utils/constants'
import { Hud } from './Hud'

// Minimap configuration
const MINIMAP_SIZE = 200 // Size of minimap in pixels
const MINIMAP_PADDING = 10 // Padding from edge of screen
const MINIMAP_ALPHA = 0.85

// Height-based color map inspired by volcanic island generation
// Maps normalized height (0-1) to RGB colors
interface ColorRGB {
    r: number
    g: number
    b: number
}

const HEIGHT_COLOR_MAP: Record<number, ColorRGB> = {
    1.0: { r: 61, g: 70, b: 41 },      // Dark green (high mountains/forest)
    0.8: { r: 118, g: 133, b: 78 },    // Green (hills)
    0.69: { r: 153, g: 146, b: 78 },   // Tan (plains)
    0.68: { r: 161, g: 164, b: 77 },   // Light tan (plains)
    0.545: { r: 197, g: 192, b: 111 }, // Pale tan (highlands)
    0.53: { r: 225, g: 209, b: 132 },  // Sand (upper beach)
    0.51: { r: 248, g: 238, b: 202 },  // Light sand (beach)
    0.5: { r: 219, g: 187, b: 130 },   // Brown sand (beach edge)
    0.49: { r: 10, g: 194, b: 182 },   // Cyan (shallow water)
    0.48: { r: 8, g: 139, b: 151 },    // Blue-cyan (water)
    0.46: { r: 0, g: 91, b: 130 },     // Blue (deeper water)
    0.35: { r: 0, g: 39, b: 100 },    // Dark blue (deep ocean)
    0.25: { r: 7, g: 16, b: 59 },      // Very dark blue (deeper ocean)
    0.15: { r: 7, g: 16, b: 59 },      // Very dark blue
    0.0: { r: 11, g: 10, b: 42 },      // Darkest blue (deepest ocean)
}

// Get color for a given normalized height value (0-1)
function getHeightColor(normalizedHeight: number): ColorRGB {
    const keys = Object.keys(HEIGHT_COLOR_MAP).map(Number).sort((a, b) => b - a)
    
    // Find closest key
    let closestKey = keys[0]
    let minDiff = Math.abs(normalizedHeight - closestKey)
    
    for (const key of keys) {
        const diff = Math.abs(normalizedHeight - key)
        if (diff < minDiff) {
            minDiff = diff
            closestKey = key
        }
    }
    
    return HEIGHT_COLOR_MAP[closestKey]
}

export class Minimap extends PIXI.Container {
    private hud: Hud
    private background: PIXI.Graphics
    private terrainTexture: PIXI.Texture | null = null
    private terrainSprite: PIXI.Sprite | null = null
    private riverGraphics: PIXI.Graphics
    private entitiesGraphics: PIXI.Graphics
    private viewportRect: PIXI.Graphics
    private border: PIXI.Graphics
    
    private worldSize: number = 0
    private minimapScale: number = 1

    constructor(hud: Hud) {
        super()
        this.hud = hud

        // Create background
        this.background = new PIXI.Graphics()
        this.background.rect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE)
        this.background.fill({ color: 0x000000, alpha: 0.5 })
        this.addChild(this.background)

        // River layer
        this.riverGraphics = new PIXI.Graphics()
        this.addChild(this.riverGraphics)

        // Entities layer (players, structures, etc)
        this.entitiesGraphics = new PIXI.Graphics()
        this.addChild(this.entitiesGraphics)

        // Viewport rectangle (shows current camera view)
        this.viewportRect = new PIXI.Graphics()
        this.addChild(this.viewportRect)

        // Border
        this.border = new PIXI.Graphics()
        this.border.rect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE)
        this.border.stroke({
            width: STROKE_WIDTH * 2,
            color: COLORS.STROKE,
            alignment: 0,
        })
        this.addChild(this.border)

        this.alpha = MINIMAP_ALPHA
        this.position.set(
            window.innerWidth - MINIMAP_SIZE - MINIMAP_PADDING,
            MINIMAP_PADDING
        )
    }

    /**
     * Initialize minimap with terrain data
     */
    initializeTerrain(terrainGen: TerrainGenerator) {
        this.worldSize = terrainGen.getWorldSize()
        this.minimapScale = MINIMAP_SIZE / (this.worldSize * 64) // 64 = tile size in pixels

        // Generate minimap terrain texture
        this.generateTerrainTexture(terrainGen)
        
        // Draw rivers
        this.drawRivers(terrainGen)
    }

    /**
     * Generate a texture for the terrain
     */
    private generateTerrainTexture(terrainGen: TerrainGenerator) {
        const canvas = document.createElement('canvas')
        canvas.width = MINIMAP_SIZE
        canvas.height = MINIMAP_SIZE
        const ctx = canvas.getContext('2d')!

        const pixelsPerTile = MINIMAP_SIZE / this.worldSize

        for (let y = 0; y < this.worldSize; y++) {
            for (let x = 0; x < this.worldSize; x++) {
                const tile = terrainGen.getTile(x, y)
                if (!tile) continue

                // Normalize height to 0-1 range
                const normalizedHeight = tile.height / 255
                
                // Get color based on height
                const color = getHeightColor(normalizedHeight)

                ctx.fillStyle = `rgb(${color.r},${color.g},${color.b})`
                ctx.fillRect(
                    x * pixelsPerTile,
                    y * pixelsPerTile,
                    Math.ceil(pixelsPerTile),
                    Math.ceil(pixelsPerTile)
                )
            }
        }

        // Create texture from canvas
        this.terrainTexture = PIXI.Texture.from(canvas)
        this.terrainSprite = new PIXI.Sprite(this.terrainTexture)
        this.addChildAt(this.terrainSprite, 1) // Add after background
    }

    /**
     * Draw rivers on minimap
     */
    private drawRivers(terrainGen: TerrainGenerator) {
        this.riverGraphics.clear()

        const rivers = terrainGen.getRivers()
        if (rivers.length === 0) return

        this.riverGraphics.stroke({
            width: 1,
            color: 0x4a90e2,
            alpha: 0.7,
        })

        for (const river of rivers) {
            if (river.path.length < 2) continue

            const firstPoint = river.path[0]
            const minimapX = (firstPoint.x * 64) * this.minimapScale
            const minimapY = (firstPoint.y * 64) * this.minimapScale

            this.riverGraphics.moveTo(minimapX, minimapY)

            for (let i = 1; i < river.path.length; i++) {
                const point = river.path[i]
                const x = (point.x * 64) * this.minimapScale
                const y = (point.y * 64) * this.minimapScale
                this.riverGraphics.lineTo(x, y)
            }
        }

        this.riverGraphics.stroke()
    }

    /**
     * Update minimap each frame
     */
    update(_delta: number, _tick: number, _now: number) {
        const world = this.hud.renderer.world
        if (!world.terrainGenerator) return

        // Clear entities
        this.entitiesGraphics.clear()

        // Draw players
        world.entities.forEach((entity, id) => {
            const x = entity._x * this.minimapScale
            const y = entity._y * this.minimapScale

            // Draw player as colored dot
            if (id === world.cameraEntityId) {
                // Current player (yellow)
                this.entitiesGraphics.circle(x, y, 3)
                this.entitiesGraphics.fill({ color: 0xffff00 })
                
                // Add pulse effect
                this.entitiesGraphics.circle(x, y, 4)
                this.entitiesGraphics.stroke({
                    width: 1,
                    color: 0xffff00,
                    alpha: 0.5,
                })
            } else if (entity._type === 1) {
                // Other players (red)
                this.entitiesGraphics.circle(x, y, 2.5)
                this.entitiesGraphics.fill({ color: 0xff4444 })
            } else {
                // Other entities (small gray dots)
                this.entitiesGraphics.circle(x, y, 1)
                this.entitiesGraphics.fill({ color: 0x888888, alpha: 0.5 })
            }
        })

        // Draw viewport rectangle (shows current camera view)
        this.updateViewportRect()
    }

    /**
     * Update the viewport rectangle showing current camera view
     */
    private updateViewportRect() {
        this.viewportRect.clear()

        const renderer = this.hud.renderer
        const camera = renderer.camera
        
        // Get screen dimensions
        const screenWidth = renderer.renderer.screen.width
        const screenHeight = renderer.renderer.screen.height

        // Calculate viewport in world coordinates
        const worldCenterX = -camera.x + screenWidth / 2
        const worldCenterY = -camera.y + screenHeight / 2

        // Convert to minimap coordinates
        const minimapCenterX = worldCenterX * this.minimapScale
        const minimapCenterY = worldCenterY * this.minimapScale
        const minimapWidth = screenWidth * this.minimapScale
        const minimapHeight = screenHeight * this.minimapScale

        // Draw viewport rectangle
        this.viewportRect.rect(
            minimapCenterX - minimapWidth / 2,
            minimapCenterY - minimapHeight / 2,
            minimapWidth,
            minimapHeight
        )
        this.viewportRect.stroke({
            width: 2,
            color: 0xffffff,
            alpha: 0.8,
        })
    }

    /**
     * Resize minimap when window resizes
     */
    resize() {
        this.position.set(
            window.innerWidth - MINIMAP_SIZE - MINIMAP_PADDING,
            MINIMAP_PADDING
        )
    }

    /**
     * Toggle minimap visibility
     */
    toggle() {
        this.visible = !this.visible
    }

    /**
     * Set minimap visibility
     */
    setVisible(visible: boolean) {
        this.visible = visible
    }
}
