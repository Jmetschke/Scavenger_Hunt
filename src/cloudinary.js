const cloudinary = require('cloudinary').v2;

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

const isConfigured = Boolean(cloudName && apiKey && apiSecret);

if (isConfigured) {
  cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
  });
}

function hasCloudinaryConfig() {
  return isConfigured;
}

async function uploadImageToCloudinary(buffer, filename, folderName = 'festival-scavenger-hunt') {
  if (!isConfigured) {
    throw new Error('Cloudinary is not configured. Add the Cloudinary environment variables.');
  }

  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: folderName,
        resource_type: 'image',
        public_id: `${Date.now()}-${String(filename || 'upload').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '-')}`,
        transformation: [{ quality: 'auto', fetch_format: 'auto' }],
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        if (!result || !result.secure_url || !result.public_id) {
          reject(new Error('Cloudinary returned an incomplete upload response.'));
          return;
        }

        resolve({
          image_url: result.secure_url,
          cloudinary_public_id: result.public_id,
        });
      }
    );

    stream.end(buffer);
  });
}

async function deleteCloudinaryImage(publicId) {
  if (!publicId) {
    return { result: 'not_found' };
  }

  if (!isConfigured) {
    return { result: 'skipped', reason: 'Cloudinary not configured' };
  }

  try {
    const result = await cloudinary.uploader.destroy(publicId);
    return result;
  } catch (error) {
    console.error('Cloudinary image deletion failed:', error.message || error);
    throw error;
  }
}

module.exports = {
  hasCloudinaryConfig,
  uploadImageToCloudinary,
  deleteCloudinaryImage,
};
