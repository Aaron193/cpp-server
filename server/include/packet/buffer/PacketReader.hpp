#pragma once

#include <cstdint>
#include <string_view>

class PacketReader {
   public:
    PacketReader() {}

    void loadMessage(const std::string_view& message);

    uint8_t readU8();
    uint16_t readU16();
    uint32_t readU32();
    uint64_t readU64();
    float readFloat();
    std::string readString();
    template <class T>
    T readBytes();

    size_t getOffset();
    size_t byteLength();

   private:
    std::string_view m_message;
    size_t m_offset;

    void validateBounds(unsigned int size);
};
