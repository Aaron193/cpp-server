cmake_minimum_required(VERSION 3.10)

# Use vcpkg when VCPKG_ROOT is available, while still allowing callers to pass
# an explicit toolchain or dependency prefix. Do not cache a path derived from
# an unset or obsolete VCPKG_ROOT.
if(NOT DEFINED CMAKE_TOOLCHAIN_FILE AND DEFINED ENV{VCPKG_ROOT})
    set(CMAKE_TOOLCHAIN_FILE
        "$ENV{VCPKG_ROOT}/scripts/buildsystems/vcpkg.cmake"
        CACHE FILEPATH "vcpkg toolchain file")
endif()

project(server VERSION 1.0)

include(CTest)

# Set default build type to Release if not specified
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

option(SERVER_ENABLE_JOLT "Build the native Jolt server and physics tests" ON)

find_package(unofficial-uwebsockets CONFIG REQUIRED)
find_package(EnTT CONFIG REQUIRED)
find_package(glm CONFIG REQUIRED)
find_package(httplib CONFIG REQUIRED)
find_package(nlohmann_json CONFIG REQUIRED)

if(SERVER_ENABLE_JOLT)
    find_package(Jolt CONFIG QUIET)
    if(TARGET Jolt::Jolt)
        set(SERVER_JOLT_TARGET Jolt::Jolt)
    else()
        find_package(unofficial-joltphysics CONFIG REQUIRED)
        set(SERVER_JOLT_TARGET unofficial::joltphysics::Jolt)
    endif()
endif()

file(GLOB_RECURSE SOURCES
    "src/*.cpp"
)

add_executable(server ${SOURCES})

target_link_libraries(server PRIVATE
    ${SERVER_JOLT_TARGET}
    unofficial::uwebsockets::uwebsockets
    EnTT::EnTT
    glm::glm
    httplib::httplib
    nlohmann_json::nlohmann_json
)

if(NOT SERVER_ENABLE_JOLT)
    set_target_properties(server PROPERTIES EXCLUDE_FROM_ALL TRUE)
endif()

target_include_directories(server PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_compile_definitions(server PRIVATE
    SERVER_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}"
    SERVER_MAP_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../client/public/maps/graybox-arena"
)

if(BUILD_TESTING)
    add_executable(server_tests
        tests/test_main.cpp
        tests/WeaponConfigCharacterizationTests.cpp
        tests/FixedStepAccumulatorTests.cpp
        tests/CollisionLayersTests.cpp
        tests/MapPackageTests.cpp
        tests/ProtocolTests.cpp
        tests/JoinTicketValidatorTests.cpp
        tests/CombatGeometryTests.cpp
        tests/AimingTests.cpp
        src/maps/MapPackage.cpp
        src/security/JoinTicketValidator.cpp
    )

    target_include_directories(server_tests PRIVATE
        ${CMAKE_CURRENT_SOURCE_DIR}/include
        ${CMAKE_CURRENT_SOURCE_DIR}/tests
    )

    target_link_libraries(server_tests PRIVATE
        nlohmann_json::nlohmann_json
        glm::glm
    )

    target_compile_definitions(server_tests PRIVATE
        SERVER_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}"
    )

    add_test(NAME server_characterization_tests COMMAND server_tests)

    if(SERVER_ENABLE_JOLT)
        add_executable(server_physics_tests
            tests/test_main.cpp
            tests/CharacterVirtualTests.cpp
            tests/MovementCommandTraceTests.cpp
            src/maps/MapPackage.cpp
            src/physics/PhysicsWorld.cpp
        )
        target_include_directories(server_physics_tests PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/include
            ${CMAKE_CURRENT_SOURCE_DIR}/tests
        )
        target_link_libraries(server_physics_tests PRIVATE
            ${SERVER_JOLT_TARGET}
            glm::glm
            nlohmann_json::nlohmann_json
        )
        target_compile_definitions(server_physics_tests PRIVATE
            SERVER_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}"
        )
        add_test(NAME server_physics_tests COMMAND server_physics_tests)

        add_executable(server_simulation_tests
            tests/test_main.cpp
            tests/Phase3BSimulationTests.cpp
            tests/ServerSessionTests.cpp
            tests/CombatSimulationTests.cpp
            tests/GameConfigPathTests.cpp
            tests/ObservabilitySecurityTests.cpp
            src/GameServer.cpp
            src/ServerRegistration.cpp
            src/security/JoinTicketValidator.cpp
            src/client/Client.cpp
            src/ecs/EntityManager.cpp
            src/maps/MapPackage.cpp
            src/physics/PhysicsWorld.cpp
        )
        target_include_directories(server_simulation_tests PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/include
            ${CMAKE_CURRENT_SOURCE_DIR}/tests
        )
        target_link_libraries(server_simulation_tests PRIVATE
            ${SERVER_JOLT_TARGET}
            EnTT::EnTT
            glm::glm
            httplib::httplib
            nlohmann_json::nlohmann_json
        )
        target_compile_definitions(server_simulation_tests PRIVATE
            SERVER_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}"
            SERVER_MAP_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../client/public/maps/graybox-arena"
        )
        add_test(NAME server_simulation_tests COMMAND server_simulation_tests)

        add_executable(server_load_benchmark
            tests/ServerLoadBenchmark.cpp
            src/GameServer.cpp
            src/ServerRegistration.cpp
            src/security/JoinTicketValidator.cpp
            src/client/Client.cpp
            src/ecs/EntityManager.cpp
            src/maps/MapPackage.cpp
            src/physics/PhysicsWorld.cpp
        )
        target_include_directories(server_load_benchmark PRIVATE
            ${CMAKE_CURRENT_SOURCE_DIR}/include
            ${CMAKE_CURRENT_SOURCE_DIR}/tests
        )
        target_link_libraries(server_load_benchmark PRIVATE
            ${SERVER_JOLT_TARGET}
            EnTT::EnTT
            glm::glm
            httplib::httplib
            nlohmann_json::nlohmann_json
        )
        target_compile_definitions(server_load_benchmark PRIVATE
            SERVER_SOURCE_DIR="${CMAKE_CURRENT_SOURCE_DIR}"
            SERVER_MAP_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../client/public/maps/graybox-arena"
        )
        add_test(NAME server_load_benchmark COMMAND server_load_benchmark)
    endif()
endif()

# If using Microsoft Visual Studio, set specific compile options
if(MSVC)
    target_compile_options(server PRIVATE
        $<$<CONFIG:Release>:/O2 /DNDEBUG>
        $<$<CONFIG:Debug>:/Od /Zi>
    )
else()
    target_compile_options(server PRIVATE
        $<$<CONFIG:Release>:-O3 -DNDEBUG>
        $<$<CONFIG:Debug>:-g -O0 -fsanitize=address -fsanitize=undefined -fno-omit-frame-pointer>
    )
    target_link_options(server PRIVATE
        $<$<CONFIG:Debug>:-fsanitize=address -fsanitize=undefined>
    )
endif()
