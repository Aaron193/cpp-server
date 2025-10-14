#pragma once

#include <box2d/b2_body.h>
#include <box2d/b2_math.h>

#include <entt/entt.hpp>

#include "ecs/EntityManager.hpp"

namespace Components {

struct Client {
    uint32_t id;
};

struct EntityBase {
    EntityTypes type;
    Variant variant = Variant::NONE;
    b2Body* body = nullptr;
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

};  // namespace Components