cmake_minimum_required(VERSION 3.10)
project(server VERSION 1.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

find_package(box2d CONFIG REQUIRED)
find_package(unofficial-uwebsockets CONFIG REQUIRED)
find_package(EnTT CONFIG REQUIRED)

file(GLOB_RECURSE SOURCES
    "src/*.cpp"
)

add_executable(server ${SOURCES})

target_link_libraries(server PRIVATE
    box2d::box2d
    unofficial::uwebsockets::uwebsockets
    EnTT::EnTT
)

target_include_directories(server PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/include
)