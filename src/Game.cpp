#include "Game.hpp"

#include "Systems.hpp"

Game::Game(uint16_t port) {
    Systems::initialize(port);
    Systems::gameServer().start();
}

Game::~Game() {
    Systems::gameServer().stop();
    Systems::shutdown();
}