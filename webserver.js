/*
 * FINAL CLOUD VERSION — Upload integriert, njsimpl entfernt
 */

const { MongoClient } = require("mongodb");
const http = require("http");
const url = require("url");
const fs = require("fs");
const pathStr = require("path");
const mime = require("mime");
const formidable = require("formidable"); // Nutzen wir jetzt direkt
const { pipeline } = require("stream");

// ===============================
// MongoDB Cloud Config
// ===============================
const uri = process.env.MONGO_URI || "mongodb+srv://mediauser:mediauser123@cluster0.m8qxa.mongodb.net/?retryWrites=true&w=majority";
const client = new MongoClient(uri);
let db;

// ===============================
// MEDIA API (METADATEN)
// ===============================
async function handleGetMedia(res) {
  try {
    if (!db) throw new Error("Datenbankverbindung fehlt");
    const items = await db.collection("media").find().toArray();
    res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ data: items }));
  } catch (e) {
    console.error("❌ GET Fehler:", e.message);
    res.writeHead(500, { "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function handlePostMedia(req, res) {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try {
      if (!db) throw new Error("Datenbankverbindung fehlt");
      const item = JSON.parse(body);

      // 🛠️ FIX: Duplikate verhindern!
      // Wir suchen nach dem Eintrag mit derselben Bild-URL ('src').
      const filter = { src: item.src };
      
      // Wir aktualisieren die Daten ($set)
      const updateDoc = { $set: item };
      
      // upsert: true bedeutet: Update wenn gefunden, sonst Insert (Neu anlegen)
      const result = await db.collection("media").updateOne(filter, updateDoc, { upsert: true });
      
      console.log("✅ Metadaten aktualisiert/gespeichert");
      
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ ok: true }));

    } catch (e) {
      console.error("❌ POST Fehler:", e.message);
      res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// ===============================
// UPLOAD HANDLER (NEU & FIX)
// ===============================
function handleUpload(req, res) {
    const form = new formidable.IncomingForm();
    form.uploadDir = pathStr.join(__dirname, "www", "content", "img");
    form.keepExtensions = true;

    // Sicherstellen, dass Ordner existiert
    if (!fs.existsSync(form.uploadDir)) {
        fs.mkdirSync(form.uploadDir, { recursive: true });
    }

    form.parse(req, (err, fields, files) => {
        if (err) {
            console.error("❌ Upload Fehler:", err);
            res.writeHead(500, { "Access-Control-Allow-Origin": "*" });
            res.end("Upload Error");
            return;
        }

        // Formidable v1 packt die Datei oft in 'filedata' oder 'files'
        // Wir suchen das erste File-Objekt
        const fileObj = files.filedata || Object.values(files)[0];

        if (!fileObj) {
            res.writeHead(400, { "Access-Control-Allow-Origin": "*" });
            res.end("No file uploaded");
            return;
        }

        // Dateinamen bereinigen und Pfad erstellen
        const oldPath = fileObj.path;
        const newFilename = Date.now() + "_" + fileObj.name.replace(/\s+/g, "_");
        const newPath = pathStr.join(form.uploadDir, newFilename);

        // Datei umbenennen (verschieben)
        fs.rename(oldPath, newPath, (err) => {
            if (err) {
                console.error("❌ Rename Fehler:", err);
                res.writeHead(500);
                res.end("Save Error");
                return;
            }

            console.log("✅ Bild hochgeladen:", newFilename);

            // Antwort im Format, das deine App erwartet
            const responseData = {
                data: {
                    filedata: `content/img/${newFilename}`,
                    contentType: fileObj.type
                }
            };

            res.writeHead(200, { 
                "Content-Type": "application/json",
                "Access-Control-Allow-Origin": "*" 
            });
            res.end(JSON.stringify(responseData));
        });
    });
}

// ===============================
// MAIN SERVER ROUTING
// ===============================
const port = process.env.PORT || 7077;
const ip = "0.0.0.0";

function application(req, res) {
  let path = url.parse(req.url).pathname;

  // CORS Preflight
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  // 1. API: Metadaten (MongoDB)
  if (path === "/api/mediaitems") {
    if (req.method === "GET") return handleGetMedia(res);
    if (req.method === "POST") return handlePostMedia(req, res);
  }

  // 2. API: Upload (Lokal im Container, ohne DB-Zwang)
  if (path.startsWith("/api/upload")) {
    return handleUpload(req, res);
  }

  // 3. Statische Dateien
  if (path === "/") path = "/app.html";
  serveFile(req, res, path);
}

// Statische Dateien ausliefern
function serveFile(req, res, path) {
  const file = __dirname + "/www" + decodeURI(path);
  fs.stat(file, (err, stats) => {
    if (err) {
      res.writeHead(404);
      res.end();
      return;
    }
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${stats.size}`,
        "Accept-Ranges": "bytes",
        "Content-Length": end - start + 1,
        "Content-Type": mime.getType(path),
      });
      pipeline(fs.createReadStream(file, { start, end }), res, () => {});
    } else {
      res.writeHead(200, { "Content-Type": mime.getType(path) });
      fs.createReadStream(file).pipe(res);
    }
  });
}

// ===============================
// START
// ===============================
async function run() {
  try {
    console.log("⏳ Verbinde mit MongoDB Atlas...");
    await client.connect();
    db = client.db("mediaapp");
    console.log("✅ Datenbank bereit");

    http.createServer(application).listen(port, ip, () => {
      console.log(`🚀 Server läuft auf Port ${port}`);
    });
  } catch (e) {
    console.error("❌ Kritischer Startfehler:", e);
    process.exit(1);
  }
}

run();