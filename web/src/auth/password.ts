import argon2 from 'argon2'

/**
 * Hash a password using argon2
 */
export async function hashPassword(password: string): Promise<string> {
    return argon2.hash(password)
}

/**
 * Verify a password against a hash using constant-time comparison
 */
export async function verifyPassword(
    hash: string,
    password: string
): Promise<boolean> {
    try {
        return await argon2.verify(hash, password)
    } catch (err) {
        // If verification throws (e.g., invalid hash format), return false
        return false
    }
}
