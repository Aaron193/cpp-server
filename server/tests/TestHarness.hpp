#pragma once

#include <exception>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

namespace TestHarness {

using TestFunction = void (*)();

struct TestCase {
    std::string name;
    TestFunction function;
};

inline std::vector<TestCase>& registry() {
    static std::vector<TestCase> tests;
    return tests;
}

struct Registrar {
    Registrar(const char* name, TestFunction function) {
        registry().push_back({name, function});
    }
};

[[noreturn]] inline void fail(const char* file, int line,
                              const std::string& message) {
    std::ostringstream output;
    output << file << ':' << line << ": " << message;
    throw std::runtime_error(output.str());
}

inline int runAll() {
    int failures = 0;
    for (const auto& test : registry()) {
        try {
            test.function();
            std::cout << "[PASS] " << test.name << '\n';
        } catch (const std::exception& error) {
            ++failures;
            std::cerr << "[FAIL] " << test.name << ": " << error.what() << '\n';
        } catch (...) {
            ++failures;
            std::cerr << "[FAIL] " << test.name << ": unknown exception\n";
        }
    }

    std::cout << registry().size() - failures << '/' << registry().size()
              << " tests passed\n";
    return failures == 0 ? 0 : 1;
}

}  // namespace TestHarness

#define TEST_CASE(name)                                           \
    static void name();                                           \
    static TestHarness::Registrar name##_registrar(#name, &name); \
    static void name()

#define EXPECT_TRUE(condition)                               \
    do {                                                     \
        if (!(condition)) {                                  \
            TestHarness::fail(__FILE__, __LINE__,            \
                              "expected true: " #condition); \
        }                                                    \
    } while (false)

#define EXPECT_EQ(actual, expected)                                  \
    do {                                                             \
        const auto& actualValue = (actual);                          \
        const auto& expectedValue = (expected);                      \
        if (!(actualValue == expectedValue)) {                       \
            TestHarness::fail(__FILE__, __LINE__,                    \
                              "expected " #actual " == " #expected); \
        }                                                            \
    } while (false)

#define EXPECT_NEAR(actual, expected, tolerance)                       \
    do {                                                               \
        const auto actualValue = (actual);                             \
        const auto expectedValue = (expected);                         \
        const auto difference = actualValue > expectedValue            \
                                    ? actualValue - expectedValue      \
                                    : expectedValue - actualValue;     \
        if (difference > (tolerance)) {                                \
            TestHarness::fail(__FILE__, __LINE__,                      \
                              "expected " #actual " near " #expected); \
        }                                                              \
    } while (false)
