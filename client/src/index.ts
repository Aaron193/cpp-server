import { Renderer } from "./renderer/Renderer";

const renderer = new Renderer(
    document.querySelector("#canvas") as HTMLCanvasElement,
    (document.querySelector("#canvas") as HTMLCanvasElement).getContext("2d") as CanvasRenderingContext2D
);

function loop(timestamp: number = 0) {

    const now = Date.now();
    const delta = (now - timestamp) / 1000;

    renderer.render(delta);
    
    requestAnimationFrame(loop);

}

function main() {
    loop();
}

main();