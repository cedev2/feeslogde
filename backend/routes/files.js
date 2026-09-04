const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const SavedFile = require('../models/SavedFile');
const Trash = require('../models/Trash');
const { success, fail } = require('../helpers/response');
const { getFileCategory, getMaxFileSize } = require('../helpers/security');
const { logActivity } = require('../helpers/audit');
const { trashItem } = require('../helpers/trash');
const { requireAuth } = require('../middleware/auth');
const { requireSchool, getSchoolId } = require('../middleware/school');

const MAX_USER_FILES = 100;
const MAX_USER_STORAGE = 500 * 1024 * 1024;

const uploadsRoot = path.join(__dirname, '..', 'uploads', 'files');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tmpDir = path.join(__dirname, '..', 'uploads', 'tmp');
    fs.mkdirSync(tmpDir, { recursive: true });
    cb(null, tmpDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }
});

router.post('/upload', requireAuth, requireSchool, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return fail(res, 'No file uploaded', 400);
    }

    const schoolId = getSchoolId(req.user, req);
    const category = getFileCategory(req.file.originalname, req.file.mimetype);
    const maxSize = getMaxFileSize(category);

    if (req.file.size > maxSize) {
      fs.unlinkSync(req.file.path);
      const maxMB = Math.round(maxSize / (1024 * 1024));
      return fail(res, `File exceeds maximum size of ${maxMB}MB for ${category} files`, 413);
    }

    const fileCount = await SavedFile.countDocuments({ userId: req.user._id });
    if (fileCount >= MAX_USER_FILES) {
      fs.unlinkSync(req.file.path);
      return fail(res, `You have reached the maximum limit of ${MAX_USER_FILES} files`, 413);
    }

    const userFiles = await SavedFile.find({ userId: req.user._id }).select('fileSize');
    const totalSize = userFiles.reduce((sum, f) => sum + f.fileSize, 0) + req.file.size;
    if (totalSize > MAX_USER_STORAGE) {
      fs.unlinkSync(req.file.path);
      const usedMB = Math.round(totalSize / (1024 * 1024));
      return fail(res, `Storage limit exceeded. Using ${usedMB}MB of 500MB`, 413);
    }

    const userDir = path.join(uploadsRoot, req.user._id.toString());
    fs.mkdirSync(userDir, { recursive: true });

    const finalFilename = Date.now() + '-' + req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const finalPath = path.join(userDir, finalFilename);
    fs.renameSync(req.file.path, finalPath);

    const relativePath = path.relative(path.join(__dirname, '..'), finalPath);

    const savedFile = await SavedFile.create({
      schoolId,
      userId: req.user._id,
      displayName: req.body.display_name || req.body.displayName || req.file.originalname,
      originalName: req.file.originalname,
      filePath: relativePath,
      mimeType: req.file.mimetype,
      fileSize: req.file.size,
      category,
      academicYear: req.body.year || req.body.academicYear || '',
      term: req.body.term || '',
      day: req.body.day || ''
    });

    await logActivity({
      action: 'file_uploaded',
      description: `File "${savedFile.displayName}" uploaded`,
      schoolId,
      userId: req.user._id,
      userEmail: req.user.email,
      entityType: 'file',
      entityId: 0,
      ipAddress: req.ip
    });

    return success(res, savedFile, 201);
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    return fail(res, 'Failed to upload file', 500, { error: error.message });
  }
});

router.get('/list', requireAuth, requireSchool, async (req, res) => {
  try {
    const trashedFileIds = (await Trash.find({
      userId: req.user._id,
      entityType: 'file'
    }).select('entityId')).map(t => t.entityId);

    const files = await SavedFile.find({
      userId: req.user._id,
      _id: { $nin: trashedFileIds }
    }).sort({ createdAt: -1 });

    return success(res, { files });
  } catch (error) {
    return fail(res, 'Failed to fetch files', 500, { error: error.message });
  }
});

router.post('/delete', requireAuth, requireSchool, async (req, res) => {
  try {
    const { id } = req.body;

    if (!id) {
      return fail(res, 'File ID is required', 422, { id: 'File ID is required' });
    }

    const schoolId = getSchoolId(req.user, req);
    const file = await SavedFile.findOne({ _id: id, userId: req.user._id });
    if (!file) {
      return fail(res, 'File not found', 404);
    }

    const fileData = file.toObject();

    await trashItem({
      schoolId,
      userId: req.user._id,
      entityType: 'file',
      entityId: 0,
      name: file.displayName,
      data: fileData
    });

    await file.deleteOne();

    await logActivity({
      action: 'file_deleted',
      description: `File "${file.displayName}" moved to trash`,
      schoolId,
      userId: req.user._id,
      userEmail: req.user.email,
      entityType: 'file',
      entityId: 0,
      ipAddress: req.ip
    });

    return success(res, { message: 'File moved to trash' });
  } catch (error) {
    return fail(res, 'Failed to delete file', 500, { error: error.message });
  }
});

router.post('/rename', requireAuth, requireSchool, async (req, res) => {
  try {
    const { id, display_name, displayName } = req.body;
    const name = display_name || displayName;

    if (!id) {
      return fail(res, 'File ID is required', 422, { id: 'File ID is required' });
    }

    if (!name || name.trim() === '') {
      return fail(res, 'Display name is required', 422, { displayName: 'Display name is required' });
    }

    const file = await SavedFile.findOne({ _id: id, userId: req.user._id });
    if (!file) {
      return fail(res, 'File not found', 404);
    }

    file.displayName = name.trim();
    await file.save();

    return success(res, file);
  } catch (error) {
    return fail(res, 'Failed to rename file', 500, { error: error.message });
  }
});

router.get('/download', requireAuth, requireSchool, async (req, res) => {
  try {
    const { id } = req.query;

    if (!id) {
      return fail(res, 'File ID is required', 422, { id: 'File ID is required' });
    }

    const file = await SavedFile.findOne({ _id: id, userId: req.user._id });
    if (!file) {
      return fail(res, 'File not found', 404);
    }

    const fullPath = path.join(__dirname, '..', file.filePath);
    if (!fs.existsSync(fullPath)) {
      return fail(res, 'File not found on disk', 404);
    }

    await logActivity({
      action: 'file_downloaded',
      description: `File "${file.displayName}" downloaded`,
      schoolId: file.schoolId,
      userId: req.user._id,
      userEmail: req.user.email,
      entityType: 'file',
      entityId: 0,
      ipAddress: req.ip
    });

    return res.download(fullPath, file.originalName);
  } catch (error) {
    return fail(res, 'Failed to download file', 500, { error: error.message });
  }
});

module.exports = router;
