### **Supported Models for STT and Timestamps**

ElevenLabs processes STT and speaker diarization primarily through its Scribe architecture.

| Model ID | Description | Best For |
| --- | --- | --- |
| `scribe_v2` | The latest model supporting 90+ languages, precise word/character timestamps, and smart speaker diarization up to 32 speakers. | Production use, multi-speaker audio, complex formatting, and event tagging. |
| `scribe_v1` | The legacy STT model. | Backwards compatibility for older applications. |

> **Note:** To utilize speaker detection, you must explicitly pass `diarize: true`. Keep in mind that diarization is designed for single-channel audio; it will throw an error if you attempt to use it alongside `use_multi_channel: true`.

---

### **Response Data Model**

When you request `diarize: true` and `timestamps_granularity: "word"`, the API returns a root transcription object containing a `words` array. The model treats both spoken words and the gaps between them as individual objects.

Here is the exact JSON structure of the API's response:

```json
{
  "language_code": "en",
  "language_probability": 0.99,
  "text": "Hello world!",
  "words": [
    {
      "text": "Hello",
      "type": "word", 
      "start": 0.0,
      "end": 0.5,
      "speaker_id": "speaker_0" 
    },
    {
      "text": " ",
      "type": "spacing",
      "start": 0.5,
      "end": 0.55,
      "speaker_id": "speaker_0"
    }
  ]
}

```

* **`type`**: Indicates if the object is a `"word"` or `"spacing"`.
* **`start` / `end**`: The precise float timestamps (in seconds) detailing exactly when the word or spacing begins and ends.
* **`speaker_id`**: The generated identifier for the speaker (e.g., `speaker_0`, `speaker_1`).

---

### **Corrected Implementation**

Here is your TypeScript implementation, fully updated to align with the correct SDK schema.

```typescript
import { ElevenLabsClient } from "elevenlabs";
import * as fs from "fs";

// Initialize the ElevenLabs client
const client = new ElevenLabsClient({
    apiKey: process.env.ELEVENLABS_API_KEY || "YOUR_API_KEY"
});

async function transcribeAudio() {
    try {
        const audioStream = fs.createReadStream("path/to/your/audio.mp3");
        console.log("Starting transcription...");
        
        const response = await client.speechToText.convert({
            file: audioStream,
            model_id: "scribe_v2", 
            diarize: true,         
            tag_audio_events: true, 
            timestamps_granularity: "word" // Corrected parameter
        });

        // Loop through the diarized segments/words
        if (response.words) {
            response.words.forEach((wordObj) => {
                // Filter out spacing objects if you only want spoken words
                if (wordObj.type === "word") {
                    const speaker = wordObj.speaker_id || "Unknown Speaker"; // Corrected field
                    console.log(`[${speaker}] (${wordObj.start.toFixed(2)}s - ${wordObj.end.toFixed(2)}s): ${wordObj.text}`);
                }
            });
        }
        
    } catch (error) {
        console.error("Error during transcription:", error);
    }
}

transcribeAudio();

```