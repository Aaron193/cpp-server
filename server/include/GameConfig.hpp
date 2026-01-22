#pragma once

#include <cstdint>
#include <fstream>
#include <nlohmann/json.hpp>
#include <sstream>
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
    float range;  // in pixels
    float spread;
    int pellets;
    float barrelLength;        // in meters
    float projectileSpeed;     // meters/sec
    float projectileLifetime;  // seconds
    bool automatic;
};

struct GameConfig {
    WeaponConfig pistol;
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

        if (!root.contains("weapons")) {
            throw std::runtime_error("Config missing required field: weapons");
        }

        const nlohmann::json& weapons = root.at("weapons");
        GameConfig config;
        config.pistol = parseWeaponConfig(weapons, "pistol");
        config.rifle = parseWeaponConfig(weapons, "rifle");
        config.shotgun = parseWeaponConfig(weapons, "shotgun");

        return config;
    }

    nlohmann::json toJson() const {
        nlohmann::json weapons;
        weapons["pistol"] = weaponToJson(pistol);
        weapons["rifle"] = weaponToJson(rifle);
        weapons["shotgun"] = weaponToJson(shotgun);

        nlohmann::json root;
        root["weapons"] = weapons;
        return root;
    }

    std::string toJsonString() const { return toJson().dump(); }

   private:
    static GunFireMode parseFireMode(const std::string& value) {
        if (value == "hitscan") return GunFireMode::FIRE_HITSCAN;
        if (value == "projectile") return GunFireMode::FIRE_PROJECTILE;
        throw std::runtime_error("Invalid fireMode: " + value);
    }

    static AmmoType parseAmmoType(const std::string& value) {
        if (value == "light") return AmmoType::AMMO_LIGHT;
        if (value == "heavy") return AmmoType::AMMO_HEAVY;
        if (value == "shell") return AmmoType::AMMO_SHELL;
        if (value == "rocket") return AmmoType::AMMO_ROCKET;
        throw std::runtime_error("Invalid ammoType: " + value);
    }

    static std::string fireModeToString(GunFireMode mode) {
        switch (mode) {
            case GunFireMode::FIRE_HITSCAN:
                return "hitscan";
            case GunFireMode::FIRE_PROJECTILE:
                return "projectile";
            default:
                throw std::runtime_error("Unknown GunFireMode value in fireModeToString");
        }
    }

    static std::string ammoTypeToString(AmmoType type) {
        switch (type) {
            case AmmoType::AMMO_LIGHT:
                return "light";
            case AmmoType::AMMO_HEAVY:
                return "heavy";
            case AmmoType::AMMO_SHELL:
                return "shell";
            case AmmoType::AMMO_ROCKET:
                return "rocket";
            case AmmoType::AMMO_COUNT:
                break;
        }
        return "light";
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
        config.projectileSpeed = j.at("projectileSpeed").get<float>();
        config.projectileLifetime = j.at("projectileLifetime").get<float>();
        config.automatic = j.at("automatic").get<bool>();
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
        j["projectileSpeed"] = weapon.projectileSpeed;
        j["projectileLifetime"] = weapon.projectileLifetime;
        j["automatic"] = weapon.automatic;
        return j;
    }
};
