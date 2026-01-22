#pragma once

#include "GameConfig.hpp"
#include "ecs/components.hpp"

namespace GunFactory {

inline Components::Gun makeFromConfig(const WeaponConfig& config,
                                      bool hitscan) {
    Components::Gun gun;
    gun.fireMode = hitscan ? GunFireMode::FIRE_HITSCAN : config.fireMode;
    gun.ammoType = config.ammoType;
    gun.magazineSize = config.magazineSize;
    gun.ammoInMag = config.magazineSize;
    gun.ammoPerShot = config.ammoPerShot;
    gun.fireRate = config.fireRate;
    gun.reloadTime = config.reloadTime;
    gun.damage = config.damage;
    gun.range = config.range;
    gun.spread = config.spread;
    gun.pellets = config.pellets;
    gun.barrelLength = config.barrelLength;
    gun.projectileSpeed = config.projectileSpeed;
    gun.projectileLifetime = config.projectileLifetime;
    gun.automatic = config.automatic;
    return gun;
}

inline Components::Gun makePistol(const GameConfig& config,
                                  bool hitscan = false) {
    return makeFromConfig(config.pistol, hitscan);
}

inline Components::Gun makeRifle(const GameConfig& config,
                                 bool hitscan = false) {
    return makeFromConfig(config.rifle, hitscan);
}

inline Components::Gun makeShotgun(const GameConfig& config,
                                   bool hitscan = false) {
    return makeFromConfig(config.shotgun, hitscan);
}

}  // namespace GunFactory
