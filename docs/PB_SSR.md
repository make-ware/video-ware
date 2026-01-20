# PocketBase with Next.js SSR

**Recommendation:** Use PocketBase **client-side only** for most use cases. SSR adds complexity and potential security issues.

## Quick Summary

When using PocketBase with Next.js Server-Side Rendering, you have three options:

1. **Client-side only** (recommended) - Browser → PocketBase
2. **Server-side only** - Browser → Next.js → PocketBase  
3. **Mixed** - Both client and server access

Most problems occur with options 2 and 3 when using long-running server processes.

## Common Problems & Solutions

### 1. Security: Shared SDK Instance

**Problem:** Sharing a single PocketBase SDK instance across server requests creates a security vulnerability. Different users' auth states will overwrite each other.

**❌ Unsafe:**
```typescript
// lib/pocketbase.ts
import PocketBase from 'pocketbase';
const pb = new PocketBase('http://localhost:8090');
export default pb; // DANGEROUS - shared across requests
```

**✅ Safe Solutions:**

**Option A: Per-request instance (for user auth)**
```typescript
// lib/pocketbase-server.ts
import PocketBase from 'pocketbase';

export function createPocketBaseClient() {
  // Create a new instance for each request
  return new PocketBase(process.env.POCKETBASE_URL);
}

// In your server action/route handler
import { createPocketBaseClient } from '@/lib/pocketbase-server';

export async function serverAction() {
  const pb = createPocketBaseClient();
  // Use pb for this request only
}
```

**Option B: Superuser client (for admin operations)**
```typescript
// lib/pocketbase-admin.ts
import PocketBase from 'pocketbase';

const adminClient = new PocketBase(process.env.POCKETBASE_URL);
adminClient.autoCancellation(false);

// Authenticate once as superuser
await adminClient.collection('_superusers').authWithPassword(
  process.env.PB_ADMIN_EMAIL!,
  process.env.PB_ADMIN_PASSWORD!,
  { autoRefreshThreshold: 30 * 60 }
);

export default adminClient; // Safe - no user auth state
```

### 2. OAuth2 Integration

**Problem:** PocketBase's OAuth2 flow requires a browser window and realtime connection, which doesn't work in server-only contexts.

**Solution:** Use OAuth2 **client-side only**, then sync auth state via cookies:

```typescript
// Client-side
const authData = await pb.collection('users').authWithOAuth2({ provider: 'google' });
document.cookie = pb.authStore.exportToCookie();

// Server-side: Read cookie and create per-request client
```

### 3. Mixed Client/Server Access

**Problem:** Need to sync auth state between browser and server.

**Solution:** Use cookies with `httpOnly: false` (requires CSP protection):

```typescript
// Client: Export auth to cookie
pb.authStore.exportToCookie({ httpOnly: false });

// Server: Read cookie and create per-request client with auth
```

### 4. Next.js Fetch Caching

**Problem:** Next.js has non-standard fetch with caching enabled by default, which can cause stale data.

**Solution:** Pass custom fetch to disable caching:

```typescript
await pb.collection('example').getList(1, 30, {
  fetch: (url, options) => fetch(url, { ...options, cache: 'no-store' })
});
```

### 5. Realtime Subscriptions

**Problem:** Realtime connections require proxying through your Next.js server if PocketBase isn't directly accessible.

**Solution:** Use client-side realtime subscriptions directly, or implement proper SSE proxying with buffering disabled.

### 6. Performance

**Problem:** Proxying all requests through Node.js adds latency and requires additional infrastructure.

**Solution:** Use client-side access when possible. For server-side operations, use superuser client only for admin tasks.

## Best Practices

1. **Prefer client-side** - Use PocketBase SDK directly in React components
2. **Use superuser client for server actions** - Only for admin operations (webhooks, validations)
3. **Create per-request instances** - If you must use user auth on server, create new instances per request
4. **Avoid shared instances** - Never share a PocketBase client with user auth state across requests
5. **Test with concurrent users** - Security issues only appear with multiple simultaneous requests

## When to Use SSR

Consider SSR only if you need:
- SEO for public pages (use static generation instead)
- Server-side data validation (use superuser client)
- Payment webhooks (use superuser client)

For most cases, **client-side rendering is simpler and more performant**.

## Reference

- [PocketBase Authentication Docs](./PB_AUTH.md)
- [PocketBase Introduction](./PB_INTRO.md)
- Original discussion: [GitHub Issue #5313](https://github.com/pocketbase/pocketbase/discussions/5313)
