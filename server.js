const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('./db');
require('dotenv').config();
const authMiddleware = require('./middleware/auth');
const dbSchemaMiddleware = require('./middleware/db-schema');
const { stackServerApp } = require('./stack/server');

const locationImageCache = {};

async function fetchLocationImage(loc) {
    if (locationImageCache[loc]) return locationImageCache[loc];
    
    const apiKey = process.env.Serper_api_key;
    if (!apiKey) return '';
    
    const getImages = async (query) => {
        try {
            const response = await fetch('https://google.serper.dev/images', {
                method: 'POST',
                headers: {
                    'X-API-KEY': apiKey,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ q: query })
            });
            const data = await response.json();
            return data.images || [];
        } catch (err) {
            console.error('Serper search error:', err);
            return [];
        }
    };

    try {
        let images = await getImages(`${loc} gta map`);
        
        // Fallback: If no images found for 'gta map', try a generic search
        if (images.length === 0) {
            images = await getImages(`${loc} city background location`);
        }
        
        if (images.length > 0) {
            // Use thumbnailUrl to bypass cross-origin hotlink protection from source wikis
            const finalImage = images[0].thumbnailUrl || images[0].imageUrl;
            locationImageCache[loc] = finalImage;
            return finalImage;
        }
    } catch (err) {
        console.error('Error fetching image from Serper:', err);
    }
    return '';
}

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Authentication UI Routes (Must be before authMiddleware to be publicly accessible)
app.get('/sign-in', (req, res) => {
    res.render('sign-in', { 
        stackProjectId: process.env.Stack_Project_ID,
        returnTo: req.query.returnTo || '/'
    });
});

app.get('/handler/oauth-callback', (req, res) => {
    res.render('oauth-callback', { stackProjectId: process.env.Stack_Project_ID });
});

app.get('/handler/magic-link-callback', (req, res) => {
    res.render('magic-link-callback', { stackProjectId: process.env.Stack_Project_ID });
});

app.get('/sign-out', (req, res) => {
    // Redirect to sign-in; the client-side check will handle the rest
    // or we can explicitly clear cookies if we know their names.
    // Stack Auth usually uses 'stack-access-token' for cookies.
    res.clearCookie('stack-access-token');
    res.clearCookie('stack-refresh-token');
    res.redirect('/sign-in');
});

// Apply Auth Middleware to all subsequent routes (Sign-in wall)
app.use(authMiddleware);
// Apply DB Schema Middleware to handle data isolation
app.use(dbSchemaMiddleware);

// Strict UUID regex for validation
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Helper for error catching in async routes
const asyncHandler = fn => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Multi-part file upload setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = './public/uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({ storage });

// Routes
app.get('/', asyncHandler(async (req, res) => {
  const selectedLocation = req.query.location || 'Northtown';
  
  // Get dynamic locations
  const locResult = await req.db.query('SELECT DISTINCT location FROM clients ORDER BY location');
  let locations = locResult.rows.map(r => r.location).filter(Boolean);
  if (locations.length === 0) {
    locations = ['Northtown', 'Westville', 'Downtown', 'Docks', 'Suburbia', 'Uptown'];
  }
  
  const location = locations.includes(selectedLocation) ? selectedLocation : locations[0] || 'Northtown';
  
  const clientsResult = await req.db.query('SELECT * FROM clients WHERE location = $1', [location]);
  const locationImage = await fetchLocationImage(location);
  
  if (req.headers['hx-request'] && req.headers['hx-target'] === 'map-content') {
    res.render('partials/map-content', { clients: clientsResult.rows }, (err, mapHtml) => {
      if (err) throw err;
      res.render('partials/location-nav', { selectedLocation: location, locations, isOOB: true }, (err, navHtml) => {
        if (err) throw err;

        const hudHtml = `
        <div id="location-hud" hx-swap-oob="true" class="absolute top-6 left-6 z-40 bg-[#1a1a1a] p-1 border border-gray-700 shadow-2xl hidden sm:block rounded-sm pointer-events-none transition-opacity duration-300" style="width: 240px; height: 135px;">
            ${locationImage ? `<img src="${locationImage}" class="w-full h-full object-cover rounded-sm border border-[#333]">` : `<div class="w-full h-full bg-gray-800 flex items-center justify-center text-gray-500 rounded-sm italic text-sm border border-[#333]">No Image</div>`}
            <div class="absolute bottom-2 left-2 right-0 flex justify-start items-end">
               <span class="bg-black/80 px-2 py-0.5 text-xs font-bold text-white uppercase tracking-wider rounded backdrop-blur-sm shadow-md">${location}</span>
            </div>
        </div>`;

        res.send(mapHtml + navHtml + hudHtml);
      });
    });
  } else {
    res.render('index', { 
        clients: clientsResult.rows, 
        selectedLocation: location, 
        locations,
        locationImage,
        stackProjectId: process.env.Stack_Project_ID,
    });
  }
}));

app.post('/update-client-meta/:id', asyncHandler(async (req, res) => {
  const { standards, tags } = req.body;
  const clientId = req.params.id;

  if (!uuidRegex.test(clientId)) return res.status(400).send('Invalid Client ID format');

  // Recalculate relationship and addiction scores based on metadata
  let relScore = 50; 
  if (standards === 'Low') relScore = 30;
  if (standards === 'Medium') relScore = 60;
  if (standards === 'High') relScore = 90;

  const effects = Array.isArray(tags) ? tags.filter(t => t.trim() !== '') : [];
  const addictionScore = Math.min(effects.length * 30, 100);

  const result = await req.db.query(
    'UPDATE clients SET standards = $1, favourite_effects = $2, relationship_score = $3, addiction_score = $4 WHERE id = $5 RETURNING *',
    [standards, effects, relScore, addictionScore, clientId]
  );

  if (result.rows.length === 0) return res.status(404).send('Client not found');
  res.render('partials/client-detail', { client: result.rows[0] });
}));

app.post('/add-client', upload.single('avatar'), asyncHandler(async (req, res) => {
  const { name, role, relationship_score, addiction_score, standards, favourite_effects, location } = req.body;
  
  if (!name || name.trim() === '') return res.status(400).send('Name is required');

  const avatar_path = req.file ? `/uploads/${req.file.filename}` : null;
  const effects = favourite_effects ? (Array.isArray(favourite_effects) ? favourite_effects : [favourite_effects]) : [];
  
  const clientLocation = (location && location.trim() !== '') ? location.trim() : 'Northtown';

  // Sanitize numeric scores
  const relScore = Math.min(Math.max(parseInt(relationship_score) || 50, 0), 100);
  const addScore = Math.min(Math.max(parseInt(addiction_score) || 0, 0), 100);

  const result = await req.db.query(
    'INSERT INTO clients (name, role, relationship_score, addiction_score, standards, favourite_effects, avatar_path, location) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *',
    [name.trim(), role || 'Customer', relScore, addScore, standards || 'Medium', effects, avatar_path, clientLocation]
  );
  
  res.redirect(`/?location=${clientLocation}`);
}));

app.get('/client/:id', asyncHandler(async (req, res) => {
  const clientId = req.params.id;
  if (!uuidRegex.test(clientId)) return res.status(400).send('Invalid Client ID format');

  const clientResult = await req.db.query('SELECT * FROM clients WHERE id = $1', [clientId]);
  if (clientResult.rows.length === 0) return res.status(404).send('Client not found');
  res.render('partials/client-detail', { client: clientResult.rows[0] });
}));

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('SERVER_ERROR:', err);
  const status = err.status || 500;
  const message = err.message || 'An unexpected error occurred';
  
  if (req.headers['hx-request']) {
    res.status(status).send(`<div class="p-4 bg-red-900/20 border border-red-500 rounded text-red-200 text-xs">${message}</div>`);
  } else {
    res.status(status).send(`
      <body style="background:#121212;color:#eee;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
        <div style="text-align:center;border:1px solid #333;padding:2rem;border-radius:8px">
          <h1 style="color:#ff4b2b">ERROR ${status}</h1>
          <p>${message}</p>
          <a href="/" style="color:#f5af19;text-decoration:none">Return to Safety</a>
        </div>
      </body>
    `);
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
