-- Add a free ticket type for testing
insert into public.ticket_types (event_id, name, price, currency, capacity_total, status)
select id, 'Free Test Ticket', 0, 'EUR', 100, 'published'
from public.events
where slug = 'marathon-26'
limit 1;
