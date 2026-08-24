#include "TestHarness.hpp"
#include "physics/CollisionLayers.hpp"

using CollisionLayers::Layer;

TEST_CASE(collision_layers_filter_static_and_moving_objects) {
    EXPECT_TRUE(CollisionLayers::shouldCollide(Layer::StaticWorld, Layer::Character));
    EXPECT_TRUE(CollisionLayers::shouldCollide(Layer::StaticWorld, Layer::DynamicProp));
    EXPECT_TRUE(CollisionLayers::shouldCollide(Layer::Projectile, Layer::StaticWorld));
    EXPECT_TRUE(!CollisionLayers::shouldCollide(Layer::StaticWorld, Layer::Trigger));
}

TEST_CASE(collision_layers_keep_triggers_nonblocking_and_hitboxes_query_only) {
    EXPECT_TRUE(CollisionLayers::shouldCollide(Layer::Trigger, Layer::Character));
    EXPECT_TRUE(CollisionLayers::shouldCollide(Layer::Trigger, Layer::Projectile));
    EXPECT_TRUE(!CollisionLayers::shouldCollide(Layer::Trigger, Layer::Trigger));
    for (std::uint8_t value = 0; value < static_cast<std::uint8_t>(Layer::Count); ++value) {
        EXPECT_TRUE(!CollisionLayers::shouldCollide(
            Layer::QueryOnlyHitbox, static_cast<Layer>(value)));
    }
}

TEST_CASE(collision_filter_is_symmetric) {
    for (std::uint8_t a = 0; a < static_cast<std::uint8_t>(Layer::Count); ++a)
        for (std::uint8_t b = 0; b < static_cast<std::uint8_t>(Layer::Count); ++b)
            EXPECT_EQ(CollisionLayers::shouldCollide(static_cast<Layer>(a), static_cast<Layer>(b)),
                      CollisionLayers::shouldCollide(static_cast<Layer>(b), static_cast<Layer>(a)));
}
