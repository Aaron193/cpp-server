import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { issueJoinTicket } from '../../web/src/servers/join-ticket'
import { PROTOCOL_VERSION } from '../src/protocol/generated'

const ticketSecret = 'playwright-join-ticket-secret-32-bytes-minimum'

const descriptor = {
    id: 'playwright', host: '127.0.0.1', port: 9002,
    region: 'Playwright', maxPlayers: 12, currentPlayers: 0,
    lastHeartbeat: new Date().toISOString(), isOnline: true,
    buildId: 'dev', protocolVersion: PROTOCOL_VERSION, mapId: 'graybox-arena',
    mapFormatVersion: 2,
    mapContentHash: 'sha256:247161e133c642351519f1c02073ccd15b6e5dfa23c766d8f01a25f936cf1582', mode: 'ffa',
    websocketUrl: 'ws://127.0.0.1:9002',
}

async function openPlayer(context: BrowserContext): Promise<Page> {
    const page = await context.newPage()
    await page.route('http://localhost:3000/servers', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ servers: [descriptor] }) }))
    await page.route('http://localhost:3000/auth/me', (route) =>
        route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }))
    await page.route('http://localhost:3000/servers/playwright/join', (route) => {
        const { ticket } = issueJoinTicket('playwright-user', 'playwright', ticketSecret, 'arena-game-server', 20)
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ websocketUrl: descriptor.websocketUrl, ticket }) })
    })
    await page.goto('/')
    const quickPlay = page.getByRole('button', { name: 'Quick Play' })
    await quickPlay.click()
    // Vite may perform one dependency-optimization reload the first time the
    // lazily loaded Babylon client is requested. Re-enter after that dev-only
    // reload instead of mistaking it for a game startup failure.
    await expect.poll(async () => {
        const health = page.locator('#fps-health')
        if (await health.count()) return health.textContent()
        if (await quickPlay.isVisible()) await quickPlay.click()
        return null
    }, { timeout: 15_000 }).toBe('100')
    await expect(page.locator('#fps-ammo')).toHaveText('30 / 120')
    return page
}

test('renders both players, stance-correct remote movement, weapons, and shot feedback', async ({ browser }, testInfo) => {
    const firstContext = await browser.newContext()
    const secondContext = await browser.newContext()
    const first = await openPlayer(firstContext)
    const second = await openPlayer(secondContext)

    await first.bringToFront()
    await expect.poll(async () => (await first.evaluate(() => window.__gameDebug?.()))?.remotePlayers).toBe(1)
    await second.bringToFront()
    await expect.poll(async () => (await second.evaluate(() => window.__gameDebug?.()))?.remotePlayers).toBe(1)

    for (const page of [first, second]) {
        await page.bringToFront()
        const debug = await page.evaluate(() => window.__gameDebug?.())
        expect(debug?.networkStatus).toBe('connected')
        expect(debug?.localWeapon).toBe(1)
        expect(debug?.meshes.some((mesh) => mesh.name.startsWith('viewmodel/rifle-rig/') && mesh.enabled && mesh.inFrustum)).toBe(true)
        expect(debug?.meshes.some((mesh) => /^remote-actor\/\d+\/(chest|helmet|pelvis)$/.test(mesh.name) && mesh.enabled && mesh.inFrustum)).toBe(true)
        expect(debug?.meshes.some((mesh) => /^remote-actor\/\d+\/weapon-receiver$/.test(mesh.name) && mesh.enabled && mesh.inFrustum)).toBe(true)
    }

    await first.bringToFront()
    await first.locator('#game_canvas').click()
    await expect.poll(async () => (await first.evaluate(() => window.__gameDebug?.()))?.localMovement.grounded).toBe(true)
    await first.keyboard.down('w')
    await first.keyboard.down('Shift')
    await expect.poll(async () => (await first.evaluate(() => window.__gameDebug?.()))?.localMovement.mode).toBe(1)
    await expect.poll(async () => (await second.evaluate(() => window.__gameDebug?.()))?.remoteActors[0]?.movementMode).toBe(1)
    await first.waitForTimeout(250)
    await first.keyboard.down('Control')
    await expect.poll(async () => (await second.evaluate(() => window.__gameDebug?.()))?.remoteActors[0]?.movementMode).toBe(2)
    await expect.poll(async () => (await second.evaluate(() => window.__gameDebug?.()))?.remoteActors[0]?.stance).toBe(1)
    await expect.poll(async () => (await second.evaluate(() => window.__gameDebug?.()))?.remoteActors[0]?.calibrationY).toBeLessThan(-.25)
    await first.keyboard.up('Control')
    await first.keyboard.up('Shift')
    await first.keyboard.up('w')
    await expect.poll(async () => (await second.evaluate(() => window.__gameDebug?.()))?.remoteActors[0]?.stance).toBe(0)
    await first.keyboard.press('z')
    await expect.poll(async () => (await second.evaluate(() => window.__gameDebug?.()))?.remoteActors[0]?.stance).toBe(2)
    await expect.poll(async () => (await second.evaluate(() => window.__gameDebug?.()))?.remoteActors[0]?.calibrationY).toBeLessThan(-.6)
    await first.mouse.down()
    await expect.poll(async () => {
        const debug = await first.evaluate(() => window.__gameDebug?.())
        return debug?.meshes.some((mesh) => mesh.name.startsWith('tracer/') && mesh.enabled && mesh.inFrustum)
    }).toBe(true)
    await first.screenshot({ path: testInfo.outputPath('two-player-combat.png') })
    await first.mouse.up()

    await firstContext.close()
    await secondContext.close()
})
