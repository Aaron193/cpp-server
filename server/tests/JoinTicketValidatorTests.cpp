#include "TestHarness.hpp"

#include <string>

#include "security/JoinTicketValidator.hpp"

namespace {
constexpr const char* kSecret = "0123456789abcdef0123456789abcdef";
constexpr const char* kTicket =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9."
    "eyJzdWIiOiJ1c2VyLTEiLCJzZXNzaW9uSWQiOiJzZXNzaW9uLTEiLCJnYW1lU2VydmVySWQiOiJzZXJ2ZXItMSIsImF1ZCI6ImFyZW5hLWdhbWUtc2VydmVyIiwiaWF0IjoxODAwMDAwMDAwLCJleHAiOjE4MDAwMDAwMjAsIm5vbmNlIjoibm9uY2UtMSJ9."
    "0loIiEZ-2JhKu9ZIPc6EYA_Wmz7gQe4SzYJBP3QnxY0";
}

TEST_CASE(join_ticket_validates_signature_claims_expiry_scope_and_replay) {
    JoinTicketValidator validator(kSecret, "arena-game-server", "server-1");
    EXPECT_TRUE(validator.validateAt(kTicket, 1800000010));
    EXPECT_EQ(validator.lastIdentity().subject, std::string("user-1"));
    EXPECT_EQ(validator.lastIdentity().sessionId, std::string("session-1"));
    EXPECT_EQ(validator.replayEntryCount(), 1U);
    EXPECT_TRUE(!validator.validateAt(kTicket, 1800000010));

    JoinTicketValidator expired(kSecret, "arena-game-server", "server-1");
    EXPECT_TRUE(!expired.validateAt(kTicket, 1800000020));
    JoinTicketValidator wrongAudience(kSecret, "wrong", "server-1");
    EXPECT_TRUE(!wrongAudience.validateAt(kTicket, 1800000010));
    JoinTicketValidator wrongServer(kSecret, "arena-game-server", "server-2");
    EXPECT_TRUE(!wrongServer.validateAt(kTicket, 1800000010));
    JoinTicketValidator wrongSecret(
        "abcdef0123456789abcdef0123456789", "arena-game-server", "server-1");
    EXPECT_TRUE(!wrongSecret.validateAt(kTicket, 1800000010));
}

TEST_CASE(join_ticket_rejects_malformed_and_oversized_tokens) {
    JoinTicketValidator validator(kSecret, "arena-game-server", "server-1");
    EXPECT_TRUE(!validator.validateAt("not.a.jwt", 1800000010));
    EXPECT_TRUE(!validator.validateAt(std::string(513U, 'x'), 1800000010));
}
