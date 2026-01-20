#pragma once

#include "ecs/components.hpp"
#include "util/units.hpp"

namespace GunFactory {

inline Components::Gun makePistol(bool hitscan = false) {
    Components::Gun gun;
    gun.fireMode =
        hitscan ? GunFireMode::FIRE_HITSCAN : GunFireMode::FIRE_PROJECTILE;
    gun.ammoType = AmmoType::AMMO_LIGHT;
    gun.magazineSize = 30;
    gun.ammoInMag = 30;
    gun.ammoPerShot = 1;
    gun.fireRate = 8.0f;
    gun.reloadTime = 1.2f;
    gun.damage = 12.0f;
    gun.range = meters(1200.0f);
    gun.spread = 0.02f;
    gun.pellets = 1;
    gun.barrelLength = 0.6f;
    gun.projectileSpeed = 10.0f;
    ;
    gun.projectileLifetime = 1.2f;
    gun.automatic = true;
    return gun;
}

inline Components::Gun makeRifle(bool hitscan = false) {
    Components::Gun gun;
    gun.fireMode =
        hitscan ? GunFireMode::FIRE_HITSCAN : GunFireMode::FIRE_PROJECTILE;
    gun.ammoType = AmmoType::AMMO_LIGHT;
    gun.magazineSize = 40;
    gun.ammoInMag = 40;
    gun.ammoPerShot = 1;
    gun.fireRate = 10.0f;
    gun.reloadTime = 1.6f;
    gun.damage = 10.0f;
    gun.range = meters(1500.0f);
    gun.spread = 0.015f;
    gun.pellets = 1;
    gun.barrelLength = 0.7f;
    gun.projectileSpeed = 10.0f;
    ;
    gun.projectileLifetime = 1.4f;
    gun.automatic = true;
    return gun;
}

inline Components::Gun makeShotgun(bool hitscan = false) {
    Components::Gun gun;
    gun.fireMode =
        hitscan ? GunFireMode::FIRE_HITSCAN : GunFireMode::FIRE_PROJECTILE;
    gun.ammoType = AmmoType::AMMO_SHELL;
    gun.magazineSize = 6;
    gun.ammoInMag = 6;
    gun.ammoPerShot = 1;
    gun.fireRate = 1.6f;
    gun.reloadTime = 2.0f;
    gun.damage = 7.0f;
    gun.range = meters(900.0f);
    gun.spread = 0.08f;
    gun.pellets = 6;
    gun.barrelLength = 0.65f;
    gun.projectileSpeed = 10.0f;
    ;
    gun.projectileLifetime = 0.9f;
    gun.automatic = false;
    return gun;
}

}  // namespace GunFactory
