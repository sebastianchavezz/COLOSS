const RETURN_TO_KEY = 'coloss_phone_return_to'

export const authHelpers = {
    saveReturnTo: (path: string) => {
        sessionStorage.setItem(RETURN_TO_KEY, path)
    },

    getReturnTo: () => {
        return sessionStorage.getItem(RETURN_TO_KEY)
    },

    consumeReturnTo: (defaultPath = '/') => {
        const path = sessionStorage.getItem(RETURN_TO_KEY)
        if (path) {
            sessionStorage.removeItem(RETURN_TO_KEY)
            return path
        }
        return defaultPath
    }
}
