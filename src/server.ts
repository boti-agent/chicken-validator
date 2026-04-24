import express, { Request, Response, NextFunction } from 'express';
import multer from 'multer';
import * as dotenv from 'dotenv';
import { uploadFile, analyzeImage } from './check-chicken-food.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Multer setup: store file in memory for temp processing
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    cb(null, allowed.includes(file.mimetype));
  },
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// Validation endpoint
app.post('/validate', upload.single('image'), async (req: Request, res: Response, next: NextFunction) => {
  if (!req.file) {
    res.status(400).json({ error: 'No image provided' });
    return;
  }

  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: 'MINIMAX_API_KEY not configured' });
    return;
  }

  try {
    // Save temp file
    const tmpPath = `/tmp/${Date.now()}-${req.file.originalname}`;
    const fs = await import('fs');
    fs.writeFileSync(tmpPath, req.file.buffer);

    // Upload to MiniMax
    const file = await uploadFile(tmpPath, apiKey);

    // Analyze
    const result = await analyzeImage(file.file_id, apiKey);

    // Cleanup
    fs.unlinkSync(tmpPath);

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Error handler
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(`❌ ${err.message}`);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📋 Health: http://localhost:${PORT}/health`);
  console.log(`🧪 Validate: POST http://localhost:${PORT}/validate`);
});