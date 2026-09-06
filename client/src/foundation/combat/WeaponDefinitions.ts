import { Weapon } from '../../protocol/generated'
export interface WeaponDefinition {
    readonly name: string
    readonly fireRate: number
    readonly magazineSize: number
    readonly reloadTime: number
    readonly range: number
    readonly muzzleVelocity: number
    readonly projectileGravity: number
    readonly automatic: boolean
}
export type WeaponDefinitions = Readonly<
    Record<Weapon.Rifle | Weapon.Shotgun, WeaponDefinition>
>
export const INFANTRY_WEAPONS: WeaponDefinitions = {
    [Weapon.Rifle]: {
        name: 'AR-28',
        fireRate: 10,
        magazineSize: 30,
        reloadTime: 2.35,
        range: 420,
        muzzleVelocity: 620,
        projectileGravity: 9.81,
        automatic: true,
    },
    [Weapon.Shotgun]: {
        name: 'SG-12',
        fireRate: 1.2,
        magazineSize: 6,
        reloadTime: 2.2,
        range: 70,
        muzzleVelocity: 380,
        projectileGravity: 9.81,
        automatic: false,
    },
}
export function parseWeaponDefinitions(json: string): WeaponDefinitions {
    const root = JSON.parse(json),
        result = { ...INFANTRY_WEAPONS }
    for (const [key, id] of [
        ['rifle', Weapon.Rifle],
        ['shotgun', Weapon.Shotgun],
    ] as const) {
        const w = root.weapons?.[key]
        if (!w) continue
        const values: Record<string, number> = {}
        for (const [name, max] of [
            ['fireRate', 60],
            ['magazineSize', 200],
            ['reloadTime', 20],
            ['range', 2000],
            ['muzzleVelocity', 2000],
            ['projectileGravity', 100],
        ] as const) {
            const v =
                w[name] ??
                (name === 'muzzleVelocity'
                    ? 0
                    : name === 'projectileGravity'
                      ? 9.81
                      : NaN)
            if (
                typeof v !== 'number' ||
                !Number.isFinite(v) ||
                v < 0 ||
                v > max ||
                (v === 0 &&
                    ![
                        'muzzleVelocity',
                        'projectileGravity',
                        'reloadTime',
                    ].includes(name))
            )
                throw new Error(`Invalid weapon ${key}.${name}`)
            values[name] = v
        }
        if (typeof w.automatic !== 'boolean')
            throw new Error('Invalid automatic fire setting')
        result[id] = {
            name: INFANTRY_WEAPONS[id].name,
            ...values,
            automatic: w.automatic,
        } as unknown as WeaponDefinition
    }
    return result
}
