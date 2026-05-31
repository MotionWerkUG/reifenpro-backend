require('dotenv').config();
const express     = require('express');
const cors        = require('cors');
const helmet      = require('helmet');
const compression = require('compression');
const morgan      = require('morgan');
const rateLimit   = require('express-rate-limit');
const cron        = require('node-cron');

const { testConnection } = require('./db/index');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const authRoutes        = require('./routes/auth');
const kundenRoutes      = require('./routes/kunden');
const einlagerungRoutes = require('./routes/einlagerungen');

const app  = express();
const PORT = process.env.PORT || 3001;

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',')
    : ['http://161.97.187.239', 'http://localhost:5173'],
  credentials: true,
}));

app.use(rateLimit({ windowMs: 900000, max: 100, message: { error: 'Zu viele Anfragen.' } }));
app.use('/api/auth/login', rateLimit({ windowMs: 900000, max: 10, message: { error: 'Zu viele Login-Versuche.' } }));

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined'));

app.get('/health', (req, res) =>
  res.json({ status: 'ok', zeit: new Date().toISOString(), version: '1.0.0' })
);

app.use('/api/auth',          authRoutes);
app.use('/api/kunden',        kundenRoutes);
app.use('/api/einlagerungen', einlagerungRoutes);
app.use(notFound);
app.use(errorHandler);

cron.schedule('0 2 * * *', async () => {
  const { query } = require('./db/index');
  const r = await query('DELETE FROM refresh_tokens WHERE ablauf_am < NOW()');
  console.log(`[Cron] ${r.rowCount} Tokens gelöscht.`);
}, { timezone: 'Europe/Berlin' });

const start = async () => {
  const ok = await testConnection();
  if (!ok) { console.error('[Server] DB-Verbindung fehlgeschlagen.'); process.exit(1); }
  app.listen(PORT, '0.0.0.0', () =>
    console.log(`[Server] ReifenPro läuft auf Port ${PORT}`)
  );
};
start();
