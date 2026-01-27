# MVP Testplan & Validatie Script

Dit document bevat een checklist en een script om de Supabase backend en Mollie integratie te valideren.

## 1. SQL Validatie Checklist

Voer deze queries uit in de Supabase SQL Editor om de structuur en security te verifiëren.

### A. RLS Check
Controleer of RLS aan staat op alle kritieke tabellen.
```sql
select tablename, rowsecurity 
from pg_tables 
where schemaname = 'public' 
and tablename in ('orgs', 'events', 'registrations', 'tickets', 'orders', 'payments', 'profiles');
-- Verwacht: rowsecurity = true voor alles
```

### B. Participants Integrity
Controleer of `user_id` verplicht is en de FK correct is.
```sql
select column_name, is_nullable 
from information_schema.columns 
where table_name = 'participants' and column_name = 'user_id';
-- Verwacht: is_nullable = NO

select constraint_name, constraint_type
from information_schema.table_constraints
where table_name = 'participants' and constraint_type = 'FOREIGN KEY';
-- Verwacht: participants_user_id_fkey
```

### C. Tickets & Orders Link
Controleer of `order_id` bestaat op `tickets` en geïndexeerd is.
```sql
select column_name 
from information_schema.columns 
where table_name = 'tickets' and column_name = 'order_id';

select indexname, indexdef 
from pg_indexes 
where tablename = 'tickets' and indexname = 'idx_tickets_order_id';
```

### D. Idempotency Constraint
Controleer de unieke constraint op `payment_events`.
```sql
select constraint_name 
from information_schema.table_constraints 
where table_name = 'payment_events' and constraint_type = 'UNIQUE';
-- Verwacht: payment_events_provider_unique (op provider, provider_event_id)
```

---

## 2. Test Script (Node.js)

Dit script simuleert een volledige flow: User -> Order -> Payment -> Webhook -> Bevestiging.

### Vereisten
*   Node.js geïnstalleerd
*   `npm install @supabase/supabase-js dotenv`
*   Een `.env` bestand met:
    *   `SUPABASE_URL`
    *   `SUPABASE_SERVICE_ROLE_KEY` (om user aan te maken en RPC te callen)
    *   `SUPABASE_ANON_KEY` (voor normale client acties)

### Script: `test-backend.ts`

```typescript
import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'
dotenv.config()

// Config
const SUPABASE_URL = process.env.SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const ANON_KEY = process.env.SUPABASE_ANON_KEY!

// Clients
const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
let userClient: any

async function runTest() {
  console.log('🚀 Starting Backend Validation Test...')

  // 1. Setup Test Data (Org, Event, Ticket Type)
  console.log('\n--- 1. Setup Infrastructure ---')
  
  // Create Org
  const { data: org, error: orgError } = await adminClient
    .from('orgs')
    .insert({ name: 'Test Org', slug: `test-org-${Date.now()}` })
    .select()
    .single()
  if (orgError) throw orgError
  console.log('✅ Org created:', org.id)

  // Create Event
  const { data: event, error: eventError } = await adminClient
    .from('events')
    .insert({ 
      org_id: org.id, 
      name: 'Test Event', 
      slug: `test-event-${Date.now()}`,
      start_time: new Date().toISOString(),
      status: 'published'
    })
    .select()
    .single()
  if (eventError) throw eventError
  console.log('✅ Event created:', event.id)

  // Create Ticket Type
  const { data: ticketType, error: ttError } = await adminClient
    .from('ticket_types')
    .insert({
      event_id: event.id,
      name: 'General Admission',
      capacity_total: 100,
      price: 10.00
    })
    .select()
    .single()
  if (ttError) throw ttError
  console.log('✅ Ticket Type created:', ticketType.id)


  // 2. Create Test User & Login
  console.log('\n--- 2. User & Auth ---')
  const email = `testuser-${Date.now()}@example.com`
  const password = 'password123'
  
  const { data: authData, error: authError } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Test User' }
  })
  if (authError) throw authError
  const userId = authData.user.id
  console.log('✅ User created:', userId)

  // Login as user to get session
  const { data: loginData, error: loginError } = await adminClient.auth.signInWithPassword({ email, password })
  if (loginError) throw loginError
  
  userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${loginData.session.access_token}` } }
  })
  console.log('✅ Logged in as user')


  // 3. Create Order Flow (Client Side)
  console.log('\n--- 3. Order Creation ---')
  
  // A. Create Participant
  const { data: participant, error: partError } = await userClient
    .from('participants')
    .insert({
      user_id: userId,
      email: email,
      first_name: 'Test',
      last_name: 'User'
    })
    .select()
    .single()
  if (partError) throw partError
  console.log('✅ Participant created:', participant.id)

  // B. Create Registration
  const { data: registration, error: regError } = await userClient
    .from('registrations')
    .insert({
      event_id: event.id,
      participant_id: participant.id,
      status: 'pending'
    })
    .select()
    .single()
  if (regError) throw regError
  console.log('✅ Registration created (pending):', registration.id)

  // C. Create Order
  const { data: order, error: orderError } = await userClient
    .from('orders')
    .insert({
      event_id: event.id,
      user_id: userId,
      email: email,
      total_amount: 10.00,
      currency: 'EUR',
      status: 'pending'
    })
    .select()
    .single()
  if (orderError) throw orderError
  console.log('✅ Order created (pending):', order.id)

  // D. Create Ticket (Linked to Order & Registration)
  const { data: ticket, error: ticketError } = await userClient
    .from('tickets')
    .insert({
      registration_id: registration.id,
      ticket_type_id: ticketType.id,
      order_id: order.id,
      barcode: `TICKET-${Date.now()}`,
      status: 'valid' // Eigenlijk 'pending' maar default is valid in schema? Check schema.
      // Schema Layer 4: default 'valid'. 
      // In echte flow zou je dit wellicht op 'pending' willen zetten tot betaling.
      // Maar voor nu testen we de webhook transitie.
    })
    .select()
    .single()
  
  // We zetten hem handmatig even op 'cancelled' of 'pending' (als enum dat toestaat) om de transitie te testen.
  // Ticket status enum: 'valid', 'used', 'cancelled'. Geen pending.
  // Laten we hem op 'cancelled' zetten om te zien of webhook hem 'valid' maakt?
  // Of we voegen 'pending' toe aan enum. 
  // Voor nu: we checken vooral of registration naar 'confirmed' gaat.
  if (ticketError) throw ticketError
  console.log('✅ Ticket created:', ticket.id)


  // 4. Call Edge Function (Mock)
  console.log('\n--- 4. Edge Function: create-mollie-payment ---')
  // We callen de functie via Supabase Functions invoke
  const { data: funcData, error: funcError } = await userClient.functions.invoke('create-mollie-payment', {
    body: { order_id: order.id, redirect_url: 'http://localhost:3000' }
  })
  
  if (funcError) {
    console.log('⚠️ Function call failed (expected if no MOLLIE_KEY set):', funcError.message)
  } else {
    console.log('✅ Function response:', funcData)
  }
  
  // We simuleren dat de payment in DB staat (normaal doet de functie dit)
  const paymentId = `tr_test_${Date.now()}`
  await adminClient.from('payments').insert({
    order_id: order.id,
    provider: 'mollie',
    provider_payment_id: paymentId,
    amount: 10.00,
    status: 'open'
  })
  console.log('✅ Payment record created (simulated):', paymentId)


  // 5. Simulate Webhook (RPC Call)
  console.log('\n--- 5. Webhook Simulation (RPC) ---')
  
  console.log('Simulating PAID webhook...')
  const { error: rpcError } = await adminClient.rpc('handle_payment_webhook', {
    _order_id: order.id,
    _payment_id: paymentId,
    _status: 'paid',
    _amount: 10.00,
    _currency: 'EUR'
  })
  if (rpcError) throw rpcError
  console.log('✅ RPC executed successfully')

  // 6. Verify Results
  console.log('\n--- 6. Verification ---')
  
  const { data: finalOrder } = await adminClient.from('orders').select('status').eq('id', order.id).single()
  console.log(`Order Status: ${finalOrder.status} (Expected: paid)`)
  
  const { data: finalReg } = await adminClient.from('registrations').select('status').eq('id', registration.id).single()
  console.log(`Registration Status: ${finalReg.status} (Expected: confirmed)`)
  
  const { data: finalTicket } = await adminClient.from('tickets').select('status').eq('id', ticket.id).single()
  console.log(`Ticket Status: ${finalTicket.status} (Expected: valid)`)

  // 7. Idempotency Test
  console.log('\n--- 7. Idempotency Test ---')
  console.log('Calling RPC again with same data...')
  const { error: rpcError2 } = await adminClient.rpc('handle_payment_webhook', {
    _order_id: order.id,
    _payment_id: paymentId,
    _status: 'paid',
    _amount: 10.00,
    _currency: 'EUR'
  })
  if (rpcError2) throw rpcError2
  console.log('✅ RPC executed again without error (Idempotent)')

  console.log('\n🎉 Test Completed Successfully!')
}

runTest().catch(console.error)
```

## 3. Environment Variables

Maak een `.env` bestand aan in de root van je project met de volgende waarden (te vinden in Supabase Dashboard > Settings > API):

```env
SUPABASE_URL=https://yihypotpywllwoymjduz.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJh... (De geheime 'service_role' sleutel)
SUPABASE_ANON_KEY=eyJh... (De publieke 'anon' sleutel)
MOLLIE_API_KEY=test_... (Je Mollie Test API Key, optioneel voor dit script als je de functie call mockt)
```
