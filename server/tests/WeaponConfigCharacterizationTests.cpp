#include <string>
#include <cstdio>
#include <fstream>

#include "GameConfig.hpp"
#include "TestHarness.hpp"

namespace {

GameConfig loadCurrentConfig() {
    return GameConfig::loadFromFile(std::string(SERVER_SOURCE_DIR) +
                                    "/game_config.json");
}

}  // namespace

TEST_CASE(current_rifle_configuration_is_preserved) {
    const WeaponConfig rifle = loadCurrentConfig().rifle;

    EXPECT_EQ(rifle.fireMode, GunFireMode::FIRE_HITSCAN);
    EXPECT_EQ(rifle.ammoType, AmmoType::LIGHT);
    EXPECT_EQ(rifle.magazineSize, 30);
    EXPECT_EQ(rifle.ammoPerShot, 1);
    EXPECT_NEAR(rifle.fireRate, 10.0F, 0.0001F);
    EXPECT_NEAR(rifle.reloadTime, 1.8F, 0.0001F);
    EXPECT_NEAR(rifle.damage, 24.0F, 0.0001F);
    EXPECT_NEAR(rifle.range, 80.0F, 0.0001F);
    EXPECT_NEAR(rifle.spread, 0.006F, 0.0001F);
    EXPECT_EQ(rifle.pellets, 1);
    EXPECT_NEAR(rifle.barrelLength, 0.7F, 0.0001F);
    EXPECT_TRUE(rifle.automatic);
}

TEST_CASE(current_shotgun_configuration_is_preserved) {
    const WeaponConfig shotgun = loadCurrentConfig().shotgun;

    EXPECT_EQ(shotgun.fireMode, GunFireMode::FIRE_HITSCAN);
    EXPECT_EQ(shotgun.ammoType, AmmoType::SHELL);
    EXPECT_EQ(shotgun.magazineSize, 6);
    EXPECT_EQ(shotgun.ammoPerShot, 1);
    EXPECT_NEAR(shotgun.fireRate, 1.2F, 0.0001F);
    EXPECT_NEAR(shotgun.reloadTime, 2.2F, 0.0001F);
    EXPECT_NEAR(shotgun.damage, 12.0F, 0.0001F);
    EXPECT_NEAR(shotgun.range, 20.0F, 0.0001F);
    EXPECT_NEAR(shotgun.spread, 0.055F, 0.0001F);
    EXPECT_EQ(shotgun.pellets, 8);
    EXPECT_NEAR(shotgun.barrelLength, 0.65F, 0.0001F);
    EXPECT_TRUE(!shotgun.automatic);
}

TEST_CASE(current_weapon_aim_profiles_are_validated_and_serialized) {
    const auto config = loadCurrentConfig();
    EXPECT_NEAR(config.rifle.aim.aimInSeconds, 0.165F, 0.0001F);
    EXPECT_NEAR(config.rifle.aim.adsSpreadRadians, 0.0025F, 0.0001F);
    EXPECT_NEAR(config.shotgun.aim.adsFovRadians, 1.1868239F, 0.0001F);
    EXPECT_EQ(config.rifle.aim.recoilYawDegrees.size(), 8U);
    EXPECT_NEAR(config.toJson().at("weapons").at("shotgun").at("aim").at("reticleArmLengthPx").get<float>(), 8.0F, 0.0001F);
}

TEST_CASE(current_weapon_config_serializes_with_named_weapon_entries) {
    const nlohmann::json serialized = loadCurrentConfig().toJson();

    EXPECT_EQ(serialized.at("weapons").size(), 2U);
    EXPECT_EQ(serialized.at("weapons").at("rifle").at("ammoType"), "light");
    EXPECT_EQ(serialized.at("weapons").at("shotgun").at("ammoType"), "shell");
}

TEST_CASE(current_movement_and_loadout_configuration_is_validated) {
    const auto config = loadCurrentConfig();
    EXPECT_NEAR(config.movement.capsuleRadius, 0.42F, 0.0001F);
    EXPECT_NEAR(config.movement.capsuleHalfHeight, 0.48F, 0.0001F);
    EXPECT_NEAR(config.movement.eyeHeight, 1.62F, 0.0001F);
    EXPECT_NEAR(config.movement.groundSpeed, 5.5F, 0.0001F);
    EXPECT_NEAR(config.movement.sprintSpeed, 7.5F, 0.0001F);
    EXPECT_NEAR(config.movement.crouchSpeed, 3.1F, 0.0001F);
    EXPECT_NEAR(config.movement.proneSpeed, 1.35F, 0.0001F);
    EXPECT_NEAR(config.movement.dashSpeed, 13.0F, 0.0001F);
    EXPECT_TRUE(config.movement.mantleEnabled);
    EXPECT_NEAR(config.movement.groundAcceleration, 42.0F, 0.0001F);
    EXPECT_NEAR(config.movement.airAcceleration, 12.0F, 0.0001F);
    EXPECT_NEAR(config.movement.jumpSpeed, 6.4F, 0.0001F);
    EXPECT_NEAR(config.movement.gravity, 20.0F, 0.0001F);
    EXPECT_NEAR(config.movement.terminalVelocity, 35.0F, 0.0001F);
    EXPECT_EQ(config.loadout.rifleReserveAmmo, 120);
    EXPECT_EQ(config.loadout.shotgunReserveAmmo, 24);
    EXPECT_EQ(config.combat.maxLagCompensationMs, 250U);
    EXPECT_EQ(config.combat.scoreLimit, 25U);
    EXPECT_NEAR(config.combat.roundSeconds, 600.0F, 0.0001F);
    EXPECT_NEAR(config.combat.intermissionSeconds, 10.0F, 0.0001F);
}

TEST_CASE(projectile_weapon_configuration_is_rejected_for_hitscan_slice) {
    auto json = loadCurrentConfig().toJson();
    json["weapons"]["rifle"]["fireMode"] = "projectile";
    const std::string path = "/tmp/cpp-server-invalid-weapon-config.json";
    {
        std::ofstream output(path);
        output << json.dump();
    }
    bool rejected = false;
    try { (void)GameConfig::loadFromFile(path); }
    catch (const std::runtime_error&) { rejected = true; }
    std::remove(path.c_str());
    EXPECT_TRUE(rejected);
}

TEST_CASE(invalid_movement_configuration_is_rejected) {
    auto json = loadCurrentConfig().toJson();
    json["movement"]["airControl"] = 2.0F;
    const std::string path = "/tmp/cpp-server-invalid-game-config.json";
    {
        std::ofstream output(path);
        output << json.dump();
    }
    bool rejected = false;
    try {
        (void)GameConfig::loadFromFile(path);
    } catch (const std::runtime_error&) {
        rejected = true;
    }
    std::remove(path.c_str());
    EXPECT_TRUE(rejected);
}
