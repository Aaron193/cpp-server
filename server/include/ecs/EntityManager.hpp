#pragma once

#include <cstdint>
#include <entt/entt.hpp>

enum EntityTypes : uint8_t { SPECTATOR, PLAYER, CRATE, HITBOX };

enum EntityStates : uint8_t {
    IDLE = 0,
    MELEE = 1 << 0,
    HURT = 1 << 1,
};

class GameServer;

class EntityManager {
   private:
    entt::registry m_registry;
    GameServer& m_gameServer;

   public:
    EntityManager(GameServer& gameServer);

    EntityManager(const EntityManager&) = delete;
    EntityManager& operator=(const EntityManager&) = delete;

    entt::registry& getRegistry() { return m_registry; }

    entt::entity createSpectator(entt::entity folowee);
    entt::entity createPlayer();
    entt::entity createCrate();

    void scheduleForRemoval(entt::entity entity);
    void removeEntities();
    entt::entity getFollowEntity();
};

struct EntityBodyUserData {
    entt::entity entity;
};
