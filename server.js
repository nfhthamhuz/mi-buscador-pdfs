const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const Fuse = require('fuse.js');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuración de Multer para subida de archivos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, 'digitalizados');
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png'];
    allowedTypes.includes(file.mimetype) ? cb(null, true) : cb(new Error('Solo se permiten PDF, JPG y PNG'));
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Variables para caché
let documentsCache = null;
let lastCacheUpdate = null;

// Función para leer documentos
async function getDocuments() {
  const now = Date.now();
  const cacheExpiry = 5 * 60 * 1000; // 5 minutos de caché

  if (documentsCache && (now - lastCacheUpdate) < cacheExpiry) {
    return documentsCache;
  }

  try {
    const readFiles = (dir, type) => {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir)
        .filter(file => /\.(pdf|jpe?g|png)$/i.test(file))
        .map(file => {
          const stats = fs.statSync(path.join(dir, file));
          return {
            id: `${type}-${file}`,
            name: file,
            path: `/${type}/${file}`,
            fullPath: path.join(__dirname, type, file),
            type: type,
            size: stats.size,
            fecha: stats.mtime.toISOString(),
            formato: path.extname(file).toLowerCase().replace('.', ''),
            metadata: {
              title: path.parse(file).name,
              author: type === 'biblioteca' ? 'Sistema' : 'Usuario',
              tags: [type]
            }
          };
        });
    };

    documentsCache = [
      ...readFiles(path.join(__dirname, 'biblioteca'), 'biblioteca'),
      ...readFiles(path.join(__dirname, 'digitalizados'), 'digitalizados')
    ];
    lastCacheUpdate = now;
    return documentsCache;

  } catch (error) {
    console.error('Error al leer documentos:', error);
    return [];
  }
}

// Configuración de Fuse.js para búsqueda
const fuseOptions = {
  keys: ['name', 'metadata.title', 'metadata.author'],
  threshold: 0.4,
  ignoreLocation: true
};

// Endpoints
app.get('/api/documentos', async (req, res) => {
  try {
    const { type } = req.query;
    const documents = await getDocuments();
    const filtered = type ? documents.filter(doc => doc.type === type) : documents;
    
    res.json({
      success: true,
      documents: filtered
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Error al listar documentos' 
    });
  }
});

app.post('/api/upload', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) throw new Error('No se subió ningún archivo');
    
    // Actualizar caché
    await getDocuments(true);
    
    res.json({
      success: true,
      document: {
        id: `digitalizados-${req.file.filename}`,
        name: req.file.filename,
        path: `/digitalizados/${req.file.filename}`,
        type: 'digitalizados',
        size: req.file.size,
        fecha: new Date().toISOString(),
        metadata: {
          title: req.body.title || path.parse(req.file.originalname).name,
          author: req.body.author || 'Usuario',
          tags: ['digitalizados']
        }
      }
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

app.get('/api/search', async (req, res) => {
  try {
    const { q = '' } = req.query;
    const documents = await getDocuments();
    const fuse = new Fuse(documents, fuseOptions);
    const results = q ? fuse.search(q).map(r => r.item) : documents;
    
    res.json({ 
      success: true, 
      results 
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      message: 'Error en la búsqueda' 
    });
  }
});

app.get('/api/document', (req, res) => {
  try {
    const filePath = path.join(__dirname, req.query.path);
    if (!fs.existsSync(filePath)) throw new Error('Archivo no encontrado');
    res.sendFile(filePath);
  } catch (error) {
    res.status(404).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Servir archivos HTML
app.get(['/', '/buscador'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'buscador.html'));
});

app.get('/subidor', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'subidor.html'));
});

// Manejo de errores
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({ 
    success: false, 
    message: 'Error interno del servidor' 
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`
  🚀 Servidor funcionando en http://localhost:${PORT}
  📂 Endpoints disponibles:
  - GET    /api/documentos     Listar documentos
  - POST   /api/upload         Subir archivos (multipart/form-data)
  - GET    /api/search?q=      Buscar documentos
  - GET    /api/document?path= Descargar documento
  `);
});