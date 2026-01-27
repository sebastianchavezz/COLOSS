/**
 * Email Helpers
 *
 * Shared utilities for email-related Edge Functions.
 * Includes token generation, URL building, and email formatting.
 */

/**
 * Generate a signed unsubscribe token
 *
 * Creates a JWT-like token that can be used in unsubscribe links.
 * Token is signed with the service role key for verification.
 *
 * @param email - The email address to unsubscribe
 * @param orgId - The organization ID
 * @param emailType - The type of emails to unsubscribe from ('marketing' or 'all')
 * @param secret - The signing secret (SERVICE_ROLE_KEY)
 * @param expiresInDays - Token expiration in days (default: 30)
 * @returns Signed token string
 */
export async function generateUnsubscribeToken(
    email: string,
    orgId: string,
    emailType: string,
    secret: string,
    expiresInDays: number = 30
): Promise<string> {
    // Header
    const header = {
        alg: 'HS256',
        typ: 'JWT'
    }

    // Payload
    const payload = {
        email: email.toLowerCase(),
        org_id: orgId,
        email_type: emailType,
        exp: Math.floor(Date.now() / 1000) + (expiresInDays * 24 * 60 * 60)
    }

    // Base64url encode
    const encode = (obj: object): string => {
        const json = JSON.stringify(obj)
        const b64 = btoa(json)
        return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    }

    const headerB64 = encode(header)
    const payloadB64 = encode(payload)
    const signedContent = `${headerB64}.${payloadB64}`

    // Sign with HMAC-SHA256
    const keyData = new TextEncoder().encode(secret)
    const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    )

    const signatureBytes = await crypto.subtle.sign(
        'HMAC',
        key,
        new TextEncoder().encode(signedContent)
    )

    // Convert signature to base64url
    const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signatureBytes)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')

    return `${headerB64}.${payloadB64}.${signatureB64}`
}

/**
 * Build an unsubscribe URL
 *
 * @param baseUrl - The Supabase functions URL (e.g., https://xxx.supabase.co/functions/v1)
 * @param token - The signed unsubscribe token
 * @returns Full unsubscribe URL
 */
export function buildUnsubscribeUrl(baseUrl: string, token: string): string {
    return `${baseUrl}/unsubscribe?token=${encodeURIComponent(token)}`
}

/**
 * Add unsubscribe footer to HTML email
 *
 * Appends a standard unsubscribe footer with link to the email body.
 *
 * @param htmlBody - The original HTML email body
 * @param unsubscribeUrl - The unsubscribe URL
 * @returns HTML body with footer added
 */
export function addUnsubscribeFooter(htmlBody: string, unsubscribeUrl: string): string {
    const footer = `
<div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #6b7280; text-align: center;">
    <p>Je ontvangt deze email omdat je je hebt aangemeld voor een evenement.</p>
    <p><a href="${unsubscribeUrl}" style="color: #6b7280; text-decoration: underline;">Uitschrijven van deze mailinglijst</a></p>
</div>`

    // Try to insert before </body> if present, otherwise append
    if (htmlBody.includes('</body>')) {
        return htmlBody.replace('</body>', `${footer}</body>`)
    }
    return htmlBody + footer
}

/**
 * Validate email format
 *
 * @param email - Email address to validate
 * @returns True if email format is valid
 */
export function isValidEmail(email: string): boolean {
    const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
    return emailRegex.test(email)
}

/**
 * Email status types
 */
export type EmailStatus =
    | 'queued'
    | 'processing'
    | 'sent'
    | 'delivered'
    | 'bounced'
    | 'soft_bounced'
    | 'complained'
    | 'failed'
    | 'cancelled'

/**
 * Batch status types
 */
export type BatchStatus =
    | 'draft'
    | 'queued'
    | 'processing'
    | 'sending'
    | 'completed'
    | 'paused'
    | 'cancelled'
    | 'failed'

/**
 * Email type for compliance
 */
export type EmailType = 'transactional' | 'marketing' | 'system'
