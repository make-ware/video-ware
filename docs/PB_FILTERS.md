# API Rules and Filters

API Rules control collection access and act as data filters. Rules are evaluated per-request and can filter records based on conditions.

## API Rules

Each collection has 5 rules corresponding to API actions:

- `listRule` - Controls listing records
- `viewRule` - Controls viewing a single record
- `createRule` - Controls creating records
- `updateRule` - Controls updating records
- `deleteRule` - Controls deleting records

Auth collections have an additional `manageRule` to allow one user to fully manage another user's data.

### Rule Values

- **`null` (locked)** - Only authorized superusers can perform the action (default)
- **Empty string** - Anyone can perform the action (superusers, authenticated users, and guests)
- **Non-empty string** - Only users satisfying the filter expression can perform the action

### Important Notes

- API Rules act as record filters. For example, `status = "active"` only returns active records.
- Superusers ignore all API rules (they can access everything).
- HTTP responses: 200 empty items (listRule), 400 (createRule), 404 (viewRule/updateRule/deleteRule), 403 (locked rule, non-superuser).

## Filter Syntax

Syntax format: `OPERAND OPERATOR OPERAND`

### Operators

| Operator | Description |
|----------|-------------|
| `=`, `!=` | Equal, Not equal |
| `>`, `>=`, `<`, `<=` | Comparison |
| `~`, `!~` | Like/Contains (auto-wraps string in `%` for wildcard) |
| `?=`, `?!=`, `?>`, `?>=`, `?<`, `?<=`, `?~`, `?!~` | Any/At least one of (for arrays) |

Group expressions with `()`, `&&` (AND), and `||` (OR). Single-line comments are supported: `// comment`

### Available Fields

1. **Collection schema fields** - All fields including nested relation fields (e.g., `someRelField.status != "pending"`)
2. **`@request.*`** - Request data:
   - `@request.context` - Context: `default`, `oauth2`, `otp`, `password`, `realtime`, `protectedFile`
   - `@request.method` - HTTP method (e.g., `@request.method = "GET"`)
   - `@request.headers.*` - Request headers (normalized to lowercase, `-` replaced with `_`)
   - `@request.query.*` - Query parameters
   - `@request.auth.*` - Authenticated user (e.g., `@request.auth.id != ""`)
   - `@request.body.*` - Request body parameters (uploaded files are evaluated separately)
3. **`@collection.*`** - Query other collections that share a common field:
   ```javascript
   @collection.news.categoryId ?= categoryId && @collection.news.author ?= @request.auth.id
   ```
   Use `:alias` suffix to join the same collection multiple times:
   ```javascript
   @collection.courseRegistrations:auth.user ?= @request.auth.id
   ```

## DateTime Macros

All macros are UTC-based:

- `@now` - Current datetime
- `@second`, `@minute`, `@hour`, `@weekday`, `@day`, `@month`, `@year` - Time components
- `@yesterday`, `@tomorrow` - Relative dates
- `@todayStart`, `@todayEnd` - Day boundaries
- `@monthStart`, `@monthEnd` - Month boundaries
- `@yearStart`, `@yearEnd` - Year boundaries

Example: `@request.body.publicDate >= @now`

## Field Modifiers

### `:isset`

Check if a field was submitted (only for `@request.*` fields):

```javascript
@request.body.role:isset = false  // Disallow submitting "role" field
```

Note: Doesn't support uploaded files (they're evaluated separately).

### `:changed`

Check if a field was submitted AND changed (only for `@request.body.*` fields):

```javascript
@request.body.role:changed = false  // Disallow changing "role" field
// Equivalent to: (@request.body.role:isset = false || @request.body.role = role)
```

Note: Doesn't support uploaded files.

### `:length`

Check the number of items in an array field (multiple file, select, relation):

```javascript
@request.body.someSelectField:length > 1  // Submitted data
someRelationField:length = 2  // Existing record field
```

Note: Doesn't support uploaded files.

### `:each`

Apply condition to each item in a multiple select/file/relation field:

```javascript
@request.body.someSelectField:each ~ "create"  // All items contain "create"
someSelectField:each ~ "pb_%"  // All items have "pb_" prefix
```

Note: Doesn't support uploaded files.

### `:lower`

Perform case-insensitive string comparisons:

```javascript
@request.body.title:lower = "test"  // Matches "Test", "tEsT", etc.
title:lower ~ "test"
```

Uses SQLite LOWER function (ASCII only unless ICU extension is loaded).

## Geographic Distance

`geoDistance(lonA, latA, lonB, latB)` calculates Haversine distance in kilometers. Primarily for `geoPoint` fields but accepts any numeric values.

```javascript
// Offices less than 25km from location (address is geoPoint field)
geoDistance(address.lon, address.lat, 23.32, 42.69) < 25
```

Note: Always results in a single value (any/at-least-one constraint applied for multiple relations).

## Examples

```javascript
// Only registered users
@request.auth.id != ""

// Registered users, active or pending records only
@request.auth.id != "" && (status = "active" || status = "pending")

// Registered users listed in allowed_users relation
@request.auth.id != "" && allowed_users.id ?= @request.auth.id

// Anyone, records where title starts with "Lorem"
title ~ "Lorem%"
```
