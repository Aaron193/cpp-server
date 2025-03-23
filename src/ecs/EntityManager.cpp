#include "ecs/EntityManager.hpp"

#include <entt/entt.hpp>

#include "ecs/components.hpp"

using namespace Components;

entt::entity EntityManager::createSpectator(entt::entity folowee) {
    entt::entity entity = m_registry.create();

    m_registry.emplace<Type>(entity, EntityTypes::SPECTATOR);
    m_registry.emplace<Camera>(entity, folowee);

    return entity;
}

entt::entity EntityManager::createPlayer() {
    entt::entity entity = m_registry.create();

    m_registry.emplace<Type>(entity, EntityTypes::PLAYER);
    m_registry.emplace<Body>(entity);
    m_registry.emplace<Dynamic>(entity);
    m_registry.emplace<Networked>(entity);
    m_registry.emplace<Camera>(entity, entity);
    m_registry.emplace<Input>(entity);

    b2Body* body = m_registry.get<Body>(entity).body;

    // TODO: setup physics body

    return entity;
}

void EntityManager::scheduleForRemoval(entt::entity entity) {
    m_registry.emplace<Removal>(entity);
}

void EntityManager::removeEntities() {
    m_registry.view<Removal>().each(
        [this](auto entity) { m_registry.destroy(entity); });
}