import express from 'express';
import { router as apiRouter } from './routes/api.js';
import { startPollers } from './pollers/index.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;
const TITLE = process.env.DASHBOARD_TITLE || 'ENTERPRISE OPS CENTER';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', apiRouter);

// Inject dashboard config into HTML
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Config endpoint for frontend to read
app.get('/config', (req, res) => {
  res.json({
    title: TITLE,
    features: {
      railway: !!process.env.RAILWAY_API_TOKEN,
      anthropic: !!process.env.ANTHROPIC_ADMIN_API_KEY,
      openai: !!process.env.OPENAI_API_KEY,
      pinecone: !!(process.env.PINECONE_API_KEY && process.env.PINECONE_INDEX_HOST),
    },
  });
});

app.listen(PORT, () => {
  console.log(`╔══════════════════════════════════════════╗`);
  console.log(`║  LCARS Dashboard :: ${TITLE.padEnd(20)} ║`);
  console.log(`║  Port: ${String(PORT).padEnd(33)} ║`);
  console.log(`║  Stardate: ${getStardate().padEnd(29)} ║`);
  console.log(`╚══════════════════════════════════════════╝`);
  startPollers();
});

function getStardate() {
  const now = new Date();
  const year = now.getFullYear();
  const startOfYear = new Date(year, 0, 0);
  const diff = now - startOfYear;
  const dayOfYear = Math.floor(diff / 86400000);
  const daysInYear = (year % 4 === 0) ? 366 : 365;
  return ((year - 2323) * 1000 + (dayOfYear / daysInYear) * 1000).toFixed(1);
}
