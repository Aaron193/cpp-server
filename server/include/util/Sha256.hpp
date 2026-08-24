#pragma once

#include <algorithm>
#include <array>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <iomanip>
#include <sstream>
#include <string>
#include <string_view>

namespace util {

class Sha256 {
   public:
    void update(const std::uint8_t* input, std::size_t length) {
        total_ += length;
        while (length > 0) {
            const std::size_t take = std::min(length, block_.size() - used_);
            std::memcpy(block_.data() + used_, input, take);
            used_ += take;
            input += take;
            length -= take;
            if (used_ == block_.size()) {
                transform(block_.data());
                used_ = 0;
            }
        }
    }

    void update(std::string_view input) {
        update(reinterpret_cast<const std::uint8_t*>(input.data()), input.size());
    }

    std::string finishHex() {
        const std::uint64_t bitLength = static_cast<std::uint64_t>(total_) * 8U;
        block_[used_++] = 0x80U;
        if (used_ > 56U) {
            std::fill(block_.begin() + used_, block_.end(), 0U);
            transform(block_.data());
            used_ = 0U;
        }
        std::fill(block_.begin() + used_, block_.begin() + 56U, 0U);
        for (std::size_t i = 0; i < 8U; ++i)
            block_[63U - i] =
                static_cast<std::uint8_t>(bitLength >> (i * 8U));
        transform(block_.data());

        std::ostringstream output;
        output << std::hex << std::setfill('0');
        for (const auto word : state_) output << std::setw(8) << word;
        return output.str();
    }

   private:
    static std::uint32_t rotate(std::uint32_t value, std::uint32_t bits) {
        return (value >> bits) | (value << (32U - bits));
    }

    void transform(const std::uint8_t* data) {
        static constexpr std::array<std::uint32_t, 64> constants = {
            0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
            0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
            0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
            0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
            0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
            0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
            0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
            0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
        std::array<std::uint32_t, 64> schedule{};
        for (std::size_t i = 0; i < 16U; ++i) {
            schedule[i] =
                (static_cast<std::uint32_t>(data[i * 4U]) << 24U) |
                (static_cast<std::uint32_t>(data[i * 4U + 1U]) << 16U) |
                (static_cast<std::uint32_t>(data[i * 4U + 2U]) << 8U) |
                static_cast<std::uint32_t>(data[i * 4U + 3U]);
        }
        for (std::size_t i = 16U; i < 64U; ++i) {
            const auto s0 = rotate(schedule[i - 15U], 7U) ^
                            rotate(schedule[i - 15U], 18U) ^
                            (schedule[i - 15U] >> 3U);
            const auto s1 = rotate(schedule[i - 2U], 17U) ^
                            rotate(schedule[i - 2U], 19U) ^
                            (schedule[i - 2U] >> 10U);
            schedule[i] = schedule[i - 16U] + s0 + schedule[i - 7U] + s1;
        }
        auto a = state_[0]; auto b = state_[1]; auto c = state_[2];
        auto d = state_[3]; auto e = state_[4]; auto f = state_[5];
        auto g = state_[6]; auto h = state_[7];
        for (std::size_t i = 0; i < 64U; ++i) {
            const auto s1 = rotate(e, 6U) ^ rotate(e, 11U) ^ rotate(e, 25U);
            const auto choice = (e & f) ^ ((~e) & g);
            const auto t1 = h + s1 + choice + constants[i] + schedule[i];
            const auto s0 = rotate(a, 2U) ^ rotate(a, 13U) ^ rotate(a, 22U);
            const auto majority = (a & b) ^ (a & c) ^ (b & c);
            const auto t2 = s0 + majority;
            h = g; g = f; f = e; e = d + t1;
            d = c; c = b; b = a; a = t1 + t2;
        }
        state_[0] += a; state_[1] += b; state_[2] += c; state_[3] += d;
        state_[4] += e; state_[5] += f; state_[6] += g; state_[7] += h;
    }

    std::array<std::uint32_t, 8> state_{
        0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
        0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
    std::array<std::uint8_t, 64> block_{};
    std::size_t used_ = 0U;
    std::size_t total_ = 0U;
};

inline std::string sha256Hex(std::string_view input) {
    Sha256 hash;
    hash.update(input);
    return hash.finishHex();
}

inline std::string sha256Identifier(std::string_view input) {
    return "sha256:" + sha256Hex(input);
}

}  // namespace util
