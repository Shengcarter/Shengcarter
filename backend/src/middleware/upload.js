'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const config = require('../config');
const logger = require('../config/logger');
const ApiError = require('../utils/ApiError');
const scanner = require('../services/malwareScanner');
const audit = require('../services/auditService');

/**
 * Safe file uploads.
 *   - Only whitelisted extensions + MIME types are accepted.
 *   - The file content is checked against its magic bytes, so a renamed
 *     executable is rejected even if the extension and MIME type look fine.
 *   - Files are stored under random names (no user-controlled paths).
 *   - With CLAMAV_HOST set, every file is scanned for viruses before it is
 *     kept; MALWARE_SCAN_REQUIRED=true refuses uploads while the scanner is down.
 *   - Expense receipts are private: served only through the API to people
 *     who may see expenses (PRIVATE_FOLDERS), never as public /uploads URLs.
 */
const PRIVATE_FOLDERS = ['expenses'];

/** Scan an upload; returns an ApiError to refuse it, or null to keep it. */
async function virusCheck(req, buffer, field, name) {
  if (!scanner.isEnabled()) return null;
  const result = await scanner.scan(buffer);
  if (result.status === 'clean') return null;
  if (result.status === 'infected') {
    logger.warn({ field, signature: result.signature, userId: req.user?.id, url: req.originalUrl }, 'Upload blocked by the virus scanner');
    await audit.record(req.ctx, {
      action: 'upload.malware_blocked', entityType: 'upload',
      description: `Blocked an uploaded file containing ${result.signature}`,
      metadata: { field, fileName: String(name || '').slice(0, 150), signature: result.signature, path: req.originalUrl },
    });
    return ApiError.validation([{ field, message: 'This file was rejected by the virus scanner and has not been saved.' }]);
  }
  logger.warn({ error: result.error }, 'Virus scanner unavailable');
  if (scanner.isRequired()) {
    return new ApiError(503, 'Uploads are paused because the virus scanner is not available. Try again in a few minutes or contact your administrator.', { code: 'SCANNER_UNAVAILABLE' });
  }
  return null;
}
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
      return virusCheck(req, fs.readFileSync(req.file.path), field, req.file.originalname).then((refusal) => {
        if (refusal) {
          fs.unlink(req.file.path, () => {});
          return next(refusal);
        }
        req.file.publicPath = `/uploads/${folder}/${req.file.filename}`;
        return next();
      }, (error) => {
        fs.unlink(req.file.path, () => {});
        next(error);
      });
    });
  };
}

/**
 * Absolute path of an uploaded file from its stored /uploads/… path, or null
 * if it would point outside the upload directory.
 */
function resolveUploadedFile(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return null;
  const root = path.resolve(config.paths.uploads);
  const resolved = path.resolve(root, publicPath.replace(/^\/uploads\//, ''));
  return resolved.startsWith(root + path.sep) ? resolved : null;
}

/** Delete a previously uploaded file given its public path. */
function removeUploadedFile(publicPath) {
  if (!publicPath || !publicPath.startsWith('/uploads/')) return;
  const resolved = path.resolve(config.paths.uploads, publicPath.replace(/^\/uploads\//, ''));
  // Never delete outside the upload directory.
  if (!resolved.startsWith(path.resolve(config.paths.uploads) + path.sep)) return;
  fs.unlink(resolved, () => {});
}

const XLSX_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // .xlsx is a ZIP package

/**
 * One .xlsx or .csv file for the import screens, kept in memory only (never
 * written to disk). Browsers report spreadsheet MIME types inconsistently
 * (Windows sends CSV as application/vnd.ms-excel), so the extension and the
 * content are checked instead: an .xlsx must start like a ZIP package and a
 * CSV must be text.
 */
function spreadsheetUpload(field = 'file') {
  const uploader = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.uploads.maxBytes, files: 1, fields: 10 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ext !== '.xlsx' && ext !== '.csv') {
        return cb(ApiError.validation([{ field, message: 'Choose an Excel workbook (.xlsx) or a CSV file (.csv). Older .xls files: open them in Excel and save as .xlsx.' }]));
      }
      return cb(null, true);
    },
  }).single(field);

  return (req, res, next) => {
    uploader(req, res, (err) => {
      if (err) return next(err);
      if (!req.file) return next();
      const ext = path.extname(req.file.originalname).toLowerCase();
      const bytes = req.file.buffer;
      const valid = ext === '.xlsx' ? bytes.subarray(0, 4).equals(XLSX_MAGIC) : !bytes.includes(0);
      if (!valid) return next(ApiError.validation([{ field, message: `This file is not a valid ${ext === '.xlsx' ? 'Excel workbook' : 'CSV text file'}.` }]));
      return virusCheck(req, bytes, field, req.file.originalname).then((refusal) => next(refusal || undefined), next);
    });
  };
}

module.exports = { singleUpload, spreadsheetUpload, removeUploadedFile, resolveUploadedFile, PRIVATE_FOLDERS };
