#include "cppfun/Game.hpp"
#include <chrono>
#include <iostream>
#include <thread>

Game::Game(uint16_t port) : m_game(), m_network(port) {}