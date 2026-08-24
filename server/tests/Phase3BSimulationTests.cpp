#include "TestHarness.hpp"

#include <glm/geometric.hpp>
#include <cmath>

#include "GameServer.hpp"
#include "ecs/components.hpp"
#include "physics/PhysicsWorld.hpp"

namespace {
CollisionMesh3D wallMesh() {
    CollisionMesh3D mesh;
    mesh.boundsMin = {-0.1F, -2.0F, -2.0F};
    mesh.boundsMax = {0.1F, 3.0F, 2.0F};
    mesh.vertices = {{0,-2,-2}, {0,3,-2}, {0,3,2}, {0,-2,2}};
    mesh.indices = {0,2,1, 0,3,2};
    return mesh;
}

Components::PlayerInput forwardInput() {
    Components::PlayerInput input;
    input.movement = {0.0F, -1.0F};
    input.yaw = 0.0F;
    return input;
}
}  // namespace

TEST_CASE(snapshot_hook_publishes_twenty_hz_without_socket_loop) {
    GameServer server;
    std::uint64_t snapshots = 0;
    std::uint64_t lastSnapshot = 0;
    server.setSnapshotHook([&](std::uint64_t tick) {
        EXPECT_TRUE(tick > lastSnapshot);
        EXPECT_EQ(tick % 3U, 0U);
        lastSnapshot = tick;
        ++snapshots;
    });
    for (int i = 0; i < 60; ++i) server.simulateOneTick();
    EXPECT_EQ(server.m_currentTick, 60U);
    EXPECT_EQ(snapshots, 20U);
    EXPECT_EQ(lastSnapshot, 60U);
}

TEST_CASE(headless_validated_input_replay_is_deterministic) {
    GameServer first;
    GameServer second;
    const auto firstPlayer = first.m_entityManager.createPlayer();
    const auto secondPlayer = second.m_entityManager.createPlayer();
    for (int tick = 0; tick < 120; ++tick) {
        auto input = forwardInput();
        input.yaw = tick < 60 ? 0.0F : 1.57079632679F;
        input.jump = tick == 30;
        first.queueValidatedInput(firstPlayer, input);
        second.queueValidatedInput(secondPlayer, input);
        first.simulateOneTick();
        second.simulateOneTick();
    }
    const auto& firstTransform = first.m_entityManager.getRegistry().get<
        Components::Transform3D>(firstPlayer);
    const auto& secondTransform = second.m_entityManager.getRegistry().get<
        Components::Transform3D>(secondPlayer);
    EXPECT_NEAR(firstTransform.position.x, secondTransform.position.x, 0.0001F);
    EXPECT_NEAR(firstTransform.position.y, secondTransform.position.y, 0.0001F);
    EXPECT_NEAR(firstTransform.position.z, secondTransform.position.z, 0.0001F);
}

TEST_CASE(player_input_moves_in_yaw_relative_xz_space) {
    GameServer server;
    const auto player = server.m_entityManager.createPlayer();
    auto input = forwardInput();
    input.yaw = 1.57079632679F;
    server.queueValidatedInput(player, input);
    server.simulateOneTick();
    const auto velocity = server.m_entityManager.getRegistry().get<
        Components::Velocity3D>(player).linear;
    EXPECT_TRUE(velocity.x > 0.01F);
    EXPECT_TRUE(std::abs(velocity.z) < 0.01F);
    EXPECT_TRUE(velocity.x < server.m_gameConfig.movement.groundSpeed);
}

TEST_CASE(player_spawns_with_two_weapon_slots_and_reserve_ammo) {
    GameServer server;
    const auto player = server.m_entityManager.createPlayer();
    auto& registry = server.m_entityManager.getRegistry();
    const auto& inventory = registry.get<Components::WeaponInventory>(player);
    const auto& ammo = registry.get<Components::Ammo>(player);
    EXPECT_EQ(inventory.slots.size(), 2U);
    EXPECT_EQ(inventory.countOccupiedSlots(), 2U);
    EXPECT_EQ(inventory.slots[0].getItemType(), ItemType::GUN_RIFLE);
    EXPECT_EQ(inventory.slots[1].getItemType(), ItemType::GUN_SHOTGUN);
    EXPECT_EQ(ammo.get(AmmoType::LIGHT),
              server.m_gameConfig.loadout.rifleReserveAmmo);
    EXPECT_EQ(ammo.get(AmmoType::SHELL),
              server.m_gameConfig.loadout.shotgunReserveAmmo);
}

TEST_CASE(death_respawn_and_spawn_protection_follow_fixed_tick_timers) {
    GameServer server;
    const auto player = server.m_entityManager.createPlayer();
    auto& registry = server.m_entityManager.getRegistry();
    auto& health = registry.get<Components::Health>(player);
    auto& life = registry.get<Components::PlayerLife>(player);
    EXPECT_NEAR(health.current, 100.0F, 0.0001F);
    EXPECT_NEAR(life.spawnProtectionRemaining, 1.5F, 0.0001F);

    server.triggerDeath(player);
    server.simulateOneTick();
    EXPECT_TRUE(life.dead);
    EXPECT_NEAR(health.current, 0.0F, 0.0001F);
    for (int i = 0; i < 179; ++i) server.simulateOneTick();
    EXPECT_TRUE(life.dead);
    server.simulateOneTick();
    EXPECT_TRUE(!life.dead);
    EXPECT_NEAR(health.current, 100.0F, 0.0001F);
    EXPECT_NEAR(life.spawnProtectionRemaining, 1.5F, 0.0001F);
    for (int i = 0; i < 90; ++i) server.simulateOneTick();
    EXPECT_NEAR(life.spawnProtectionRemaining, 0.0F, 0.0001F);
}

TEST_CASE(spawn_selection_prefers_distance_from_nearby_visible_enemy) {
    GameServer server;
    server.m_mapPackage.manifest.spawnPoints = {
        {"near", {1.0F, 0.1F, 0.0F}, 0.0F},
        {"far", {20.0F, 0.1F, 0.0F}, 0.0F}};
    const auto enemy = server.m_entityManager.createPlayer();
    auto& enemyTransform = server.m_entityManager.getRegistry().get<
        Components::Transform3D>(enemy);
    enemyTransform.position = {0.0F, 0.1F, 0.0F};
    EXPECT_EQ(server.selectSpawnPoint().id, "far");
}

TEST_CASE(static_world_ray_query_distinguishes_cover_for_spawn_safety) {
    PhysicsWorld world;
    world.addStaticCollision(wallMesh());
    EXPECT_TRUE(world.staticRayBlocked({-2,1,0}, {2,1,0}));
    EXPECT_TRUE(!world.staticRayBlocked({-2,1,3}, {2,1,3}));
}
