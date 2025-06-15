import { GameClient } from './GameClient'
import { AssetLoader } from './graphics/utils/AssetLoader'

window.onload = async function () {
    console.log('window loaded')

    await AssetLoader.loadAll()

    const client = await GameClient.create()

    let tick = 0
    let previous = performance.now()
    const loop = function () {
        window.requestAnimationFrame(loop)
        let now = performance.now()
        let delta = (now - previous) / 1000
        previous = now
        tick++

        client.update(delta, tick, now)
    }

    loop()
}
