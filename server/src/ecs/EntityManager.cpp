#include "ecs/EntityManager.hpp"

#include <cassert>
#include <cstdlib>

#include "GameServer.hpp"
#include "ecs/GunFactory.hpp"
#include "ecs/components.hpp"

using namespace Components;

EntityManager::EntityManager(GameServer& gameServer) : m_gameServer(gameServer) {
    m_variants[BUSH] = 2;
    m_variants[ROCK] = 2;
    m_variants[CRATE] = 0;
    m_variants[PLAYER] = 0;
    m_variants[SPECTATOR] = 0;
    m_variants[WALL] = 0;
    m_variants[FENCE] = 0;
    m_variants[TREE] = 2;
}

uint8_t EntityManager::getVariantCount(EntityTypes type) {
    assert(m_variants.count(type));
    return m_variants[type];
}

uint8_t EntityManager::getRandomVariant(EntityTypes type) {
    const uint8_t variants = getVariantCount(type);
    return variants == 0 ? 0 : static_cast<uint8_t>((std::rand() % variants) + 1);
}

entt::entity EntityManager::createSpectator(entt::entity followee) {
    const auto entity = m_registry.create();
    m_registry.emplace<EntityBase>(entity, SPECTATOR);
    if (followee == entt::null) followee = getFollowEntity();
    m_registry.emplace<Camera>(entity, followee);
    return entity;
}

entt::entity EntityManager::createPlayer() {
    const auto entity = m_registry.create();
    m_registry.emplace<EntityBase>(entity, PLAYER);
    const auto& spawn = m_gameServer.selectSpawnPoint();
    auto& transform = m_registry.emplace<Transform3D>(entity);
    transform.position = spawn.position;
    transform.rotation = glm::angleAxis(spawn.yaw, glm::vec3{0.0F, 1.0F, 0.0F});
    m_registry.emplace<Velocity3D>(entity);
    auto& controller = m_registry.emplace<CharacterController>(entity);
    PhysicsWorld::CharacterConfig physicsConfig;
    const auto& movement = m_gameServer.m_gameConfig.movement;
    physicsConfig.radius = movement.capsuleRadius;
    physicsConfig.halfHeight = movement.capsuleHalfHeight;
    physicsConfig.maxSlopeRadians = movement.maxSlopeRadians;
    physicsConfig.stepHeight = movement.stepUpHeight;
    physicsConfig.stickToFloorDistance = movement.stickToFloorDistance;
    physicsConfig.groundAcceleration = movement.groundAcceleration;
    physicsConfig.airAcceleration = movement.airAcceleration;
    physicsConfig.airControl = movement.airControl;
    physicsConfig.jumpSpeed = movement.jumpSpeed;
    physicsConfig.gravity = movement.gravity;
    physicsConfig.terminalVelocity = movement.terminalVelocity;
    controller.adapterId = m_gameServer.m_physicsWorld.createCharacter(physicsConfig, transform.position);
    m_registry.emplace<NetworkReplicated>(entity);
    auto& input = m_registry.emplace<PlayerInput>(entity);
    input.yaw = spawn.yaw;
    input.angle = spawn.yaw;
    m_registry.emplace<Health>(entity, 100.0F, 100.0F);
    auto& life = m_registry.emplace<PlayerLife>(entity);
    life.spawnProtectionRemaining =
        m_gameServer.m_gameConfig.combat.spawnProtectionSeconds;
    m_registry.emplace<PlayerCombat>(entity);
    m_registry.emplace<Score>(entity);
    m_registry.emplace<Camera>(entity, entity);
    auto& inventory = m_registry.emplace<WeaponInventory>(entity);
    inventory.addItem(GunFactory::makeRifle(m_gameServer.m_gameConfig));
    inventory.addItem(GunFactory::makeShotgun(m_gameServer.m_gameConfig));
    auto& ammo = m_registry.emplace<Ammo>(entity);
    ammo.add(AmmoType::LIGHT,
             m_gameServer.m_gameConfig.loadout.rifleReserveAmmo);
    ammo.add(AmmoType::SHELL,
             m_gameServer.m_gameConfig.loadout.shotgunReserveAmmo);
    return entity;
}

void EntityManager::scheduleForRemoval(entt::entity entity) {
    if (m_registry.valid(entity) && !m_registry.all_of<Removal>(entity))
        m_registry.emplace<Removal>(entity);
}

void EntityManager::removeEntities() {
    const auto view = m_registry.view<Removal>();
    for (const auto entity : view) {
        if (const auto* controller = m_registry.try_get<CharacterController>(entity))
            m_gameServer.m_physicsWorld.destroyCharacter(controller->adapterId);
        if (const auto* body = m_registry.try_get<RigidBody>(entity))
            m_gameServer.m_physicsWorld.removeBody(body->adapterId);
    }
    m_registry.destroy(view.begin(), view.end());
}

entt::entity EntityManager::getFollowEntity() {
    const auto view = m_registry.view<EntityBase, NetworkReplicated>();
    for (const auto entity : view)
        if (view.get<EntityBase>(entity).type == PLAYER) return entity;
    return entt::null;
}
