#include "cppfun/Game.hpp"
#include <iostream>
#include <iterator>
#include <uwebsockets/App.h>

int main() {
  std::cout << "WebSocket Server has Started!" << std::endl;
  new Game(9001);
}
