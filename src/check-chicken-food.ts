/**
 * MiniMax Image Validator
 * 
 * Uploads an image and asks MiniMax vision model if it contains chicken food.
 * Returns JSON with is_valid and reason.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

// ============ Types ============

export interface FileObject {
  file_id: number;
  bytes: number;
  created_at: number;
  filename: string;
  purpose: string;
}

export interface BaseResp {
  status_code: number;
  status_msg: string;
}

export interface UploadFileResp {
  file: FileObject;
  base_resp: BaseResp;
}

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  signature?: string;
}

export interface ChatResponse {
  id: string;
  type: string;
  role: string;
  model: string;
  content: ContentBlock[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
  };
  stop_reason: string;
  base_resp: BaseResp;
}

export interface ValidationResult {
  is_valid: string;
  reason: string;
}

// ============ Constants ============

export const SYSTEM_PROMPT = `You are an expert Computer Vision classifier analyzing images for an automated backend pipeline.

Objective: Evaluate the provided image to determine if it is a genuine, non-commercial photograph of a prepared chicken dish.

Evaluation Criteria:
To return true, the image MUST meet ALL of the following positive constraints and trigger NONE of the rejection criteria.

✅ Pass Criteria (Must be present):
1. Prepared Food: The image must depict a fully cooked, prepared meal intended for human consumption.
2. Contains Chicken: Cooked chicken meat must be a clearly visible ingredient in the dish.

❌ Rejection Triggers (Return false immediately if detected):
1. Raw or Live: Reject if the image shows a live bird, feathers, or raw/uncooked poultry meat.
2. Advertisements: Reject if the image contains promotional text overlays, logos, prices, or is formatted as a commercial banner/flyer.
3. AI-Generated/Synthetic: Reject if the image exhibits obvious signs of AI generation (e.g., impossible geometry, floating objects, warped textures, or unnatural "plastic" lighting).

Output Constraint:
Do not provide any explanations, conversational text, or markdown code blocks (\`). Return ONLY a strict, valid JSON object containing a single boolean key.

Expected Output Format:
{
 "is_valid": "true"/"false",
 "reason": "small summarize",
}`;

const MIME_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
};

// ============ HTTP Helper ============

export function request<T>(options: https.RequestOptions, body?: Buffer | string): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => (data += chunk.toString()));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data) as T);
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ============ API Calls ============

export async function uploadFile(filePath: string, apiKey: string): Promise<FileObject> {
  const boundary = `----FormBoundary${Math.random().toString(36).slice(2)}`;
  const fileContent = fs.readFileSync(filePath);
  const filename = path.basename(filePath);
  const ext = path.extname(filename).slice(1).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

  const header = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="purpose"`,
    '',
    `image_classify`,
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${mimeType}`,
    '',
  ].join('\r\n');

  const footer = `\r\n--${boundary}--\r\n`;
  const fullBody = Buffer.concat([
    Buffer.from(header, 'utf8'),
    fileContent,
    Buffer.from(footer, 'utf8'),
  ]);

  const resp = await request<UploadFileResp>(
    {
      hostname: 'api.minimax.io',
      port: 443,
      path: '/v1/files/upload',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': fullBody.length,
      },
    },
    fullBody
  );

  if (resp.base_resp.status_code !== 0) {
    throw new Error(`Upload failed: ${JSON.stringify(resp.base_resp)}`);
  }

  return resp.file;
}

export async function analyzeImage(fileId: number, apiKey: string): Promise<ValidationResult> {
  const payload = {
    model: 'MiniMax-M2.7',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image', source: { type: 'upload', file_id: fileId } },
          { type: 'text', text: 'Analyze this image and return the JSON result.' },
        ],
      },
    ],
  };

  const body = JSON.stringify(payload);
  const resp = await request<ChatResponse>(
    {
      hostname: 'api.minimax.io',
      port: 443,
      path: '/anthropic/v1/messages',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    body
  );

  // Extract text block
  const textBlock = resp.content.find((b) => b.type === 'text');
  if (!textBlock || !textBlock.text) {
    throw new Error(`No text in response: ${JSON.stringify(resp)}`);
  }

  // Parse JSON from text
  const jsonMatch = textBlock.text.match(/\{[^}]+\}/s);
  if (!jsonMatch) {
    throw new Error(`Could not parse JSON from: ${textBlock.text}`);
  }

  return JSON.parse(jsonMatch[0]) as ValidationResult;
}

// ============ CLI Logic ============

function validateArgs(): void {
  const apiKey = process.argv[2];
  const imagePath = process.argv[3];

  if (!imagePath) {
    console.error('Usage: npx ts-node src/check-chicken-food.ts <api_key> <image_path>');
    process.exit(1);
  }
  if (!apiKey) {
    console.error('Error: Provide MINIMAX_API_KEY env var or 1st argument');
    process.exit(1);
  }
}

export async function main(): Promise<void> {
  const apiKey = process.argv[2] || process.env.MINIMAX_API_KEY || '';
  const imagePath = process.argv[3];

  validateArgs();

  try {
    console.error(`📤 Uploading ${imagePath}...`);
    const file = await uploadFile(imagePath!, apiKey);
    console.error(`✅ Uploaded! file_id: ${file.file_id}`);

    console.error(`🔍 Analyzing image...`);
    const result = await analyzeImage(file.file_id, apiKey);

    // Print ONLY the JSON to stdout
    console.log(JSON.stringify(result));
  } catch (err) {
    console.error(`❌ Error: ${(err as Error).message}`);
    process.exit(1);
  }
}
