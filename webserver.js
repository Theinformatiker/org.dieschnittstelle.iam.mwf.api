/*
 * SERVER: Express + MongoDB Atlas
 * Passt perfekt zur Flet-App (REST API)
 */

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');
const { v4: uuidv4 } = require('uuid');

// --- Konfiguration ---
const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'content', 'img');

// ⚠️ DEIN MONGODB STRING HIER EINTRAGEN:
const MONGO_URI = "mongodb+srv://mediauser:mediauser123@cluster0.m8qxa.mongodb.net/?retryWrites=true&w=majority";
const DB_NAME = "mediaapp";
const COLLECTION = "media";

// --- Middleware ---
app.use(cors());
app.use(express.json()); // Wichtig für JSON Body
app.use('/content/img', express.static(UPLOAD_DIR)); // Bilder ausliefern

// --- Upload Vorbereitung ---
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname.replace(/\s+/g, '_'))
});
const upload = multer({ storage: storage });

// --- MongoDB Verbindung ---
let db;
let collection;

async function startServer() {
    try {
        const client = new MongoClient(MONGO_URI);
        await client.connect();
        db = client.db(DB_NAME);
        collection = db.collection(COLLECTION);
        console.log("✅ Mit MongoDB Atlas verbunden");

        // --- ROUTES ---

        // 1. GET: Alle laden
        app.get('/api/mediaitems', async (req, res) => {
            try {
                const items = await collection.find().toArray();
                // _id von Mongo entfernen/umwandeln, damit es sauber bleibt (optional)
                const cleanItems = items.map(item => {
                    const { _id, ...rest } = item; 
                    return rest;
                });
                res.json({ data: cleanItems });
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        // 2. POST: Neu erstellen (Server macht die ID)
        app.post('/api/mediaitems', async (req, res) => {
            try {
                const newItem = req.body;
                newItem.id = uuidv4(); // Sichere ID generieren
                
                // Koordinaten sicherstellen
                newItem.lat = newItem.lat || null;
                newItem.lon = newItem.lon || null;

                await collection.insertOne(newItem);
                console.log(`✅ MongoDB Insert: ${newItem.title}`);
                res.json(newItem);
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        // 3. PUT: Update per ID (WICHTIG für deine App!)
        app.put('/api/mediaitems/:id', async (req, res) => {
            try {
                const id = req.params.id;
                const updateData = req.body;
                
                // Sicherheit: ID im Body darf ID in URL nicht überschreiben
                updateData.id = id; 
                // _id darf man nicht manuell updaten, also weg damit falls vorhanden
                delete updateData._id; 

                const result = await collection.updateOne(
                    { id: id }, 
                    { $set: updateData }
                );

                if (result.matchedCount > 0) {
                    console.log(`🔄 MongoDB Update: ${id}`);
                    res.json({ ok: true });
                } else {
                    res.status(404).json({ error: "Item not found" });
                }
            } catch (e) {
                console.error(e);
                res.status(500).json({ error: e.message });
            }
        });

        // 4. DELETE: Löschen per src
        app.delete('/api/mediaitems', async (req, res) => {
            try {
                const src = req.query.src;
                if (!src) return res.status(400).json({ error: "src param missing" });

                const result = await collection.deleteMany({ src: src });
                
                // Optional: Datei von Platte löschen
                try {
                    const filename = path.basename(src);
                    const filepath = path.join(UPLOAD_DIR, filename);
                    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
                } catch(err) { console.log("Datei konnte nicht gelöscht werden (egal)"); }

                console.log(`🗑️ Deleted ${result.deletedCount} items.`);
                res.json({ deleted: result.deletedCount });
            } catch (e) {
                res.status(500).json({ error: e.message });
            }
        });

        // 5. UPLOAD
        app.post('/api/upload', upload.single('filedata'), (req, res) => {
            if (!req.file) return res.status(400).json({ error: 'No file' });
            res.json({
                data: {
                    filedata: `content/img/${req.file.filename}`,
                    contentType: req.file.mimetype
                }
            });
        });

        // Server starten
        app.listen(PORT, () => {
            console.log(`🚀 Server läuft auf Port ${PORT}`);
        });

    } catch (e) {
        console.error("❌ DB Fehler:", e);
    }
}

startServer();
