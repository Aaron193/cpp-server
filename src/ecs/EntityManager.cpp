#include "ecs/EntityManager.hpp"

#include <entt/entt.hpp>

#include "ecs/components.hpp"

using namespace Components;

entt::entity EntityManager::createSpectator(entt::entity followee) {
    entt::entity entity = m_registry.create();

    m_registry.emplace<Type>(entity, EntityTypes::SPECTATOR);

    if (followee == entt::null) {
        followee = getFollowEntity();
    }

    m_registry.emplace<Camera>(entity, followee);

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

entt::entity EntityManager::getFollowEntity() {
    auto view = m_registry.view<Body, Dynamic, Networked>();

    // random entity for now
    for (auto entity : view) {
        return entity;
    }

    return entt::null;
}