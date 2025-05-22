export function isDevelopment(): boolean {
    return /(localhost)|(127\.0\.0\.1)|(8080)/.test(location.host)
}
