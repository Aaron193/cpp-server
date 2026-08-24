#include "TestHarness.hpp"

#include <cstdint>
#include <limits>

#include "simulation/FixedStepAccumulator.hpp"

TEST_CASE(accumulator_runs_exact_sixty_hz_steps) {
    FixedStepAccumulator clock;
    std::uint64_t ticks = 0;
    for (int frame = 0; frame < 120; ++frame)
        clock.consume(1.0 / 120.0, [&](double delta) {
            EXPECT_NEAR(delta, 1.0 / 60.0, 1.0e-12);
            ++ticks;
        });
    EXPECT_EQ(ticks, 60U);
}

TEST_CASE(accumulator_bounds_catch_up_and_discards_spiral_time) {
    FixedStepAccumulator clock(4);
    std::uint64_t ticks = 0;
    EXPECT_EQ(clock.consume(30.0, [&](double) { ++ticks; }), 4U);
    EXPECT_EQ(ticks, 4U);
    EXPECT_TRUE(clock.remainderSeconds() < FixedStepAccumulator::kStepSeconds);
    EXPECT_TRUE(clock.lastDroppedSeconds() > 29.0);
    EXPECT_NEAR(clock.totalDroppedSeconds(), clock.lastDroppedSeconds(),
                1.0e-12);
    EXPECT_EQ(clock.consume(0.0, [&](double) { ++ticks; }), 0U);
}

TEST_CASE(accumulator_rejects_invalid_wall_time) {
    FixedStepAccumulator clock;
    std::uint64_t ticks = 0;
    clock.consume(-1.0, [&](double) { ++ticks; });
    clock.consume(std::numeric_limits<double>::infinity(),
                  [&](double) { ++ticks; });
    EXPECT_EQ(ticks, 0U);
}
