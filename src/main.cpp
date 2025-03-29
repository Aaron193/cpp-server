#include <box2d/box2d.h>
#include <uwebsockets/App.h>

#include <iostream>

#include "Game.hpp"

int main() {
    std::cout << "Game has Started!" << std::endl;

    new Game(9001);
}
