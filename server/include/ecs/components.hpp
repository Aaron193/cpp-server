#pragma once

#include <box2d/box2d.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <entt/entt.hpp>
#include <unordered_set>

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
    bool reloadRequested = false;
    bool pickupRequested = false;
    int8_t switchSlot = -1;
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
    std::array<int, static_cast<size_t>(AmmoType::COUNT)> amounts{};

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
    ItemType itemType = ItemType::ITEM_NONE;
    GunFireMode fireMode = GunFireMode::FIRE_PROJECTILE;
    AmmoType ammoType = AmmoType::LIGHT;

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

    float barrelLength = 0.6f;  // meters, muzzle offset from player surface

    float projectileSpeed = 10.0f;    // meters per second
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

struct InventorySlot {
    Gun gun{};

    ItemType getItemType() const { return gun.itemType; }

    bool isEmpty() const { return gun.itemType == ItemType::ITEM_NONE; }

    bool isGun() const {
        return gun.itemType == ItemType::GUN_PISTOL ||
               gun.itemType == ItemType::GUN_RIFLE ||
               gun.itemType == ItemType::GUN_SHOTGUN;
    }
};

struct Inventory {
    std::array<InventorySlot, 5> slots{};
    uint8_t activeSlot = 0;
    bool dirty = true;

    bool setActiveSlot(uint8_t slot) {
        if (slot >= slots.size()) {
            return false;
        }
        activeSlot = slot;
        dirty = true;
        return true;
    }

    bool addItem(const Gun& gun) {
        for (auto& slot : slots) {
            if (slot.isEmpty()) {
                slot.gun = gun;
                dirty = true;
                return true;
            }
        }
        return false;
    }

    bool clearSlot(uint8_t slot) {
        if (slot >= slots.size()) {
            return false;
        }
        slots[slot] = InventorySlot{};
        dirty = true;
        return true;
    }

    uint8_t countOccupiedSlots() const {
        uint8_t count = 0;
        for (const auto& slot : slots) {
            if (!slot.isEmpty()) {
                ++count;
            }
        }
        return count;
    }

    InventorySlot& getActive() { return slots[activeSlot]; }
    const InventorySlot& getActive() const { return slots[activeSlot]; }
    bool hasGunInHands() const { return getActive().isGun(); }
};

struct GroundItem {
    ItemType itemType = ItemType::ITEM_NONE;
    AmmoType ammoType = AmmoType::LIGHT;
    int ammoAmount = 0;
    Gun gun{};
    std::unordered_set<entt::entity> overlaps;

    bool isGun() const {
        return itemType == ItemType::GUN_PISTOL ||
               itemType == ItemType::GUN_RIFLE ||
               itemType == ItemType::GUN_SHOTGUN;
    }
};

struct Projectile {
    entt::entity owner = entt::null;
    float damage = 0.0f;
    float remainingLife = 0.0f;
    bool active = false;
    uint64_t spawnTick = 0;
    // todo : use vec2?
    float originX = 0.0f;
    float originY = 0.0f;
    float dirX = 0.0f;
    float dirY = 0.0f;
    float speed = 0.0f;

    void init(entt::entity ownerEntity, const Gun& gun, uint64_t tick,
              float spawnX, float spawnY, float directionX, float directionY,
              float projectileSpeed) {
        owner = ownerEntity;
        damage = gun.damage;
        remainingLife = gun.projectileLifetime;
        active = true;
        spawnTick = tick;
        originX = spawnX;
        originY = spawnY;
        dirX = directionX;
        dirY = directionY;
        speed = projectileSpeed;
    }
};

};  // namespace Components