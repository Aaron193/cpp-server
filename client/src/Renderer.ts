import * as PIXI from 'pixi.js'
import { Hud } from './graphics/hud/Hud'
import { World } from './World'
import { Grid } from './graphics/Grid'

const TEMP_VEC = { x: 0, y: 0 }

export class Renderer {
    world!: World
    canvas: HTMLCanvasElement
    scale: number
    stage: PIXI.Container
    camera: PIXI.Container
    hud: Hud
    grid: Grid
    background: PIXI.Container
    middleground: PIXI.Container
    foreground: PIXI.Container
    renderer!: PIXI.Renderer

    private constructor() {
        this.canvas = document.getElementById(
            'game_canvas'
        ) as HTMLCanvasElement

        this.scale = 1

        // Game World Containers
        this.camera = new PIXI.Container({
            isRenderGroup: true,
        })

        this.background = new PIXI.Container()
        this.middleground = new PIXI.Container()
        this.foreground = new PIXI.Container()

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
        this.grid.update(delta, tick, now)
        this.hud.update(delta, tick, now)
    }

    render() {
        this.renderer.render(this.stage)
    }
}
