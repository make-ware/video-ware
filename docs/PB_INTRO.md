# PocketBase Introduction

This guide provides an overview of how PocketBase is used in this Next.js + PocketBase monorepo template.

## Overview

PocketBase is a lightweight backend-as-a-service that provides:
- **RESTful API** - Auto-generated APIs for all your collections
- **Authentication** - Built-in user management with multiple auth methods
- **Real-time** - WebSocket subscriptions for live data updates
- **File Storage** - Built-in file upload and management
- **Database** - SQLite database with automatic migrations
- **Admin UI** - Web-based dashboard for managing your data

## Architecture in This Project

This template uses PocketBase as a **standalone backend service** that runs alongside your Next.js application:

```
┌─────────────┐         ┌──────────────┐
│  Next.js    │ ──────> │  PocketBase  │
│  (Port 3000)│  HTTP   │  (Port 8090) │
└─────────────┘         └──────────────┘
```

### Client-Side Usage (Recommended)

The recommended approach is to use PocketBase **directly from the client-side** (browser). This means:
- Making API calls from React components using the PocketBase SDK
- Handling authentication in the browser
- Using real-time subscriptions for live updates

This is the simplest and most performant approach, as PocketBase was designed for this use case.

### Shared Package

This monorepo includes a `shared` workspace that provides:
- **Type-safe schemas** - Zod validation schemas for your collections
- **TypeScript types** - Auto-generated types from your PocketBase schema
- **PocketBase client** - Pre-configured client instance
- **Utility functions** - Helper functions for common operations

```typescript
// Example: Using the shared package
import { pb, auth, UserSchema } from 'shared';

// Type-safe authentication
await auth.signIn(email, password);

// Type-safe data fetching
const users = await pb.collection('users').getFullList();
const validated = users.map(user => UserSchema.parse(user));
```

## Server-Side Usage (Advanced)

For cases where you need server-side handling (webhooks, server-side validation, etc.), you can create a **superuser client** that runs only on the server:

```typescript
// lib/pocketbase-server.ts
import PocketBase from 'pocketbase';

const superuserClient = new PocketBase(process.env.POCKETBASE_URL);

// Disable autocancellation for server-side usage
superuserClient.autoCancellation(false);

// Authenticate as superuser (use environment variables)
await superuserClient.collection('_superusers').authWithPassword(
  process.env.PB_ADMIN_EMAIL!,
  process.env.PB_ADMIN_PASSWORD!,
  {
    autoRefreshThreshold: 30 * 60 // Auto-refresh 30 minutes before expiry
  }
);

export default superuserClient;
```

**Important:** Only use superuser clients on the server-side, never expose them to the client.

## Next.js SSR Considerations

While it's possible to use PocketBase with Next.js Server-Side Rendering (SSR), it comes with complications:

- **Security concerns** - Shared SDK instances in long-running server contexts
- **OAuth2 complexity** - Server-side OAuth flows require careful handling
- **Performance overhead** - Additional network hops (client → Next.js → PocketBase)
- **Realtime limitations** - WebSocket connections need special handling in SSR

For most use cases, we recommend using PocketBase **client-side only** and leveraging Next.js for static generation and client-side rendering.

## Documentation

This documentation covers the essential PocketBase concepts:

- **[Collections](./PB_COLLECTIONS.md)** - Understanding collection types and fields
- **[API Rules & Filters](./PB_FILTERS.md)** - Access control and data filtering
- **[Authentication](./PB_AUTH.md)** - User authentication methods
- **[File Uploads](./PB_UPLOADS.md)** - Handling file uploads and storage
- **[Relationships](./PB_RELATIONSHIPS.md)** - Working with related data
- **[Extending PocketBase](./PB_EXTENDING.md)** - Custom hooks and routes

## Getting Started

1. **Start PocketBase:**
   ```bash
   yarn pb:dev
   ```

2. **Create collections** via the Admin UI at http://localhost:8090/_/

3. **Use the shared package** in your Next.js app for type-safe interactions

4. **Set up API rules** to control access to your data

For more details, see the [main README](../../README.md) and other documentation files.