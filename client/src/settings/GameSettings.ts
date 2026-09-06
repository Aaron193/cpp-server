export interface GameSettings {
    quality: 'auto' | 'low' | 'medium' | 'high' | 'ultra'
    renderScale: number
    fov: number
    sensitivity: number
    adsSensitivity: number
    invertY: boolean
    motion: boolean
    bloom: boolean
    ambientOcclusion: boolean
    master: number
    effects: number
    ambience: number
    ui: number
}
export const DEFAULT_SETTINGS: Readonly<GameSettings> = Object.freeze({
    quality: 'auto',
    renderScale: 1,
    fov: 80,
    sensitivity: 1,
    adsSensitivity: 0.65,
    invertY: false,
    motion: true,
    bloom: true,
    ambientOcclusion: true,
    master: 0.8,
    effects: 1,
    ambience: 0.45,
    ui: 0.65,
})
const key = 'ironworks.settings.v1'
export function normalizeSettings(value: unknown): GameSettings {
    const input =
        value && typeof value === 'object'
            ? (value as Record<string, unknown>)
            : {}
    const out = { ...DEFAULT_SETTINGS }
    for (const name of [
        'invertY',
        'motion',
        'bloom',
        'ambientOcclusion',
    ] as const)
        if (typeof input[name] === 'boolean') out[name] = input[name]
    if (
        ['auto', 'low', 'medium', 'high', 'ultra'].includes(
            String(input.quality)
        )
    )
        out.quality = input.quality as GameSettings['quality']
    for (const [name, min, max] of [
        ['renderScale', 0.5, 1.5],
        ['fov', 60, 105],
        ['sensitivity', 0.1, 4],
        ['adsSensitivity', 0.1, 2],
        ['master', 0, 1],
        ['effects', 0, 1],
        ['ambience', 0, 1],
        ['ui', 0, 1],
    ] as const) {
        const v = input[name]
        if (typeof v === 'number' && Number.isFinite(v))
            out[name] = Math.max(min, Math.min(max, v))
    }
    return out
}
export function loadSettings(): GameSettings {
    try {
        return normalizeSettings(JSON.parse(localStorage.getItem(key) ?? '{}'))
    } catch {
        return { ...DEFAULT_SETTINGS }
    }
}
export function saveSettings(value: GameSettings): void {
    try {
        localStorage.setItem(key, JSON.stringify(normalizeSettings(value)))
    } catch {}
    window.dispatchEvent(new Event('game-settings-changed'))
}
