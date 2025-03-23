#pragma once

#include <entt/entt.hpp>

enum EntityTypes { SPECTATOR, PLAYER };

class EntityManager {
   private:
    entt::registry m_registry;

   public:
    EntityManager() = default;

    EntityManager(const EntityManager&) = delete;
    EntityManager& operator=(const EntityManager&) = delete;

    entt::registry& getRegistry() { return m_registry; }

    entt::entity createSpectator(entt::entity folowee);
    entt::entity createPlayer();

    void scheduleForRemoval(entt::entity entity);
    void removeEntities();
};