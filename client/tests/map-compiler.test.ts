import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { compileMapGltf, MapCompileError } from '../tools/map-compiler/index'
import { expandInlineGeometry } from '../tools/map-compiler/geometry'

function boxGeometry(): object {
    return { shape: 'box', size: [2, 1, 2] }
}

function validSource(spawnCount = 12): any {
    const nodes: any[] = [
        { name: 'render-floor', extras: { collection: 'Render', geometry: boxGeometry() } },
        { name: 'collision-floor', extras: { collection: 'Collision', geometry: boxGeometry() } },
    ]
    for (let index = 0; index < spawnCount; index++) {
        nodes.push({ name: `spawn-${String(index).padStart(2, '0')}`, translation: [index - 6, 1, 0], extras: { collection: 'Spawns', yaw: index / 10 } })
    }
    return {
        asset: { version: '2.0' }, scene: 0,
        scenes: [{ nodes: nodes.map((_, index) => index) }], nodes,
        extras: { map: { id: 'test-map', bounds: { min: [-20, -2, -20], max: [20, 10, 20] } } },
    }
}

describe('offline map compiler', () => {
    it('winds every procedural ramp face toward its exterior', () => {
        const ramp = expandInlineGeometry({ shape: 'ramp', size: [4, 2, 6] }, 'ramp')
        const normals = [] as number[][]
        for (let index = 0; index < ramp.indices.length; index += 3) {
            const [a, b, c] = ramp.indices.slice(index, index + 3).map((vertex) => ramp.positions[vertex])
            const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
            const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
            normals.push([
                ab[1] * ac[2] - ab[2] * ac[1],
                ab[2] * ac[0] - ab[0] * ac[2],
                ab[0] * ac[1] - ab[1] * ac[0],
            ])
        }
        expect(normals[0][1]).toBeLessThan(0)
        expect(normals[1][1]).toBeLessThan(0)
        expect(normals[2][1]).toBeGreaterThan(0); expect(normals[2][2]).toBeLessThan(0)
        expect(normals[3][1]).toBeGreaterThan(0); expect(normals[3][2]).toBeLessThan(0)
        expect(normals[4][0]).toBeGreaterThan(0)
        expect(normals[5][2]).toBeGreaterThan(0); expect(normals[6][0]).toBeLessThan(0)
        expect(normals[7][2]).toBeGreaterThan(0)
    })

    it('emits byte-identical packages and stable hashes', () => {
        const first = compileMapGltf(validSource())
        const second = compileMapGltf(structuredClone(validSource()))
        expect(second.manifest.contentHash).toBe(first.manifest.contentHash)
        expect(first.manifest.contentHash).toMatch(/^sha256:[a-f0-9]{64}$/)
        for (const [name, contents] of first.files) expect(second.files.get(name)).toEqual(contents)
    })

    it('accepts Blender-style indexed mesh accessors with embedded buffers', () => {
        const source = validSource()
        const binary = new ArrayBuffer(42)
        const view = new DataView(binary)
        const positions = [0, 0, 0, 1, 0, 0, 0, 1, 0]
        positions.forEach((value, index) => view.setFloat32(index * 4, value, true))
        ;[0, 1, 2].forEach((value, index) => view.setUint16(36 + index * 2, value, true))
        source.buffers = [{ byteLength: 42, uri: `data:application/octet-stream;base64,${Buffer.from(binary).toString('base64')}` }]
        source.bufferViews = [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: 6 }]
        source.accessors = [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }, { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }]
        source.meshes = [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }]
        source.materials = [{ name: 'AuthoredPBR', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.8, 1], metallicFactor: 0.7, roughnessFactor: 0.25 } }]
        source.meshes[0].primitives[0].material = 0
        delete source.nodes[0].extras.geometry
        source.nodes[0].mesh = 0
        delete source.nodes[1].extras.geometry
        source.nodes[1].mesh = 0
        const compiled = compileMapGltf(source)
        expect(new TextDecoder().decode(compiled.files.get('scene.glb'))).toContain('AuthoredPBR')
        expect(new TextDecoder().decode(compiled.files.get('scene.glb'))).not.toContain('Graybox')
    })

    it('inherits roles from named Blender collection nodes', () => {
        const source = validSource()
        delete source.nodes[0].extras.collection
        delete source.nodes[1].extras.collection
        const renderCollection = source.nodes.push({ name: 'Render', children: [0] }) - 1
        const collisionCollection = source.nodes.push({ name: 'Collision', children: [1] }) - 1
        source.scenes[0].nodes = [renderCollection, collisionCollection, ...source.scenes[0].nodes.slice(2)]
        expect(() => compileMapGltf(source)).not.toThrow()
    })

    it('rejects unsupported schema metadata and unapplied scale', () => {
        const metadata = validSource()
        metadata.nodes[0].extras.typoRole = true
        expect(() => compileMapGltf(metadata)).toThrow(/unsupported property "typoRole"/)
        const scale = validSource()
        scale.nodes[0].scale = [2, 2, 2]
        expect(() => compileMapGltf(scale)).toThrow(/unapplied scale/)
    })

    it('rejects degenerate and out-of-bounds triangles', () => {
        const degenerate = validSource()
        degenerate.nodes[1].extras.geometry = { positions: [[0, 0, 0], [1, 0, 0], [2, 0, 0]], indices: [0, 1, 2] }
        expect(() => compileMapGltf(degenerate)).toThrow(/triangle 0 is degenerate/)
        const outOfBounds = validSource()
        outOfBounds.nodes[1].translation = [50, 0, 0]
        expect(() => compileMapGltf(outOfBounds)).toThrow(/outside world bounds/)
    })

    it('enforces spawn count, finite values, and bounds', () => {
        expect(() => compileMapGltf(validSource(11))).toThrow(/at least 12 spawns/)
        const outside = validSource()
        outside.nodes[2].translation = [100, 1, 0]
        expect(() => compileMapGltf(outside)).toThrow(/spawn spawn-00 is outside world bounds/)
        const nonFinite = validSource()
        nonFinite.nodes[2].extras.yaw = Number.NaN
        expect(() => compileMapGltf(nonFinite)).toThrow(MapCompileError)
    })

    it('rejects invalid metadata for every non-mesh role', () => {
        const marker = validSource(); marker.nodes.push({ name: 'bad-marker', translation: [0, 0, 0], extras: { collection: 'Markers', markerType: 'teleporter' } }); marker.scenes[0].nodes.push(marker.nodes.length - 1)
        expect(() => compileMapGltf(marker)).toThrow(/supported markerType/)
        const zone = validSource(); zone.nodes.push({ name: 'bad-zone', translation: [19, 0, 0], extras: { collection: 'Zones', zoneType: 'playable', size: [4, 2, 4] } }); zone.scenes[0].nodes.push(zone.nodes.length - 1)
        expect(() => compileMapGltf(zone)).toThrow(/outside world bounds/)
        const navigation = validSource(); navigation.nodes.push({ name: 'nav-a', translation: [0, 0, 0], extras: { collection: 'Navigation', links: ['missing-node'] } }); navigation.scenes[0].nodes.push(navigation.nodes.length - 1)
        expect(() => compileMapGltf(navigation)).toThrow(/links to missing node|navigation graph is disconnected/)
        const radar = validSource(); radar.nodes.push({ name: 'radar', extras: { collection: 'Radar', typo: true } }); radar.scenes[0].nodes.push(radar.nodes.length - 1)
        expect(() => compileMapGltf(radar)).toThrow(/unsupported property "typo"/)
    })

    it('rejects scene cycles, duplicate identities, invalid roles and transforms', () => {
        const duplicate = validSource(); duplicate.nodes[1].name = duplicate.nodes[0].name
        expect(() => compileMapGltf(duplicate)).toThrow(/duplicate node name/)
        const cycle = validSource(); cycle.nodes[0].children = [0]
        expect(() => compileMapGltf(cycle)).toThrow(/appears more than once or forms a cycle/)
        const role = validSource(); role.nodes[0].extras.mapRole = 'portal'
        expect(() => compileMapGltf(role)).toThrow(/unsupported mapRole/)
        const rotation = validSource(); rotation.nodes[0].rotation = [0, 2, 0, 0]
        expect(() => compileMapGltf(rotation)).toThrow(/normalized quaternion/)
    })

    it('compiles the committed arena with routes, vertical spawns, and collision diagnostics', async () => {
        const path = new URL('../maps/graybox-arena.gltf', import.meta.url)
        const compiled = compileMapGltf(JSON.parse(await readFile(path, 'utf8')))
        const gameplay = JSON.parse(new TextDecoder().decode(compiled.files.get('gameplay.json')))
        expect(gameplay.spawnPoints).toHaveLength(16)
        expect(gameplay.spawnPoints.some((spawn: any) => spawn.position[1] > 3)).toBe(true)
        for (const spawn of gameplay.spawnPoints) {
            const [x, , z] = spawn.position
            const inwardX = -x, inwardZ = -z
            const forwardX = Math.sin(spawn.yaw), forwardZ = -Math.cos(spawn.yaw)
            expect(forwardX * inwardX + forwardZ * inwardZ).toBeGreaterThan(0)
        }
        expect(gameplay.markers.length).toBeGreaterThanOrEqual(4)
        expect(new TextDecoder().decode(compiled.files.get('debug-report.json'))).toContain('triangleCount')
        expect(compiled.files.get('collision.bin')?.slice(0, 4)).toEqual(Uint8Array.from([0x4d, 0x33, 0x43, 0x4c]))
        const scene = compiled.files.get('scene.glb')!
        const view = new DataView(scene.buffer, scene.byteOffset, scene.byteLength)
        const jsonLength = view.getUint32(12, true)
        const sceneJson = new TextDecoder().decode(scene.slice(20, 20 + jsonLength))
        expect(sceneJson).toContain('Render_Floor')
        expect(sceneJson).not.toContain('Collision_Floor')
    })

    it('builds two distinct v2 maps with gameplay, radar, navigation and authored PBR materials', async () => {
        const gray = compileMapGltf(JSON.parse(await readFile(new URL('../maps/graybox-arena.gltf', import.meta.url), 'utf8')))
        const copper = compileMapGltf(JSON.parse(await readFile(new URL('../maps/copper-yard.gltf', import.meta.url), 'utf8')))
        expect(gray.manifest.formatVersion).toBe(2)
        expect(copper.manifest.mapId).toBe('copper-yard')
        expect(copper.manifest.contentHash).not.toBe(gray.manifest.contentHash)
        expect(copper.files.has('gameplay.json')).toBe(true)
        expect(copper.files.has('navigation.json')).toBe(true)
        expect(copper.files.has('radar.svg')).toBe(true)
        expect(new TextDecoder().decode(copper.files.get('scene.glb'))).toContain('OxidizedCopper')
        expect(Object.keys(copper.manifest.assetHashes).sort()).toEqual([...copper.files.keys()].filter((name) => name !== 'manifest.json').sort())
    })
})
