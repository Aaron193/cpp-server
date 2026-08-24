#include "TestHarness.hpp"

#include <glm/geometric.hpp>
#include <cmath>

#include "combat/CombatGeometry.hpp"

TEST_CASE(ray_capsule_hits_side_caps_and_rejects_misses) {
    const CombatGeometry::Capsule capsule{{0,0,0}, {0,2,0}, 0.5F};
    const auto side = CombatGeometry::rayCapsule(
        {0,1,5}, {0,0,-1}, capsule, 10.0F);
    EXPECT_TRUE(side.has_value());
    EXPECT_NEAR(side->distance, 4.5F, 0.0001F);
    EXPECT_NEAR(side->normal.z, 1.0F, 0.0001F);
    const auto cap = CombatGeometry::rayCapsule(
        {0,4,0}, {0,-1,0}, capsule, 10.0F);
    EXPECT_TRUE(cap.has_value());
    EXPECT_NEAR(cap->distance, 1.5F, 0.0001F);
    EXPECT_TRUE(!CombatGeometry::rayCapsule(
        {2,1,5}, {0,0,-1}, capsule, 10.0F).has_value());
}

TEST_CASE(ray_capsule_nearest_distance_is_stable) {
    const auto nearHit = CombatGeometry::rayCapsule(
        {0,1,5}, {0,0,-1}, {{0,0,1}, {0,2,1}, 0.5F}, 20.0F);
    const auto farHit = CombatGeometry::rayCapsule(
        {0,1,5}, {0,0,-1}, {{0,0,-3}, {0,2,-3}, 0.5F}, 20.0F);
    EXPECT_TRUE(nearHit.has_value() && farHit.has_value());
    EXPECT_TRUE(nearHit->distance < farHit->distance);
}

TEST_CASE(server_seeded_spread_is_reproducible_and_bounded) {
    const glm::vec3 forward{0,0,-1};
    const auto first = CombatGeometry::spreadDirection(
        forward, 0.055F, 1234U, 7U, 99U, 3U);
    const auto repeated = CombatGeometry::spreadDirection(
        forward, 0.055F, 1234U, 7U, 99U, 3U);
    const auto different = CombatGeometry::spreadDirection(
        forward, 0.055F, 1234U, 7U, 99U, 4U);
    EXPECT_NEAR(first.x, repeated.x, 0.000001F);
    EXPECT_NEAR(first.y, repeated.y, 0.000001F);
    EXPECT_NEAR(first.z, repeated.z, 0.000001F);
    EXPECT_TRUE(glm::length(first - different) > 0.0001F);
    EXPECT_NEAR(glm::length(first), 1.0F, 0.0001F);
    EXPECT_TRUE(std::acos(glm::dot(first, forward)) <= 0.0551F);
}

TEST_CASE(history_tick_clamp_handles_old_future_and_wraparound_ticks) {
    EXPECT_EQ(CombatGeometry::clampHistoryTick(90U, 100U, 115U), 100U);
    EXPECT_EQ(CombatGeometry::clampHistoryTick(108U, 100U, 115U), 108U);
    EXPECT_EQ(CombatGeometry::clampHistoryTick(120U, 100U, 115U), 115U);
    EXPECT_EQ(CombatGeometry::clampHistoryTick(0xFFFFFFF0U,
                                               0xFFFFFFF8U, 4U),
              0xFFFFFFF8U);
    EXPECT_EQ(CombatGeometry::clampHistoryTick(1U, 0xFFFFFFF8U, 4U), 1U);
    EXPECT_EQ(CombatGeometry::clampHistoryTick(10U, 0xFFFFFFF8U, 4U), 4U);
}
