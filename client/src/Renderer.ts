import * as PIXI from 'pixi.js'
import { Hud } from './graphics/hud/Hud'
import { World } from './World'
import { Grid } from './graphics/Grid'
import { TerrainRenderer } from './graphics/TerrainRenderer'

const TEMP_VEC = { x: 0, y: 0 }

export class Renderer {
    world!: World
    canvas: HTMLCanvasElement
    stage: PIXI.Container
    camera: PIXI.Container
    hud: Hud
    grid: Grid
    terrainRenderer: TerrainRenderer
    background: PIXI.Container
    middleground: PIXI.Container
    foreground: PIXI.Container
    app!: { renderer: PIXI.Renderer }
    renderer!: PIXI.Renderer
    private readonly worldScale = 1 // for debug map purposes

    private constructor() {
        this.canvas = document.getElementById(
            'game_canvas'
        ) as HTMLCanvasElement

        // Game World Containers
        this.camera = new PIXI.Container({
            isRenderGroup: true,
        })
        this.camera.scale.set(this.worldScale, this.worldScale)

        this.background = new PIXI.Container()
        this.middleground = new PIXI.Container()
        this.foreground = new PIXI.Container()

        // Initialize terrain renderer
        this.terrainRenderer = new TerrainRenderer(this)
        this.background.addChild(this.terrainRenderer.getContainer())

        this.grid = new Grid(this)
        this.background.addChild(this.grid)

        this.camera.addChild(this.background)
        this.camera.addChild(this.middleground)
        this.camera.addChild(this.foreground)

        // also render group
        this.hud = new Hud(this)
        this.stage = new PIXI.Container()

        this.stage.addChild(this.camera)
        this.stage.addChild(this.hud)

        window.addEventListener('resize', () => {
            if (this.renderer) {
                this.resize()
            }
        })
    }

    private async init() {
        this.renderer = await PIXI.autoDetectRenderer({
            width: window.innerWidth,
            height: window.innerHeight,
            canvas: this.canvas,
            antialias: false,
            resolution: 1,
            backgroundColor: 0x509446,
        })

        this.app = { renderer: this.renderer }

        this.resize()
    }

    public static async create(): Promise<Renderer> {
        const rendererInstance = new Renderer()
        await rendererInstance.init()
        return rendererInstance
    }

    setWorld(world: World) {
        this.world = world
    }

    resize() {
        this.renderer.resize(window.innerWidth, window.innerHeight)
        this.hud.resize()
    }

    centerCamera(x: number, y: number) {
        this.camera.x = -x + 0.5 * this.renderer.screen.width
        this.camera.y = -y + 0.5 * this.renderer.screen.height
    }

    toWorldCoordinates(mouseX: number, mouseY: number) {
        TEMP_VEC.x = mouseX - this.camera.x
        TEMP_VEC.y = mouseY - this.camera.y

        return TEMP_VEC
    }

    update(delta: number, tick: number, now: number) {
        this.terrainRenderer.update(delta, tick, now)
        this.grid.update(delta, tick, now)
        this.hud.update(delta, tick, now)
    }

    render() {
        this.renderer.render(this.stage)
    }
}
