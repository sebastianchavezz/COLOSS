# Sprint S3: Event Settings Management

**Flow**: F003 Event Creation
**Sprint**: S3
**Date**: 2026-01-28
**Status**: Complete (Pre-existing)

---

## Context

S3 focuses on comprehensive event settings management. This was implemented as an advanced configuration system with 12 domains, each with its own permissions and reset capabilities.

---

## Scope

### Implemented Features

1. **General Settings** (`EventSettings.tsx`)
   - Edit event name, dates, location, description
   - Uses react-hook-form

2. **Advanced Settings** (`events/Settings.tsx`)
   12 configuration domains:

   | Domain | Features |
   |--------|----------|
   | `governance` | Private event toggle |
   | `legal` | Terms mode (none/pdf/url/inline), multi-locale |
   | `basic_info` | Multi-locale name/description, contact, website |
   | `content_communication` | Checkout message, email subject/body, extra recipients |
   | `branding` | Hero image, logo, primary color |
   | `waitlist` | Enable/disable waitlist |
   | `interest_list` | Enable/disable interest collection |
   | `ticket_pdf` | Available from date, banner image |
   | `ticket_privacy` | Show/hide fields on PDF |
   | `payments` | Profile, invoice prefix, VAT number/rate |
   | `transfers` | Enable, expiry hours |
   | `communication` | Sender, bulk settings, compliance, rate limits, retry |

3. **Permission System**
   - Role-based permissions per domain
   - `get_event_config_permissions` RPC
   - Disable form fields when not authorized

4. **Reset Functionality**
   - Reset any domain to defaults
   - `reset_event_config_domain` RPC

5. **Multi-Locale Support**
   - Dutch, English, French tabs
   - LocaleString type for translated fields

---

## Database

### event_settings table
```sql
CREATE TABLE public.event_settings (
    event_id uuid PRIMARY KEY REFERENCES events(id),
    currency text NOT NULL DEFAULT 'EUR',
    vat_percentage numeric(4,2) NOT NULL DEFAULT 21.00,
    support_email text,
    is_public_visible boolean NOT NULL DEFAULT false,
    allow_waitlist boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
```

### RPC Functions
| Function | Purpose |
|----------|---------|
| `get_event_config` | Get merged org + event settings |
| `set_event_config` | Patch specific domain |
| `reset_event_config_domain` | Reset to defaults |
| `get_event_config_permissions` | Check user permissions |

---

## Files

| File | Purpose |
|------|---------|
| `web/src/pages/EventSettings.tsx` | General settings form |
| `web/src/pages/events/Settings.tsx` | Advanced 12-domain config |
| `supabase/migrations/20240119000002_layer_2_events.sql` | Base schema |

---

## UI Tabs

```
[Governance] [Content] [Branding] [Waitlist] [Tickets] [Payments] [Transfers] [Communication]
```

Each tab has:
- Form with domain-specific fields
- Save button (when authorized)
- Reset to defaults button
- Toast notifications

---

## Acceptance Criteria

- [x] Edit general event settings
- [x] 12 configuration domains
- [x] Multi-locale support (nl/en/fr)
- [x] Role-based permissions
- [x] Reset to defaults
- [x] Toast notifications
- [x] Disabled state when not authorized
- [x] Debug panel (?debug=1)

---

*Sprint S3 - F003 Event Creation - 2026-01-28*
