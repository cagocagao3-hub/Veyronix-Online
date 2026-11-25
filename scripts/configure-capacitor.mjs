import fs from "node:fs";
import { URL } from "node:url";

const raw = process.env.VEYRONIX_SERVER_URL || process.argv[2] || "";
if (!raw) {
  console.error("Defina VEYRONIX_SERVER_URL com a URL HTTPS publicada do Veyronix.");
  process.exit(1);
}
let url;
try { url = new URL(raw); } catch {
  console.error("URL inválida. Exemplo: https://veyronix.onrender.com");
  process.exit(1);
}
if (url.protocol !== "https:") {
  console.error("Por segurança, o APK online exige uma URL HTTPS.");
  process.exit(1);
}
const config = {
  appId: "com.veyronix.app",
  appName: "Veyronix",
  webDir: "public",
  server: { url: url.origin, cleartext: false, allowNavigation: [url.host] }
};
fs.writeFileSync("capacitor.config.json", JSON.stringify(config, null, 2) + "\n");
console.log(`APK configurado para carregar ${url.origin}`);
