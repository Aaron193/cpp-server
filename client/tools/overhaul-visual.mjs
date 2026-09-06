import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
const tier = process.env.CAPTURE_TIER ?? 'high'
if (!['software', 'low', 'medium', 'high', 'ultra'].includes(tier))
    throw new Error('Invalid CAPTURE_TIER')
await mkdir('artifacts', { recursive: true })
const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--no-sandbox'],
})
try {
    const page = await browser.newPage({
            viewport: { width: 1440, height: 900 },
        }),
        errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto(process.env.CAPTURE_URL ?? 'http://127.0.0.1:5173/')
    const initialize = async (tier) => {
        const { FoundationClient } = await import(
                '/src/foundation/FoundationClient.ts'
            ),
            services = await import('/src/foundation/services.ts')
        document.getElementById('home-screen').style.display = 'none'
        document.getElementById('game-container').classList.remove('hidden')
        const client = new FoundationClient({
            canvas: document.getElementById('game_canvas'),
            hudRoot: document.getElementById('game-hud'),
            mapRoot: '/maps/ironworks',
            rendering: { preferredBackend: 'webgl2' },
            renderQuality: { tier },
            camera: { fieldOfViewRadians: 1.25 },
        })
        await client.initialize()
        await client.start()
        window.captureClient = client
        window.captureServices = services
        let previous = performance.now(),
            elapsed = 0,
            frame = 0
        function loop(now) {
            const dt = Math.min(0.1, (now - previous) / 1000)
            previous = now
            elapsed += dt
            client.update({
                deltaSeconds: dt,
                elapsedSeconds: elapsed,
                frame: frame++,
            })
            requestAnimationFrame(loop)
        }
        requestAnimationFrame(loop)
        document.getElementById('game-hud').style.display = 'none'
        client.services.get(services.PHYSICS).setExternalDrive(true)
        client.services
            .get(services.PHYSICS)
            .setAuthoritativeState(
                { x: -82, y: 4, z: 62 },
                { x: 0, y: 0, z: 0 }
            )
        client.services.get(services.INPUT).angles.set(0.924, -0.04)
    }
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await page.evaluate(initialize, tier)
            break
        } catch (error) {
            if (attempt || !/context was destroyed/.test(String(error)))
                throw error
            await page.waitForLoadState('domcontentloaded')
            await page.waitForTimeout(2000)
        }
    }
    await page.waitForTimeout(12000)
    await page.screenshot({ path: `artifacts/ironworks-${tier}.jpg` })
    const infantry = await page.evaluate(
        () =>
            window.captureClient.services.get(
                window.captureServices.PERFORMANCE
            ).snapshot
    )
    const shadowShaders = await page.evaluate(
        () =>
            window.captureClient.services
                .get(window.captureServices.SCENE)
                .meshes.filter(
                    (m) =>
                        m.name.startsWith('map/') &&
                        m.subMeshes?.some((sub) =>
                            sub.effect?.defines?.includes('#define SHADOWS')
                        )
                ).length
    )
    if (['high', 'ultra'].includes(tier) && shadowShaders === 0)
        throw new Error('No map shader compiled with shadows')
    await page.evaluate(() => {
        const c = window.captureClient,
            s = window.captureServices
        c.services
            .get(s.PHYSICS)
            .setAuthoritativeState({ x: 2, y: 36, z: 95 }, { x: 0, y: 0, z: 0 })
        c.services.get(s.INPUT).angles.set(-0.02, -0.32)
        c.services
            .get(s.SCENE)
            .meshes.filter((m) => m.name.startsWith('viewmodel/'))
            .forEach((m) => (m.isVisible = false))
    })
    await page.waitForTimeout(3000)
    await page.screenshot({
        path: `artifacts/ironworks-overview-${tier}.jpg`,
        quality: 88,
    })
    const report = {
        environment: 'headless-chrome-swiftshader',
        tier,
        errors,
        shadowShaders,
        infantry,
        overview: await page.evaluate(
            () =>
                window.captureClient.services.get(
                    window.captureServices.PERFORMANCE
                ).snapshot
        ),
    }
    await writeFile(
        `artifacts/ironworks-${tier}-profile.json`,
        JSON.stringify(report, null, 2) + '\n'
    )
    console.log(JSON.stringify(report, null, 2))
    if (errors.length)
        throw new Error('Browser capture reported runtime errors')
} finally {
    await browser.close()
}
