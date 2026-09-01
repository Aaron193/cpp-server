#pragma once

#include <fstream>
#include <cmath>
#include <nlohmann/json.hpp>
#include <stdexcept>
#include <string>
#include <vector>

#include "common/enums.hpp"

struct WeaponConfig {
    struct AimProfile {
        float aimInSeconds;
        float aimOutSeconds;
        float adsFovRadians;
        float adsMoveMultiplier;
        float hipSpreadRadians;
        float adsSpreadRadians;
        float hipMoveSpreadRadians;
        float adsMoveSpreadRadians;
        float airborneSpreadRadians;
        float crouchMultiplier;
        float proneMultiplier;
        float bloomPerShotRadians;
        float bloomMaxRadians;
        float bloomDelaySeconds;
        float bloomRecoveryRadiansPerSecond;
        float recoilResetSeconds;
        float recoilRecoveryDelaySeconds;
        float recoilRecoveryRate;
        float adsRecoilMultiplier;
        std::vector<float> recoilPitchDegrees;
        std::vector<float> recoilYawDegrees;
        float recoilVariationPitchDegrees;
        float recoilVariationYawDegrees;
        float reticleArmLengthPx;
        float reticleMinGapPx;
    } aim;
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
        float sprintSpeed;
        float crouchSpeed;
        float proneSpeed;
        float groundAcceleration;
        float airAcceleration;
        float airControl;
        float jumpSpeed;
        float gravity;
        float terminalVelocity;
        float maxSlopeRadians;
        float stepUpHeight;
        float stickToFloorDistance;
        float crouchCapsuleRadius;
        float crouchCapsuleHalfHeight;
        float crouchEyeHeight;
        float proneCapsuleRadius;
        float proneCapsuleHalfHeight;
        float proneEyeHeight;
        float slideDuration;
        float slideStartSpeed;
        float slideEndSpeed;
        float slideSteerRadiansPerSecond;
        float slideCooldown;
        float slideJumpCommitment;
        float dashSpeed;
        float dashDuration;
        float dashCooldown;
        float mantleMinHeight;
        float mantleMaxHeight;
        float mantleReach;
        float mantleDuration;
        float sprintToFireDelay;
        float slideSpreadMultiplier;
        bool sprintEnabled;
        bool crouchEnabled;
        bool proneEnabled;
        bool slideEnabled;
        bool dashEnabled;
        bool mantleEnabled;
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
            {"sprintSpeed", movement.sprintSpeed},
            {"crouchSpeed", movement.crouchSpeed},
            {"proneSpeed", movement.proneSpeed},
            {"groundAcceleration", movement.groundAcceleration},
            {"airAcceleration", movement.airAcceleration},
            {"airControl", movement.airControl},
            {"jumpSpeed", movement.jumpSpeed},
            {"gravity", movement.gravity},
            {"terminalVelocity", movement.terminalVelocity},
            {"maxSlopeRadians", movement.maxSlopeRadians},
            {"stepUpHeight", movement.stepUpHeight},
            {"stickToFloorDistance", movement.stickToFloorDistance},
            {"crouchCapsuleRadius", movement.crouchCapsuleRadius},
            {"crouchCapsuleHalfHeight", movement.crouchCapsuleHalfHeight},
            {"crouchEyeHeight", movement.crouchEyeHeight},
            {"proneCapsuleRadius", movement.proneCapsuleRadius},
            {"proneCapsuleHalfHeight", movement.proneCapsuleHalfHeight},
            {"proneEyeHeight", movement.proneEyeHeight},
            {"slideDuration", movement.slideDuration},
            {"slideStartSpeed", movement.slideStartSpeed},
            {"slideEndSpeed", movement.slideEndSpeed},
            {"slideSteerRadiansPerSecond", movement.slideSteerRadiansPerSecond},
            {"slideCooldown", movement.slideCooldown},
            {"slideJumpCommitment", movement.slideJumpCommitment},
            {"dashSpeed", movement.dashSpeed}, {"dashDuration", movement.dashDuration},
            {"dashCooldown", movement.dashCooldown}, {"mantleMinHeight", movement.mantleMinHeight},
            {"mantleMaxHeight", movement.mantleMaxHeight}, {"mantleReach", movement.mantleReach},
            {"mantleDuration", movement.mantleDuration}, {"sprintToFireDelay", movement.sprintToFireDelay},
            {"slideSpreadMultiplier", movement.slideSpreadMultiplier},
            {"sprintEnabled", movement.sprintEnabled}, {"crouchEnabled", movement.crouchEnabled},
            {"proneEnabled", movement.proneEnabled}, {"slideEnabled", movement.slideEnabled},
            {"dashEnabled", movement.dashEnabled}, {"mantleEnabled", movement.mantleEnabled}};
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
            positiveFloat(value, "sprintSpeed"),
            positiveFloat(value, "crouchSpeed"),
            positiveFloat(value, "proneSpeed"),
            positiveFloat(value, "groundAcceleration"),
            positiveFloat(value, "airAcceleration"),
            positiveFloat(value, "airControl", true),
            positiveFloat(value, "jumpSpeed"),
            positiveFloat(value, "gravity"),
            positiveFloat(value, "terminalVelocity"),
            positiveFloat(value, "maxSlopeRadians"),
            positiveFloat(value, "stepUpHeight", true),
            positiveFloat(value, "stickToFloorDistance", true),
            positiveFloat(value, "crouchCapsuleRadius"), positiveFloat(value, "crouchCapsuleHalfHeight"), positiveFloat(value, "crouchEyeHeight"),
            positiveFloat(value, "proneCapsuleRadius"), positiveFloat(value, "proneCapsuleHalfHeight"), positiveFloat(value, "proneEyeHeight"),
            positiveFloat(value, "slideDuration"), positiveFloat(value, "slideStartSpeed"), positiveFloat(value, "slideEndSpeed"),
            positiveFloat(value, "slideSteerRadiansPerSecond"), positiveFloat(value, "slideCooldown"), positiveFloat(value, "slideJumpCommitment"),
            positiveFloat(value, "dashSpeed"), positiveFloat(value, "dashDuration"), positiveFloat(value, "dashCooldown"),
            positiveFloat(value, "mantleMinHeight"), positiveFloat(value, "mantleMaxHeight"), positiveFloat(value, "mantleReach"), positiveFloat(value, "mantleDuration"),
            positiveFloat(value, "sprintToFireDelay"), positiveFloat(value, "slideSpreadMultiplier"),
            boolean(value, "sprintEnabled"), boolean(value, "crouchEnabled"), boolean(value, "proneEnabled"), boolean(value, "slideEnabled"), boolean(value, "dashEnabled"), boolean(value, "mantleEnabled")};
        if (config.airControl > 1.0F ||
            config.maxSlopeRadians >= 1.57079632679F ||
            config.eyeHeight > 2.0F *
                                   (config.capsuleHalfHeight + config.capsuleRadius) ||
            config.groundSpeed > config.sprintSpeed ||
            config.slideJumpCommitment >= config.slideDuration ||
            config.mantleMinHeight >= config.mantleMaxHeight)
            throw std::runtime_error("Movement configuration is out of range");
        return config;
    }

    static bool boolean(const nlohmann::json& object, const char* key) {
        if (!object.contains(key) || !object.at(key).is_boolean())
            throw std::runtime_error(std::string("Config missing boolean field: ") + key);
        return object.at(key).get<bool>();
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
        const auto& aim = j.at("aim");
        config.aim = {
            positiveFloat(aim, "aimInSeconds"), positiveFloat(aim, "aimOutSeconds"),
            positiveFloat(aim, "adsFovRadians"), positiveFloat(aim, "adsMoveMultiplier"),
            positiveFloat(aim, "hipSpreadRadians", true), positiveFloat(aim, "adsSpreadRadians", true),
            positiveFloat(aim, "hipMoveSpreadRadians", true), positiveFloat(aim, "adsMoveSpreadRadians", true),
            positiveFloat(aim, "airborneSpreadRadians", true), positiveFloat(aim, "crouchMultiplier"),
            positiveFloat(aim, "proneMultiplier"), positiveFloat(aim, "bloomPerShotRadians", true),
            positiveFloat(aim, "bloomMaxRadians", true), positiveFloat(aim, "bloomDelaySeconds", true),
            positiveFloat(aim, "bloomRecoveryRadiansPerSecond"), positiveFloat(aim, "recoilResetSeconds"),
            positiveFloat(aim, "recoilRecoveryDelaySeconds", true), positiveFloat(aim, "recoilRecoveryRate"),
            positiveFloat(aim, "adsRecoilMultiplier"), aim.at("recoilPitchDegrees").get<std::vector<float>>(),
            aim.at("recoilYawDegrees").get<std::vector<float>>(), positiveFloat(aim, "recoilVariationPitchDegrees", true),
            positiveFloat(aim, "recoilVariationYawDegrees", true), positiveFloat(aim, "reticleArmLengthPx"),
            positiveFloat(aim, "reticleMinGapPx")};
        if (config.magazineSize <= 0 || config.ammoPerShot <= 0 ||
            config.ammoPerShot > config.magazineSize || config.fireRate <= 0.0F ||
            config.reloadTime < 0.0F || config.damage < 0.0F ||
            config.range <= 0.0F || config.spread < 0.0F ||
            config.spread > 0.5F || config.pellets <= 0 ||
            config.pellets > 32 ||
            config.fireMode != GunFireMode::FIRE_HITSCAN ||
            config.aim.aimInSeconds > 2.0F || config.aim.aimOutSeconds > 2.0F ||
            config.aim.adsFovRadians < 0.4F || config.aim.adsFovRadians > 1.8F ||
            config.aim.adsMoveMultiplier > 1.0F || config.aim.hipSpreadRadians > 0.5F ||
            config.aim.adsSpreadRadians > config.aim.hipSpreadRadians ||
            config.aim.bloomPerShotRadians > config.aim.bloomMaxRadians ||
            config.aim.crouchMultiplier > 1.0F || config.aim.proneMultiplier > 1.0F ||
            config.aim.adsRecoilMultiplier > 1.0F ||
            config.aim.recoilPitchDegrees.empty() || config.aim.recoilYawDegrees.empty())
            throw std::runtime_error("Invalid weapon configuration: " + key);
        const auto finiteDegrees = [](const std::vector<float>& values) {
            return std::all_of(values.begin(), values.end(), [](float value) {
                return std::isfinite(value) && std::abs(value) <= 10.0F;
            });
        };
        if (!finiteDegrees(config.aim.recoilPitchDegrees) ||
            !finiteDegrees(config.aim.recoilYawDegrees))
            throw std::runtime_error("Invalid weapon recoil pattern: " + key);
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
        j["aim"] = {
            {"aimInSeconds", weapon.aim.aimInSeconds}, {"aimOutSeconds", weapon.aim.aimOutSeconds},
            {"adsFovRadians", weapon.aim.adsFovRadians}, {"adsMoveMultiplier", weapon.aim.adsMoveMultiplier},
            {"hipSpreadRadians", weapon.aim.hipSpreadRadians}, {"adsSpreadRadians", weapon.aim.adsSpreadRadians},
            {"hipMoveSpreadRadians", weapon.aim.hipMoveSpreadRadians}, {"adsMoveSpreadRadians", weapon.aim.adsMoveSpreadRadians},
            {"airborneSpreadRadians", weapon.aim.airborneSpreadRadians}, {"crouchMultiplier", weapon.aim.crouchMultiplier},
            {"proneMultiplier", weapon.aim.proneMultiplier}, {"bloomPerShotRadians", weapon.aim.bloomPerShotRadians},
            {"bloomMaxRadians", weapon.aim.bloomMaxRadians}, {"bloomDelaySeconds", weapon.aim.bloomDelaySeconds},
            {"bloomRecoveryRadiansPerSecond", weapon.aim.bloomRecoveryRadiansPerSecond}, {"recoilResetSeconds", weapon.aim.recoilResetSeconds},
            {"recoilRecoveryDelaySeconds", weapon.aim.recoilRecoveryDelaySeconds}, {"recoilRecoveryRate", weapon.aim.recoilRecoveryRate},
            {"adsRecoilMultiplier", weapon.aim.adsRecoilMultiplier}, {"recoilPitchDegrees", weapon.aim.recoilPitchDegrees},
            {"recoilYawDegrees", weapon.aim.recoilYawDegrees}, {"recoilVariationPitchDegrees", weapon.aim.recoilVariationPitchDegrees},
            {"recoilVariationYawDegrees", weapon.aim.recoilVariationYawDegrees}, {"reticleArmLengthPx", weapon.aim.reticleArmLengthPx},
            {"reticleMinGapPx", weapon.aim.reticleMinGapPx}};
        return j;
    }
};
