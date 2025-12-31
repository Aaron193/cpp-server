import { GameClient } from './GameClient'
import { AssetLoader } from './graphics/utils/AssetLoader'
import { HomeScreen } from './HomeScreen'

let gameClient: GameClient | null = null
let gameLoop: (() => void) | null = null

window.onload = async function () {
    console.log('window loaded')

    await AssetLoader.loadAll()

    // Show home screen and wait for server selection
    const homeScreen = new HomeScreen(
        'home-screen',
        async (host: string, port: number) => {
            console.log(`Connecting to server: ${host}:${port}`)

            // Hide home screen
            homeScreen.hide()

            // Show game container
            const gameContainer = document.getElementById('game-container')
            if (gameContainer) {
                gameContainer.classList.remove('hidden')
            }

            // Create game client with selected server
            gameClient = await GameClient.create(host, port)

            // Start game loop
            let tick = 0
            let previous = performance.now()
            gameLoop = function () {
                window.requestAnimationFrame(gameLoop!)
                let now = performance.now()
                let delta = (now - previous) / 1000
                previous = now
                tick++

                gameClient!.update(delta, tick, now)
            }

            gameLoop()
        }
    )

    await homeScreen.show()
}
