const sharp = require('sharp');

const MAX_PROCESSED_BYTES = 9.5 * 1024 * 1024;
const PROCESSING_ATTEMPTS = [
  { maxDimension: 2000, quality: 82 },
  { maxDimension: 1800, quality: 75 },
  { maxDimension: 1600, quality: 68 },
];

async function optimizeImage(buffer) {
  const source = sharp(buffer, { failOn: 'error' });
  const metadata = await source.metadata();
  if (!metadata.width || !metadata.height || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
    throw new Error('This image format is not supported. Please use a JPG, PNG, or WebP photo.');
  }

  for (const attempt of PROCESSING_ATTEMPTS) {
    const result = await sharp(buffer, { failOn: 'error' })
      .rotate()
      .resize({
        width: attempt.maxDimension,
        height: attempt.maxDimension,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: attempt.quality, progressive: true, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });

    if (result.data.length < MAX_PROCESSED_BYTES) {
      const finalMetadata = await sharp(result.data).metadata();
      console.info(`Photo optimized: ${Math.round(buffer.length / 1024 / 1024 * 10) / 10} MB -> ${Math.round(result.data.length / 1024 / 1024 * 10) / 10} MB (${metadata.width}x${metadata.height} -> ${finalMetadata.width}x${finalMetadata.height})`);
      return result.data;
    }
  }

  throw new Error('This image could not be compressed below the 10MB upload limit. Please choose a smaller photo.');
}

module.exports = { MAX_PROCESSED_BYTES, optimizeImage };