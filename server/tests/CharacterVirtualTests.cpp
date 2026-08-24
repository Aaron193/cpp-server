#include "TestHarness.hpp"

#include <algorithm>

#include "physics/PhysicsWorld.hpp"

namespace {
void addTriangle(CollisionMesh3D& mesh, glm::vec3 a, glm::vec3 b, glm::vec3 c) {
    const auto base = static_cast<std::uint32_t>(mesh.vertices.size());
    mesh.vertices.insert(mesh.vertices.end(), {a, b, c});
    mesh.indices.insert(mesh.indices.end(), {base, base + 1, base + 2});
}

CollisionMesh3D floorMesh() {
    CollisionMesh3D mesh;
    mesh.boundsMin = {-20.0F, -2.0F, -20.0F};
    mesh.boundsMax = {20.0F, 10.0F, 20.0F};
    const glm::vec3 a{-20,0,-20}, b{20,0,-20}, c{20,0,20}, d{-20,0,20};
    addTriangle(mesh, a, c, b); addTriangle(mesh, a, d, c);
    return mesh;
}

void settle(PhysicsWorld& world, PhysicsWorld::CharacterId id, int frames = 90) {
    for (int i = 0; i < frames; ++i) {
        world.updateCharacter(id, 1.0F / 60.0F, {0,0,0});
        world.step(1.0F / 60.0F);
    }
}
}  // namespace

TEST_CASE(character_virtual_grounds_and_moves_on_static_collision) {
    PhysicsWorld world;
    world.addStaticCollision(floorMesh());
    const auto character = world.createCharacter({}, {0, 2, 0});
    settle(world, character);
    const auto settled = world.characterState(character);
    EXPECT_TRUE(settled.grounded);
    EXPECT_TRUE(settled.position.y < 0.1F);
    const float start = settled.position.x;
    for (int i = 0; i < 60; ++i) {
        world.updateCharacter(character, 1.0F / 60.0F, {2,0,0});
        world.step(1.0F / 60.0F);
    }
    EXPECT_TRUE(world.characterState(character).position.x > start + 1.0F);
}

TEST_CASE(character_virtual_accelerates_instead_of_setting_horizontal_velocity) {
    PhysicsWorld world;
    world.addStaticCollision(floorMesh());
    PhysicsWorld::CharacterConfig config;
    config.groundAcceleration = 42.0F;
    const auto character = world.createCharacter(config, {0, 2, 0});
    settle(world, character);
    world.updateCharacter(character, 1.0F / 60.0F, {7.5F,0,0});
    world.step(1.0F / 60.0F);
    const float firstFrameSpeed = world.characterState(character).velocity.x;
    EXPECT_TRUE(firstFrameSpeed > 0.5F);
    EXPECT_TRUE(firstFrameSpeed < 1.0F);
    for (int i = 0; i < 30; ++i) {
        world.updateCharacter(character, 1.0F / 60.0F, {7.5F,0,0});
        world.step(1.0F / 60.0F);
    }
    EXPECT_NEAR(world.characterState(character).velocity.x, 7.5F, 0.1F);
}

TEST_CASE(character_virtual_applies_air_control_and_terminal_velocity) {
    PhysicsWorld world;
    PhysicsWorld::CharacterConfig config;
    config.airAcceleration = 12.0F;
    config.airControl = 0.45F;
    config.gravity = 20.0F;
    config.terminalVelocity = 35.0F;
    const auto character = world.createCharacter(config, {0, 50, 0});
    world.updateCharacter(character, 1.0F / 60.0F, {7.5F,0,0});
    world.step(1.0F / 60.0F);
    const auto first = world.characterState(character);
    EXPECT_TRUE(first.velocity.x > 0.05F && first.velocity.x < 0.2F);
    for (int i = 0; i < 180; ++i) {
        world.updateCharacter(character, 1.0F / 60.0F, {0,0,0});
        world.step(1.0F / 60.0F);
    }
    EXPECT_TRUE(world.characterState(character).velocity.y >= -35.01F);
}

TEST_CASE(character_virtual_jumps_only_from_ground_and_lands_again) {
    PhysicsWorld world;
    world.addStaticCollision(floorMesh());
    const auto character = world.createCharacter({}, {0, 2, 0});
    settle(world, character);
    const float groundHeight = world.characterState(character).position.y;

    world.updateCharacter(character, 1.0F / 60.0F, {0,0,0}, true);
    world.step(1.0F / 60.0F);
    const auto launched = world.characterState(character);
    EXPECT_TRUE(!launched.grounded);
    EXPECT_TRUE(launched.velocity.y > 5.0F);

    float highest = launched.position.y;
    for (int i = 0; i < 45; ++i) {
        world.updateCharacter(character, 1.0F / 60.0F, {0,0,0}, true);
        world.step(1.0F / 60.0F);
        highest = std::max(highest, world.characterState(character).position.y);
    }
    EXPECT_TRUE(highest > groundHeight + 0.8F);

    settle(world, character, 90);
    const auto landed = world.characterState(character);
    EXPECT_TRUE(landed.grounded);
    EXPECT_NEAR(landed.position.y, groundHeight, 0.05F);
}

TEST_CASE(character_virtual_climbs_walkable_slope) {
    PhysicsWorld world;
    auto mesh = floorMesh();
    addTriangle(mesh, {0,0,-2}, {4,2,2}, {4,2,-2});
    addTriangle(mesh, {0,0,-2}, {0,0,2}, {4,2,2});
    world.addStaticCollision(mesh);
    const auto character = world.createCharacter({}, {-1, 1, 0});
    settle(world, character);
    float highest = world.characterState(character).position.y;
    for (int i = 0; i < 150; ++i) {
        world.updateCharacter(character, 1.0F / 60.0F, {2,0,0});
        world.step(1.0F / 60.0F);
        highest = std::max(highest, world.characterState(character).position.y);
    }
    EXPECT_TRUE(highest > 1.4F);
}

TEST_CASE(character_virtual_rejects_slope_above_configured_limit) {
    PhysicsWorld world;
    auto mesh = floorMesh();
    addTriangle(mesh, {0,0,-2}, {1,2,2}, {1,2,-2});
    addTriangle(mesh, {0,0,-2}, {0,0,2}, {1,2,2});
    world.addStaticCollision(mesh);
    const auto character = world.createCharacter({}, {-1, 1, 0});
    settle(world, character);

    float highest = world.characterState(character).position.y;
    for (int i = 0; i < 150; ++i) {
        world.updateCharacter(character, 1.0F / 60.0F, {2,0,0});
        world.step(1.0F / 60.0F);
        highest = std::max(highest, world.characterState(character).position.y);
    }
    EXPECT_TRUE(highest < 0.5F);
    EXPECT_TRUE(world.characterState(character).position.x < 0.5F);
}

TEST_CASE(character_virtual_walks_up_configured_step) {
    PhysicsWorld world;
    auto mesh = floorMesh();
    // A 0.25 m high, 1 m long step. Top and leading face are enough for the motor.
    addTriangle(mesh, {0,0.25F,-2}, {1,0.25F,2}, {1,0.25F,-2});
    addTriangle(mesh, {0,0.25F,-2}, {0,0.25F,2}, {1,0.25F,2});
    addTriangle(mesh, {0,0,-2}, {0,0.25F,2}, {0,0.25F,-2});
    addTriangle(mesh, {0,0,-2}, {0,0,2}, {0,0.25F,2});
    world.addStaticCollision(mesh);
    const auto character = world.createCharacter({}, {-1,1,0});
    settle(world, character);
    float highest = 0.0F;
    for (int i = 0; i < 100; ++i) {
        world.updateCharacter(character, 1.0F / 60.0F, {2,0,0});
        world.step(1.0F / 60.0F);
        highest = std::max(highest, world.characterState(character).position.y);
    }
    EXPECT_TRUE(world.characterState(character).position.x > 0.5F);
    EXPECT_TRUE(highest > 0.2F);
}

TEST_CASE(jolt_runtime_supports_overlapping_world_lifetimes) {
    PhysicsWorld first;
    first.addStaticCollision(floorMesh());
    const auto firstCharacter = first.createCharacter({}, {0, 1, 0});
    settle(first, firstCharacter);

    {
        PhysicsWorld second;
        second.addStaticCollision(floorMesh());
        const auto secondCharacter = second.createCharacter({}, {0, 1, 0});
        settle(second, secondCharacter);
        EXPECT_TRUE(second.characterState(secondCharacter).grounded);
    }

    first.updateCharacter(firstCharacter, 1.0F / 60.0F, {1,0,0});
    first.step(1.0F / 60.0F);
    EXPECT_TRUE(first.characterState(firstCharacter).grounded);
}
