import fs from 'fs';
import path from 'path';
import https from 'https';

// Leer datos del episodio desde un JSON temporal
const metaPath = process.env.EPISODE_META_JSON;
if (!metaPath) throw new Error('Falta EPISODE_META_JSON');
const { url, titulo: title, descripcion: description } = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
const podcastsJsonUrl = 'https://raw.githubusercontent.com/edopalomino/startupsandcafe/refs/heads/main/podcasts.json';

// Usar la ruta correcta al archivo podcasts.json dentro del repo clonado
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const repoJsonPath = path.resolve(__dirname, '../../startupsandcafe/podcasts.json');

// Asegura que la carpeta exista antes de cualquier operación
fs.mkdirSync(path.dirname(repoJsonPath), { recursive: true });

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
    // Si falla, intenta leer el archivo del repo clonado
    if (fs.existsSync(repoJsonPath)) {
      podcasts = JSON.parse(fs.readFileSync(repoJsonPath, 'utf8'));
    }
  }
  const episodio = podcasts.length ? Math.max(...podcasts.map(e => e.episodio)) + 1 : 1;
  podcasts.push({
    episodio,
    titulo: title,
    descripcion: description,
    url
  });
  // Asegura que la carpeta exista antes de escribir el archivo
  fs.mkdirSync(path.dirname(repoJsonPath), { recursive: true });
  fs.writeFileSync(repoJsonPath, JSON.stringify(podcasts, null, 2));
  console.log('Nuevo episodio agregado:', { episodio, title, description, url });
}

main();
