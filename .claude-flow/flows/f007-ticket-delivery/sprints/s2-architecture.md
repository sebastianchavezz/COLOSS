# Architecture: Mobile Ticket Scanner (BYOD)

**Flow**: F007 Ticket Delivery
**Sprint**: S2
**Date**: 2026-01-29

## Overview

Frontend-only sprint. No database changes needed - uses existing `scan_ticket` and `get_scan_stats` RPCs from S1.

## Component Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         App.tsx (Routes)                        │
├─────────────────────────────────────────────────────────────────┤
│  /org/:orgSlug/events/:eventSlug/scanner  →  Scanner.tsx       │
│  /scan/m/:eventSlug                        →  MobileScanner.tsx │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────┐     ┌─────────────────────────────────┐
│     Scanner.tsx         │     │      MobileScanner.tsx          │
│  (Desktop Setup Page)   │     │    (Mobile Camera Page)         │
├─────────────────────────┤     ├─────────────────────────────────┤
│  - QR code generation   │     │  - Auth guard                   │
│  - URL display + copy   │     │  - useQrScanner hook            │
│  - Stats polling        │     │  - Scan result overlays         │
│  - Instructions (NL)    │     │  - Manual token fallback        │
└─────────────────────────┘     │  - Stats display                │
                                └─────────────────────────────────┘
                                           │
                                           ▼
                                ┌─────────────────────────────────┐
                                │      useQrScanner.ts            │
                                │    (Custom Hook)                │
                                ├─────────────────────────────────┤
                                │  - html5-qrcode wrapper         │
                                │  - Camera permission handling   │
                                │  - 2s debounce                  │
                                │  - Camera switching             │
                                └─────────────────────────────────┘
                                           │
                                           ▼
                                ┌─────────────────────────────────┐
                                │      device-id.ts               │
                                │    (Utility)                    │
                                ├─────────────────────────────────┤
                                │  - Generate persistent ID       │
                                │  - localStorage persistence     │
                                └─────────────────────────────────┘
```

## File Structure

```
web/src/
├── lib/
│   └── device-id.ts              # NEW: Device ID for rate limiting
├── hooks/
│   └── useQrScanner.ts           # NEW: html5-qrcode wrapper hook
├── pages/
│   ├── events/
│   │   └── Scanner.tsx           # NEW: Scanner setup page (sidebar)
│   └── MobileScanner.tsx         # NEW: Mobile camera scanner
├── App.tsx                       # MODIFY: Add routes
└── EventDetail.tsx               # MODIFY: Add sidebar item
```

## Interfaces

### EventDetailContext (existing pattern)
```typescript
type EventDetailContext = {
    event: AppEvent;
    org: { id: string; slug: string };
    refreshEvent: () => void;
};
```

### useQrScanner Hook
```typescript
interface UseQrScannerOptions {
    onScan: (token: string) => void;
    onError?: (error: string) => void;
    debounceMs?: number;  // default: 2000
}

interface UseQrScannerResult {
    isScanning: boolean;
    error: string | null;
    cameraId: string | null;
    cameras: { id: string; label: string }[];
    start: (cameraId?: string) => Promise<void>;
    stop: () => void;
    switchCamera: (cameraId: string) => void;
}

function useQrScanner(
    containerId: string,
    options: UseQrScannerOptions
): UseQrScannerResult;
```

### ScanResult (existing from ScanPage.tsx)
```typescript
interface ScanResult {
    result: string;  // VALID, INVALID, ALREADY_USED, etc.
    message?: string;
    ticket?: {
        id: string;
        type_name: string;
        participant_name: string | null;
        participant_email: string | null;
        checked_in_at: string;
    };
}
```

## UI Components

### Scanner.tsx (Desktop)
```
┌─────────────────────────────────────────────────────────────────┐
│  Scanner Setup                                                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────┐    Instructies                            │
│  │                 │    1. Open camera op je telefoon          │
│  │    QR CODE      │    2. Scan deze QR code                   │
│  │   (256x256)     │    3. Login indien nodig                  │
│  │                 │    4. Begin met scannen!                  │
│  └─────────────────┘                                            │
│                                                                 │
│  URL: coloss.nl/scan/m/{eventSlug}          [Copy]             │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│  Statistieken (10s polling)                                     │
│  ┌──────────────┬──────────────┬──────────────┐                │
│  │ Ingecheckt   │ Scans/uur    │ Fouten       │                │
│  │ 45/200 (22%) │ 23           │ 2            │                │
│  └──────────────┴──────────────┴──────────────┘                │
└─────────────────────────────────────────────────────────────────┘
```

### MobileScanner.tsx
```
┌─────────────────────────────┐
│  ← Terug    [Event Name]    │  Header (fixed)
├─────────────────────────────┤
│                             │
│  ┌───────────────────────┐  │
│  │                       │  │
│  │       CAMERA          │  │  Camera preview
│  │        VIEW           │  │  (fullscreen, 16:9)
│  │                       │  │
│  └───────────────────────┘  │
│                             │
│  [Wissel camera]            │  Camera toggle button
│                             │
├─────────────────────────────┤
│                             │
│  ┌───────────────────────┐  │  Result overlay
│  │  ✓ Geldig             │  │  (appears after scan)
│  │  Jan D*** - 10km Run  │  │
│  │  12:34                │  │
│  └───────────────────────┘  │
│                             │
├─────────────────────────────┤
│  Ingecheckt: 45 / 200       │  Stats bar (bottom)
└─────────────────────────────┘

Feedback Colors:
- Green (#22c55e): Valid scan
- Red (#ef4444): Invalid/error
- Yellow (#eab308): Already used
```

## Route Configuration

```typescript
// App.tsx routes

// Inside ProtectedRoute wrapper:
<Route path="/scan/m/:eventSlug" element={<MobileScanner />} />

// Inside EventDetail children:
<Route path="scanner" element={<Scanner />} />
```

## Sidebar Navigation

```typescript
// EventDetail.tsx - eventNavItems array
{ name: 'Scanner', href: 'scanner', icon: QrCode }
// Insert after 'Uitnodigingen', before 'Route'
```

## State Management

### Scanner.tsx
- `stats`: ScanStats | null - polling every 10 seconds
- `copied`: boolean - copy feedback

### MobileScanner.tsx
- `event`: Event data from slug lookup
- `scanResult`: Last scan result (VALID/INVALID/etc)
- `showResult`: Boolean to show/hide result overlay
- `processing`: Boolean during RPC call
- `stats`: ScanStats for bottom bar
- `manualMode`: Boolean for token input fallback

### useQrScanner
- `isScanning`: Camera active state
- `error`: Camera/permission error
- `cameras`: Available camera devices
- `cameraId`: Currently selected camera
- `lastScanTime`: For debouncing

## Security Considerations

1. **Auth Required**: MobileScanner requires authentication
2. **Rate Limiting**: Uses existing scan_ticket rate limiting
3. **Device ID**: Persistent ID for device-level rate limiting
4. **PII Masking**: Uses existing masked responses from scan_ticket

## Dependencies

```json
{
  "html5-qrcode": "^2.3.8",  // NEW
  "qrcode.react": "^4.2.0"  // EXISTING
}
```

## Error Handling

| Scenario | Handler |
|----------|---------|
| Not authenticated | Redirect to /login with return URL |
| Camera denied | Show manual token input |
| No camera found | Show manual token input |
| Network error | Show retry button |
| Rate limited | Show cooldown timer |

---

*Created: 2026-01-29*
