# PocketBase Realtime Subscriptions

## Overview

PocketBase provides real-time updates via **Server-Sent Events (SSE)**. You can subscribe to changes in individual records or entire collections to receive live updates when data is created, updated, or deleted.

## How It Works

The Realtime API consists of two main operations:

1. **Establish SSE connection** - Creates a persistent connection to the server
2. **Submit client subscriptions** - Registers which records/collections to monitor

Events are automatically sent for:
- `create` - New records added
- `update` - Existing records modified
- `delete` - Records removed

### Access Control

- **Single record subscriptions**: Use the collection's `ViewRule` to determine access
- **Collection subscriptions**: Use the collection's `ListRule` to determine access

If a user doesn't have permission, they won't receive events for that data.

## Using Mutators (Recommended)

The shared package provides type-safe mutators with built-in subscription methods:

```typescript
import { createTodoMutator } from '@project/shared';

const todoMutator = createTodoMutator(pb);

// Subscribe to a specific record
const unsubscribe = await todoMutator.subscribeToRecord(
  'RECORD_ID',
  (data) => {
    console.log('Action:', data.action); // 'create', 'update', or 'delete'
    console.log('Record:', data.record);
  }
);

// Subscribe to all records in the collection
const unsubscribeAll = await todoMutator.subscribeToCollection(
  (data) => {
    console.log('Change detected:', data.action, data.record);
  }
);

// Unsubscribe when done
unsubscribe();
unsubscribeAll();
```

### With Expand Parameters

You can include related data in real-time updates:

```typescript
const unsubscribe = await todoMutator.subscribeToRecord(
  'RECORD_ID',
  (data) => {
    console.log('Record with relations:', data.record);
  },
  ['user', 'category'] // Expand related fields
);
```

## Direct PocketBase SDK Usage

You can also use the PocketBase SDK directly:

```typescript
import pb from '@/lib/pocketbase';

// Subscribe to a specific record
pb.collection('todos').subscribe('RECORD_ID', (e) => {
    console.log(e.action);
    console.log(e.record);
});

// Subscribe to all records in a collection
pb.collection('todos').subscribe('*', (e) => {
    console.log(e.action);
    console.log(e.record);
}, {
  expand: 'user', // Optional expand parameters
  headers: { 'x-custom': 'value' } // Optional custom headers
});

// Unsubscribe
pb.collection('todos').unsubscribe('RECORD_ID'); // Remove specific subscription
pb.collection('todos').unsubscribe('*'); // Remove all collection subscriptions
pb.collection('todos').unsubscribe(); // Remove all subscriptions in collection
```

## React Hook Pattern

For React components, create a custom hook to manage subscriptions:

```typescript
'use client';

import { useEffect, useRef } from 'react';
import { createTodoMutator } from '@project/shared';
import pb from '@/lib/pocketbase';
import type { RecordSubscription } from 'pocketbase';

export function useTodoSubscription(
  todoId: string | null,
  onUpdate: (data: RecordSubscription<any>) => void
) {
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!todoId) return;

    const todoMutator = createTodoMutator(pb);
    
    todoMutator.subscribeToRecord(todoId, onUpdate).then((unsubscribe) => {
      unsubscribeRef.current = unsubscribe;
    });

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [todoId, onUpdate]);
}

// Usage in component
function TodoView({ todoId }: { todoId: string }) {
  const [todo, setTodo] = useState(null);

  useTodoSubscription(todoId, (data) => {
    if (data.action === 'update') {
      setTodo(data.record);
    } else if (data.action === 'delete') {
      // Handle deletion
      router.push('/todos');
    }
  });

  return <div>{/* Render todo */}</div>;
}
```

## Collection-Wide Subscriptions

For live feeds or dashboards:

```typescript
'use client';

import { useEffect, useRef } from 'react';
import { createTodoMutator } from '@project/shared';
import pb from '@/lib/pocketbase';

export function useTodoFeed(onUpdate: (data: RecordSubscription<any>) => void) {
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const todoMutator = createTodoMutator(pb);
    
    todoMutator.subscribeToCollection(onUpdate).then((unsubscribe) => {
      unsubscribeRef.current = unsubscribe;
    });

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [onUpdate]);
}

// Usage
function TodoList() {
  const [todos, setTodos] = useState([]);

  useTodoFeed((data) => {
    if (data.action === 'create') {
      setTodos((prev) => [...prev, data.record]);
    } else if (data.action === 'update') {
      setTodos((prev) =>
        prev.map((todo) =>
          todo.id === data.record.id ? data.record : todo
        )
      );
    } else if (data.action === 'delete') {
      setTodos((prev) => prev.filter((todo) => todo.id !== data.record.id));
    }
  });

  return <div>{/* Render todos */}</div>;
}
```

## Connection Management

### Automatic Reconnection

PocketBase automatically reconnects if the connection is lost (e.g., network interruption). The SDK handles this transparently.

### Connection Timeout

If a client doesn't receive any messages for **5 minutes**, the server will send a disconnect signal to prevent forgotten/leaked connections. The connection will automatically reestablish if the client is still active (e.g., browser tab is open).

### Authentication

**Important:** User/superuser authorization happens during the first subscription call. Make sure you're authenticated before subscribing:

```typescript
// Authenticate first
await pb.collection('users').authWithPassword(email, password);

// Then subscribe (subscription will use authenticated user's permissions)
await todoMutator.subscribeToCollection((data) => {
  // Only receives events for records the user has access to
});
```

## API Endpoints

### GET `/api/realtime`

Establishes a new SSE connection and immediately sends a `PB_CONNECT` SSE event with the created client ID.

### POST `/api/realtime`

Sets new active client subscriptions (and auto unsubscribes from previous ones).

**Body Parameters:**

- `clientId` (required, string) - ID of the SSE client connection
- `subscriptions` (optional, array) - New client subscriptions in format:
  - `COLLECTION_ID_OR_NAME` - Subscribe to entire collection
  - `COLLECTION_ID_OR_NAME/RECORD_ID` - Subscribe to specific record

**Advanced Options:**

You can attach optional query and header parameters as serialized JSON:

```
todos/RECORD_ID?options={"query": {"expand": "user"}, "headers": {"x-token": "..."}}
```

Leave `subscriptions` empty to unsubscribe from everything.

**Authorization:**

If `Authorization` header is set, will authorize the client SSE connection with the associated user or superuser.

## Best Practices

1. **Always unsubscribe** - Clean up subscriptions in React `useEffect` cleanup functions
2. **Handle errors** - Wrap subscriptions in try-catch blocks
3. **Use mutators** - Prefer the shared mutator methods for type safety
4. **Authenticate first** - Ensure user is authenticated before subscribing
5. **Limit subscriptions** - Don't subscribe to more collections than necessary
6. **Test permissions** - Verify API rules allow the user to receive events

## Example: Complete Todo Component

```typescript
'use client';

import { useEffect, useState, useRef } from 'react';
import { createTodoMutator } from '@project/shared';
import pb from '@/lib/pocketbase';
import type { RecordSubscription } from 'pocketbase';
import type { Todo } from '@project/shared/types';

export function TodoComponent({ todoId }: { todoId: string }) {
  const [todo, setTodo] = useState<Todo | null>(null);
  const [loading, setLoading] = useState(true);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const todoMutator = createTodoMutator(pb);

    // Fetch initial data
    todoMutator.getOne(todoId).then(setTodo).finally(() => setLoading(false));

    // Subscribe to real-time updates
    todoMutator
      .subscribeToRecord(todoId, (data: RecordSubscription<Todo>) => {
        if (data.action === 'update') {
          setTodo(data.record);
        } else if (data.action === 'delete') {
          setTodo(null);
          // Optionally redirect or show message
        }
      })
      .then((unsubscribe) => {
        unsubscribeRef.current = unsubscribe;
      })
      .catch((error) => {
        console.error('Subscription error:', error);
      });

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [todoId]);

  if (loading) return <div>Loading...</div>;
  if (!todo) return <div>Todo not found</div>;

  return <div>{/* Render todo */}</div>;
}
```

## Related Documentation

- **[Collections](./PB_COLLECTIONS.md)** - Understanding collection structure
- **[API Rules & Filters](./PB_FILTERS.md)** - Access control for subscriptions
- **[Authentication](./PB_AUTH.md)** - User authentication required for subscriptions
- **[SSR Considerations](./PB_SSR.md)** - Realtime limitations with server-side rendering
