cmake_minimum_required(VERSION 3.14)

project(server VERSION 0.1.0 LANGUAGES CXX C)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(ZLIB REQUIRED)

include_directories(include)
include_directories(include/uwebsockets/uSockets)

file(GLOB USOCKETS_SOURCES
    include/uwebsockets/uSockets/*.c
    include/uwebsockets/uSockets/crypto/*.c
    include/uwebsockets/uSockets/eventing/*.c
)

file(GLOB_RECURSE SOURCES "src/*.cpp")

add_executable(${PROJECT_NAME} src/main.cpp ${SOURCES} ${USOCKETS_SOURCES})

target_compile_definitions(${PROJECT_NAME} PRIVATE LIBUS_NO_SSL)

target_link_libraries(${PROJECT_NAME} PRIVATE pthread ${ZLIB_LIBRARIES})