import type { FoundationClient } from './foundation/FoundationClient'
import { HomeScreen, type GameServer } from './HomeScreen'
import './assets/styles/style.css'

let client: FoundationClient | undefined
let animationFrame = 0

declare global {
    interface Window {
        __gameDebug?: () => ReturnType<FoundationClient['debugSnapshot']> | undefined
    }
}

async function startGame(homeScreen: HomeScreen, server: GameServer | null): Promise<void> {
    if (client) return
    homeScreen.hide()
    const gameContainer = document.getElementById('game-container')
    const canvas = document.getElementById('game_canvas') as HTMLCanvasElement | null
    const hudRoot = document.getElementById('game-hud')
    if (!gameContainer || !canvas || !hudRoot) throw new Error('Offline game shell is incomplete')
    gameContainer.classList.remove('hidden')
    hudRoot.innerHTML = '<div class="fps-loading">Loading graybox arena and Jolt…</div>'
    try {
        const { FoundationClient } = await import('./foundation/FoundationClient')
        client = new FoundationClient({
            canvas, hudRoot, mapRoot: '/maps/graybox-arena',
            networking: server ? {
                clientBuildId: import.meta.env.VITE_CLIENT_BUILD_ID || 'dev',
                server: {
                    websocketUrl: server.websocketUrl,
                    buildId: server.buildId,
                    protocolVersion: server.protocolVersion,
                    mapId: server.mapId,
                    mode: server.mode,
                },
            } : undefined,
        })
        await client.initialize()
        await client.start()
        if (import.meta.env.DEV) window.__gameDebug = () => client?.debugSnapshot()
        let previous = performance.now()
        let elapsedSeconds = 0
        let frame = 0
        const loop = (now: number): void => {
            const deltaSeconds = Math.min((now - previous) / 1000, 0.25)
            previous = now
            elapsedSeconds += deltaSeconds
            client?.update({ deltaSeconds, elapsedSeconds, frame: frame++ })
            animationFrame = requestAnimationFrame(loop)
        }
        animationFrame = requestAnimationFrame(loop)
    } catch (error) {
        console.error('[FoundationClient] startup failed', error)
        hudRoot.innerHTML = `<div class="fps-load-error"><strong>Unable to start arena</strong><span>${error instanceof Error ? error.message : String(error)}</span></div>`
        await client?.dispose()
        client = undefined
    }
}

window.addEventListener('load', async () => {
    const homeScreen = new HomeScreen('home-screen', (server) => { void startGame(homeScreen, server) })
    await homeScreen.show()
})

window.addEventListener('beforeunload', () => {
    cancelAnimationFrame(animationFrame)
    delete window.__gameDebug
    void client?.dispose()
})
