import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import AdmZip from "adm-zip";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // API Route to download the project source as ZIP
  app.get("/api/download-project", (req, res) => {
    try {
      const zip = new AdmZip();
      const rootDir = "/"; // Absolute root in this environment
      
      const filesToInclude = [
        "package.json",
        "tsconfig.json",
        "vite.config.ts",
        "metadata.json",
        ".env.example",
        ".gitignore",
        "server.ts",
        "index.html"
      ];

      const dirsToInclude = [
        "src"
      ];

      // Add individual files
      filesToInclude.forEach(file => {
        const filePath = path.join(rootDir, file);
        if (fs.existsSync(filePath)) {
          zip.addLocalFile(filePath);
        }
      });

      // Add directories
      dirsToInclude.forEach(dir => {
        const dirPath = path.join(rootDir, dir);
        if (fs.existsSync(dirPath)) {
          zip.addLocalFolder(dirPath, dir);
        }
      });

      const buffer = zip.toBuffer();
      
      if (buffer.length === 0) {
        throw new Error("Generated ZIP is empty");
      }

      res.set({
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=project_source.zip",
        "Content-Length": buffer.length
      });
      
      res.send(buffer);
    } catch (error) {
      console.error("Zip error:", error);
      res.status(500).send("Failed to generate ZIP: " + (error instanceof Error ? error.message : "Unknown error"));
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { 
        middlewareMode: true,
        host: "0.0.0.0",
        port: 3000
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
