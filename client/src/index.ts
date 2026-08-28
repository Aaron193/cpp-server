import type { FoundationClient } from './foundation/FoundationClient'
import { HomeScreen, type GameServer } from './HomeScreen'
import './assets/styles/style.css'
import { PROTOCOL_VERSION } from './protocol/generated'
import type { RenderingBackend } from './foundation/rendering/EngineFactory'
import type { RenderTier } from './foundation/rendering/RenderQualityModule'

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
    const selectedMapId = server?.mapId ?? (import.meta.env.VITE_OFFLINE_MAP_ID || 'graybox-arena')
    hudRoot.innerHTML = `<div class="fps-loading">Loading ${selectedMapId} and Jolt…</div>`
    try {
        const clientBuildId = import.meta.env.VITE_CLIENT_BUILD_ID || 'dev'
        let join: { websocketUrl: string; ticket: string } | undefined
        let requestJoin: (() => Promise<{ websocketUrl: string; ticket: string }>) | undefined
        if (server) {
            const apiBase = import.meta.env.VITE_CLIENT_API_BASE ||
                (import.meta.env.DEV ? 'http://localhost:3000' : `${window.location.origin}/api`)
            requestJoin = async () => {
                const response = await fetch(`${apiBase}/servers/${encodeURIComponent(server.id)}/join`, {
                    method: 'POST', credentials: 'include',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ clientBuildId, protocolVersion: PROTOCOL_VERSION, mapId: server.mapId, mode: server.mode }),
                })
                const body = await response.json() as { websocketUrl?: string; ticket?: string; error?: string }
                if (!response.ok || !body.websocketUrl || !body.ticket) throw new Error(body.error ?? 'Unable to obtain a game join ticket')
                return { websocketUrl: body.websocketUrl, ticket: body.ticket }
            }
            join = await requestJoin()
        }
        const { FoundationClient } = await import('./foundation/FoundationClient')
        const captureParameters = new URLSearchParams(window.location.search)
        const backendValue = captureParameters.get('renderBackend')
        const tierValue = captureParameters.get('renderTier')
        const preferredBackend = backendValue === 'webgpu' || backendValue === 'webgl2' ? backendValue as RenderingBackend : 'auto'
        const renderTier = tierValue === 'high' || tierValue === 'medium' || tierValue === 'low' || tierValue === 'software' ? tierValue as RenderTier : undefined
        client = new FoundationClient({
            canvas, hudRoot, mapRoot: `/maps/${encodeURIComponent(selectedMapId)}`,
            rendering: { preferredBackend },
            renderQuality: { tier: renderTier },
            networking: server ? {
                clientBuildId,
                accessToken: join?.ticket,
                joinTicketProvider: requestJoin,
                server: {
                    websocketUrl: join?.websocketUrl ?? server.websocketUrl,
                    buildId: server.buildId,
                    protocolVersion: server.protocolVersion,
                    mapId: server.mapId,
                    mode: server.mode,
                    mapFormatVersion: server.mapFormatVersion,
                    contentHash: server.mapContentHash,
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
