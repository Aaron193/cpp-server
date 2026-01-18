#pragma once

#include <cstdint>
#include <entt/entt.hpp>
#include <unordered_map>
#include <vector>

enum EntityTypes : uint8_t {
    SPECTATOR,
    PLAYER,
    CRATE,
    BUSH,
    ROCK,
    WALL,
    FENCE,
    TREE,
    BULLET
};
enum Variant : uint8_t { NONE, VARIANT_1, VARIANT_2, VARIANT_3 };

enum EntityStates : uint8_t {
    IDLE = 0,
    MELEE = 1 << 0,
    HURT = 1 << 1,
    SHOOTING = 1 << 2,
};

class GameServer;

class EntityManager {
   private:
    entt::registry m_registry;
    GameServer& m_gameServer;

    entt::entity createProjectileEntity();
    std::vector<entt::entity> m_projectilePool;

   public:
    EntityManager(GameServer& gameServer);

    EntityManager(const EntityManager&) = delete;
    EntityManager& operator=(const EntityManager&) = delete;

    entt::registry& getRegistry() { return m_registry; }

    // Max amount of variants per EntityType
    std::unordered_map<EntityTypes, uint8_t> m_variants;
    uint8_t getVariantCount(EntityTypes type);
    uint8_t getRandomVariant(EntityTypes type);

    entt::entity createSpectator(entt::entity folowee);
    entt::entity createPlayer();
    entt::entity createCrate();
    entt::entity createBush();
    entt::entity createRock();
    entt::entity createWall(float x, float y);
    entt::entity createTree(float x, float y);

    void initProjectilePool(size_t count);
    entt::entity acquireProjectile();
    void releaseProjectile(entt::entity entity);

    void scheduleForRemoval(entt::entity entity);
    void removeEntities();
    entt::entity getFollowEntity();
};

struct EntityBodyUserData {
    entt::entity entity;
};
