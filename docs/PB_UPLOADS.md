# File Uploads and Handling

To upload files, add a file field to your collection first.

## Uploading Files

Files are stored with the original filename (sanitized) and suffixed with a random part (usually 10 characters), e.g., `test_52iwbgds7l.png`.

Max file size: ~8GB (2^53-1 bytes).

### Using SDKs

```typescript
import PocketBase from 'pocketbase';

const pb = new PocketBase('http://127.0.0.1:8090');

// Create record with multiple files (files must be Blob or File instances)
const createdRecord = await pb.collection('example').create({
    title: 'Hello world!',
    'documents': [
        new File(['content 1...'], 'file1.txt'),
        new File(['content 2...'], 'file2.txt'),
    ]
});
```

### Using FormData

```typescript
const fileInput = document.getElementById('fileInput');
const formData = new FormData();

formData.append('title', 'Hello world!');

fileInput.addEventListener('change', function () {
    for (let file of fileInput.files) {
        formData.append('documents', file);
    }
});

const createdRecord = await pb.collection('example').create(formData);
```

### Adding Files to Existing Records

For file fields that support multiple files (Max Files >= 2), use the `+` prefix/suffix to add files:

```typescript
await pb.collection('example').update('RECORD_ID', {
    "documents+": new File(["content 3..."], "file3.txt")
});
```

## Deleting Files

Set the file field to an empty value or use the `-` modifier to delete specific files:

```typescript
// Delete all files in field
await pb.collection('example').update('RECORD_ID', {
    'documents': [],
});

// Delete specific files (by filename)
await pb.collection('example').update('RECORD_ID', {
    'documents-': ["file1.pdf", "file2.txt"],
});
```

When using FormData, set the file field to an empty string to delete all files.

## File URLs

Access uploaded files via:

```
http://127.0.0.1:8090/api/files/COLLECTION_ID_OR_NAME/RECORD_ID/FILENAME
```

### Image Thumbnails

If your file field has Thumb sizes configured, request thumbnails using the `thumb` query parameter:

```
http://127.0.0.1:8090/api/files/COLLECTION_ID_OR_NAME/RECORD_ID/FILENAME?thumb=100x300
```

**Supported formats:** jpg, png, gif (first frame), webp (stored as png)

**Thumb formats:**
- `WxH` (e.g., `100x300`) - Crop to WxH viewbox (from center)
- `WxHt` (e.g., `100x300t`) - Crop to WxH viewbox (from top)
- `WxHb` (e.g., `100x300b`) - Crop to WxH viewbox (from bottom)
- `WxHf` (e.g., `100x300f`) - Fit inside WxH viewbox (without cropping)
- `0xH` (e.g., `0x300`) - Resize to H height (preserve aspect ratio)
- `Wx0` (e.g., `100x0`) - Resize to W width (preserve aspect ratio)

The original file is returned if the requested thumb size doesn't exist or the file isn't an image.

### Using SDK Methods

```typescript
const record = await pb.collection('example').getOne('RECORD_ID');

// Get first filename (array if Max Files > 1, string if Max Files = 1)
const firstFilename = Array.isArray(record.documents) 
    ? record.documents[0] 
    : record.documents;

// Generate file URL with thumbnail
const url = pb.files.getURL(record, firstFilename, {'thumb': '100x250'});
```

### Download Files

Append `?download=1` to force download instead of preview:

```
http://127.0.0.1:8090/api/files/COLLECTION_ID_OR_NAME/RECORD_ID/FILENAME?download=1
```

## Protected Files

By default, all files are publicly accessible if you know the full URL (random filename suffix provides basic security).

For sensitive files (ID cards, contracts, etc.), mark the file field as **Protected** in the Dashboard field options.

**Access Control:** Only requests that satisfy the View API rule of the record collection can access protected files.

```typescript
// Authenticate first
await pb.collection('users').authWithPassword('test@example.com', '1234567890');

// Generate a file token (valid ~2 minutes)
const fileToken = await pb.files.getToken();

// Get protected file URL
const record = await pb.collection('example').getOne('RECORD_ID');
const url = pb.files.getURL(record, record.myPrivateFile, {'token': fileToken});
```

## Storage Options

By default, files are stored in `pb_data/storage` on the local filesystem (recommended for most cases).

For limited disk space, you can switch to S3-compatible storage (AWS S3, MinIO, Wasabi, DigitalOcean Spaces, Vultr Object Storage, etc.) via:

**Dashboard > Settings > Files storage**
