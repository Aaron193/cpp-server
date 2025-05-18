#pragma once

#include <box2d/b2_body.h>
#include <box2d/b2_math.h>

#include <entt/entt.hpp>

#include "ecs/EntityManager.hpp"

namespace Components {

struct Type {
    EntityTypes type;
};

struct Client {
    uint32_t id;
};

struct Body {
    b2Body* body;
};

struct Static {};
struct Dynamic {};

struct Networked {};

struct Camera {
    entt::entity target;
    b2Vec2 position;
    int width = 1920;
    int height = 1080;
};

struct Input {
    uint8_t direction;
    float angle;
};

struct Removal {};

}  // namespace Components