import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
    const environment = loadEnv(mode, '.', '')
    const configuredPort = Number(environment.CLIENT_PORT ?? 3001)

    return {
        base: './',
        cacheDir: process.env.PLAYWRIGHT_TEST
            ? 'node_modules/.vite-e2e'
            : 'node_modules/.vite',
        optimizeDeps: {
            entries: ['src/index.ts', 'src/foundation/FoundationClient.ts'],
        },
        server: {
            port: Number.isInteger(configuredPort) ? configuredPort : 3001,
        },
        build: {
            sourcemap: true,
        },
    }
})
