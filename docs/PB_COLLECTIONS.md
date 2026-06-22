# PocketBase Collections

Collections represent your application data. They are backed by SQLite tables that are automatically generated with the collection name and fields (columns).

A single entry in a collection is called a **record** (a row in the SQL table).

Collections can be managed from:
- The Dashboard
- Web APIs using client-side SDKs (superusers only)
- Programmatically via Go/JavaScript migrations

Records can be managed similarly through the Dashboard, Web APIs, or programmatic Record operations.

## Collection Types

There are 3 collection types:

### Base Collection

The default collection type for storing any application data (articles, products, posts, etc.).

### View Collection

A read-only collection where data is populated from a SQL SELECT statement. Useful for aggregations and custom queries.

**Example:**

```sql
SELECT
    posts.id,
    posts.name,
    count(comments.id) as totalComments
FROM posts
LEFT JOIN comments on comments.postId = posts.id
GROUP BY posts.id
```

**Note:** View collections don't receive realtime events since they don't support create/update/delete operations.

### Auth Collection

Extends Base collection with special system fields for user management and authentication:

- `email`
- `emailVisibility`
- `verified`
- `password`
- `tokenKey`

These fields cannot be renamed or deleted but can be configured (e.g., make email required or optional).

You can have multiple Auth collections (users, managers, staff, members, clients, etc.), each with their own fields and separate login/managing endpoints.

## Access Control Patterns

### Role-Based (Group)

Add a "role" select field to your Auth collection, then use it in API rules:

```javascript
@request.auth.role = "staff"  // Only staff can access
```

### Relation-Based (Ownership)

Create a relation field pointing to your Auth collection:

```javascript
// In "posts" collection, create "author" relation field pointing to "users"
// Rule: Only the author can access their posts
@request.auth.id != "" && author = @request.auth.id

// Nested relation lookups are supported
someRelField.anotherRelField.author = @request.auth.id
```

### Managed

Auth collections have a special `manageRule` that allows one user to fully manage another user's data (including email, password, etc.). The managing user can be from a different collection.

### Mixed

Combine multiple patterns using parentheses and logical operators:

```javascript
@request.auth.id != "" && (@request.auth.role = "staff" || author = @request.auth.id)
```

## Field Notes

- All fields (except JSON) are non-nullable and use zero-defaults when missing:
  - Text fields: empty string
  - Number fields: 0
  - etc.
- All field-specific modifiers are supported in both Web APIs and record Get/Set methods.
