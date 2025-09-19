import 'dotenv/config';
import RSSParser from 'rss-parser';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { GoogleGenAI } from '@google/genai';
import wav from 'wav';
import fs from 'fs';
import cloudinaryLib from 'cloudinary';
import { createRestAPIClient } from 'masto';
import { randomUUID } from 'crypto';
import { RSS_FEEDS, GEMINI_API_KEY, CLOUDINARY_CONFIG, MASTODON_CONFIG } from './config.js';
import { execSync } from 'child_process';

const parser = new RSSParser();
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Cloudinary
const cloudinary = cloudinaryLib.v2;
cloudinary.config(CLOUDINARY_CONFIG);

// Mastodon
const masto = createRestAPIClient(MASTODON_CONFIG);

// ---- Utils
const hoursAgo = (h) => Date.now() - h * 3600_000;
const uniqueby = (arr, key) => [...new Map(arr.map(x => [key(x), x])).values()];

async function extractArticleText(url) {
  try {
    const res = await fetch(url, { redirect: 'follow' });
    const html = await res.text();
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    return article?.textContent?.trim() || '';
  } catch {
    return '';
  }
}

async function fetchRecentItems() {
  const cutoff = hoursAgo(24 * 7);
  const items = [];
  for (const feed of RSS_FEEDS) {
    try {
      const r = await parser.parseURL(feed);
      for (const it of r.items ?? []) {
        const pub = it.isoDate ? new Date(it.isoDate).getTime() : Date.now();
        if (pub >= cutoff) items.push({ title: it.title, link: it.link, summary: it.contentSnippet });
      }
    } catch { /* ignore feed errors */ }
  }
  // Dedupe por título o URL
  return uniqueby(items, x => x.link || x.title).slice(0, 6);
}

async function buildScript(stories) {
  // Enriquecer con texto del artículo si hace falta
  const enriched = [];
  for (const s of stories) {
    const body = s.summary && s.summary.length > 200 ? s.summary : await extractArticleText(s.link);
    enriched.push({ ...s, body: (body || '').slice(0, 4000) });
  }

  const prompt = `
Eres el guionista de "Startups y Café", un micro-podcast.
El objetivo es informar y motivar a emprendedores universitarios y de la comunidad de Chihuahua.
Escribe una charla natural entre dos anfitriones: Alex (entusiasta, visionario y es Speaker 1) y Eva (analítica, pragmática y es Speaker 2).
El tono debe ser informativo, accesible, y motivador, usando lenguaje claro y evitando jerga excesivamente técnica.

Reglas ESTRICTAS de formato de salida:
- La salida debe contener únicamente líneas que comiencen con “Speaker 1:” o “Speaker 2:”. No incluyas ningún otro texto.
- La primera línea debe ser exactamente:
Charla natural entre dos anfitriones: Alex (entusiasta, visionario y es Speaker 1) y Eva (analítica, pragmática y es Speaker 2).
El tono debe ser informativo, accesible, y motivador, usando lenguaje claro y evitando jerga excesivamente técnica.
Speaker 1: ¡Qué tal, comunidad emprendedora! Bienvenidos a un nuevo episodio de Startups y Café.
- No uses acotaciones, efectos de sonido, notas, encabezados, emojis o cualquier texto que no sea parte del diálogo.
- La última línea debe ser una despedida clara, por ejemplo:
Speaker 2: Gracias por acompañarnos. ¡Nos escuchamos en el próximo episodio con más del mundo de la innovación!

Aquí están las noticias de esta semana para discutir (título + resumen):
${enriched.map((s,i)=>`[${i+1}] ${s.title}\n${s.body || ''}`).join('\n\n')}
`;

  const resp = await ai.models.generateContent({
    model: 'gemini-2.5-pro',  // calidad para escritura
    contents: [{ role: 'user', parts: [{ text: prompt }]}],
  });
    return resp.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function ttsMultiSpeaker(scriptText, outFile='episode.wav') {
  // El modelo TTS entrega PCM 24k; lo guardamos a WAV.
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-preview-tts',
    contents: [{ parts: [{ text: `TTS esta conversación entre Alex y Eva:\n${scriptText}` }]}],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        multiSpeakerVoiceConfig: {
          speakerVoiceConfigs: [
            { speaker: 'Alex', voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
            { speaker: 'Eva',  voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Puck' } } },
          ],
        },
      },
    },
  });

  const b64 = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  const pcm = Buffer.from(b64, 'base64');

  await new Promise((resolve, reject) => {
    const writer = new wav.FileWriter(outFile, { channels: 1, sampleRate: 24000, bitDepth: 16 });
    writer.on('finish', resolve);
    writer.on('error', reject);
    writer.write(pcm);
    writer.end();
  });

  return outFile;
}

async function uploadToCloudinary(filepath, publicId) {
  // Audio se sube como resource_type "video"
  const res = await cloudinary.uploader.upload(filepath, {
    resource_type: 'video',
    folder: 'super-happy-dev',
    public_id: publicId,
    overwrite: true,
  });
  return res.secure_url;
}

async function postToMastodon(text, url) {
  const status = await masto.v1.statuses.create({
    status: `${text}\n\nEscúchalo aquí: ${url}`,
    visibility: 'public',
  });
  return status.url;
}

async function main() {
  console.log('Obteniendo noticias recientes...');
  const items = await fetchRecentItems();
  if (!items.length) throw new Error('No hay noticias recientes en los feeds configurados.');
  console.log('Generando guion del episodio...');
  const uuid = randomUUID();
  const script = await buildScript(items);
  // Guardar el guion generado en un archivo temporal
  const scriptPath = `episode-script-${uuid}.txt`;
  fs.writeFileSync(scriptPath, script);
  // Validar que el guion no esté vacío
  const guionTexto = fs.readFileSync(scriptPath, 'utf8').trim();
  if (!guionTexto) {
    throw new Error('El guion generado está vacío. No se puede continuar.');
  }
  console.log('Guion generado para el episodio:\n', guionTexto);
  console.log('Generando audio TTS...');
  const wavPath = await ttsMultiSpeaker(script, `episode-${uuid}.wav`);
  const dateTag = new Date().toISOString().slice(0,10);
  console.log('Subiendo episodio a Cloudinary...');
  const cdnUrl = await uploadToCloudinary(wavPath, `shd-${dateTag}-${uuid}`);

  // Usar Gemini para generar título y descripción basados en el guion guardado
  const resumenPrompt = `Lee el siguiente guion de podcast y, basándote únicamente en su contenido, genera un título corto (máx 8 palabras) y una descripción de una oración. Responde en JSON con las claves "titulo" y "descripcion". No inventes información, usa solo lo que está en el guion.\n\nGuion:\n${guionTexto}`;
  console.log('Prompt enviado a Gemini para título y descripción:\n', resumenPrompt);
  const resumenResp = await ai.models.generateContent({
    model: 'gemini-2.5-pro',
    contents: [{ role: 'user', parts: [{ text: resumenPrompt }]}],
  });
  const resumenTexto = resumenResp.candidates?.[0]?.content?.parts?.[0]?.text || '';
  console.log('Respuesta cruda de Gemini para título y descripción:\n', resumenTexto);
  let titulo = `Episodio ${dateTag}`;
  let descripcion = 'Un episodio más del podcast.';
  try {
    const resumenJson = JSON.parse(resumenTexto);
    if (resumenJson.titulo) titulo = resumenJson.titulo;
    if (resumenJson.descripcion) descripcion = resumenJson.descripcion;
  } catch (e) {
    console.warn('No se pudo parsear el JSON de Gemini, usando valores por defecto.');
  }

  // Guardar info en un JSON temporal para que update_podcasts_json.js lo lea
  const tempJsonPath = `episode-meta-${uuid}.json`;
  fs.writeFileSync(tempJsonPath, JSON.stringify({ url: cdnUrl, titulo, descripcion, guion: guionTexto }, null, 2));

  // Llamar al script para actualizar el JSON
  execSync(
    `EPISODE_META_JSON="${tempJsonPath}" node scripts/update_podcasts_json.js`,
    { stdio: 'inherit' }
  );

  // Elimina el archivo temporal
  fs.unlinkSync(tempJsonPath);
  fs.unlinkSync(scriptPath);

  console.log('Publicado en:', tootUrl);
  process.exit(0); // Finaliza el proceso exitosamente
}

main().catch(err => { console.error(err); process.exit(1); });
