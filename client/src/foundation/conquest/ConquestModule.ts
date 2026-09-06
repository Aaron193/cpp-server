import { Vector3, Matrix } from '@babylonjs/core/Maths/math.vector.js'
import { Weapon, type ObjectiveState } from '../../protocol/generated'
import type {
    ClientModule,
    ClientModuleContext,
    FrameUpdate,
} from '../lifecycle'
import {
    ARENA,
    CAMERA,
    ENTITY_VIEWS,
    INPUT,
    NETWORKING,
    PHYSICS,
    SCENE,
} from '../services'
import { projectRadar, type RadarProjection } from '../hud/MinimapModel'
import type { ClientMapSpawn } from '../assets/MapManifest'
import { openSettings } from '../../frontend/SettingsPanel'

export function availableSpawns(
    spawns: readonly ClientMapSpawn[],
    objectives: readonly ObjectiveState[],
    team: number
): readonly ClientMapSpawn[] {
    if (team !== 1 && team !== 2) return []
    return spawns.filter(
        (s) =>
            s.modes.includes('conquest') &&
            (s.team === (team === 1 ? 'west' : 'east') ||
                objectives.some(
                    (o) =>
                        o.owner === team &&
                        !o.contested &&
                        (o.capturing === 0 || o.capturing === team) &&
                        s.id.startsWith(o.id + '-spawn-')
                ))
    )
}
/** Tactical presentation consumes authoritative objectives. No client capture or team rules. */
export class ConquestModule implements ClientModule {
    readonly name = 'conquest-presentation'
    private context?: ClientModuleContext
    private root?: HTMLElement
    private strip?: HTMLElement
    private world?: HTMLElement
    private radar?: HTMLElement
    private map?: HTMLElement
    private status?: HTMLElement
    private deploy?: HTMLButtonElement
    private selected = ''
    private selectedLabel?: HTMLElement
    private ready = false
    private offlineDeployed = false
    private nextUpdate = 0
    private spawnSignature = ''
    private projection?: RadarProjection
    initialize(context: ClientModuleContext): void {
        this.context = context
        const manifest = context.services.get(ARENA).mapManifest,
            gameplay = context.services.get(ARENA).mapGameplay
        if (!manifest || !gameplay?.markers.some((m) => m.type === 'objective'))
            return
        this.projection = {
            minX: manifest.worldBounds.min[0],
            maxX: manifest.worldBounds.max[0],
            minZ: manifest.worldBounds.min[2],
            maxZ: manifest.worldBounds.max[2],
            northYaw: manifest.policy.radarNorthYaw,
        }
        this.strip = document.createElement('div')
        this.strip.className = 'conquest-strip'
        context.hudRoot.append(this.strip)
        this.world = document.createElement('div')
        context.hudRoot.append(this.world)
        this.radar = document.createElement('div')
        context.hudRoot.querySelector('#fps-radar')?.append(this.radar)
        const root = document.createElement('section')
        root.className = 'deployment'
        root.setAttribute('data-gameplay-input-blocking', 'true')
        root.setAttribute('aria-label', 'Deployment')
        root.hidden = true
        root.innerHTML = `<header class="deploy-header"><div><small>TACTICAL DEPLOYMENT / CONQUEST</small><h1>IRONWORKS <span> / </span> OPERATION 031</h1></div><button type="button" id="deploy-settings">SETTINGS</button></header><div class="deploy-map-wrap"><div class="deploy-map"><img alt="Industrial complex tactical plan" src="/maps/${encodeURIComponent(manifest.mapId)}/${manifest.assets.radar}"><div class="deploy-grid"></div><div id="deploy-spawns"></div><div id="deploy-objectives"></div><div id="deploy-allies"></div></div></div><aside class="deploy-side"><div><small>YOUR UNIT</small><h2 id="deploy-team">RECONNAISSANCE</h2></div><div><small>PRIMARY WEAPON</small><select id="deploy-weapon" aria-label="Primary weapon"><option value="1">AR-28 · ASSAULT RIFLE</option><option value="2">SG-12 · BREACHER</option></select></div><div><small>INSERTION POINT</small><h2 id="deploy-selected">SELECT A SPAWN</h2></div><p>Hold a majority of objectives to drain enemy tickets. Defend your captured sectors to open forward deployment.</p><div class="deploy-status" role="status"></div><button class="deploy-button" type="button">DEPLOY →</button></aside><footer class="deploy-footer"><span>SELECT AN AVAILABLE INSERTION POINT ON THE MAP</span><span>WESTERN TASK FORCE / EASTERN GUARD</span></footer>`
        context.hudRoot.append(root)
        this.root = root
        this.map = root.querySelector('#deploy-spawns')!
        this.status = root.querySelector('.deploy-status')!
        this.deploy = root.querySelector('.deploy-button')!
        this.selectedLabel = root.querySelector('#deploy-selected')!
        root.querySelector('#deploy-settings')!.addEventListener(
            'click',
            openSettings
        )
        this.deploy.addEventListener('click', () => {
            if (!this.ready || !this.selected) return
            const net = context.services.get(NETWORKING),
                weapon = Number(
                    (root.querySelector('#deploy-weapon') as HTMLSelectElement)
                        .value
                ) as Weapon
            context.services
                .get(INPUT)
                .state.selectWeapon(weapon === Weapon.Shotgun ? 2 : 1)
            if (net.status === 'offline') {
                const spawn = gameplay.spawnPoints.find(
                    (s) => s.id === this.selected
                )
                if (!spawn) return
                context.services.get(PHYSICS).setAuthoritativeState(
                    {
                        x: spawn.position[0],
                        y: spawn.position[1],
                        z: spawn.position[2],
                    },
                    { x: 0, y: 0, z: 0 }
                )
                context.services.get(INPUT).angles.set(spawn.yaw, 0)
                this.offlineDeployed = true
                this.hideDeployment()
            } else {
                net.deploy(this.selected, weapon)
                this.status!.textContent = 'Requesting insertion…'
                this.deploy!.disabled = true
            }
        })
    }
    private hideDeployment(): void {
        if (this.root) this.root.hidden = true
        if (this.context) {
            this.context.canvas.tabIndex = 0
            this.context.canvas.focus()
        }
        void this.context?.canvas.requestPointerLock()?.catch(() => {})
    }
    update(frame: FrameUpdate): void {
        const c = this.context
        if (!c || !this.root || !this.projection) return
        const net = c.services.get(NETWORKING),
            offline = net.status === 'offline',
            gameplay = c.services.get(ARENA).mapGameplay!,
            state = net.conquest
        const show = offline
            ? !this.offlineDeployed
            : !!state && net.combat.localPlayer.dead
        if (!show && !this.root.hidden) this.hideDeployment()
        if (show) {
            this.root.hidden = false
            if (document.pointerLockElement) void document.exitPointerLock()
        }
        if (performance.now() < this.nextUpdate) return
        this.nextUpdate = performance.now() + 100
        if (!offline && !state) {
            this.strip!.hidden = true
            return
        }
        const team = state?.localTeam ?? 1
        const objectives: readonly ObjectiveState[] =
            state?.objectives ??
            gameplay.markers
                .filter((m) => m.type === 'objective')
                .map((m) => ({
                    id: m.id,
                    owner: 0,
                    capturing: 0,
                    progress: 0,
                    contested: false,
                }))
        this.strip!.hidden = offline
        const west = state?.westTickets ?? 500,
            east = state?.eastTickets ?? 500
        this.strip!.innerHTML = `<span class="tickets">${team === 1 ? west : east}</span><div class="objective-row"></div><span class="tickets enemy">${team === 1 ? east : west}</span>`
        const row = this.strip!.querySelector('.objective-row')!
        for (const o of objectives) row.append(this.icon(o, team))
        const spawns = offline
            ? gameplay.spawnPoints.filter(
                  (s) => s.team === 'west' || s.team === null
              )
            : availableSpawns(gameplay.spawnPoints, objectives, team)
        if (!spawns.some((s) => s.id === this.selected))
            this.selected = spawns[0]?.id ?? ''
        this.ready = offline || !!state?.deployReady
        this.deploy!.disabled = !this.ready || !this.selected
        this.status!.textContent = offline
            ? 'EXPLORATION · No match scoring'
            : this.ready
              ? 'Ready for deployment'
              : 'Awaiting reinforcements…'
        this.root.querySelector('#deploy-team')!.textContent = offline
            ? 'FIELD RECON'
            : team === 1
              ? 'WESTERN TASK FORCE'
              : 'EASTERN GUARD'
        this.selectedLabel!.textContent = this.selected
            .replace(/-spawn-\d+$/, '')
            .replace(/-hq-\d+$/, ' HQ')
            .replaceAll('-', ' ')
            .toUpperCase()
        const signature = spawns.map((s) => s.id).join('|') + this.selected
        if (signature !== this.spawnSignature) {
            this.spawnSignature = signature
            const sectors = new Map<string, ClientMapSpawn>()
            for (const s of spawns) {
                const key = s.team ?? s.id.replace(/-spawn-\d+$/, '')
                if (!sectors.has(key) || s.id === this.selected)
                    sectors.set(key, s)
            }
            this.map!.replaceChildren(
                ...[...sectors.values()].map((s) => {
                    const b = document.createElement('button')
                    b.type = 'button'
                    b.className = 'deploy-spawn'
                    b.textContent = s.team ? 'HQ' : s.id[0].toUpperCase()
                    b.title = s.id
                    b.setAttribute('aria-label', 'Deploy at ' + s.id)
                    b.setAttribute(
                        'aria-pressed',
                        String(s.id === this.selected)
                    )
                    this.position(b, s.position[0], s.position[2])
                    b.onclick = () => {
                        this.selected = s.id
                        this.nextUpdate = 0
                    }
                    return b
                })
            )
        }
        this.radar!.replaceChildren()
        this.world!.replaceChildren()
        const tactical = this.root.querySelector('#deploy-objectives')!
        tactical.replaceChildren()
        for (const o of objectives) {
            const marker = gameplay.markers.find((m) => m.id === o.id)
            if (!marker) continue
            for (const root of [this.radar!, tactical]) {
                const icon = this.icon(o, team)
                icon.classList.add('radar-objective')
                this.position(icon, marker.position[0], marker.position[2])
                root.append(icon)
            }
            const camera = c.services.get(CAMERA),
                scene = c.services.get(SCENE),
                position = new Vector3(
                    marker.position[0],
                    marker.position[1] + 5,
                    marker.position[2]
                ),
                screen = Vector3.Project(
                    position,
                    Matrix.IdentityReadOnly,
                    scene.getTransformMatrix(),
                    camera.viewport.toGlobal(
                        c.canvas.clientWidth,
                        c.canvas.clientHeight
                    )
                )
            if (
                screen.z > 0 &&
                screen.z < 1 &&
                screen.x > 20 &&
                screen.y > 80 &&
                screen.x < c.canvas.clientWidth - 20 &&
                screen.y < c.canvas.clientHeight - 150
            ) {
                const el = document.createElement('div')
                el.className = 'objective-world'
                el.style.left = `${screen.x}px`
                el.style.top = `${screen.y}px`
                el.append(this.icon(o, team))
                const distance = document.createElement('span')
                distance.textContent = `${Math.round(Vector3.Distance(position, camera.position))} m`
                el.append(distance)
                this.world!.append(el)
            }
        }
        const allies = this.root.querySelector('#deploy-allies')!
        allies.replaceChildren()
        c.services.get(ENTITY_VIEWS).forEachPresentationPose((id, pos) => {
            if (
                !state?.roster.some((p) => p.playerId === id && p.team === team)
            )
                return
            for (const root of [this.radar!, allies]) {
                const dot = document.createElement('span')
                dot.className = 'radar-ally'
                this.position(dot, pos.x, pos.z)
                root.append(dot)
            }
        })
    }
    private position(el: HTMLElement, x: number, z: number): void {
        const p = projectRadar({ x, z }, this.projection!)
        el.style.left = `${p.xPercent}%`
        el.style.top = `${p.yPercent}%`
    }
    private icon(o: ObjectiveState, team: number): HTMLElement {
        const el = document.createElement('span')
        el.className = 'objective-icon'
        el.dataset.owner = String(o.owner === 0 ? 0 : o.owner === team ? 1 : 2)
        el.dataset.contested = String(o.contested)
        el.textContent = o.id[0].toUpperCase()
        el.title = o.id
        const progress = document.createElement('i')
        progress.style.width = `${Math.max(0, Math.min(1, o.progress)) * 100}%`
        el.append(progress)
        return el
    }
    dispose(): void {
        this.root?.remove()
        this.strip?.remove()
        this.radar?.remove()
        this.world?.remove()
        this.context = undefined
    }
}
