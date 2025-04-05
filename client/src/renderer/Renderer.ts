interface Renderable {
    render(ctx: CanvasRenderingContext2D, delta: number): void;

    addChild(child: Renderable): void;
}

export class RContainer {

    children: Renderable[] = [];

    addChild(child: Renderable) {

    }
}

export class RImage {
    constructor(img: HTMLCanvasElement | HTMLImageElement) {

    }
}

export class RLayer implements Renderable {

    children: Renderable[] = [];

    render(ctx: CanvasRenderingContext2D, delta: number): void {

    }

    addChild(child: Renderable): void {

    }
}

export class Renderer {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;

    layers: RLayer[] = [];

    constructor(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D) {
        this.canvas = canvas;
        this.ctx = ctx;
    }

    public addLayer(layer: RLayer) {
        this.layers.push(layer);
    }

    public addLayers(layers: RLayer[]) {
        for (let i = 0; i < layers.length; i++) {
            const layer = layers[i];
            this.layers.push(layer);
        }
    }

    public render(delta: number) {
        for (let i = 0; i < this.layers.length; i++) {
            const layer = this.layers[i];
            layer.render(this.ctx, delta);
        }
    }
}
/**


    const render = new Renderer(canvas, ctx);

    const gameLayer = new Layer();

    const hud = new Layer();

    render.addLayers([
        gameLayer,
        hud
    ]);

    const playerNode = new RContainer();
    const body = new RImage('img.png')
    body.setTransform(body.width / 2, body.height / 2)
    playerNode.addChild(body)


    render.render(delta);
 */