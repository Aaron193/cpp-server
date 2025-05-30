#pragma once

#include <mutex>

typedef const std::lock_guard<std::mutex> mutex_lock_t;
