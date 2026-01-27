# Auth Implementation Guide & Checklist

## 1. Supabase Dashboard Configuration

### Authentication Providers
- [ ] Go to **Authentication > Providers**
- [ ] Enable **Email**
  - [ ] Ensure "Enable Magic Link" is checked
  - [ ] (Optional) Ensure "Enable Email Signup" is checked if you want password signups
- [ ] Enable **Google**
  - [ ] Client ID: (From Google Cloud Console)
  - [ ] Client Secret: (From Google Cloud Console)
  - [ ] Authorized Redirect URI (in Google Console): `https://<your-project-ref>.supabase.co/auth/v1/callback`

### URL Configuration
- [ ] Go to **Authentication > URL Configuration**
- [ ] **Site URL**: Set to your production URL (e.g., `https://organizer-os.vercel.app`)
- [ ] **Redirect URLs**: Add the following (including localhost for dev):
  - `http://localhost:5173/auth/callback` (Organizer OS Web)
  - `http://localhost:5174/auth/callback` (Phone UI)
  - `https://<your-web-domain>/auth/callback`
  - `https://<your-phone-ui-domain>/auth/callback`

### Email Templates
- [ ] Go to **Authentication > Email Templates**
- [ ] Customize **Magic Link** template to match your branding.

## 2. Environment Variables

Ensure both apps have the correct `.env` variables:

**web/.env**
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

**phone_ui/.env**
```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

## 3. Testing Steps

### Organizer OS (Web)
1.  Navigate to `http://localhost:5173`.
2.  You should be redirected to `/login`.
3.  **Test Google Login**: Click "Continue with Google". Should redirect to Google, then back to `/auth/callback`, then to `/org/demo/events`.
4.  **Test Magic Link**: Enter email, click "Send Magic Link". Click link in email (or copy link from Supabase logs if local). Should redirect to `/auth/callback` then dashboard.
5.  **Test Logout**: Use the Auth Debug panel (bottom right) to verify session status. (Implement logout button in UI if not present).
6.  **Test Protection**: Try to access `/org/demo/events` directly in incognito. Should redirect to login.

### End-user App (Phone UI)
1.  Navigate to `http://localhost:5174`.
2.  Go to "Tickets" tab. Should redirect to `/login`.
3.  **Test Google Login**: Click "Continue with Google".
4.  **Test Magic Link**: Enter email, click "Send Magic Link".
5.  **Test Redirect**: After login, should redirect back to "Tickets" (or wherever you came from).

## 4. Debugging

- Use the **Auth Debug** panel in the bottom right corner (only visible in `DEV` mode).
- Check the browser console for `[Auth]` logs.
- Verify `localStorage` has `coloss-auth` (web) or `coloss-phone-auth` (phone_ui) keys.
