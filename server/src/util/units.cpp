#include "util/units.hpp"

float meters(float pixels) { return pixels / 100.0f; }
float pixels(float meters) { return meters * 100.0f; }