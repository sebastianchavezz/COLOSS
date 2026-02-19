/**
 * ticket-pdf Edge Function
 *
 * Generates a printable HTML ticket page for a specific ticket_instance.
 * Returns text/html with auto-print dialog, allowing save as PDF.
 *
 * Endpoint: GET /functions/v1/ticket-pdf?ticket_id={uuid}
 * Auth: Bearer token required
 * Security: ticket owner OR org member only
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { handleCors, corsHeaders } from '../_shared/cors.ts'
import { authenticateUser, isOrgMember } from '../_shared/auth.ts'
import { getServiceClient } from '../_shared/supabase.ts'
import { createLogger } from '../_shared/logger.ts'

interface TicketRow {
  id: string
  qr_code: string
  status: string
  created_at: string
  ticket_types: { name: string; price: number } | null
  orders: {
    purchaser_name: string
    email: string
    event_id: string
    org_id: string
    user_id: string
    events: {
      name: string
      start_time: string
      location_name: string | null
      slug: string
    } | null
  } | null
}

function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function formatDutchDate(isoString: string): string {
  try {
    // Format in Europe/Amsterdam timezone
    const formatter = new Intl.DateTimeFormat('nl-NL', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Europe/Amsterdam',
    })
    return formatter.format(new Date(isoString))
  } catch {
    return isoString
  }
}

function formatPrice(cents: number): string {
  const euros = cents / 100
  return `\u20AC ${euros.toFixed(2).replace('.', ',')}`
}

function generateTicketHtml(ticket: TicketRow): string {
  const event = ticket.orders?.events
  const order = ticket.orders
  const tt = ticket.ticket_types

  const eventName = escapeHtml(event?.name ?? 'Evenement')
  const location = escapeHtml(event?.location_name ?? '')
  const startTime = event?.start_time ? formatDutchDate(event.start_time) : 'Datum onbekend'
  const typeName = escapeHtml(tt?.name ?? 'Ticket')
  const price = tt?.price != null ? formatPrice(tt.price) : ''
  const participant = escapeHtml(order?.purchaser_name ?? 'Deelnemer')
  const ref = ticket.id.replace(/-/g, '').slice(0, 8).toUpperCase()
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&ecc=H&data=${encodeURIComponent(ticket.qr_code)}`

  return `<!DOCTYPE html>
<html lang="nl">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Ticket - ${eventName}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;background:#f0f2f5;color:#1a1a2e;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.ticket{background:#fff;width:148mm;max-width:100%;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.12)}
.ticket__header{background:#0f172a;padding:24px 28px 20px}
.ticket__label{font-size:10px;font-weight:700;letter-spacing:.15em;text-transform:uppercase;color:#94a3b8;margin-bottom:8px}
.ticket__event{font-size:22px;font-weight:800;color:#f8fafc;line-height:1.2}
.ticket__body{padding:24px 28px}
.ticket__info{display:flex;flex-direction:column;gap:14px;margin-bottom:24px;list-style:none}
.ticket__row{display:flex;align-items:flex-start;gap:10px}
.ticket__icon{width:18px;flex-shrink:0;margin-top:1px;color:#64748b}
.ticket__lbl{font-size:10px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8;margin-bottom:2px}
.ticket__val{font-size:14px;font-weight:500;color:#1a1a2e;line-height:1.4}
.ticket__divider{border:none;border-top:2px dashed #e2e8f0;margin:0 -28px 24px}
.ticket__qr{display:flex;align-items:center;gap:20px}
.ticket__qr-wrap{flex-shrink:0;padding:6px;border:2px solid #e2e8f0;border-radius:8px;line-height:0}
.ticket__qr-img{width:120px;height:120px;display:block}
.ticket__qr-meta{flex:1;min-width:0}
.ticket__badge{display:inline-block;background:#f1f5f9;color:#475569;font-size:11px;font-weight:600;padding:3px 8px;border-radius:4px;margin-bottom:8px}
.ticket__price{font-size:20px;font-weight:800;color:#0f172a;margin-bottom:4px}
.ticket__note{font-size:11px;color:#94a3b8;line-height:1.4}
.ticket__footer{background:#f8fafc;border-top:1px solid #e2e8f0;padding:12px 28px;display:flex;align-items:center;justify-content:space-between}
.ticket__brand{font-size:11px;font-weight:700;color:#64748b;letter-spacing:.05em}
.ticket__ref{font-size:11px;font-weight:600;color:#94a3b8;font-family:'Courier New',monospace}
.print-wrap{text-align:center;margin-top:20px}
.print-btn{background:#0f172a;color:#fff;border:none;border-radius:8px;padding:12px 28px;font-size:14px;font-weight:600;cursor:pointer}
.print-btn:hover{background:#1e293b}
@media print{
  @page{size:A5 portrait;margin:0}
  html,body{background:#fff;padding:0;min-height:unset;display:block}
  .ticket{width:148mm;max-width:148mm;box-shadow:none;border-radius:0;margin:0 auto}
  .print-wrap{display:none}
}
</style>
</head>
<body>
<div>
<article class="ticket">
<header class="ticket__header">
<p class="ticket__label">Ticket</p>
<h1 class="ticket__event">${eventName}</h1>
</header>
<section class="ticket__body">
<ul class="ticket__info">
<li class="ticket__row">
<svg class="ticket__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
<div><p class="ticket__lbl">Datum &amp; Tijd</p><p class="ticket__val">${escapeHtml(startTime)}</p></div>
</li>
${location ? `<li class="ticket__row">
<svg class="ticket__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
<div><p class="ticket__lbl">Locatie</p><p class="ticket__val">${location}</p></div>
</li>` : ''}
<li class="ticket__row">
<svg class="ticket__icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
<div><p class="ticket__lbl">Deelnemer</p><p class="ticket__val">${participant}</p></div>
</li>
</ul>
<hr class="ticket__divider"/>
<div class="ticket__qr">
<div class="ticket__qr-wrap">
<img class="ticket__qr-img" src="${qrUrl}" alt="QR #${ref}" width="120" height="120"/>
</div>
<div class="ticket__qr-meta">
<span class="ticket__badge">${typeName}</span>
${price ? `<p class="ticket__price">${escapeHtml(price)}</p>` : ''}
<p class="ticket__note">Laat deze QR code scannen bij de ingang.</p>
</div>
</div>
</section>
<footer class="ticket__footer">
<span class="ticket__brand">COLOSS</span>
<span class="ticket__ref">#${ref}</span>
</footer>
</article>
<div class="print-wrap">
<button class="print-btn" onclick="window.print()">Opslaan als PDF / Afdrukken</button>
</div>
</div>
<script>
window.addEventListener('load',function(){
var q=document.querySelector('.ticket__qr-img');
function p(){if(window.self===window.top)window.print();}
if(q&&!q.complete){q.addEventListener('load',p);setTimeout(p,3000);}
else setTimeout(p,300);
});
</script>
</body>
</html>`
}

serve(async (req: Request) => {
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  const logger = createLogger('ticket-pdf')

  try {
    // 1. Auth
    const { user, error: authError } = await authenticateUser(req)
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized', code: authError ?? 'NO_USER' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 2. Parse ticket_id
    const url = new URL(req.url)
    const ticketId = url.searchParams.get('ticket_id')

    if (!ticketId) {
      return new Response(JSON.stringify({ error: 'Missing ticket_id' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    if (!UUID_RE.test(ticketId)) {
      return new Response(JSON.stringify({ error: 'Invalid ticket_id format' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 3. Fetch ticket with joins
    const serviceClient = getServiceClient()
    const { data: ticket, error: fetchError } = await serviceClient
      .from('ticket_instances')
      .select(`
        id, qr_code, status, created_at,
        ticket_types ( name, price ),
        orders ( purchaser_name, email, event_id, org_id, user_id,
          events ( name, start_time, location_name, slug )
        )
      `)
      .eq('id', ticketId)
      .single()

    if (fetchError || !ticket) {
      logger.warn('Ticket not found', { ticketId })
      return new Response(JSON.stringify({ error: 'Ticket not found' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const t = ticket as unknown as TicketRow

    // 3b. Guard: ticket must have order data and be in issued status
    if (!t.orders) {
      return new Response(JSON.stringify({ error: 'Ticket has no associated order' }), {
        status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    if (t.status !== 'issued') {
      return new Response(JSON.stringify({ error: 'Ticket is not valid for download', status: t.status }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 4. Authorization: owner OR org member
    const isOwner = t.orders?.user_id === user.id
    let authorized = isOwner
    if (!authorized && t.orders?.org_id) {
      authorized = await isOrgMember(serviceClient, t.orders.org_id, user.id)
    }

    if (!authorized) {
      return new Response(JSON.stringify({ error: 'Access denied' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 5. Generate HTML ticket
    const html = generateTicketHtml(t)

    return new Response(html, {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      },
    })

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error)
    logger.error('Unexpected error', { error: msg })
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
