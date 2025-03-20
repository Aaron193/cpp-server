#include "packet/buffer/PacketReader.hpp"

#include <cstdint>
#include <iostream>
#include <sstream>

void PacketReader::loadMessage(const std::string_view& message) {
    m_message = message;
    m_offset = 0;
}

void PacketReader::validateBounds(unsigned int length) {
    if (m_offset + length > m_message.length()) {
        std::ostringstream oss;
        oss << "PacketReader Error - overflow: "
            << "offset=" << m_offset << ", length=" << length
            << ", message_length=" << m_message.length();
        throw std::runtime_error(oss.str());
    }
}

uint8_t PacketReader::readU8() { return readBytes<uint8_t>(); }

uint16_t PacketReader::readU16() { return readBytes<uint16_t>(); }

uint32_t PacketReader::readU32() { return readBytes<uint32_t>(); }

float PacketReader::readFloat() {
    uint32_t value = readBytes<uint32_t>();
    return *reinterpret_cast<float*>(&value);
}

std::string PacketReader::readString() {
    uint16_t length = readU16();
    validateBounds(length);
    std::string value = std::string(m_message.substr(m_offset, length));
    m_offset += length;
    return value;
}

template <class T>
T PacketReader::readBytes() {
    validateBounds(sizeof(T));
    T value = *reinterpret_cast<const T*>(&m_message[m_offset]);
    m_offset += sizeof(T);
    return value;
}

size_t PacketReader::getOffset() { return m_offset; }
size_t PacketReader::byteLength() { return m_message.length(); }
