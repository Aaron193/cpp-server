#pragma once

#include <string>
#include <string_view>

class PacketWriter {
   public:
    PacketWriter() {}

    std::string m_message;
    size_t m_offset;

    void writeU8(uint8_t x);
    void writeU16(uint8_t x);
    void writeU32(uint32_t x);
    void writeFloat(float x);
    void writeString(const std::string& x);
    template <class T>
    void writeBytes(T data);

    std::string_view getMessage();
    void clear();
    bool hasData();
};