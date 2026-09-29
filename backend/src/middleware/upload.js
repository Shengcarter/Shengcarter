'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const ApiError = require('../utils/ApiError');

/**
 * Safe file uploads.
 *   - Only whitelisted extensions + MIME types are accepted.
 *   - The file content is checked against its magic bytes, so a renamed
 *     executable is rejected even if the extension and MIME type look fine.
 *   - Files are stored under random names (no user-controlled paths).
 */
const FILE_TYPES = {
  image: {
    '.jpg': { mime: ['image/jpeg'], magic: [[0xff, 0xd8, 0xff]] },
    '.jpeg': { mime: ['image/jpeg'], magic: [[0xff, 0xd8, 0xff]] },
    '.png': { mime: ['image/png'], magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]] },
    '.webp': { mime: ['image/webp'], magic: [[0x52, 0x49, 0x46, 0x46]], magicAt8: [0x57, 0x45, 0x42, 0x50] },
  },
  document: {
    '.pdf': { mime: ['application/pdf'], magic: [[0x25, 0x50, 0x44, 0x46]] },
  },
};

function allowedTypes(kinds) {
  return kinds.reduce((acc, kind) => ({ ...acc, ...FILE_TYPES[kind] }), {});
}

function matchesMagic(buffer, rule) {
  const ok = rule.magic.some((signature) => signature.every((byte, i) => buffer[i] === byte));
  if (!ok) return false;
  if (rule.magicAt8) return rule.magicAt8.every((byte, i) => buffer[8 + i] === byte);
  return true;
}

/**
 * Create a single-file upload middleware.
 * @param {string} folder  sub-folder of the upload directory (e.g. 'customers')
 * @param {string[]} kinds  'image' and/or 'document'
 */
function singleUpload(field, folder, kinds = ['image']) {
  const types = allowedTypes(kinds);
  const destination = path.join(config.paths.uploads, folder);

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
      fs.mkdir(destination, { recursive: true }, (err) => cb(err, destination));
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(16).toString('hex')}${ext}`);
    },
  });

  const uploader = multer({
    storage,
    limits: { fileSize: config.uploads.maxBytes, files: 1, fields: 20 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const rule = types[ext];
      if (!rule || !rule.mime.includes(file.mimetype)) {
        return cb(ApiError.validation([{
          field,
          message: `File type not allowed. Allowed: ${Object.keys(types).join(', ')}`,
        }]));
      }
      return cb(null, true);
    },
  }).single(field);

  return (req, res, next) => {
    uploader(req, res, (err) => {
      if (err) return next(err);
      if (!req.file) return next();

      const ext = path.extname(req.file.filename).toLowerCase();
      const fd = fs.openSync(req.file.path, 'r');
      const header = Buffer.alloc(16);
      fs.readSync(fd, header, 0, 16, 0);
      fs.closeSync(fd);

      if (!matchesMagic(header, types[ext])) {
        fs.unlink(req.file.path, () => {});
        return next(ApiError.validation([{ field, message: 'File content does not match its type' }]));
      }
      req.file.publicPath = `/uploads/${folder}/${req.file.filename}`;
      return next();
    });
  };
}

/** Delete a previously uploaded file given its public path. */
function removeUploadedFile(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return;
  const resolved = path.resolve(config.paths.uploads, publicPath.replace(/^\/uploads\//, ''));
  // Never delete outside the upload directory.
  if (!resolved.startsWith(path.resolve(config.paths.uploads) + path.sep)) return;
  fs.unlink(resolved, () => {});
}

module.exports = { singleUpload, removeUploadedFile };
