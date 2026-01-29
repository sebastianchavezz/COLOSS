/**
 * Device ID Utility
 *
 * Generates and persists a unique device ID for rate limiting purposes.
 * Uses localStorage for persistence across sessions.
 */

const DEVICE_ID_KEY = 'coloss_device_id'

/**
 * Generate a random device ID
 */
function generateDeviceId(): string {
    const timestamp = Date.now().toString(36)
    const randomPart = Math.random().toString(36).substring(2, 15)
    return `${timestamp}-${randomPart}`
}

/**
 * Get or create a persistent device ID
 */
export function getDeviceId(): string {
    try {
        let deviceId = localStorage.getItem(DEVICE_ID_KEY)

        if (!deviceId) {
            deviceId = generateDeviceId()
            localStorage.setItem(DEVICE_ID_KEY, deviceId)
        }

        return deviceId
    } catch {
        // Fallback if localStorage is unavailable (e.g., private browsing)
        return generateDeviceId()
    }
}
