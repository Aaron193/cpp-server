#!/usr/bin/env node

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const schemaPath = resolve(root, 'protocol/schema.json')
const fixturePath = resolve(root, 'protocol/fixtures/golden-fixtures.json')
const schema = JSON.parse(readFileSync(schemaPath, 'utf8'))
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'))
const check = process.argv.includes('--check')

const generatedBanner = (source) => `// Generated from ${source} by protocol/generate.mjs. DO NOT EDIT.\n`
const cap = (value) => value[0].toUpperCase() + value.slice(1)
const limit = (name) => schema.limits[name]
const enumEntries = Object.entries(schema.enums)
const typeEntries = Object.entries(schema.types)
const messageEntries = Object.entries(schema.messages)

function validateSchema() {
    if (schema.limits.maxEnvelopeBytes !== schema.limits.maxPayloadBytes + 3)
        throw new Error('maxEnvelopeBytes must include the exact three-byte envelope header')
    if (schema.limits.maxPayloadBytes > 0xffff)
        throw new Error('maxPayloadBytes cannot exceed the u16 envelope length')
    const ids = new Set()
    for (const [name, message] of messageEntries) {
        if (!Number.isInteger(message.id) || message.id < 0 || message.id > 0xff || ids.has(message.id))
            throw new Error(`Invalid or duplicate message ID for ${name}`)
        ids.add(message.id)
    }
    const validateType = (type, field, location) => {
        if (typeof type === 'string') {
            if (!['u8', 'u16', 'u32', 'i16', 'i32', 'f32', 'bool', 'string'].includes(type))
                throw new Error(`Unknown scalar ${type} at ${location}`)
            if (type === 'string') {
                const maximum = field.max ? limit(field.max) : schema.limits.maxStringBytes
                if (!Number.isInteger(maximum) || maximum < 0 || maximum > schema.limits.maxStringBytes)
                    throw new Error(`Invalid string bound at ${location}`)
            }
            return
        }
        if (type.enum && !schema.enums[type.enum]) throw new Error(`Unknown enum at ${location}`)
        else if (type.ref && !schema.types[type.ref]) throw new Error(`Unknown type reference at ${location}`)
        else if (type.optional) validateType(type.optional, field, `${location}?`)
        else if (type.array) {
            const maximum = limit(field.max)
            if (!Number.isInteger(maximum) || maximum < (field.min ?? 0) || maximum > 0xffff)
                throw new Error(`Invalid array bound at ${location}`)
            validateType(type.array, {}, `${location}[]`)
        } else if (!type.enum && !type.ref) throw new Error(`Invalid type at ${location}`)
    }
    for (const [owner, fields] of [...typeEntries, ...messageEntries.map(([name, message]) => [name, message.fields])])
        for (const field of fields) validateType(field.type, field, `${owner}.${field.name}`)
}

validateSchema()

function cppType(type) {
    if (typeof type === 'string') {
        return ({ u8: 'std::uint8_t', u16: 'std::uint16_t', u32: 'std::uint32_t', i16: 'std::int16_t', i32: 'std::int32_t', f32: 'float', bool: 'bool', string: 'std::string' })[type]
    }
    if (type.enum) return type.enum
    if (type.ref) return type.ref
    if (type.optional) return `std::optional<${cppType(type.optional)}>`
    if (type.array) return `std::vector<${cppType(type.array)}>`
    throw new Error(`Unknown C++ type ${JSON.stringify(type)}`)
}

function tsType(type) {
    if (typeof type === 'string') return type === 'bool' ? 'boolean' : type === 'string' ? 'string' : 'number'
    if (type.enum) return type.enum
    if (type.ref) return type.ref
    if (type.optional) return `${tsType(type.optional)} | null`
    if (type.array) return `ReadonlyArray<${tsType(type.array)}>`
    throw new Error(`Unknown TypeScript type ${JSON.stringify(type)}`)
}

function cppLimit(field) {
    return field.max ? `Limits::${cap(field.max)}` : 'Limits::MaxStringBytes'
}

function cppWrite(type, expression, field, indent = '    ') {
    if (typeof type === 'string') {
        if (type === 'string') return `${indent}writer.writeString(${expression}, ${cppLimit(field)});\n`
        if (type === 'bool') return `${indent}writer.writeBool(${expression});\n`
        return `${indent}writer.write${cap(type)}(${expression});\n`
    }
    if (type.enum) return `${indent}write${type.enum}(writer, ${expression});\n`
    if (type.ref) return `${indent}write${type.ref}(writer, ${expression});\n`
    if (type.optional) {
        return `${indent}writer.writeBool(${expression}.has_value());\n${indent}if (${expression}.has_value()) {\n${cppWrite(type.optional, `*${expression}`, field, `${indent}    `)}${indent}}\n`
    }
    if (type.array) {
        const maximum = `Limits::${cap(field.max)}`
        const minimum = field.min ?? 0
        return `${indent}writer.writeLength(${expression}.size(), ${minimum}, ${maximum});\n${indent}for (const auto& item : ${expression}) {\n${cppWrite(type.array, 'item', {}, `${indent}    `)}${indent}}\n`
    }
    throw new Error(`Unknown C++ write type ${JSON.stringify(type)}`)
}

function cppReadExpression(type, field) {
    if (typeof type === 'string') {
        if (type === 'string') return `reader.readString(${cppLimit(field)})`
        if (type === 'bool') return 'reader.readBool()'
        return `reader.read${cap(type)}()`
    }
    if (type.enum) return `read${type.enum}(reader)`
    if (type.ref) return `read${type.ref}(reader)`
    throw new Error(`Type needs statements: ${JSON.stringify(type)}`)
}

function cppRead(type, target, field, indent = '    ') {
    if (typeof type === 'string' || type.enum || type.ref) return `${indent}${target} = ${cppReadExpression(type, field)};\n`
    if (type.optional) {
        const inner = cppType(type.optional)
        return `${indent}if (reader.readBool()) {\n${indent}    ${inner} decodedValue{};\n${cppRead(type.optional, 'decodedValue', field, `${indent}    `)}${indent}    ${target} = std::move(decodedValue);\n${indent}} else {\n${indent}    ${target}.reset();\n${indent}}\n`
    }
    if (type.array) {
        const maximum = `Limits::${cap(field.max)}`
        const minimum = field.min ?? 0
        const inner = cppType(type.array)
        return `${indent}{\n${indent}    const auto count = reader.readLength(${minimum}, ${maximum});\n${indent}    ${target}.clear();\n${indent}    ${target}.reserve(count);\n${indent}    for (std::size_t index = 0; index < count; ++index) {\n${indent}        ${inner} decodedValue{};\n${cppRead(type.array, 'decodedValue', {}, `${indent}        `)}${indent}        ${target}.push_back(std::move(decodedValue));\n${indent}    }\n${indent}}\n`
    }
    throw new Error(`Unknown C++ read type ${JSON.stringify(type)}`)
}

function generateCpp() {
    let out = generatedBanner('protocol/schema.json')
    out += `#pragma once

#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <limits>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <variant>
#include <vector>

namespace protocol {

struct Limits {
`
    for (const [name, value] of Object.entries(schema.limits)) out += `    static constexpr std::size_t ${cap(name)} = ${value}U;\n`
    out += `};

class ProtocolError : public std::runtime_error {
   public:
    explicit ProtocolError(const std::string& message) : std::runtime_error(message) {}
};

enum class MessageType : std::uint8_t {
`
    for (const [name, message] of messageEntries) out += `    ${name} = ${message.id},\n`
    out += `};

`
    for (const [name, definition] of enumEntries) {
        out += `enum class ${name} : std::uint8_t {\n`
        for (const [valueName, value] of Object.entries(definition.values)) out += `    ${valueName} = ${value},\n`
        out += `};\n\n`
    }
    for (const [name, fields] of [...typeEntries, ...messageEntries.map(([messageName, message]) => [messageName, message.fields])]) {
        out += `struct ${name} {\n`
        for (const field of fields) out += `    ${cppType(field.type)} ${field.name}{};\n`
        out += `};\n\n`
    }
    out += `namespace detail {

inline bool validUtf8(const std::uint8_t* bytes, std::size_t size) {
    std::size_t index = 0;
    while (index < size) {
        const std::uint8_t first = bytes[index++];
        if (first <= 0x7FU) continue;
        std::size_t continuation = 0;
        std::uint32_t codepoint = 0;
        if (first >= 0xC2U && first <= 0xDFU) { continuation = 1; codepoint = first & 0x1FU; }
        else if (first >= 0xE0U && first <= 0xEFU) { continuation = 2; codepoint = first & 0x0FU; }
        else if (first >= 0xF0U && first <= 0xF4U) { continuation = 3; codepoint = first & 0x07U; }
        else return false;
        if (index + continuation > size) return false;
        for (std::size_t offset = 0; offset < continuation; ++offset) {
            const std::uint8_t next = bytes[index++];
            if ((next & 0xC0U) != 0x80U) return false;
            codepoint = (codepoint << 6U) | (next & 0x3FU);
        }
        if ((continuation == 2 && codepoint < 0x800U) ||
            (continuation == 3 && codepoint < 0x10000U) ||
            (codepoint >= 0xD800U && codepoint <= 0xDFFFU) || codepoint > 0x10FFFFU) return false;
    }
    return true;
}

class Writer {
   public:
    const std::vector<std::uint8_t>& bytes() const { return bytes_; }
    void writeU8(std::uint8_t value) { bytes_.push_back(value); }
    void writeU16(std::uint16_t value) { writeU8(static_cast<std::uint8_t>(value)); writeU8(static_cast<std::uint8_t>(value >> 8U)); }
    void writeU32(std::uint32_t value) { writeU16(static_cast<std::uint16_t>(value)); writeU16(static_cast<std::uint16_t>(value >> 16U)); }
    void writeI16(std::int16_t value) { std::uint16_t raw; std::memcpy(&raw, &value, sizeof(raw)); writeU16(raw); }
    void writeI32(std::int32_t value) { std::uint32_t raw; std::memcpy(&raw, &value, sizeof(raw)); writeU32(raw); }
    void writeF32(float value) {
        if (!std::isfinite(value)) throw ProtocolError("non-finite float");
        std::uint32_t raw; std::memcpy(&raw, &value, sizeof(raw)); writeU32(raw);
    }
    void writeBool(bool value) { writeU8(value ? 1U : 0U); }
    void writeLength(std::size_t value, std::size_t minimum, std::size_t maximum) {
        if (value < minimum || value > maximum || value > std::numeric_limits<std::uint16_t>::max()) throw ProtocolError("bounded length out of range");
        writeU16(static_cast<std::uint16_t>(value));
    }
    void writeString(const std::string& value, std::size_t maximum) {
        const auto* bytes = reinterpret_cast<const std::uint8_t*>(value.data());
        if (value.size() > Limits::MaxStringBytes) throw ProtocolError("string exceeds global limit");
        if (value.size() > maximum || value.size() > std::numeric_limits<std::uint16_t>::max()) throw ProtocolError("string exceeds field limit");
        if (!validUtf8(bytes, value.size())) throw ProtocolError("invalid UTF-8 string");
        writeU16(static_cast<std::uint16_t>(value.size()));
        bytes_.insert(bytes_.end(), bytes, bytes + value.size());
    }
   private:
    std::vector<std::uint8_t> bytes_;
};

class Reader {
   public:
    Reader(const std::uint8_t* data, std::size_t size) : data_(data), size_(size) {}
    std::size_t remaining() const { return size_ - offset_; }
    std::uint8_t readU8() { require(1); return data_[offset_++]; }
    std::uint16_t readU16() { const auto low = readU8(); const auto high = readU8(); return static_cast<std::uint16_t>(low | (static_cast<std::uint16_t>(high) << 8U)); }
    std::uint32_t readU32() { const auto low = readU16(); const auto high = readU16(); return static_cast<std::uint32_t>(low) | (static_cast<std::uint32_t>(high) << 16U); }
    std::int16_t readI16() { const auto raw = readU16(); std::int16_t value; std::memcpy(&value, &raw, sizeof(value)); return value; }
    std::int32_t readI32() { const auto raw = readU32(); std::int32_t value; std::memcpy(&value, &raw, sizeof(value)); return value; }
    float readF32() { const auto raw = readU32(); float value; std::memcpy(&value, &raw, sizeof(value)); if (!std::isfinite(value)) throw ProtocolError("non-finite float"); return value; }
    bool readBool() { const auto value = readU8(); if (value > 1U) throw ProtocolError("invalid boolean"); return value != 0U; }
    std::size_t readLength(std::size_t minimum, std::size_t maximum) { const auto value = readU16(); if (value < minimum || value > maximum) throw ProtocolError("bounded length out of range"); return value; }
    std::string readString(std::size_t maximum) {
        const auto length = readLength(0, maximum);
        require(length);
        if (!validUtf8(data_ + offset_, length)) throw ProtocolError("invalid UTF-8 string");
        std::string value(reinterpret_cast<const char*>(data_ + offset_), length); offset_ += length; return value;
    }
   private:
    void require(std::size_t count) const { if (count > remaining()) throw ProtocolError("truncated payload"); }
    const std::uint8_t* data_; std::size_t size_; std::size_t offset_ = 0;
};

`
    for (const [name, definition] of enumEntries) {
        const valid = Object.values(definition.values).map((value) => `raw == ${value}U`).join(' || ')
        out += `inline void write${name}(Writer& writer, ${name} value) {\n    const auto raw = static_cast<std::uint8_t>(value);\n    if (!(${valid})) throw ProtocolError("invalid ${name}");\n    writer.writeU8(raw);\n}\n`
        out += `inline ${name} read${name}(Reader& reader) {\n    const auto raw = reader.readU8();\n    if (!(${valid})) throw ProtocolError("invalid ${name}");\n    return static_cast<${name}>(raw);\n}\n\n`
    }
    for (const [name, fields] of typeEntries) {
        out += `inline void write${name}(Writer& writer, const ${name}& value) {\n`
        for (const field of fields) out += cppWrite(field.type, `value.${field.name}`, field)
        out += `}\ninline ${name} read${name}(Reader& reader) {\n    ${name} value{};\n`
        for (const field of fields) out += cppRead(field.type, `value.${field.name}`, field)
        out += `    return value;\n}\n\n`
    }
    for (const [name, message] of messageEntries) {
        out += `inline void write${name}(Writer& writer, const ${name}& value) {\n`
        for (const field of message.fields) out += cppWrite(field.type, `value.${field.name}`, field)
        out += `}\ninline ${name} read${name}(Reader& reader) {\n    ${name} value{};\n`
        for (const field of message.fields) out += cppRead(field.type, `value.${field.name}`, field)
        out += `    return value;\n}\n\n`
    }
    out += `}  // namespace detail

using MessagePayload = std::variant<std::monostate, ${messageEntries.map(([name]) => name).join(', ')}>;

struct DecodedEnvelope {
    std::uint8_t messageType{};
    std::uint16_t payloadLength{};
    bool known{};
    MessagePayload message{};
    std::size_t nextOffset{};
};

`
    for (const [name] of messageEntries) {
        out += `inline std::vector<std::uint8_t> encode(const ${name}& message) {\n    detail::Writer payload; detail::write${name}(payload, message);\n    if (payload.bytes().size() > Limits::MaxPayloadBytes) throw ProtocolError("payload exceeds maximum");\n    detail::Writer envelope; envelope.writeU8(static_cast<std::uint8_t>(MessageType::${name})); envelope.writeU16(static_cast<std::uint16_t>(payload.bytes().size()));\n    std::vector<std::uint8_t> result = envelope.bytes(); result.insert(result.end(), payload.bytes().begin(), payload.bytes().end()); return result;\n}\n`
    }
    out += `
inline DecodedEnvelope decodeEnvelope(const std::uint8_t* data, std::size_t size, std::size_t offset = 0) {
    if (offset > size || size - offset < 3U) throw ProtocolError("truncated envelope");
    const std::uint8_t messageType = data[offset];
    const std::uint16_t payloadLength = static_cast<std::uint16_t>(data[offset + 1U] | (static_cast<std::uint16_t>(data[offset + 2U]) << 8U));
    if (payloadLength > Limits::MaxPayloadBytes) throw ProtocolError("oversized payload");
    const std::size_t payloadStart = offset + 3U;
    if (payloadLength > size - payloadStart) throw ProtocolError("truncated payload");
    const std::size_t nextOffset = payloadStart + payloadLength;
    detail::Reader reader(data + payloadStart, payloadLength);
    MessagePayload payload{};
    bool known = true;
    switch (messageType) {
`
    for (const [name, message] of messageEntries) out += `        case ${message.id}: payload = detail::read${name}(reader); break;\n`
    out += `        default: known = false; break;
    }
    if (known && reader.remaining() != 0U) throw ProtocolError("payload has trailing bytes");
    return {messageType, payloadLength, known, std::move(payload), nextOffset};
}

inline DecodedEnvelope decodeEnvelope(const std::vector<std::uint8_t>& bytes, std::size_t offset = 0) {
    return decodeEnvelope(bytes.data(), bytes.size(), offset);
}

}  // namespace protocol
`
    return out
}

function tsLimit(field) {
    return field.max ? `LIMITS.${field.max}` : 'LIMITS.maxStringBytes'
}

function tsWrite(type, expression, field, indent = '    ') {
    if (typeof type === 'string') {
        if (type === 'string') return `${indent}writer.string(${expression}, ${tsLimit(field)})\n`
        return `${indent}writer.${type}(${expression})\n`
    }
    if (type.enum) return `${indent}write${type.enum}(writer, ${expression})\n`
    if (type.ref) return `${indent}write${type.ref}(writer, ${expression})\n`
    if (type.optional) return `${indent}writer.bool(${expression} !== null)\n${indent}if (${expression} !== null) {\n${tsWrite(type.optional, expression, field, `${indent}    `)}${indent}}\n`
    if (type.array) {
        const maximum = `LIMITS.${field.max}`
        const minimum = field.min ?? 0
        return `${indent}writer.length(${expression}.length, ${minimum}, ${maximum})\n${indent}for (const item of ${expression}) {\n${tsWrite(type.array, 'item', {}, `${indent}    `)}${indent}}\n`
    }
    throw new Error(`Unknown TypeScript write type ${JSON.stringify(type)}`)
}

function tsReadExpression(type, field) {
    if (typeof type === 'string') return type === 'string' ? `reader.string(${tsLimit(field)})` : `reader.${type}()`
    if (type.enum) return `read${type.enum}(reader)`
    if (type.ref) return `read${type.ref}(reader)`
    if (type.optional) return `reader.bool() ? ${tsReadExpression(type.optional, field)} : null`
    if (type.array) {
        const maximum = `LIMITS.${field.max}`
        const minimum = field.min ?? 0
        return `Array.from({ length: reader.length(${minimum}, ${maximum}) }, () => ${tsReadExpression(type.array, {})})`
    }
    throw new Error(`Unknown TypeScript read type ${JSON.stringify(type)}`)
}

function generateTs() {
    let out = generatedBanner('protocol/schema.json')
    out += `export const PROTOCOL_VERSION = ${schema.version} as const

export const LIMITS = ${JSON.stringify(schema.limits, null, 4)} as const

export enum MessageType {
`
    for (const [name, message] of messageEntries) out += `    ${name} = ${message.id},\n`
    out += `}\n\n`
    for (const [name, definition] of enumEntries) {
        out += `export enum ${name} {\n`
        for (const [valueName, value] of Object.entries(definition.values)) out += `    ${valueName} = ${value},\n`
        out += `}\n\n`
    }
    for (const [name, fields] of [...typeEntries, ...messageEntries.map(([messageName, message]) => [messageName, message.fields])]) {
        out += `export interface ${name} {\n`
        for (const field of fields) out += `    readonly ${field.name}: ${tsType(field.type)}\n`
        out += `}\n\n`
    }
    out += `export type Message =\n${messageEntries.map(([name]) => `    | { readonly type: MessageType.${name}; readonly payload: ${name} }`).join('\n')}

export type DecodedEnvelope =
    | { readonly known: true; readonly messageType: MessageType; readonly payloadLength: number; readonly message: Message; readonly nextOffset: number }
    | { readonly known: false; readonly messageType: number; readonly payloadLength: number; readonly nextOffset: number }

export class ProtocolError extends Error {
    constructor(message: string) { super(message); this.name = 'ProtocolError' }
}

function validString(value: string): boolean {
    for (let index = 0; index < value.length; ++index) {
        const code = value.charCodeAt(index)
        if (code >= 0xd800 && code <= 0xdbff) {
            if (++index >= value.length) return false
            const next = value.charCodeAt(index)
            if (next < 0xdc00 || next > 0xdfff) return false
        } else if (code >= 0xdc00 && code <= 0xdfff) return false
    }
    return true
}

class Writer {
    private readonly output: number[] = []
    bytes(): Uint8Array { return Uint8Array.from(this.output) }
    u8(value: number): void { this.integer(value, 0, 0xff); this.output.push(value) }
    u16(value: number): void { this.integer(value, 0, 0xffff); this.u8(value & 0xff); this.u8(value >>> 8) }
    u32(value: number): void { this.integer(value, 0, 0xffffffff); this.u16(value & 0xffff); this.u16(Math.floor(value / 0x10000)) }
    i16(value: number): void { this.integer(value, -0x8000, 0x7fff); this.u16(value & 0xffff) }
    i32(value: number): void { this.integer(value, -0x80000000, 0x7fffffff); this.u32(value >>> 0) }
    f32(value: number): void {
        if (!Number.isFinite(value)) throw new ProtocolError('non-finite float')
        const bytes = new Uint8Array(4); new DataView(bytes.buffer).setFloat32(0, value, true); this.output.push(...bytes)
    }
    bool(value: boolean): void { if (typeof value !== 'boolean') throw new ProtocolError('invalid boolean'); this.u8(value ? 1 : 0) }
    length(value: number, minimum: number, maximum: number): void { this.integer(value, minimum, maximum); this.u16(value) }
    string(value: string, maximum: number): void {
        if (typeof value !== 'string' || !validString(value)) throw new ProtocolError('invalid Unicode string')
        const bytes = new TextEncoder().encode(value)
        if (bytes.length > LIMITS.maxStringBytes) throw new ProtocolError('string exceeds global limit')
        if (bytes.length > maximum || bytes.length > 0xffff) throw new ProtocolError('string exceeds field limit')
        this.u16(bytes.length); this.output.push(...bytes)
    }
    private integer(value: number, minimum: number, maximum: number): void {
        if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new ProtocolError('integer out of range')
    }
}

class Reader {
    private offset = 0
    constructor(private readonly input: Uint8Array) {}
    remaining(): number { return this.input.length - this.offset }
    u8(): number { this.require(1); return this.input[this.offset++]! }
    u16(): number { return this.u8() | (this.u8() << 8) }
    u32(): number { return (this.u16() + this.u16() * 0x10000) >>> 0 }
    i16(): number { const value = this.u16(); return value >= 0x8000 ? value - 0x10000 : value }
    i32(): number { const value = this.u32(); return value >= 0x80000000 ? value - 0x100000000 : value }
    f32(): number { this.require(4); const value = new DataView(this.input.buffer, this.input.byteOffset + this.offset, 4).getFloat32(0, true); this.offset += 4; if (!Number.isFinite(value)) throw new ProtocolError('non-finite float'); return value }
    bool(): boolean { const value = this.u8(); if (value > 1) throw new ProtocolError('invalid boolean'); return value === 1 }
    length(minimum: number, maximum: number): number { const value = this.u16(); if (value < minimum || value > maximum) throw new ProtocolError('bounded length out of range'); return value }
    string(maximum: number): string {
        const length = this.length(0, maximum); this.require(length)
        const bytes = this.input.subarray(this.offset, this.offset + length); this.offset += length
        try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new ProtocolError('invalid UTF-8 string') }
    }
    private require(count: number): void { if (count > this.remaining()) throw new ProtocolError('truncated payload') }
}

`
    for (const [name, definition] of enumEntries) {
        const valid = Object.values(definition.values).map((value) => `value === ${value}`).join(' || ')
        out += `function write${name}(writer: Writer, value: ${name}): void { if (!(${valid})) throw new ProtocolError('invalid ${name}'); writer.u8(value) }\n`
        out += `function read${name}(reader: Reader): ${name} { const value = reader.u8(); if (!(${valid})) throw new ProtocolError('invalid ${name}'); return value as ${name} }\n\n`
    }
    for (const [name, fields] of [...typeEntries, ...messageEntries.map(([messageName, message]) => [messageName, message.fields])]) {
        out += `function write${name}(writer: Writer, value: ${name}): void {\n`
        for (const field of fields) out += tsWrite(field.type, `value.${field.name}`, field)
        out += `}\nfunction read${name}(reader: Reader): ${name} {\n    return {\n`
        for (const field of fields) out += `        ${field.name}: ${tsReadExpression(field.type, field)},\n`
        out += `    }\n}\n\n`
    }
    out += `export function encodeMessage(message: Message): Uint8Array {
    const payloadWriter = new Writer()
    switch (message.type) {
`
    for (const [name] of messageEntries) out += `        case MessageType.${name}: write${name}(payloadWriter, message.payload); break\n`
    out += `        default: throw new ProtocolError('unknown message type')
    }
    const payload = payloadWriter.bytes()
    if (payload.length > LIMITS.maxPayloadBytes) throw new ProtocolError('payload exceeds maximum')
    const envelope = new Writer(); envelope.u8(message.type); envelope.u16(payload.length)
    const result = new Uint8Array(3 + payload.length); result.set(envelope.bytes()); result.set(payload, 3); return result
}

export function decodeEnvelope(data: Uint8Array, offset = 0): DecodedEnvelope {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > data.length || data.length - offset < 3) throw new ProtocolError('truncated envelope')
    const messageType = data[offset]!
    const payloadLength = data[offset + 1]! | (data[offset + 2]! << 8)
    if (payloadLength > LIMITS.maxPayloadBytes) throw new ProtocolError('oversized payload')
    const payloadStart = offset + 3; const nextOffset = payloadStart + payloadLength
    if (nextOffset > data.length) throw new ProtocolError('truncated payload')
    const reader = new Reader(data.subarray(payloadStart, nextOffset))
    let message: Message
    switch (messageType) {
`
    for (const [name] of messageEntries) out += `        case MessageType.${name}: message = { type: MessageType.${name}, payload: read${name}(reader) }; break\n`
    out += `        default: return { known: false, messageType, payloadLength, nextOffset }
    }
    if (reader.remaining() !== 0) throw new ProtocolError('payload has trailing bytes')
    return { known: true, messageType: message.type, payloadLength, message, nextOffset }
}
`
    return out
}

function fixtureEncode(type, value, field, writer) {
    const pushU8 = (number) => writer.push(number & 0xff)
    const pushU16 = (number) => { pushU8(number); pushU8(number >>> 8) }
    const pushU32 = (number) => { pushU16(number); pushU16(Math.floor(number / 0x10000)) }
    if (typeof type === 'string') {
        if (type === 'u8') pushU8(value)
        else if (type === 'u16') pushU16(value)
        else if (type === 'u32') pushU32(value)
        else if (type === 'i16') pushU16(value & 0xffff)
        else if (type === 'i32') pushU32(value >>> 0)
        else if (type === 'f32') { const bytes = new Uint8Array(4); new DataView(bytes.buffer).setFloat32(0, value, true); writer.push(...bytes) }
        else if (type === 'bool') pushU8(value ? 1 : 0)
        else if (type === 'string') { const bytes = new TextEncoder().encode(value); pushU16(bytes.length); writer.push(...bytes) }
        return
    }
    if (type.enum) { pushU8(value); return }
    if (type.ref) { for (const nested of schema.types[type.ref]) fixtureEncode(nested.type, value[nested.name], nested, writer); return }
    if (type.optional) { pushU8(value === null ? 0 : 1); if (value !== null) fixtureEncode(type.optional, value, field, writer); return }
    if (type.array) { pushU16(value.length); for (const item of value) fixtureEncode(type.array, item, {}, writer); return }
    throw new Error(`Unknown fixture type ${JSON.stringify(type)}`)
}

function generateVectors() {
    const output = fixtures.map((fixture) => {
        const message = schema.messages[fixture.message]
        if (!message) throw new Error(`Unknown fixture message ${fixture.message}`)
        const payload = []
        for (const field of message.fields) fixtureEncode(field.type, fixture.value[field.name], field, payload)
        const envelope = [message.id, payload.length & 0xff, payload.length >>> 8, ...payload]
        return { ...fixture, expectedHex: Buffer.from(envelope).toString('hex') }
    })
    return `${JSON.stringify(output, null, 2)}\n`
}

const outputs = [
    [resolve(root, 'server/include/protocol/generated.hpp'), generateCpp()],
    [resolve(root, 'client/src/protocol/generated.ts'), generateTs()],
    [resolve(root, 'protocol/fixtures/golden-vectors.json'), generateVectors()],
]

let stale = false
for (const [path, contents] of outputs) {
    if (check) {
        let current = ''
        try { current = readFileSync(path, 'utf8') } catch {}
        if (current !== contents) { console.error(`Generated protocol file is stale: ${path}`); stale = true }
    } else {
        mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, contents)
        console.log(`Generated ${path}`)
    }
}
if (stale) process.exitCode = 1
