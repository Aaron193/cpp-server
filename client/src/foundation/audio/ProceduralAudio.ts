/** Original synthesis for replaceable field recordings. All buffers are made once at unlock. */
export function noiseBuffer(
    context: AudioContext,
    seconds: number,
    kind: 'wind' | 'gravel' | 'concrete' | 'metal' | 'tail'
): AudioBuffer {
    const buffer = context.createBuffer(
            1,
            Math.ceil(context.sampleRate * seconds),
            context.sampleRate
        ),
        data = buffer.getChannelData(0)
    let seed = 193,
        low = 0
    for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        const white = seed / 2147483648 - 1,
            t = i / context.sampleRate
        low = low * 0.985 + white * 0.015
        if (kind === 'wind')
            data[i] =
                low *
                0.65 *
                (0.7 + 0.15 * Math.sin(t * 1.2) + 0.15 * Math.sin(t * 0.47))
        else if (kind === 'tail')
            data[i] = (white * 0.35 + low) * Math.exp(-t * 4.5)
        else {
            const attack = Math.min(1, t * 450),
                decay = Math.exp(-t * (kind === 'gravel' ? 22 : 40)),
                thump =
                    Math.sin(t * 2 * Math.PI * (kind === 'metal' ? 180 : 75)) *
                    Math.exp(-t * 50)
            data[i] =
                (white * (kind === 'gravel' ? 0.27 : 0.1) + thump * 0.5) *
                attack *
                decay
        }
    }
    return buffer
}
