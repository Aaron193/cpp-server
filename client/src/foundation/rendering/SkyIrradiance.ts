import { Constants } from '@babylonjs/core/Engines/constants.js'
import { RawCubeTexture } from '@babylonjs/core/Materials/Textures/rawCubeTexture.js'
import '@babylonjs/core/Materials/Textures/baseTexture.polynomial.js'
import { CubeMapToSphericalPolynomialTools } from '@babylonjs/core/Misc/HighDynamicRange/cubemapToSphericalPolynomial.js'
import type { Scene } from '@babylonjs/core/scene.js'

/** Original low-frequency sky radiance. Diffuse convolution is computed once on the CPU. */
export function createSkyIrradiance(scene: Scene): RawCubeTexture {
    const size = 32
    const faces = Array.from({ length: 6 }, (_, face) => {
        const bytes = new Uint8Array(size * size * 4)
        for (let y = 0; y < size; y++)
            for (let x = 0; x < size; x++) {
                const u = (2 * (x + 0.5)) / size - 1,
                    v = (2 * (y + 0.5)) / size - 1
                const direction = [
                    [1, -v, -u],
                    [-1, -v, u],
                    [u, 1, v],
                    [u, -1, -v],
                    [u, -v, 1],
                    [-u, -v, -1],
                ][face]
                const height = direction[1] / Math.hypot(...direction)
                const ground = [0.065, 0.075, 0.055],
                    horizon = [0.31, 0.35, 0.35],
                    zenith = [0.13, 0.22, 0.3]
                const blend = Math.pow(Math.abs(height), 0.5)
                const pole = height > 0 ? zenith : ground
                const offset = (y * size + x) * 4
                for (let channel = 0; channel < 3; channel++)
                    bytes[offset + channel] = Math.round(
                        255 *
                            (horizon[channel] * (1 - blend) +
                                pole[channel] * blend)
                    )
                bytes[offset + 3] = 255
            }
        return bytes
    })
    const format = Constants.TEXTUREFORMAT_RGBA,
        type = Constants.TEXTURETYPE_UNSIGNED_BYTE
    const texture = new RawCubeTexture(
        scene,
        faces,
        size,
        format,
        type,
        true,
        false,
        Constants.TEXTURE_TRILINEAR_SAMPLINGMODE
    )
    texture.name = 'environment/original-overcast-sky'
    texture.gammaSpace = false
    texture.sphericalPolynomial =
        CubeMapToSphericalPolynomialTools.ConvertCubeMapToSphericalPolynomial({
            right: faces[0],
            left: faces[1],
            up: faces[2],
            down: faces[3],
            front: faces[4],
            back: faces[5],
            size,
            format,
            type,
            gammaSpace: false,
        })
    return texture
}
