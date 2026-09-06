import {
    DEFAULT_SETTINGS,
    loadSettings,
    saveSettings,
    type GameSettings,
} from '../settings/GameSettings'
const sliders: [keyof GameSettings, string, number, number, number, string][] =
    [
        ['renderScale', 'Render scale', 0.5, 1.5, 0.05, 'video'],
        ['fov', 'Vertical field of view', 60, 105, 1, 'video'],
        ['sensitivity', 'Mouse sensitivity', 0.1, 4, 0.05, 'controls'],
        ['adsSensitivity', 'Aiming sensitivity', 0.1, 2, 0.05, 'controls'],
        ['master', 'Master volume', 0, 1, 0.05, 'audio'],
        ['effects', 'Combat & equipment', 0, 1, 0.05, 'audio'],
        ['ambience', 'Environment', 0, 1, 0.05, 'audio'],
        ['ui', 'Interface', 0, 1, 0.05, 'audio'],
    ]
export function openSettings(): void {
    if (document.getElementById('game-settings')) return
    let value = loadSettings()
    const root = document.createElement('dialog')
    root.id = 'game-settings'
    root.className = 'military-settings'
    root.setAttribute('data-gameplay-input-blocking', 'true')
    root.innerHTML = `<form method="dialog"><header><div><small>FIELD CONFIGURATION</small><h2>SETTINGS</h2></div><button aria-label="Close settings">✕</button></header></form><nav>${['video', 'controls', 'audio'].map((tab, i) => `<button type="button" data-tab="${tab}" aria-selected="${i === 0}">${tab.toUpperCase()}</button>`).join('')}</nav><div class="settings-scroll">${[
        'video',
        'controls',
        'audio',
    ]
        .map(
            (tab, i) =>
                `<section data-section="${tab}" ${i ? 'hidden' : ''}>${tab === 'video' ? `<label>Quality preset<select data-setting="quality">${['auto', 'low', 'medium', 'high', 'ultra'].map((q) => `<option value="${q}">${q.toUpperCase()}</option>`).join('')}</select></label>` : ''}${sliders
                    .filter((s) => s[5] === tab)
                    .map(
                        ([name, label, min, max, step]) =>
                            `<label>${label}<span><input data-setting="${name}" type="range" min="${min}" max="${max}" step="${step}"><output data-output="${name}"></output></span></label>`
                    )
                    .join('')}${(tab === 'video'
                    ? [
                          ['motion', 'Camera motion'],
                          ['bloom', 'Restrained bloom'],
                          ['ambientOcclusion', 'Ambient occlusion'],
                      ]
                    : tab === 'controls'
                      ? [['invertY', 'Invert mouse Y']]
                      : []
                )
                    .map(
                        ([name, label]) =>
                            `<label>${label}<input data-setting="${name}" type="checkbox"></label>`
                    )
                    .join(
                        ''
                    )}${tab === 'controls' ? '<p>W A S D · Move &nbsp; SHIFT · Sprint &nbsp; C · Stance &nbsp; SPACE · Jump / mantle<br>RMB · Aim &nbsp; LMB · Fire &nbsp; R · Reload &nbsp; 1 / 2 · Weapon<br>TAB · Scoreboard &nbsp; ESC · Release cursor</p>' : ''}${tab === 'video' ? '<button type="button" id="settings-fullscreen">TOGGLE FULLSCREEN</button><p>Video changes apply on the next deployment session. Controls and audio update immediately.</p>' : ''}</section>`
        )
        .join(
            ''
        )}</div><footer><button type="button" id="settings-reset">RESTORE DEFAULTS</button><span role="status" id="settings-status">Saved automatically</span></footer>`
    document.body.append(root)
    const sync = () => {
        for (const input of root.querySelectorAll<
            HTMLInputElement | HTMLSelectElement
        >('[data-setting]')) {
            const name = input.dataset.setting as keyof GameSettings
            if (input instanceof HTMLInputElement && input.type === 'checkbox')
                input.checked = Boolean(value[name])
            else input.value = String(value[name])
            const output = root.querySelector(`[data-output="${name}"]`)
            if (output)
                output.textContent = Number(value[name]).toFixed(
                    name === 'fov' ? 0 : 2
                )
        }
    }
    sync()
    root.addEventListener('input', (e) => {
        const el = e.target as HTMLInputElement
        if (!el.dataset.setting) return
        const name = el.dataset.setting as keyof GameSettings
        value = {
            ...value,
            [name]:
                el.type === 'checkbox'
                    ? el.checked
                    : name === 'quality'
                      ? el.value
                      : Number(el.value),
        }
        saveSettings(value)
        sync()
    })
    root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(
        (button) =>
            (button.onclick = () => {
                root.querySelectorAll('[data-tab]').forEach((b) =>
                    b.setAttribute('aria-selected', String(b === button))
                )
                root.querySelectorAll<HTMLElement>('[data-section]').forEach(
                    (s) => (s.hidden = s.dataset.section !== button.dataset.tab)
                )
            })
    )
    root.querySelector<HTMLButtonElement>('#settings-reset')!.onclick = () => {
        value = { ...DEFAULT_SETTINGS }
        saveSettings(value)
        sync()
    }
    root.querySelector<HTMLButtonElement>('#settings-fullscreen')!.onclick =
        () => {
            void (
                document.fullscreenElement
                    ? document.exitFullscreen()
                    : document.documentElement.requestFullscreen()
            ).catch(() => {
                root.querySelector('#settings-status')!.textContent =
                    'Fullscreen unavailable in this browser'
            })
        }
    root.addEventListener('close', () => root.remove())
    root.showModal()
}
