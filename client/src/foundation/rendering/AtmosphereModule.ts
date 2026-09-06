import { createSkyIrradiance } from './SkyIrradiance'
import type { RawCubeTexture } from '@babylonjs/core/Materials/Textures/rawCubeTexture.js'
import { ShaderMaterial } from '@babylonjs/core/Materials/shaderMaterial.js'
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder.js'
import { Mesh } from '@babylonjs/core/Meshes/mesh.js'
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js'
import { Color3 } from '@babylonjs/core/Maths/math.color.js'
import { Scene } from '@babylonjs/core/scene.js'
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem.js'
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js'
import { Color4 } from '@babylonjs/core/Maths/math.color.js'
import type {
    ClientModule,
    ClientModuleContext,
    FrameUpdate,
} from '../lifecycle'
import { ARENA, CAMERA, RENDER_QUALITY, SCENE } from '../services'

/** Analytic sky, aerial depth and bounded environmental particles; original shaders/textures. */
export class AtmosphereModule implements ClientModule {
    readonly name = 'atmosphere'
    private context?: ClientModuleContext
    private sky?: Mesh
    private material?: ShaderMaterial
    private particles: ParticleSystem[] = []
    private texture?: RawTexture
    private irradiance?: RawCubeTexture
    initialize(context: ClientModuleContext): void {
        this.context = context
        if (context.services.get(ARENA).mapManifest?.mapId !== 'ironworks')
            return
        const scene = context.services.get(SCENE),
            profile = context.services.get(RENDER_QUALITY).profile
        this.irradiance = createSkyIrradiance(scene)
        scene.environmentTexture = this.irradiance
        scene.environmentIntensity = 0.65
        scene.fogMode = Scene.FOGMODE_EXP2
        scene.fogDensity = 0.0025
        scene.fogColor = new Color3(0.47, 0.53, 0.53)
        this.sky = CreateSphere(
            'atmosphere/sky',
            { diameter: 850, segments: 16, sideOrientation: Mesh.BACKSIDE },
            scene
        )
        this.sky.isPickable = false
        this.sky.infiniteDistance = true
        this.sky.applyFog = false
        const vertex = `precision highp float;attribute vec3 position;uniform mat4 worldViewProjection;varying vec3 direction;void main(){direction=position;gl_Position=worldViewProjection*vec4(position,1.0);}`
        const fragment = `precision highp float;varying vec3 direction;uniform vec3 sun;uniform float time;
        float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
        void main(){vec3 d=normalize(direction);float h=max(d.y,0.0);vec3 col=mix(vec3(.56,.61,.59),vec3(.23,.36,.45),pow(h,.55));float s=max(dot(d,sun),0.0);col+=vec3(.65,.46,.25)*pow(s,16.0)*.3+vec3(.9,.75,.5)*pow(s,900.0);vec2 uv=d.xz/(h+.22)*1.7+vec2(time*.001,0);float clouds=noise(uv)*.58+noise(uv*2.1)*.26+noise(uv*4.3)*.16;float cover=smoothstep(.42,.7,clouds)*smoothstep(0.0,.16,h);col=mix(col,vec3(.67,.68,.63),cover*.48);gl_FragColor=vec4(col,1);}`
        this.material = new ShaderMaterial(
            'atmosphere/sky-material',
            scene,
            { vertexSource: vertex, fragmentSource: fragment },
            {
                attributes: ['position'],
                uniforms: ['worldViewProjection', 'sun', 'time'],
            }
        )
        this.material.backFaceCulling = false
        this.material.disableDepthWrite = true
        this.material.setVector3(
            'sun',
            new Vector3(0.55, 0.72, -0.36).normalize()
        )
        this.sky.material = this.material
        if (profile.tier === 'software' || profile.tier === 'low') return
        const n = 32,
            bytes = new Uint8Array(n * n * 4)
        for (let y = 0; y < n; y++)
            for (let x = 0; x < n; x++) {
                const i = (y * n + x) * 4,
                    a = Math.max(
                        0,
                        1 - Math.hypot((x - 15.5) / 16, (y - 15.5) / 16)
                    )
                bytes.set([220, 221, 204, Math.round(a * a * 130)], i)
            }
        this.texture = RawTexture.CreateRGBATexture(
            bytes,
            n,
            n,
            scene,
            false,
            false
        )
        for (const x of [-29, 38]) {
            const p = new ParticleSystem(
                `atmosphere/steam/${x}`,
                profile.tier === 'ultra' ? 100 : 50,
                scene
            )
            p.particleTexture = this.texture
            p.emitter = new Vector3(x, 30, -140)
            p.minEmitBox = new Vector3(-0.3, 0, -0.3)
            p.maxEmitBox = new Vector3(0.3, 0.4, 0.3)
            p.color1 = new Color4(0.6, 0.63, 0.59, 0.16)
            p.color2 = new Color4(0.7, 0.7, 0.65, 0.12)
            p.colorDead = new Color4(0.5, 0.56, 0.55, 0)
            p.minSize = 1.8
            p.maxSize = 4
            p.minLifeTime = 4
            p.maxLifeTime = 8
            p.emitRate = 6
            p.direction1 = new Vector3(1, 0.7, 0.1)
            p.direction2 = new Vector3(2, 1, 0.4)
            p.minEmitPower = 0.7
            p.maxEmitPower = 1.2
            p.updateSpeed = 0.01
            p.blendMode = ParticleSystem.BLENDMODE_STANDARD
            p.start()
            this.particles.push(p)
        }
    }
    update(frame: FrameUpdate): void {
        this.material?.setFloat('time', frame.elapsedSeconds)
    }
    dispose(): void {
        for (const p of this.particles) p.dispose()
        this.texture?.dispose()
        const scene = this.context?.services.get(SCENE)
        if (scene?.environmentTexture === this.irradiance && scene)
            scene.environmentTexture = null
        this.irradiance?.dispose()
        this.sky?.dispose()
        this.material?.dispose()
        this.context = undefined
    }
}
