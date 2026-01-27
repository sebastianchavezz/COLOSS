import { useOutletContext } from 'react-router-dom'
import type { Organization } from '../types/supabase'

/**
 * Context type passed via React Router's Outlet context
 */
export type OrgContextType = {
    org: Organization
}

/**
 * Hook to access the current organization context.
 * 
 * MUST be used within a route that is a child of Layout.tsx,
 * which provides the org context via <Outlet context={{ org }} />.
 * 
 * @throws Error if used outside of org-scoped routes
 */
export function useOrg(): OrgContextType {
    const context = useOutletContext<OrgContextType | undefined>()

    if (!context || !context.org) {
        throw new Error(
            'useOrg() must be used within org-scoped routes (children of Layout). ' +
            'Ensure you are rendering inside /org/:orgSlug/* routes and Layout has loaded the org.'
        )
    }

    return context
}

/**
 * Safe version that doesn't throw, returns undefined if not available.
 * Use this only in components that can gracefully handle missing org.
 */
export function useOrgSafe(): OrgContextType | undefined {
    return useOutletContext<OrgContextType | undefined>()
}
