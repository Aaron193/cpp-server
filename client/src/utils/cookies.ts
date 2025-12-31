/**
 * Utility function to get a cookie value by name
 */
export function getCookie(name: string): string | null {
    const value = `; ${document.cookie}`
    const parts = value.split(`; ${name}=`)
    if (parts.length === 2) {
        return parts.pop()?.split(';').shift() || null
    }
    return null
}

/**
 * Get the access token from cookies
 */
export function getAccessToken(): string | null {
    return getCookie('access_token')
}
