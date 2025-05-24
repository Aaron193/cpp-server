import * as PIXI from 'pixi.js'
import { Hud } from './graphics/hud/Hud'

export class Renderer {
    canvas: HTMLCanvasElement
    scale: number
    stage: PIXI.Container
    camera: PIXI.Container
    hud: Hud
    background: PIXI.Container
    foreground: PIXI.Container
    renderer!: PIXI.Renderer

    private constructor() {
        this.canvas = document.getElementById(
            'game_canvas'
        ) as HTMLCanvasElement

        this.scale = 1

        this.camera = new PIXI.Container()
        this.background = new PIXI.Container()
        this.foreground = new PIXI.Container()

        this.camera.addChild(this.background)
        this.camera.addChild(this.foreground)

        this.hud = new Hud()
        this.stage = new PIXI.Container()

        this.stage.addChild(this.hud)
        this.stage.addChild(this.camera)

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
            backgroundColor: 0x378047,
        })

        this.resize()
    }

    public static async create(): Promise<Renderer> {
        const rendererInstance = new Renderer()
        await rendererInstance.init()
        return rendererInstance
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
        return {
            x: mouseX - this.camera.x,
            y: mouseY - this.camera.y,
        }
    }

    render() {
        this.renderer.render(this.stage)
    }
}
