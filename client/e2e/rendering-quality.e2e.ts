import { expect, test } from '@playwright/test'
import { issueJoinTicket } from '../../web/src/servers/join-ticket'
import { PROTOCOL_VERSION } from '../src/protocol/generated'

const ticketSecret = 'playwright-join-ticket-secret-32-bytes-minimum'
const descriptor = {
    id: 'playwright', host: '127.0.0.1', port: 9002, region: 'Playwright', maxPlayers: 12,
    currentPlayers: 0, lastHeartbeat: new Date().toISOString(), isOnline: true, buildId: 'dev',
    protocolVersion: PROTOCOL_VERSION, mapId: 'graybox-arena', mapFormatVersion: 2,
    mapContentHash: 'sha256:3984a02b8a6ce8abaebddacb010273285fbb666cb4f973f5eb7e251e3fb9b477',
    mode: 'ffa', websocketUrl: 'ws://127.0.0.1:9002',
}

test('captures deterministic WebGL2 software-tier presentation facts', async ({ page }, testInfo) => {
    await page.route('http://localhost:3000/servers', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ servers: [descriptor] }) }))
    await page.route('http://localhost:3000/auth/me', (route) =>
        route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }))
    await page.route('http://localhost:3000/servers/playwright/join', (route) => {
        const { ticket } = issueJoinTicket('render-capture', 'playwright', ticketSecret, 'arena-game-server', 20)
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ websocketUrl: descriptor.websocketUrl, ticket }) })
    })
    await page.goto('/?renderBackend=webgl2&renderTier=software')
    const quickPlay = page.getByRole('button', { name: 'Quick Play' })
    await quickPlay.click()
    await expect.poll(async () => {
        const health = page.locator('#fps-health')
        if (await health.count()) return health.textContent()
        if (await quickPlay.isVisible()) await quickPlay.click()
        return null
    }, { timeout: 15_000 }).toBe('100')

    await expect.poll(async () => {
        return page.evaluate(() => {
            const profile = (window as Window & { __arenaProfile?: () => { fps: number } }).__arenaProfile?.()
            return profile?.fps ?? 0
        })
    }).toBeGreaterThan(0)
    const debug = await page.evaluate(() => window.__gameDebug?.())
    expect(debug?.rendering.quality).toMatchObject({ backend: 'webgl2', tier: 'software', resolutionScale: 0.65 })
    expect(debug?.rendering.quality.effectiveDpr).toBeLessThanOrEqual(0.75)
    expect(debug?.rendering.environment).toMatchObject({ exposure: 1, toneMapping: 'aces', imageProcessing: 'linear-pbr-forward', shadowsEnabled: false })
    expect(debug?.rendering.post).toMatchObject({ postAA: 'fxaa', postProcessCount: 1, finalGradePasses: 0 })
    expect(debug?.rendering.world).toMatchObject({ decorativeSources: 1, decorativeInstances: 1, lodLevels: 0, decorationBudget: 2 })

    const profile = await page.evaluate(() =>
        (window as Window & { __arenaProfile?: () => unknown }).__arenaProfile?.())
    console.info(JSON.stringify({ event: 'phase5_render_profile', environment: 'headless-chrome-swiftshader', profile }))
    await testInfo.attach('software-webgl2-render-profile.json', {
        body: JSON.stringify(profile, null, 2), contentType: 'application/json',
    })

    await page.setViewportSize({ width: 1024, height: 768 })
    await expect.poll(async () => (await page.evaluate(() => window.__gameDebug?.()))?.rendering.quality.canvasWidth).toBe(1024)
    const resized = await page.evaluate(() => window.__gameDebug?.()?.rendering.quality)
    expect(resized?.canvasHeight).toBe(768)
    expect(resized?.aspect).toBeCloseTo(4 / 3)
    expect(resized?.effectiveDpr).toBeLessThanOrEqual(0.75)
})
