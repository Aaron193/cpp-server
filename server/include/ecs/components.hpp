#pragma once

#include <algorithm>
#include <array>
#include <cstdint>
#include <entt/entt.hpp>
#include <glm/gtc/quaternion.hpp>
#include <glm/vec2.hpp>
#include <glm/vec3.hpp>

#include "common/enums.hpp"
#include "combat/Aiming.hpp"
#include "ecs/EntityManager.hpp"
#include "protocol/generated.hpp"

namespace Components {

struct Client {
    uint32_t id;
};

struct EntityBase {
    EntityTypes type;
    uint8_t variant = 0;
};

struct Transform3D {
    glm::vec3 position{0.0F};
    glm::quat rotation{1.0F, 0.0F, 0.0F, 0.0F};
};

struct Velocity3D {
    glm::vec3 linear{0.0F};
    glm::vec3 angular{0.0F};
};

struct CharacterController {
    std::uint32_t adapterId = 0;
    bool grounded = false;
};

struct RigidBody {
    std::uint32_t adapterId = 0;
    bool dynamic = false;
};

struct NetworkReplicated {
    bool dirty = true;
};

struct Removal {};

struct Camera {
    entt::entity target;
    glm::vec3 position{0.0F};
    int width = 1920;
    int height = 1080;
};

struct PlayerInput {
    uint8_t direction = 0;
    float angle = 0.0F;
    glm::vec2 movement{0.0F};
    float yaw = 0.0F;
    float pitch = 0.0F;
    bool jump = false;
    bool mouseIsDown = false;
    // true if the mouse was ever down during the current tick
    bool dirtyClick = false;
    bool reloadRequested = false;
    bool sprintHeld = false;
    bool crouchPressed = false;
    bool pronePressed = false;
    bool dashPressed = false;
    bool adsHeld = false;
    int8_t switchSlot = -1;
    std::uint32_t clientTick = 0;
    std::uint32_t inputSequence = 0;
    std::uint32_t fireActionId = 0;
    std::uint32_t reloadActionId = 0;
};

struct MovementState {
    protocol::Stance stance = protocol::Stance::Standing;
    protocol::MovementMode mode = protocol::MovementMode::Normal;
    float modeTimeRemaining = 0.0F;
    float dashCooldownRemaining = 0.0F;
    float slideCooldownRemaining = 0.0F;
    float weaponLockRemaining = 0.0F;
    bool stanceExpansionPending = false;
    glm::vec3 dashDirection{0.0F, 0.0F, -1.0F};
    glm::vec3 mantleStart{0.0F};
    glm::vec3 mantleTarget{0.0F};
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

struct PlayerLife {
    bool dead = false;
    float respawnRemaining = 0.0F;
    float spawnProtectionRemaining = 1.5F;
    std::uint64_t deathTick = 0;
    entt::entity killer = entt::null;
    ItemType killingWeapon = ItemType::ITEM_NONE;
    bool deathPublished = false;
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
    GunFireMode fireMode = GunFireMode::FIRE_HITSCAN;
    AmmoType ammoType = AmmoType::LIGHT;

    int magazineSize = 12;
    int ammoInMag = 12;
    int ammoPerShot = 1;

    float fireRate = 6.0f;  // shots per second
    float reloadTime = 1.5f;  // seconds
    float reloadRemaining = 0.0f;

    float damage = 10.0f;
    float range = 12.0f;   // meters for hitscan
    float spread = 0.02f;  // radians
    int pellets = 1;

    float barrelLength = 0.6f;  // meters, muzzle offset from player surface

    bool automatic = true;
    std::uint64_t nextFireTick = 0;
    std::uint64_t reloadEndTick = 0;

    bool isReloading() const { return reloadRemaining > 0.0f; }
};

struct PlayerCombat {
    bool triggerWasDown = false;
};

struct PlayerAiming {
    Aiming::State value{};
};

struct InventorySlot {
    Gun gun{};

    ItemType getItemType() const { return gun.itemType; }

    bool isEmpty() const { return gun.itemType == ItemType::ITEM_NONE; }

    bool isGun() const {
        return gun.itemType == ItemType::GUN_RIFLE ||
               gun.itemType == ItemType::GUN_SHOTGUN;
    }
};

struct WeaponInventory {
    std::array<InventorySlot, 2> slots{};
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

struct Score {
    std::uint32_t kills = 0;
    std::uint32_t deaths = 0;
    std::int32_t points = 0;
};

};  // namespace Components
