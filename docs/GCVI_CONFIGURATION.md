# Google Cloud Video Intelligence (GCVI) Configuration Guide

## Overview

Video Ware integrates with Google Cloud Video Intelligence API to provide AI-powered video analysis capabilities. The system supports five separate GCVI processors, each making independent API calls with specific features. This modular architecture allows for granular cost control and feature enablement.

## Processor Architecture

### Five Independent Processors

The GCVI integration is split into five separate processors, each handling a specific type of video analysis:

1. **Label Detection** - Detects objects, activities, locations, and shot changes
2. **Object Tracking** - Tracks objects across frames with bounding boxes
3. **Face Detection** - Detects and tracks faces with attributes
4. **Person Detection** - Detects and tracks persons with pose landmarks
5. **Speech Transcription** - Transcribes speech to text with timestamps

Each processor can be independently enabled or disabled via environment variables, allowing you to control costs and only run the analyses you need.

### Workflow Architecture

```
Parent Processor (DetectLabelsParentProcessor)
    ↓
    ├─► UPLOAD_TO_GCS (prerequisite)
    ↓
    ├─► LABEL_DETECTION (if enabled)
    │   ├─► Call GCVI API
    │   ├─► Cache response
    │   └─► Normalize and store results
    │
    ├─► OBJECT_TRACKING (if enabled)
    │   ├─► Call GCVI API
    │   ├─► Cache response
    │   └─► Normalize and store results
    │
    ├─► FACE_DETECTION (if enabled)
    │   ├─► Call GCVI API
    │   ├─► Cache response
    │   └─► Normalize and store results
    │
    ├─► PERSON_DETECTION (if enabled)
    │   ├─► Call GCVI API
    │   ├─► Cache response
    │   └─► Normalize and store results
    │
    └─► SPEECH_TRANSCRIPTION (if enabled)
        ├─► Call GCVI API
        ├─► Cache response
        └─► Normalize and store results
```

All enabled processors run in parallel after the GCS upload completes. The workflow succeeds if at least one processor completes successfully (partial success is allowed).

## Configuration

### Environment Variables

Configure GCVI processors in your `.env` file:

```bash
# ============================================================================
# GCVI Processor Configuration
# ============================================================================

# Processor Enablement Flags
# ---------------------------
ENABLE_LABEL_DETECTION=true          # Default: true
ENABLE_OBJECT_TRACKING=false         # Default: false
ENABLE_FACE_DETECTION=false          # Default: false
ENABLE_PERSON_DETECTION=false        # Default: false
ENABLE_SPEECH_TRANSCRIPTION=true     # Default: true

# Google Cloud Credentials
# ------------------------
GOOGLE_PROJECT_ID=your-gcp-project-id
GOOGLE_CLOUD_CREDENTIALS={"type":"service_account",...}
# OR
GOOGLE_CLOUD_KEY_FILE=/path/to/service-account-key.json

# GCS Bucket (required for temporary uploads)
GCS_BUCKET=your-gcs-bucket-name

# Processing Configuration
# ------------------------
LABEL_DETECTION_CONFIDENCE_THRESHOLD=0.2
OBJECT_TRACKING_CONFIDENCE_THRESHOLD=0.5
FACE_DETECTION_CONFIDENCE_THRESHOLD=0.7
PERSON_DETECTION_CONFIDENCE_THRESHOLD=0.7

LABEL_DETECTION_MODE=SHOT_MODE
SPEECH_TRANSCRIPTION_LANGUAGE=en-US
SPEECH_TRANSCRIPTION_ENABLE_PUNCTUATION=true

FACE_DETECTION_INCLUDE_BOUNDING_BOXES=true
FACE_DETECTION_INCLUDE_ATTRIBUTES=true

PERSON_DETECTION_INCLUDE_BOUNDING_BOXES=true
PERSON_DETECTION_INCLUDE_POSE_LANDMARKS=true
PERSON_DETECTION_INCLUDE_ATTRIBUTES=true
```

### Default Configuration

By default, only **Label Detection** and **Speech Transcription** are enabled. This provides basic content categorization and transcription while minimizing costs.

To enable additional processors, set their corresponding environment variables to `true`.

## Processor Details

### 1. Label Detection

**API Features:** `LABEL_DETECTION`, `SHOT_CHANGE_DETECTION`

**Use Cases:**
- Content categorization and tagging
- Scene detection and segmentation
- Activity recognition
- Location identification

**Cost:** ~$0.01 per minute of video

**Configuration:**
```bash
ENABLE_LABEL_DETECTION=true
LABEL_DETECTION_CONFIDENCE_THRESHOLD=0.2
LABEL_DETECTION_MODE=SHOT_MODE  # or SHOT_AND_FRAME_MODE
```

**Output:**
- **LabelEntity**: Catalog of detected labels (e.g., "Car", "Building", "Beach")
- **LabelClip**: Time-bounded segments where labels appear
- **Shot boundaries**: Detected scene changes

**Modes:**
- `SHOT_MODE`: Detect labels at shot level only (faster, cheaper)
- `SHOT_AND_FRAME_MODE`: Detect labels at both shot and frame level (more detailed, more expensive)

### 2. Object Tracking

**API Features:** `OBJECT_TRACKING`

**Use Cases:**
- Object movement analysis
- Security footage analysis
- Sports analytics
- Traffic monitoring

**Cost:** ~$0.025 per minute of video

**Configuration:**
```bash
ENABLE_OBJECT_TRACKING=false  # Disabled by default
OBJECT_TRACKING_CONFIDENCE_THRESHOLD=0.5
```

**Output:**
- **LabelEntity**: Catalog of tracked object types (e.g., "Car", "Person")
- **LabelTrack**: Continuous tracks with keyframes and bounding boxes
- **LabelClip**: Significant object appearances

**Data Stored:**
- Bounding boxes (normalized 0-1 coordinates)
- Confidence scores per frame
- Track IDs for continuous tracking
- Keyframe data for efficient storage

### 3. Face Detection

**API Features:** `FACE_DETECTION`

**Use Cases:**
- Face presence detection
- Crowd analysis
- Audience engagement metrics
- Privacy compliance (face blurring)

**Cost:** ~$0.025 per minute of video

**Configuration:**
```bash
ENABLE_FACE_DETECTION=false  # Disabled by default
FACE_DETECTION_CONFIDENCE_THRESHOLD=0.7
FACE_DETECTION_INCLUDE_BOUNDING_BOXES=true
FACE_DETECTION_INCLUDE_ATTRIBUTES=true
```

**Output:**
- **LabelEntity**: Face entities
- **LabelTrack**: Face tracks with keyframes and attributes
- **LabelClip**: Significant face appearances

**Attributes Detected:**
- Headwear (hat, helmet, etc.)
- Glasses (sunglasses, eyeglasses)
- Looking at camera (boolean)

**Note:** This processor detects face presence and attributes but does NOT perform face recognition or identification.

### 4. Person Detection

**API Features:** `PERSON_DETECTION`

**Use Cases:**
- Person tracking and counting
- Activity recognition
- Pose analysis
- Clothing color detection

**Cost:** ~$0.025 per minute of video

**Configuration:**
```bash
ENABLE_PERSON_DETECTION=false  # Disabled by default
PERSON_DETECTION_CONFIDENCE_THRESHOLD=0.7
PERSON_DETECTION_INCLUDE_BOUNDING_BOXES=true
PERSON_DETECTION_INCLUDE_POSE_LANDMARKS=true
PERSON_DETECTION_INCLUDE_ATTRIBUTES=true
```

**Output:**
- **LabelEntity**: Person entities
- **LabelTrack**: Person tracks with keyframes, landmarks, and attributes
- **LabelClip**: Significant person appearances

**Attributes Detected:**
- Upper clothing color
- Lower clothing color

**Landmarks Detected:**
- Body keypoints (nose, eyes, shoulders, elbows, wrists, hips, knees, ankles)
- 3D position coordinates
- Confidence scores per landmark

### 5. Speech Transcription

**API Features:** `SPEECH_TRANSCRIPTION`

**Use Cases:**
- Subtitle generation
- Content search and indexing
- Accessibility compliance
- Keyword extraction

**Cost:** ~$0.024 per minute of video

**Configuration:**
```bash
ENABLE_SPEECH_TRANSCRIPTION=true
SPEECH_TRANSCRIPTION_LANGUAGE=en-US
SPEECH_TRANSCRIPTION_ENABLE_PUNCTUATION=true
```

**Output:**
- **LabelEntity**: Significant words and phrases
- **LabelClip**: Speech segments with timestamps
- **Full transcript**: Stored in LabelMedia

**Features:**
- Word-level timestamps
- Automatic punctuation
- Confidence scores per word
- Multi-language support

## Cost Optimization Strategies

### 1. Enable Only What You Need

The most effective cost optimization is to disable processors you don't need:

```bash
# Minimal configuration (cheapest)
ENABLE_LABEL_DETECTION=true           # ~$0.01/min
ENABLE_OBJECT_TRACKING=false
ENABLE_FACE_DETECTION=false
ENABLE_PERSON_DETECTION=false
ENABLE_SPEECH_TRANSCRIPTION=false
# Total: ~$0.01 per minute

# Basic configuration (recommended for most use cases)
ENABLE_LABEL_DETECTION=true           # ~$0.01/min
ENABLE_OBJECT_TRACKING=false
ENABLE_FACE_DETECTION=false
ENABLE_PERSON_DETECTION=false
ENABLE_SPEECH_TRANSCRIPTION=true      # ~$0.024/min
# Total: ~$0.034 per minute

# Full configuration (most expensive)
ENABLE_LABEL_DETECTION=true           # ~$0.01/min
ENABLE_OBJECT_TRACKING=true           # ~$0.025/min
ENABLE_FACE_DETECTION=true            # ~$0.025/min
ENABLE_PERSON_DETECTION=true          # ~$0.025/min
ENABLE_SPEECH_TRANSCRIPTION=true      # ~$0.024/min
# Total: ~$0.109 per minute
```

### 2. Use Confidence Thresholds

Higher confidence thresholds reduce the number of results stored and processed:

```bash
# Lower thresholds = more results (more storage, more processing)
LABEL_DETECTION_CONFIDENCE_THRESHOLD=0.1

# Higher thresholds = fewer results (less storage, less processing)
LABEL_DETECTION_CONFIDENCE_THRESHOLD=0.5
```

**Recommended thresholds:**
- Label Detection: 0.2 (captures most relevant labels)
- Object Tracking: 0.5 (reduces false positives)
- Face Detection: 0.7 (high confidence faces only)
- Person Detection: 0.7 (high confidence persons only)

### 3. Use SHOT_MODE for Label Detection

`SHOT_MODE` is significantly cheaper than `SHOT_AND_FRAME_MODE`:

```bash
# Cheaper: Detect labels at shot level only
LABEL_DETECTION_MODE=SHOT_MODE

# More expensive: Detect labels at both shot and frame level
LABEL_DETECTION_MODE=SHOT_AND_FRAME_MODE
```

Use `SHOT_MODE` unless you need frame-level label detection.

### 4. Leverage Caching

The system automatically caches GCVI API responses. If you reprocess the same video, cached results are used instead of making new API calls.

**Cache behavior:**
- Responses are cached by GCS URI and processor version
- Cache is checked before every API call
- Cache hits avoid API costs entirely
- Cache is stored in the database for persistence

### 5. Batch Processing

Process videos in batches during off-peak hours to take advantage of:
- Lower infrastructure costs
- Better resource utilization
- Easier monitoring and debugging

### 6. Selective Processing

Enable processors selectively based on video content type:

```bash
# For interview videos
ENABLE_LABEL_DETECTION=true
ENABLE_SPEECH_TRANSCRIPTION=true
ENABLE_FACE_DETECTION=false
ENABLE_PERSON_DETECTION=false
ENABLE_OBJECT_TRACKING=false

# For security footage
ENABLE_LABEL_DETECTION=true
ENABLE_OBJECT_TRACKING=true
ENABLE_PERSON_DETECTION=true
ENABLE_FACE_DETECTION=false
ENABLE_SPEECH_TRANSCRIPTION=false

# For sports videos
ENABLE_LABEL_DETECTION=true
ENABLE_PERSON_DETECTION=true
ENABLE_OBJECT_TRACKING=true
ENABLE_FACE_DETECTION=false
ENABLE_SPEECH_TRANSCRIPTION=false
```

## Cost Estimation

### Example Calculations

**10-minute video with basic configuration:**
```
Label Detection:        10 min × $0.01/min  = $0.10
Speech Transcription:   10 min × $0.024/min = $0.24
Total:                                        $0.34
```

**10-minute video with full configuration:**
```
Label Detection:        10 min × $0.01/min  = $0.10
Object Tracking:        10 min × $0.025/min = $0.25
Face Detection:         10 min × $0.025/min = $0.25
Person Detection:       10 min × $0.025/min = $0.25
Speech Transcription:   10 min × $0.024/min = $0.24
Total:                                        $1.09
```

**Monthly costs for 100 hours of video:**
```
Basic configuration:    6,000 min × $0.034/min  = $204/month
Full configuration:     6,000 min × $0.109/min  = $654/month
```

### Cost Monitoring

Monitor your GCVI costs in the Google Cloud Console:
1. Navigate to **Usage** → **Reports**
2. Filter by **Video Intelligence API**
3. Group by **SKU** to see costs per feature
4. Set up **Budget Alerts** to avoid surprises

## Data Model

### Collections Created

The GCVI processors create and populate three main collections:

#### 1. LabelEntity
Stable label dictionary for all detected labels:
- `canonicalName`: Label name (e.g., "Car", "Person")
- `labelType`: OBJECT, SHOT, PERSON, SPEECH
- `provider`: GOOGLE_VIDEO_INTELLIGENCE, GOOGLE_SPEECH
- `processor`: Processor version (e.g., "object-tracking:1.0.0")
- `entityHash`: Unique hash for deduplication

#### 2. LabelTrack
Track-level data for objects, persons, and faces:
- `trackId`: Stable track identifier
- `start`, `end`, `duration`: Time boundaries
- `confidence`: Average or max confidence
- `keyframes`: Array of {time, bbox, confidence, attributes}
- `trackData`: Aggregated properties

#### 3. LabelClip
Time-bounded label occurrences:
- `LabelEntityRef`: Link to LabelEntity
- `LabelTrackRef`: Link to LabelTrack (optional)
- `start`, `end`, `duration`: Time boundaries
- `confidence`: Confidence score
- `labelData`: Compact label data

#### 4. LabelMedia (Enhanced)
Aggregated metadata per media file:
- Processor-specific counts (objects, faces, persons, etc.)
- Processing timestamps
- Processor versions
- Full transcript (for speech)

## Troubleshooting

### Common Issues

#### 1. Processor Not Running

**Symptom:** Processor is enabled but not executing

**Solutions:**
- Check environment variable is set to `true` (case-sensitive)
- Verify worker service is running: `yarn workspace @project/worker dev`
- Check worker logs for configuration errors
- Restart worker after changing environment variables

#### 2. API Authentication Errors

**Symptom:** "Authentication failed" or "Invalid credentials"

**Solutions:**
- Verify `GOOGLE_PROJECT_ID` is correct
- Check `GOOGLE_CLOUD_CREDENTIALS` or `GOOGLE_CLOUD_KEY_FILE` is valid
- Ensure service account has Video Intelligence API permissions
- Enable Video Intelligence API in Google Cloud Console

#### 3. GCS Upload Failures

**Symptom:** "Failed to upload to GCS" or "Bucket not found"

**Solutions:**
- Verify `GCS_BUCKET` exists and is accessible
- Check service account has Storage Object Creator role
- Ensure bucket is in the same project as credentials
- Verify bucket name doesn't include `gs://` prefix

#### 4. High Costs

**Symptom:** Unexpected API costs

**Solutions:**
- Review enabled processors and disable unused ones
- Increase confidence thresholds to reduce results
- Use `SHOT_MODE` instead of `SHOT_AND_FRAME_MODE`
- Check for duplicate processing (cache should prevent this)
- Set up budget alerts in Google Cloud Console

#### 5. Partial Results

**Symptom:** Some processors succeed, others fail

**Solutions:**
- This is expected behavior (partial success is allowed)
- Check logs for specific processor errors
- Verify each processor's configuration
- Ensure sufficient API quotas for all processors

### Debug Mode

Enable detailed logging for troubleshooting:

```bash
# In worker/.env
LOG_LEVEL=debug
```

This will log:
- Processor enablement status at startup
- API request/response details
- Cache hit/miss information
- Normalizer input/output
- Database operation details

## Best Practices

### 1. Start with Defaults

Begin with the default configuration (Label Detection + Speech Transcription) and enable additional processors only when needed.

### 2. Test with Short Videos

Test your configuration with short videos (< 1 minute) before processing large batches to avoid unexpected costs.

### 3. Monitor Costs Regularly

Set up Google Cloud budget alerts and review costs weekly, especially when enabling new processors.

### 4. Use Appropriate Thresholds

Adjust confidence thresholds based on your use case:
- **High precision needed**: Use higher thresholds (0.7+)
- **High recall needed**: Use lower thresholds (0.2-0.4)
- **Balanced**: Use medium thresholds (0.4-0.6)

### 5. Document Your Configuration

Document why each processor is enabled/disabled for your use case to help future developers understand the configuration.

### 6. Version Your Configuration

Track configuration changes in version control and document the reasoning behind changes.

### 7. Test Partial Failures

Test scenarios where some processors fail to ensure your application handles partial results gracefully.

## Migration from Legacy Configuration

If you're migrating from the legacy GCVI configuration:

### Old Configuration (Deprecated)
```bash
ENABLE_GOOGLE_VIDEO_INTELLIGENCE=true
ENABLE_GOOGLE_SPEECH=true
```

### New Configuration (Recommended)
```bash
ENABLE_LABEL_DETECTION=true
ENABLE_OBJECT_TRACKING=false
ENABLE_FACE_DETECTION=false
ENABLE_PERSON_DETECTION=false
ENABLE_SPEECH_TRANSCRIPTION=true
```

The legacy flags are deprecated and will be removed in a future version. Update your configuration to use the granular processor flags.

## Additional Resources

- [Google Cloud Video Intelligence API Documentation](https://cloud.google.com/video-intelligence/docs)
- [Google Cloud Speech-to-Text API Documentation](https://cloud.google.com/speech-to-text/docs)
- [GCVI Pricing](https://cloud.google.com/video-intelligence/pricing)
- [GCVI Queries Documentation](docs/GCVI_QUERIES.md)
- [Development Guide](docs/DEVELOPMENT.md)

## Support

For issues or questions:
1. Check the troubleshooting section above
2. Review worker logs for error details
3. Consult Google Cloud documentation
4. Open an issue in the project repository
