#pragma once

#include <cstdint>
#include <memory>
#include <optional>

#include <glm/vec3.hpp>

#include "maps/MapPackage.hpp"

class PhysicsWorld {
   public:
    struct CharacterConfig {
        float radius = 0.35F;
        float halfHeight = 0.48F;
        float maxSlopeRadians = 0.87266463F;
        float stepHeight = 0.35F;
        float stickToFloorDistance = 0.5F;
        float groundAcceleration = 42.0F;
        float airAcceleration = 12.0F;
        float airControl = 0.45F;
        float jumpSpeed = 6.4F;
        float gravity = 20.0F;
        float terminalVelocity = 35.0F;
        float mass = 80.0F;
    };
    struct CharacterState {
        glm::vec3 position{0.0F};
        glm::vec3 velocity{0.0F};
        bool grounded = false;
    };
    using CharacterId = std::uint32_t;
    using BodyId = std::uint32_t;

    PhysicsWorld();
    ~PhysicsWorld();
    PhysicsWorld(const PhysicsWorld&) = delete;
    PhysicsWorld& operator=(const PhysicsWorld&) = delete;
    PhysicsWorld(PhysicsWorld&&) noexcept;
    PhysicsWorld& operator=(PhysicsWorld&&) noexcept;

    BodyId addStaticCollision(const CollisionMesh3D& mesh);
    void removeBody(BodyId body);
    CharacterId createCharacter(const CharacterConfig& config,
                                const glm::vec3& position);
    void destroyCharacter(CharacterId character);
    void setCharacterVelocity(CharacterId character, const glm::vec3& velocity);
    void setCharacterPosition(CharacterId character, const glm::vec3& position);
    CharacterState characterState(CharacterId character) const;
    void updateCharacter(CharacterId character, float deltaSeconds,
                         const glm::vec3& desiredVelocity,
                         bool jumpRequested = false);

    // Returns true when static world geometry blocks the segment.
    bool staticRayBlocked(const glm::vec3& from, const glm::vec3& to) const;
    struct StaticRayHit {
        float distance = 0.0F;
        glm::vec3 position{0.0F};
        glm::vec3 normal{0.0F};
    };
    std::optional<StaticRayHit> castStaticRay(
        const glm::vec3& origin, const glm::vec3& normalizedDirection,
        float maxDistance) const;

    // Larger deltas are split so a native Jolt update never exceeds 1/60 s.
    void step(float deltaSeconds);

   private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
};
