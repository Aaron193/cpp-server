import { MapCompileError, type Vec3 } from './types'

export interface InlineGeometry {
    readonly shape?: unknown
    readonly size?: unknown
    readonly positions?: unknown
    readonly indices?: unknown
}

const BOX_INDICES = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1,
    6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
]

const RAMP_INDICES = [
    0, 2, 1, 0, 3, 2, 0, 1, 5, 0, 5, 4, 1, 2, 5, 2, 3, 5, 3, 0, 4, 3,
    4, 5,
]

function vec3(value: unknown, context: string): Vec3 {
    if (
        !Array.isArray(value) ||
        value.length !== 3 ||
        !value.every((component) =>
            typeof component === 'number' && Number.isFinite(component)
        )
    ) {
        throw new MapCompileError(`${context} must contain three finite numbers`)
    }
    return [value[0], value[1], value[2]]
}

export function expandInlineGeometry(
    value: InlineGeometry,
    context: string
): { positions: Vec3[]; indices: number[] } {
    const allowed = new Set(['shape', 'size', 'positions', 'indices'])
    for (const key of Object.keys(value)) {
        if (!allowed.has(key)) {
            throw new MapCompileError(`${context} has unsupported geometry property "${key}"`)
        }
    }

    if (value.positions !== undefined || value.indices !== undefined) {
        if (!Array.isArray(value.positions) || !Array.isArray(value.indices)) {
            throw new MapCompileError(`${context} positions and indices must both be arrays`)
        }
        const positions = value.positions.map((entry, index) =>
            vec3(entry, `${context}.positions[${index}]`)
        )
        const indices = value.indices.map((entry, index) => {
            if (!Number.isInteger(entry) || (entry as number) < 0) {
                throw new MapCompileError(`${context}.indices[${index}] must be an unsigned integer`)
            }
            return entry as number
        })
        return { positions, indices }
    }

    const size = vec3(value.size, `${context}.size`)
    if (size.some((component) => component <= 0)) {
        throw new MapCompileError(`${context}.size must be positive`)
    }
    const [x, y, z] = size.map((component) => component / 2) as [number, number, number]
    if (value.shape === 'box') {
        return {
            positions: [
                [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
                [-x, -y, z], [x, -y, z], [x, y, z], [-x, y, z],
            ],
            indices: [...BOX_INDICES],
        }
    }
    if (value.shape === 'ramp') {
        return {
            positions: [
                [-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z],
                [-x, y, z], [x, y, z],
            ],
            indices: [...RAMP_INDICES],
        }
    }
    throw new MapCompileError(`${context}.shape must be "box" or "ramp"`)
}

export function readVec3(value: unknown, context: string): Vec3 {
    return vec3(value, context)
}
