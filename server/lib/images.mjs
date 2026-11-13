import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.mjs';
import { HttpError } from './http.mjs';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

const MIME_BY_EXTENSION = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function decodeImage(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length < 32) {
    throw new HttpError(400, 'Image manquante ou illisible.', 'INVALID_IMAGE');
  }
  const match = /^data:([\w.+-]+\/[\w.+-]+);base64,([\s\S]+)$/i.exec(dataUrl);
  const base64 = match ? match[2] : dataUrl;
  let buffer;
  try {
    buffer = Buffer.from(base64, 'base64');
  } catch {
    throw new HttpError(400, 'Image illisible.', 'INVALID_IMAGE');
  }
  if (buffer.length < 128) {
    throw new HttpError(400, 'Image trop petite ou corrompue.', 'INVALID_IMAGE');
  }
  if (buffer.length > Math.min(MAX_IMAGE_BYTES, config.maxUploadBytes)) {
    throw new HttpError(413, 'Image trop volumineuse (4 Mo maximum).', 'IMAGE_TOO_LARGE');
  }

  let extension;
  let mime;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    extension = 'jpg';
    mime = 'image/jpeg';
  } else if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    extension = 'png';
    mime = 'image/png';
  } else if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    extension = 'webp';
    mime = 'image/webp';
  } else if (
    buffer.subarray(4, 8).toString('ascii') === 'ftyp' &&
    /heic|heix|hevc|mif1|msf1/.test(buffer.subarray(8, 16).toString('ascii'))
  ) {
    extension = 'heic';
    mime = 'image/heic';
  } else {
    throw new HttpError(400, 'Format d’image non pris en charge.', 'UNSUPPORTED_IMAGE');
  }

  return { buffer, extension, mime };
}

function removeImage(directory, relativePath) {
  if (!relativePath) return;
  try {
    fs.unlinkSync(path.join(directory, relativePath));
  } catch {
    // fichier déjà absent
  }
}

export function deleteImage(directory, relativePath) {
  removeImage(directory, relativePath);
}

/**
 * Écrit une image (data URL ou base64) dans `directory` sous `<baseName>.<ext>`
 * et renvoie le chemin relatif à conserver en base.
 */
export function writeImage(directory, baseName, dataUrl, previousPath) {
  const image = decodeImage(dataUrl);
  fs.mkdirSync(directory, { recursive: true });
  const relative = `${baseName}.${image.extension}`;
  fs.writeFileSync(path.join(directory, relative), image.buffer, { mode: 0o600 });

  if (previousPath && previousPath !== relative) {
    removeImage(directory, previousPath);
  }
  return relative;
}

/**
 * Lit une image stockée dans `directory`. Refuse tout chemin hors du dossier.
 */
export function readImage(directory, relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new HttpError(404, 'Image introuvable.', 'NOT_FOUND');
  }
  const root = path.resolve(directory);
  const absolute = path.resolve(root, relativePath);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new HttpError(404, 'Image introuvable.', 'NOT_FOUND');
  }

  let buffer;
  try {
    buffer = fs.readFileSync(absolute);
  } catch {
    throw new HttpError(404, 'Image introuvable sur le serveur.', 'NOT_FOUND');
  }

  const extension = path.extname(absolute).slice(1).toLowerCase();
  const mime = MIME_BY_EXTENSION[extension];
  if (!mime) throw new HttpError(404, 'Image introuvable.', 'NOT_FOUND');
  return { buffer, mime };
}
