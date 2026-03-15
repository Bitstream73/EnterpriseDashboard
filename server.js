import express from 'express';
import { router as apiRouter } from './routes/api.js';
import { startPollers, stopPollers } from './pollers/index.js';
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

// Global Express error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`╔══════════════════════════════════════════╗`);
  console.log(`║  LCARS Dashboard :: ${TITLE.padEnd(20)} ║`);
  console.log(`║  Port: ${String(PORT).padEnd(33)} ║`);
  console.log(`║  Stardate: ${getStardate().padEnd(29)} ║`);
  console.log(`╚══════════════════════════════════════════╝`);
  startPollers();
});

const shutdown = () => {
  console.log('Shutting down gracefully...');
  stopPollers();
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000); // force kill after 10s
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function getStardate() {
  // Fan-standard formula: (year - 2000) * 1000 + fractional day
  // Gives ~26000-range stardates for current era
  const now = new Date();
  const year = now.getFullYear();
  const startOfYear = new Date(year, 0, 0);
  const diff = now - startOfYear;
  const dayOfYear = Math.floor(diff / 86400000);
  const daysInYear = (year % 4 === 0) ? 366 : 365;
  return ((year - 2000) * 1000 + (dayOfYear / daysInYear) * 1000).toFixed(1);
}
