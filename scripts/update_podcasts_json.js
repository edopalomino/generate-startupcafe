import fs from 'fs';
import path from 'path';
import https from 'https';

// Leer datos del episodio desde un JSON temporal
const metaPath = process.env.EPISODE_META_JSON;
if (!metaPath) throw new Error('Falta EPISODE_META_JSON');
const { url, titulo: title, descripcion: description } = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const podcastsJsonUrl = 'https://raw.githubusercontent.com/edopalomino/startupsandcafe/refs/heads/main/podcasts.json';

// Reemplaza __dirname por la forma compatible con ES modules:
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const localPath = path.join(__dirname, '../startupsandcafe/podcasts.json');

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  let podcasts = [];
  try {
    podcasts = await fetchJson(podcastsJsonUrl);
  } catch (e) {
    // Si falla, intenta leer local
    if (fs.existsSync(localPath)) {
      podcasts = JSON.parse(fs.readFileSync(localPath, 'utf8'));
    }
  }
  const episodio = podcasts.length ? Math.max(...podcasts.map(e => e.episodio)) + 1 : 1;
  podcasts.push({
    episodio,
    titulo: title,
    descripcion: description,
    url
  });
  fs.writeFileSync(localPath, JSON.stringify(podcasts, null, 2));
  console.log('Nuevo episodio agregado:', { episodio, title, description, url });
}

main();
