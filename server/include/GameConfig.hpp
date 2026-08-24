#pragma once

#include <fstream>
#include <cmath>
#include <nlohmann/json.hpp>
#include <stdexcept>
#include <string>

#include "common/enums.hpp"

struct WeaponConfig {
    GunFireMode fireMode;
    AmmoType ammoType;
    int magazineSize;
    int ammoPerShot;
    float fireRate;
    float reloadTime;
    float damage;
    float range;  // in meters
    float spread;
    int pellets;
    float barrelLength;        // in meters
    bool automatic;
};

struct GameConfig {
    struct MovementConfig {
        float capsuleRadius;
        float capsuleHalfHeight;
        float eyeHeight;
        float groundSpeed;
        float groundAcceleration;
        float airAcceleration;
        float airControl;
        float jumpSpeed;
        float gravity;
        float terminalVelocity;
        float maxSlopeRadians;
        float stepUpHeight;
        float stickToFloorDistance;
    } movement;

    struct LoadoutConfig {
        int rifleReserveAmmo;
        int shotgunReserveAmmo;
    } loadout;

    struct CombatConfig {
        std::uint32_t serverSeed;
        std::uint32_t maxLagCompensationMs;
        std::uint32_t scoreLimit;
        float roundSeconds;
        float intermissionSeconds;
        float respawnSeconds;
        float spawnProtectionSeconds;
    } combat;

    WeaponConfig rifle;
    WeaponConfig shotgun;

    static GameConfig loadFromFile(const std::string& path) {
        std::ifstream file(path);
        if (!file.is_open()) {
            throw std::runtime_error("Failed to open game config: " + path);
        }

        nlohmann::json root;
        try {
            file >> root;
        } catch (const std::exception& ex) {
            throw std::runtime_error(
                std::string("Failed to parse config JSON: ") + ex.what());
        }

        if (!root.contains("weapons") || !root.contains("movement") ||
            !root.contains("loadout") || !root.contains("combat"))
            throw std::runtime_error(
                "Config requires weapons, movement, loadout, and combat objects");

        const nlohmann::json& weapons = root.at("weapons");
        GameConfig config;
        config.rifle = parseWeaponConfig(weapons, "rifle");
        config.shotgun = parseWeaponConfig(weapons, "shotgun");
        config.movement = parseMovementConfig(root.at("movement"));
        const auto& loadout = root.at("loadout");
        config.loadout.rifleReserveAmmo =
            positiveInt(loadout, "rifleReserveAmmo", true);
        config.loadout.shotgunReserveAmmo =
            positiveInt(loadout, "shotgunReserveAmmo", true);
        const auto& combat = root.at("combat");
        config.combat.serverSeed =
            static_cast<std::uint32_t>(positiveInt(combat, "serverSeed"));
        config.combat.maxLagCompensationMs = static_cast<std::uint32_t>(
            positiveInt(combat, "maxLagCompensationMs"));
        config.combat.scoreLimit =
            static_cast<std::uint32_t>(positiveInt(combat, "scoreLimit"));
        config.combat.roundSeconds = positiveFloat(combat, "roundSeconds");
        config.combat.intermissionSeconds =
            positiveFloat(combat, "intermissionSeconds");
        config.combat.respawnSeconds = positiveFloat(combat, "respawnSeconds");
        config.combat.spawnProtectionSeconds =
            positiveFloat(combat, "spawnProtectionSeconds", true);
        if (config.combat.maxLagCompensationMs > 1000U ||
            config.combat.scoreLimit > 1000U ||
            config.combat.roundSeconds > 3600.0F ||
            config.combat.intermissionSeconds > 120.0F)
            throw std::runtime_error("Combat configuration is out of range");

        return config;
    }

    nlohmann::json toJson() const {
        nlohmann::json weapons;
        weapons["rifle"] = weaponToJson(rifle);
        weapons["shotgun"] = weaponToJson(shotgun);

        nlohmann::json root;
        root["weapons"] = weapons;
        root["movement"] = {
            {"capsuleRadius", movement.capsuleRadius},
            {"capsuleHalfHeight", movement.capsuleHalfHeight},
            {"eyeHeight", movement.eyeHeight},
            {"groundSpeed", movement.groundSpeed},
            {"groundAcceleration", movement.groundAcceleration},
            {"airAcceleration", movement.airAcceleration},
            {"airControl", movement.airControl},
            {"jumpSpeed", movement.jumpSpeed},
            {"gravity", movement.gravity},
            {"terminalVelocity", movement.terminalVelocity},
            {"maxSlopeRadians", movement.maxSlopeRadians},
            {"stepUpHeight", movement.stepUpHeight},
            {"stickToFloorDistance", movement.stickToFloorDistance}};
        root["loadout"] = {
            {"rifleReserveAmmo", loadout.rifleReserveAmmo},
            {"shotgunReserveAmmo", loadout.shotgunReserveAmmo}};
        root["combat"] = {
            {"serverSeed", combat.serverSeed},
            {"maxLagCompensationMs", combat.maxLagCompensationMs},
            {"scoreLimit", combat.scoreLimit},
            {"roundSeconds", combat.roundSeconds},
            {"intermissionSeconds", combat.intermissionSeconds},
            {"respawnSeconds", combat.respawnSeconds},
            {"spawnProtectionSeconds", combat.spawnProtectionSeconds}};
        return root;
    }

    std::string toJsonString() const { return toJson().dump(); }

   private:
    static float positiveFloat(const nlohmann::json& object,
                               const char* key, bool allowZero = false) {
        if (!object.contains(key) || !object.at(key).is_number())
            throw std::runtime_error(std::string("Config missing numeric field: ") + key);
        const float value = object.at(key).get<float>();
        if (!std::isfinite(value) || (allowZero ? value < 0.0F : value <= 0.0F))
            throw std::runtime_error(std::string("Config field is out of range: ") + key);
        return value;
    }

    static int positiveInt(const nlohmann::json& object, const char* key,
                           bool allowZero = false) {
        if (!object.contains(key) || !object.at(key).is_number_integer())
            throw std::runtime_error(std::string("Config missing integer field: ") + key);
        const int value = object.at(key).get<int>();
        if (allowZero ? value < 0 : value <= 0)
            throw std::runtime_error(std::string("Config field is out of range: ") + key);
        return value;
    }

    static MovementConfig parseMovementConfig(const nlohmann::json& value) {
        MovementConfig config{
            positiveFloat(value, "capsuleRadius"),
            positiveFloat(value, "capsuleHalfHeight"),
            positiveFloat(value, "eyeHeight"),
            positiveFloat(value, "groundSpeed"),
            positiveFloat(value, "groundAcceleration"),
            positiveFloat(value, "airAcceleration"),
            positiveFloat(value, "airControl", true),
            positiveFloat(value, "jumpSpeed"),
            positiveFloat(value, "gravity"),
            positiveFloat(value, "terminalVelocity"),
            positiveFloat(value, "maxSlopeRadians"),
            positiveFloat(value, "stepUpHeight", true),
            positiveFloat(value, "stickToFloorDistance", true)};
        if (config.airControl > 1.0F ||
            config.maxSlopeRadians >= 1.57079632679F ||
            config.eyeHeight > 2.0F *
                                   (config.capsuleHalfHeight + config.capsuleRadius))
            throw std::runtime_error("Movement configuration is out of range");
        return config;
    }

    static GunFireMode parseFireMode(const std::string& value) {
        if (value == "hitscan") return GunFireMode::FIRE_HITSCAN;
        if (value == "projectile") return GunFireMode::FIRE_PROJECTILE;
        throw std::runtime_error("Invalid fireMode: " + value);
    }

    static AmmoType parseAmmoType(const std::string& value) {
        if (value == "light") return AmmoType::LIGHT;
        if (value == "heavy") return AmmoType::HEAVY;
        if (value == "shell") return AmmoType::SHELL;
        if (value == "rocket") return AmmoType::ROCKET;
        throw std::runtime_error("Invalid ammoType: " + value);
    }

    static std::string fireModeToString(GunFireMode mode) {
        switch (mode) {
            case GunFireMode::FIRE_HITSCAN:
                return "hitscan";
            case GunFireMode::FIRE_PROJECTILE:
                return "projectile";
            default:
                throw std::runtime_error(
                    "Unknown GunFireMode value in fireModeToString");
        }
    }

    static std::string ammoTypeToString(AmmoType type) {
        switch (type) {
            case AmmoType::LIGHT:
                return "light";
            case AmmoType::HEAVY:
                return "heavy";
            case AmmoType::SHELL:
                return "shell";
            case AmmoType::ROCKET:
                return "rocket";
            case AmmoType::COUNT:
            default:
                throw std::runtime_error("Invalid AmmoType enum value");
        }
    }

    static WeaponConfig parseWeaponConfig(const nlohmann::json& weapons,
                                          const std::string& key) {
        if (!weapons.contains(key)) {
            throw std::runtime_error("Config missing weapon: " + key);
        }

        const nlohmann::json& j = weapons.at(key);
        WeaponConfig config;
        config.fireMode = parseFireMode(j.at("fireMode").get<std::string>());
        config.ammoType = parseAmmoType(j.at("ammoType").get<std::string>());
        config.magazineSize = j.at("magazineSize").get<int>();
        config.ammoPerShot = j.at("ammoPerShot").get<int>();
        config.fireRate = j.at("fireRate").get<float>();
        config.reloadTime = j.at("reloadTime").get<float>();
        config.damage = j.at("damage").get<float>();
        config.range = j.at("range").get<float>();
        config.spread = j.at("spread").get<float>();
        config.pellets = j.at("pellets").get<int>();
        config.barrelLength = j.at("barrelLength").get<float>();
        config.automatic = j.at("automatic").get<bool>();
        if (config.magazineSize <= 0 || config.ammoPerShot <= 0 ||
            config.ammoPerShot > config.magazineSize || config.fireRate <= 0.0F ||
            config.reloadTime < 0.0F || config.damage < 0.0F ||
            config.range <= 0.0F || config.spread < 0.0F ||
            config.spread > 0.5F || config.pellets <= 0 ||
            config.pellets > 32 ||
            config.fireMode != GunFireMode::FIRE_HITSCAN)
            throw std::runtime_error("Invalid weapon configuration: " + key);
        return config;
    }

    static nlohmann::json weaponToJson(const WeaponConfig& weapon) {
        nlohmann::json j;
        j["fireMode"] = fireModeToString(weapon.fireMode);
        j["ammoType"] = ammoTypeToString(weapon.ammoType);
        j["magazineSize"] = weapon.magazineSize;
        j["ammoPerShot"] = weapon.ammoPerShot;
        j["fireRate"] = weapon.fireRate;
        j["reloadTime"] = weapon.reloadTime;
        j["damage"] = weapon.damage;
        j["range"] = weapon.range;
        j["spread"] = weapon.spread;
        j["pellets"] = weapon.pellets;
        j["barrelLength"] = weapon.barrelLength;
        j["automatic"] = weapon.automatic;
        return j;
    }
};
