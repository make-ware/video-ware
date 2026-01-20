# Working with Relations

Relation fields work like any other collection field—set them by updating the field value with a record ID (or array of IDs for multiple relations).

## Creating Records with Relations

```typescript
import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

// Create a post with 2 tags
const post = await pb.collection('posts').create({
    'title': 'Lorem ipsum...',
    'tags': ['TAG_ID1', 'TAG_ID2'],
});
```

## Prepending/Appending Relations

Use the `+` modifier to add relations to existing values:

```typescript
const post = await pb.collection('posts').update('POST_ID', {
    // Prepend single tag
    '+tags': 'TAG_ID1',

    // Append multiple tags
    'tags+': ['TAG_ID1', 'TAG_ID2'],
});
```

## Removing Relations

Use the `-` modifier to remove relations:

```typescript
const post = await pb.collection('posts').update('POST_ID', {
    // Remove single tag
    'tags-': 'TAG_ID1',

    // Remove multiple tags
    'tags-': ['TAG_ID1', 'TAG_ID2'],
});
```

## Expanding Relations

Expand relation fields in the response using the `expand` query parameter:

```typescript
// Expand single relation
await pb.collection("comments").getList(1, 30, { expand: "user" })

// Expand nested relations (dot notation, up to 6 levels)
await pb.collection("comments").getList(1, 30, { expand: "user,post.tags" })
```

**Note:** Only relations that satisfy the relation collection's View API Rule will be expanded.

**Example Response:**

```javascript
{
    "page": 1,
    "perPage": 30,
    "totalPages": 1,
    "totalItems": 20,
    "items": [
        {
            "id": "lmPJt4Z9CkLW36z",
            "post": "Wy Aw4bDrvws6gGl",
            "user": "FtHAW9feB5rze7D",
            "message": "Example message...",
            "expand": {
                "user": {
                    "id": "FtHAW9feB5rze7D",
                    "collectionName": "users",
                    "username": "users54126",
                    "name": "John Doe"
                }
            }
        }
    ]
}
```

## Back-Relations

Back-relations allow filtering/expanding on relations where the relation field is in a different collection. Use the notation: `referenceCollection_via_relField`.

**Example:** List posts that have at least one comment containing "hello":

```typescript
await pb.collection("posts").getList(1, 30, {
    filter: "comments_via_post.message ?~ 'hello'",
    expand: "comments_via_post.user",
})
```

**Example Response:**

```javascript
{
    "items": [
        {
            "id": "WyAw4bDrvws6gGl",
            "title": "Lorem ipsum dolor sit...",
            "expand": {
                "comments_via_post": [
                    {
                        "id": "lmPJt4Z9CkLW36z",
                        "message": "hello...",
                        "expand": {
                            "user": {
                                "id": "FtHAW9feB5rze7D",
                                "name": "John Doe"
                            }
                        }
                    }
                ]
            }
        }
    ]
}
```

### Back-Relation Notes

- By default, back-relations are resolved as multiple relations (arrays), even if the original relation field is single. This is because one record can have multiple back-related records.
- Back-relations are treated as single relations only when there's a UNIQUE index on the relation field.
- Back-relation expand is limited to 1000 records per relation field. For larger datasets, use a separate paginated `getList()` request instead.
