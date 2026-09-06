#include "GameServer.hpp"
#include "TestHarness.hpp"
#include "combat/Conquest.hpp"
#include "ecs/components.hpp"

TEST_CASE(conquest_neutralizes_before_capture_and_freezes_mixed_presence) {
    Conquest::Rules rules;
    rules.objectives.push_back(
        {{"a-capture", "objective", {-10, -1, -10}, {10, 5, 10}}});
    std::vector<Conquest::Player> west{{{0, 0, 0}, 1, true}};
    for (int i = 0; i < 721; i++) rules.step(west, 1.F / 60);
    EXPECT_EQ(rules.objectives[0].owner, 1U);
    std::vector<Conquest::Player> east{{{0, 0, 0}, 2, true}};
    for (int i = 0; i < 721; i++) rules.step(east, 1.F / 60);
    EXPECT_EQ(rules.objectives[0].owner, 0U);
    for (int i = 0; i < 180; i++) rules.step(east, 1.F / 60);
    const float progress = rules.objectives[0].progress;
    rules.step({{{0, 0, 0}, 1, true}, {{0, 0, 0}, 2, true}}, 2);
    EXPECT_TRUE(rules.objectives[0].contested);
    EXPECT_NEAR(rules.objectives[0].progress, progress, .00001F);
    rules.step({{{0, 10, 0}, 1, true}, {{0, 0, 0}, 2, false}}, 2);
    EXPECT_TRUE(!rules.objectives[0].contested);
    EXPECT_TRUE(rules.objectives[0].progress < progress);
}
TEST_CASE(conquest_majority_drains_enemy_and_deaths_cost_one_ticket) {
    Conquest::Rules rules;
    for (int i = 0; i < 5; i++)
        rules.objectives.push_back(
            {{"zone", "objective", {-1, -1, -1}, {1, 3, 1}},
             static_cast<std::uint8_t>(i < 3 ? 1 : 2)});
    rules.step({}, 3);
    EXPECT_NEAR(rules.tickets[0], 500, .001F);
    EXPECT_NEAR(rules.tickets[1], 497, .001F);
    rules.death(1);
    EXPECT_NEAR(rules.tickets[0], 499, .001F);
    rules.tickets[1] = .1F;
    rules.step({}, 1);
    EXPECT_TRUE(rules.ended());
    rules.reset();
    EXPECT_TRUE(!rules.ended());
    EXPECT_EQ(rules.objectives[0].owner, 0U);
}
TEST_CASE(conquest_balances_teams_rejects_enemy_spawns_and_requires_deploy) {
    GameServer server;
    server.m_sessionConfiguration.mode = "conquest";
    server.m_gameConfig.combat.respawnSeconds = .01F;
    auto& spawns = server.m_mapPackage.manifest.spawnPoints;
    for (std::size_t i = 0; i < spawns.size(); i++) {
        spawns[i].team = i % 2 == 0 ? "west" : "east";
        spawns[i].modes.push_back("conquest");
    }
    const auto west = server.m_entityManager.createPlayer(),
               east = server.m_entityManager.createPlayer();
    auto& r = server.m_entityManager.getRegistry();
    EXPECT_EQ(server.playerTeam(west), 1U);
    EXPECT_EQ(server.playerTeam(east), 2U);
    for (int i = 0; i < 5; i++) server.simulateOneTick();
    EXPECT_TRUE(r.get<Components::PlayerLife>(west).dead);
    server.requestDeploy(west, {spawns[1].id, protocol::Weapon::Rifle});
    server.simulateOneTick();
    EXPECT_TRUE(r.get<Components::PlayerLife>(west).dead);
    server.requestDeploy(west, {spawns[0].id, protocol::Weapon::Rifle});
    server.requestDeploy(west, {spawns[1].id, protocol::Weapon::Shotgun});
    server.simulateOneTick();
    EXPECT_TRUE(r.get<Components::PlayerLife>(west).dead);
    server.requestDeploy(west, {spawns[0].id, protocol::Weapon::Rifle});
    server.simulateOneTick();
    EXPECT_TRUE(!r.get<Components::PlayerLife>(west).dead);
    const auto ally = server.m_entityManager.createPlayer();
    server.requestDeploy(ally, {spawns[0].id, protocol::Weapon::Rifle});
    server.simulateOneTick();
    EXPECT_TRUE(!r.get<Components::PlayerLife>(ally).dead);
    EXPECT_TRUE(glm::length(r.get<Components::Transform3D>(ally).position -
                            r.get<Components::Transform3D>(west).position) >
                1.F);
    r.get<Components::PlayerLife>(ally).spawnProtectionRemaining = 0;
    EXPECT_EQ(server.playerTeam(ally), 1U);
    EXPECT_TRUE(!server.applyDamage(west, ally, 25, ItemType::GUN_RIFLE));
}
TEST_CASE(projectiles_resolve_after_travel_instead_of_at_trigger_time) {
    GameServer server;
    server.m_gameConfig.rifle.muzzleVelocity = 60;
    server.m_gameConfig.rifle.projectileGravity = 0;
    server.m_gameConfig.rifle.aim.hipSpreadRadians = 0;
    server.m_gameConfig.rifle.aim.adsSpreadRadians = 0;
    server.m_gameConfig.rifle.aim.hipMoveSpreadRadians = 0;
    server.m_gameConfig.rifle.aim.adsMoveSpreadRadians = 0;
    server.m_gameConfig.rifle.aim.airborneSpreadRadians = 0;
    const auto shooter = server.m_entityManager.createPlayer(),
               target = server.m_entityManager.createPlayer();
    auto& r = server.m_entityManager.getRegistry();
    auto place = [&](entt::entity p, glm::vec3 pos) {
        r.get<Components::Transform3D>(p).position = pos;
        server.m_physicsWorld.setCharacterPosition(
            r.get<Components::CharacterController>(p).adapterId, pos);
        server.m_physicsWorld.setCharacterVelocity(
            r.get<Components::CharacterController>(p).adapterId, {0, 0, 0});
        r.get<Components::PlayerLife>(p).spawnProtectionRemaining = 0;
    };
    place(shooter, {0, 10, 10});
    place(target, {0, 10, 0});
    Components::PlayerInput input;
    input.mouseIsDown = true;
    input.dirtyClick = true;
    input.clientTick = 1;
    server.queueValidatedInput(shooter, input);
    server.simulateOneTick();
    EXPECT_NEAR(r.get<Components::Health>(target).current, 100, .001F);
    input.mouseIsDown = false;
    input.dirtyClick = false;
    server.queueValidatedInput(shooter, input);
    for (int i = 0; i < 12; i++) {
        place(target, {0, 10, 0});
        server.simulateOneTick();
    }
    EXPECT_TRUE(r.get<Components::Health>(target).current < 100);
}
