/*
 * CLEAN CLOUD VERSION — Vollständig korrigiert
 */

const { MongoClient } = require("mongodb");
const http = require("http");
const url = require("url");
const fs = require("fs");
const mime = require("mime");
const { pipeline } = require("stream");

// ===============================
// MongoDB Cloud
// ===============================
// Wir priorisieren die MONGO_URI von Render
const uri = process.env.MONGO_URI || "mongodb+srv://mediauser:mediauser123@cluster0.m8qxa.mongodb.net/?retryWrites=true&w=majority";

const client = new MongoClient(uri);
let db;

// ===============================
// MEDIA API
// ===============================
async function handleGetMedia(res) {
  try {
    if (!db) throw new Error("Datenbankverbindung nicht initialisiert");
    const items = await db.collection("media").find().toArray();

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(JSON.stringify({ data: items }));
  } catch (e) {
    console.error("❌ GET Fehler:", e.message);
    res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function handlePostMedia(req, res) {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try {
      if (!db) throw new Error("Datenbankverbindung nicht initialisiert");
      const item = JSON.parse(body);
      const result = await db.collection("media").insertOne(item);
      
      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ ok: true, id: result.insertedId }));
    } catch (e) {
      console.error("❌ POST Fehler:", e.message);
      res.writeHead(500, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify({ error: e.message }));
    }
  });
}

// ===============================
// SERVER SETTINGS
// ===============================
const port = process.env.PORT || 7077;
const ip = "0.0.0.0";

// Ordnerstruktur sicherstellen
if (!fs.existsSync("www/content/img")) fs.mkdirSync("www/content/img", { recursive: true });

function application(req, res) {
  let path = url.parse(req.url).pathname;

  // CORS
  if (req.method === "OPTIONS") {
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  if (path === "/api/mediaitems") {
    if (req.method === "GET") return handleGetMedia(res);
    if (req.method === "POST") return handlePostMedia(req, res);
  }

  if (path.startsWith("/api/upload")) {
    return require("./njsimpl/http2mdb")
      .CRUDImpl()
      .processRequest(req, res, "api", "upload");
  }

  if (path === "/") path = "/app.html";
  serveFile(req, res, path);
}

function serveFile(req, res, path) {
  const file = __dirname + "/www" + decodeURI(path);
  fs.stat(file, (err, stats) => {
    if (err) {
      res.writeHead(404);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": mime.getType(path) });
    fs.createReadStream(file).pipe(res);
  });
}

// ===============================
// START MIT DB-VERBINDUNG
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