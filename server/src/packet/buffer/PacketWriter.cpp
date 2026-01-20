#include "packet/buffer/PacketWriter.hpp"

#include <string>
#include <string_view>

void PacketWriter::writeU8(uint8_t x) { writeBytes<uint8_t>(x); }

void PacketWriter::writeU16(uint16_t x) { writeBytes<uint16_t>(x); }

void PacketWriter::writeU32(uint32_t x) { writeBytes<uint32_t>(x); }

void PacketWriter::writeU64(uint64_t x) { writeBytes<uint64_t>(x); }

void PacketWriter::writeFloat(float x) {
    writeBytes<uint32_t>(*reinterpret_cast<uint32_t*>(&x));
}

void PacketWriter::writeString(const std::string& x) {
    auto len = static_cast<uint16_t>(x.length());
    writeU16(len);
    for (const unsigned char& c : x) {
        writeU8(c);
    }
}

template <class T>
void PacketWriter::writeBytes(T data) {
    const char* bytes = reinterpret_cast<const char*>(&data);
    for (size_t i = 0; i < sizeof(T); i++) {
        m_message.push_back(bytes[i]);
    }
}

std::string_view PacketWriter::getMessage() { return m_message; }

void PacketWriter::clear() {
    m_message.clear();
    m_offset = 0;
}

bool PacketWriter::hasData() { return m_message.length() > 0; }
