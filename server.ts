import 'dotenv/config';
import express from 'express';
import sql from 'mssql';
import cors from 'cors';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { parse } from 'csv-parse/sync';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(cors());
  app.use(express.json());

  // Logging middleware
  app.use((req, res, next) => {
    if (req.url.startsWith('/api')) {
      console.log(`[API Request] ${req.method} ${req.url}`);
    }
    next();
  });

  // SQL Server Configuration
  const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER || 'localhost',
    database: process.env.DB_NAME,
    options: {
      encrypt: process.env.DB_ENCRYPT === 'true',
      trustServerCertificate: true,
      connectTimeout: 30000 // 30 seconds timeout
    }
  };

  let pool: sql.ConnectionPool | null = null;

  async function getPool() {
    if (!pool) {
      const serverHost = process.env.DB_SERVER || 'localhost';
      
      if (serverHost === 'localhost' || serverHost === '127.0.0.1') {
        console.warn('⚠️ ATTENTION : DB_SERVER est "localhost". L\'application tourne dans le cloud et ne peut pas accéder à votre base de données locale directement.');
        console.info('💡 Pour tester localement, utilisez une IP publique ou un tunnel (ngrok).');
      }
      
      try {
        console.log(`📡 Tentative de connexion : ${serverHost} -> ${config.database}`);
        pool = await sql.connect(config);
        console.log('✅ Connexion SQL Server réussie !');
      } catch (err: any) {
        console.error('❌ Échec de connexion SQL :', err.message);
        
        if (err.message.includes('getaddrinfo')) {
          console.error(`👉 Erreur de résolution : L'hôte "${serverHost}" est introuvable. Vérifiez l'adresse dans vos variables d'environnement.`);
        } else if (err.message.includes('ETIMEDOUT')) {
          console.error(`👉 Timeout : Le serveur "${serverHost}" ne répond pas. Vérifiez le pare-feu (Port 1433).`);
        }
        
        pool = null; 
        return null;
      }
    }
    return pool;
  }

  // CSV Data loading
  const CSV_FILE_PATH = path.join(process.cwd(), 'Liens Pdfs de sitetafawakdz - Base de données Tafawak 98.csv');
  let csvData: any[] = [];

  function loadCsvData() {
    try {
      if (fs.existsSync(CSV_FILE_PATH)) {
        const fileContent = fs.readFileSync(CSV_FILE_PATH, 'utf-8');
        csvData = parse(fileContent, {
          columns: true,
          skip_empty_lines: true,
          bom: true
        });
        console.log(`✅ Loaded ${csvData.length} records from CSV fallback.`);
      } else {
        console.warn(`⚠️ CSV fallback file not found at ${CSV_FILE_PATH}`);
      }
    } catch (err: any) {
      console.error('❌ Failed to load CSV data:', err.message);
    }
  }

  // Load CSV on start
  loadCsvData();

  // API Routes
  app.get('/api/sujets/:matiere', async (req, res) => {
    const { matiere } = req.params;
    if (!matiere) {
      return res.status(400).json({ error: "Le paramètre 'matiere' est manquant." });
    }

    // Try SQL first
    try {
      const conn = await getPool();
      if (conn) {
        console.log(`🔍 Fetching from SQL Server for subject: ${matiere}`);
        const result = await conn.request()
          .input('matiere', sql.NVarChar, matiere)
          .query("SELECT code_niveau, matiere, reference_pdf, [Lien direct] AS lien_direct_drive FROM Liens_Pdfs__sitetafawakdz WHERE matiere = @matiere");
        
        if (result.recordset && result.recordset.length > 0) {
          return res.json(result.recordset);
        }
        console.log(`ℹ️ No results in SQL for ${matiere}, trying CSV fallback...`);
      }
    } catch (err: any) {
      console.warn(`⚠️ SQL Query failed: ${err.message}. Falling back to CSV.`);
    }

    // Fallback to CSV
    console.log(`📂 Searching in CSV for subject: ${matiere}`);

    const subjectMapping: Record<string, string[]> = {
      'arabic': ['arabe', 'ar'],
      'french': ['fr', 'french'],
      'english': ['eng', 'en', 'english'],
      'islamic': ['islam', 'islamic'],
      'history_geo': ['hist'],
      'civic': ['civic', 'hist'],
      'science': ['science', 'sci'],
      'primary_science': ['science', 'sci'],
      'physics': ['physique', 'ph'],
      'informatics': ['info', 'informatique'],
      'amazigh': ['tamazigh', 'amazigh'],
      'art': ['dessin', 'art'],
      'math': ['math', 'maths']
    };

    const targetLabels = subjectMapping[matiere] || [matiere];

    const filtered = csvData.filter(row => {
      const m = (row.Matière || row.matiere || row.MATIERE || '').toLowerCase();
      return m === matiere.toLowerCase() || targetLabels.includes(m);
    });

    // Map CSV keys to match SQL keys for frontend compatibility
    const mapped = filtered.map(row => ({
      code_niveau: row.Année || row.Année || row.annee || row.code_niveau || '',
      matiere: row.Matière || row.matiere || '',
      reference_pdf: row['Nom du fichier PDF'] || row.reference_pdf || '',
      lien_direct_drive: row['Lien direct'] || row.lien_direct_drive || ''
    }));

    res.json(mapped);
  });

  // Catch-all for unknown /api routes to prevent Vite HTML fallback
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `Route API non trouvée: ${req.method} ${req.url}` });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
