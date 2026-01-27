/**
 * unsubscribe Edge Function
 *
 * Handles unsubscribe link clicks from marketing emails.
 * Verifies a signed JWT token and registers the unsubscribe in the database.
 *
 * Features:
 * - Token-based authentication (no user login required)
 * - Signed JWT verification using SERVICE_ROLE_KEY
 * - GDPR-compliant unsubscribe recording
 * - User-friendly HTML response page
 *
 * Security: Token verification via JWT signed with service role secret
 * Token contains: email, org_id, email_type
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

interface UnsubscribeTokenPayload {
    email: string
    org_id: string
    email_type: string
    exp: number  // Expiration timestamp
}

/**
 * Verify and decode JWT token
 * Uses HMAC-SHA256 with service role key as secret
 */
async function verifyToken(token: string, secret: string): Promise<UnsubscribeTokenPayload | null> {
    try {
        const parts = token.split('.')
        if (parts.length !== 3) {
            return null
        }

        const [headerB64, payloadB64, signatureB64] = parts

        // Verify signature
        const signedContent = `${headerB64}.${payloadB64}`
        const keyData = new TextEncoder().encode(secret)

        const key = await crypto.subtle.importKey(
            'raw',
            keyData,
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        )

        // Decode signature (base64url to Uint8Array)
        const signatureStr = signatureB64
            .replace(/-/g, '+')
            .replace(/_/g, '/')
        const signatureBytes = Uint8Array.from(atob(signatureStr), c => c.charCodeAt(0))

        const isValid = await crypto.subtle.verify(
            'HMAC',
            key,
            signatureBytes,
            new TextEncoder().encode(signedContent)
        )

        if (!isValid) {
            return null
        }

        // Decode payload
        const payloadStr = payloadB64
            .replace(/-/g, '+')
            .replace(/_/g, '/')
        const payloadJson = atob(payloadStr)
        const payload = JSON.parse(payloadJson) as UnsubscribeTokenPayload

        // Check expiration
        if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
            return null
        }

        return payload

    } catch {
        return null
    }
}

/**
 * Generate HTML response page
 */
function htmlResponse(title: string, message: string, success: boolean): Response {
    const bgColor = success ? '#f0fdf4' : '#fef2f2'
    const textColor = success ? '#166534' : '#991b1b'
    const icon = success ? '&#10004;' : '&#10006;'

    const html = `<!DOCTYPE html>
<html lang="nl">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background-color: ${bgColor};
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 12px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            padding: 40px;
            max-width: 500px;
            text-align: center;
        }
        .icon {
            font-size: 48px;
            color: ${textColor};
            margin-bottom: 20px;
        }
        h1 {
            color: ${textColor};
            margin-bottom: 16px;
            font-size: 24px;
        }
        p {
            color: #4b5563;
            line-height: 1.6;
        }
        .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #e5e7eb;
            font-size: 14px;
            color: #9ca3af;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">${icon}</div>
        <h1>${title}</h1>
        <p>${message}</p>
        <div class="footer">
            Je kunt dit venster nu sluiten.
        </div>
    </div>
</body>
</html>`

    return new Response(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
    })
}

serve(async (req: Request) => {
    const logger = createLogger('unsubscribe')
    logger.info('Function invoked')

    try {
        // 1. EXTRACT TOKEN FROM URL
        const url = new URL(req.url)
        const token = url.searchParams.get('token')

        if (!token) {
            logger.warn('Missing token parameter')
            return htmlResponse(
                'Ongeldige link',
                'De uitschrijflink is ongeldig of onvolledig. Neem contact op met de organisatie als je je wilt uitschrijven.',
                false
            )
        }

        // 2. GET SECRET FOR VERIFICATION
        const serviceRoleKey = Deno.env.get('SERVICE_ROLE_KEY') ??
                              Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

        if (!serviceRoleKey) {
            logger.error('Missing SERVICE_ROLE_KEY')
            return htmlResponse(
                'Serverfout',
                'Er is een technisch probleem opgetreden. Probeer het later opnieuw.',
                false
            )
        }

        // 3. VERIFY TOKEN
        const payload = await verifyToken(token, serviceRoleKey)

        if (!payload) {
            logger.warn('Invalid or expired token')
            return htmlResponse(
                'Link verlopen',
                'De uitschrijflink is verlopen of ongeldig. Uitschrijflinks zijn 30 dagen geldig. Neem contact op met de organisatie als je je wilt uitschrijven.',
                false
            )
        }

        const { email, org_id, email_type } = payload
        logger.info('Token verified', { email, orgId: org_id, emailType: email_type })

        // 4. SETUP ADMIN CLIENT
        const supabaseAdmin = getServiceClient()

        // 5. INSERT UNSUBSCRIBE RECORD
        // ON CONFLICT DO NOTHING to handle duplicate clicks gracefully
        const { error: insertError } = await supabaseAdmin
            .from('email_unsubscribes')
            .insert({
                email: email.toLowerCase(),
                org_id: org_id,
                email_type: email_type,
                source: 'link_click',
                reason: 'User clicked unsubscribe link',
                metadata: {
                    user_agent: req.headers.get('user-agent'),
                    timestamp: new Date().toISOString()
                }
            })

        // Check for duplicate (already unsubscribed)
        if (insertError) {
            // Unique constraint violation means already unsubscribed
            if (insertError.code === '23505') {
                logger.info('Email already unsubscribed', email)
                return htmlResponse(
                    'Al uitgeschreven',
                    'Je bent al uitgeschreven van deze mailinglijst. Je ontvangt geen verdere marketing emails meer.',
                    true
                )
            }

            logger.error('Failed to insert unsubscribe', insertError)
            return htmlResponse(
                'Fout bij uitschrijven',
                'Er is een fout opgetreden bij het verwerken van je uitschrijving. Probeer het later opnieuw of neem contact op met de organisatie.',
                false
            )
        }

        logger.info('Unsubscribe recorded successfully', { email, orgId: org_id })

        // 6. RETURN SUCCESS PAGE
        return htmlResponse(
            'Succesvol uitgeschreven',
            'Je bent uitgeschreven van de mailinglijst. Je ontvangt geen verdere marketing emails meer van deze organisatie. Transactionele emails (zoals orderbevestigingen) blijf je wel ontvangen.',
            true
        )

    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error('Unexpected error', message)
        return htmlResponse(
            'Serverfout',
            'Er is een onverwachte fout opgetreden. Probeer het later opnieuw of neem contact op met de organisatie.',
            false
        )
    }
})
