#pragma once

#include <algorithm>
#include <cmath>
#include <cstddef>

// A deterministic fixed-step clock. Excess wall time is deliberately dropped
// once maxCatchUpSteps have been retained, preventing a stalled server from
// entering an unbounded catch-up spiral.
class FixedStepAccumulator {
   public:
    static constexpr double kStepSeconds = 1.0 / 60.0;
    static constexpr std::size_t kDefaultMaxCatchUpSteps = 5;

    explicit FixedStepAccumulator(
        std::size_t maxCatchUpSteps = kDefaultMaxCatchUpSteps)
        : maxCatchUpSteps_(std::max<std::size_t>(1, maxCatchUpSteps)) {}

    template <typename Step>
    std::size_t consume(double elapsedSeconds, Step&& step) {
        lastDroppedSeconds_ = 0.0;
        if (!std::isfinite(elapsedSeconds) || elapsedSeconds <= 0.0) return 0;
        const double retainedLimit =
            kStepSeconds * static_cast<double>(maxCatchUpSteps_);
        const double available = accumulator_ + elapsedSeconds;
        const double retained = std::min(available, retainedLimit);
        lastDroppedSeconds_ = std::max(0.0, available - retained);
        totalDroppedSeconds_ += lastDroppedSeconds_;
        accumulator_ = retained;

        std::size_t count = 0;
        constexpr double epsilon = kStepSeconds * 1.0e-9;
        while (count < maxCatchUpSteps_ &&
               accumulator_ + epsilon >= kStepSeconds) {
            step(kStepSeconds);
            accumulator_ -= kStepSeconds;
            if (accumulator_ < 0.0) accumulator_ = 0.0;
            ++count;
        }
        return count;
    }

    void reset() {
        accumulator_ = 0.0;
        lastDroppedSeconds_ = 0.0;
        totalDroppedSeconds_ = 0.0;
    }
    double remainderSeconds() const { return accumulator_; }
    double lastDroppedSeconds() const { return lastDroppedSeconds_; }
    double totalDroppedSeconds() const { return totalDroppedSeconds_; }
    std::size_t maxCatchUpSteps() const { return maxCatchUpSteps_; }

   private:
    double accumulator_ = 0.0;
    double lastDroppedSeconds_ = 0.0;
    double totalDroppedSeconds_ = 0.0;
    std::size_t maxCatchUpSteps_;
};
