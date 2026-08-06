const { query } = require('../db/index');

const errorHandler = (err, req, res, next) => {
  const status = err.status || 500;
  if (status === 500) {
    // Interne Fehler (z. B. rohe DB-Meldungen) nicht an den Client leaken
    console.error('[ERROR]', req.method, req.path, err.message);
    return res.status(500).json({ error: 'Interner Serverfehler.' });
  }
  res.status(status).json({ error: err.message || 'Fehler.' });
};

const notFound = (req, res) =>
  res.status(404).json({ error: `${req.method} ${req.path} nicht gefunden.` });

const auditLog = async ({ userId, aktion, tabelle, datensatzId, alteWerte, neueWerte, req }) => {
  try {
    await query(
      `INSERT INTO audit_log
         (user_id,aktion,tabelle,datensatz_id,alte_werte,neue_werte,ip_adresse)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [userId||null, aktion, tabelle||null, datensatzId||null,
       alteWerte ? JSON.stringify(alteWerte) : null,
       neueWerte ? JSON.stringify(neueWerte) : null,
       req ? req.ip : null]
    );
  } catch (e) { console.error('[Audit]', e.message); }
};

module.exports = { errorHandler, notFound, auditLog };
