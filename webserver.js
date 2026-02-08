/*
 * CLEAN CLOUD VERSION — Korrigierte Fassung mit Start-Sequenz
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
const uri =
  process.env.MONGO_URI ||
  "mongodb+srv://mediauser:mediauser123@cluster0.m8qxa.mongodb.net/?retryWrites=true&w=majority";

const client = new MongoClient(uri);
let db;

// ===============================
// MEDIA API
// ===============================
async function handleGetMedia(res) {
  try {
    if (!db) throw new Error("Datenbank nicht bereit");
    const items = await db.collection("media").find().toArray();

    res.writeHead(200, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });

    res.end(JSON.stringify({ data: items }));
  } catch (e) {
    console.error("❌ GET Media Error:", e.message);
    res.writeHead(500, { "Access-Control-Allow-Origin": "*" });
    res.end(JSON.stringify({ error: e.message }));
  }
}

async function handlePostMedia(req, res) {
  let body = "";
  req.on("data", (c) => (body += c));

  req.on("end", async () => {
    try {
      if (!db) throw new Error("Datenbank nicht bereit");
      const item = JSON.parse(body);

      const result = await db.collection("media").insertOne(item);
      console.log("✅ Item in MongoDB gespeichert:", result.insertedId);

      res.writeHead(200, {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(JSON.stringify({ ok: true, id: result.insertedId }));
    } catch (e) {
      console.error("❌ POST Media Error:", e.message);
      res.writeHead(500, { 
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*" 
      });
      res.end(JSON.stringify({ error: "Insert Error", details: e.message }));
    }
  });
}

// ===============================
// SERVER SETTINGS & STATIC
// ===============================
const port = process.env.PORT || 7077;
const ip = "0.0.0.0";

// Ordner sicherstellen
if (!fs.existsSync("www/content/img")) fs.mkdirSync("www/content/img", { recursive: true });
if (!fs.existsSync("www/content/mov")) fs.mkdirSync("www/content/mov", { recursive: true });

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

  // API Routing
  if (path === "/api/mediaitems") {
    if (req.method === "GET") return handleGetMedia(res);
    if (req.method === "POST") return handlePostMedia(req, res);
  }

  // Upload Endpoint (njsimpl)
  if (path.startsWith("/api/upload")) {
    try {
      return require("./njsimpl/http2mdb")
        .CRUDImpl()
        .processRequest(req, res, "api", "upload");
    } catch (e) {
      res.writeHead(500);
      res.end("Upload Module Missing");
      return;
    }
  }

  // Statische Dateien
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
    const size = stats.size;
    const range = req.headers.range;

    if (range) {
      let [start, end] = range.replace(/bytes=/, "").split("-");
      start = parseInt(start, 10);
      end = end ? parseInt(end, 10) : size - 1;
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${size}`,
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
// START-SEQUENZ (WICHTIG)
// ===============================
async function start() {
  try {
    console.log("⏳ Verbinde mit MongoDB...");
    await client.connect();
    db = client.db("mediaapp");
    console.log("✅ MongoDB verbunden");

    http.createServer(application).listen(port, ip, () => {
      console.log(`🚀 Server aktiv auf http://${ip}:${port}`);
    });
  } catch (e) {
    console.error("❌ Server-Start fehlgeschlagen:", e);
    process.exit(1);
  }
}

start();