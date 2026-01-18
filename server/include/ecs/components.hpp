#pragma once

#include <box2d/box2d.h>

#include <algorithm>
#include <array>
#include <entt/entt.hpp>

#include "common/enums.hpp"
#include "ecs/EntityManager.hpp"

namespace Components {

struct Client {
    uint32_t id;
};

struct EntityBase {
    EntityTypes type;
    uint8_t variant = 0;
    b2BodyId bodyId = b2_nullBodyId;
};

struct Networked {};
struct Removal {};

struct Camera {
    entt::entity target;
    b2Vec2 position;
    int width = 1920;
    int height = 1080;
};

struct Input {
    uint8_t direction;
    float angle;
    bool mouseIsDown = false;
    // true if the mouse was ever down during the current tick
    bool dirtyClick = false;
};

struct AttackCooldown {
    float duration;
    float current;

    bool update(float delta) {
        current -= delta;
        if (current <= 0.0f) {
            current = 0.0f;
            return true;
        }
        return false;
    }

    void reset() { current = duration; }
};

struct State {
    uint8_t state;

    void setState(uint8_t bitflag) { state |= bitflag; }
    void unsetState(uint8_t bitflag) { state &= ~bitflag; }
    bool isSet(uint8_t bitflag) const { return (state & bitflag) != 0; }
    bool isIdle() const { return state == 0; }
    void clear() { state = 0; }
};

struct Health {
    float max;
    float current;
    bool dirty = false;
    entt::entity attacker = entt::null;

    void decrement(float amount, entt::entity attacker = entt::null) {
        current -= amount;
        if (current < 0.0f) {
            current = 0.0f;
        }

        dirty = true;
        this->attacker = attacker;
    }
};

struct Destructible {
    float maxHealth = 100.0f;
    float currentHealth = 100.0f;
    bool destroyed = false;

    void damage(float amount) {
        currentHealth -= amount;
        if (currentHealth <= 0.0f) {
            currentHealth = 0.0f;
            destroyed = true;
        }
    }

    bool isDestroyed() const { return destroyed; }
};

struct Ammo {
    std::array<int, static_cast<size_t>(AmmoType::AMMO_COUNT)> amounts{};

    int get(AmmoType type) const { return amounts[static_cast<size_t>(type)]; }

    int take(AmmoType type, int amount) {
        size_t index = static_cast<size_t>(type);
        int available = amounts[index];
        int taken = std::min(available, amount);
        amounts[index] = available - taken;
        return taken;
    }

    void add(AmmoType type, int amount) {
        amounts[static_cast<size_t>(type)] += amount;
    }
};

struct Gun {
    GunFireMode fireMode = GunFireMode::FIRE_HITSCAN;
    AmmoType ammoType = AmmoType::AMMO_LIGHT;

    int magazineSize = 12;
    int ammoInMag = 12;
    int ammoPerShot = 1;

    float fireRate = 6.0f;  // shots per second
    float cooldown = 0.0f;
    float reloadTime = 1.5f;  // seconds
    float reloadRemaining = 0.0f;

    float damage = 10.0f;
    float range = 12.0f;   // meters for hitscan
    float spread = 0.02f;  // radians
    int pellets = 1;

    float projectileSpeed = 30.0f;    // meters per second
    float projectileLifetime = 1.5f;  // seconds

    bool automatic = true;

    void update(float delta) {
        if (cooldown > 0.0f) {
            cooldown -= delta;
            if (cooldown < 0.0f) cooldown = 0.0f;
        }
        if (reloadRemaining > 0.0f) {
            reloadRemaining -= delta;
            if (reloadRemaining < 0.0f) reloadRemaining = 0.0f;
        }
    }

    bool isReloading() const { return reloadRemaining > 0.0f; }

    bool canFire() const {
        return cooldown <= 0.0f && !isReloading() && ammoInMag >= ammoPerShot;
    }

    void startReload() { reloadRemaining = reloadTime; }

    void triggerCooldown() {
        if (fireRate > 0.0f) {
            cooldown = 1.0f / fireRate;
        } else {
            cooldown = 0.0f;
        }
    }
};

struct Projectile {
    entt::entity owner = entt::null;
    float damage = 0.0f;
    float remainingLife = 0.0f;
    bool active = false;
};

};  // namespace Components