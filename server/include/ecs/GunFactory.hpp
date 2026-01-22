#pragma once

#include "GameConfig.hpp"
#include "ecs/components.hpp"

namespace GunFactory {

inline Components::Gun makeFromConfig(const WeaponConfig& config) {
    Components::Gun gun;
    gun.fireMode = config.fireMode;
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

inline Components::Gun makePistol(const GameConfig& config) {
    Components::Gun gun = makeFromConfig(config.pistol);
    gun.itemType = ItemType::GUN_PISTOL;
    return gun;
}

inline Components::Gun makeRifle(const GameConfig& config) {
    Components::Gun gun = makeFromConfig(config.rifle);
    gun.itemType = ItemType::GUN_RIFLE;
    return gun;
}

inline Components::Gun makeShotgun(const GameConfig& config) {
    Components::Gun gun = makeFromConfig(config.shotgun);
    gun.itemType = ItemType::GUN_SHOTGUN;
    return gun;
}

}  // namespace GunFactory
