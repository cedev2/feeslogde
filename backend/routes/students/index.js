const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Student = require('../../models/Student');
const Parent = require('../../models/Parent');
const Class = require('../../models/Class');
const AcademicYear = require('../../models/AcademicYear');
const Payment = require('../../models/Payment');
const Trash = require('../../models/Trash');
const { success, fail, getInput } = require('../../helpers/response');
const { validateId, validateEmail } = require('../../helpers/validation');
const { logActivity } = require('../../helpers/audit');
const { trashItem } = require('../../helpers/trash');
const { requireAuth } = require('../../middleware/auth');
const { canPerform } = require('../../middleware/role');
const { getSchoolId } = require('../../middleware/school');

const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'students');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    cb(null, 'stu_' + require('crypto').randomBytes(12).toString('hex') + ext);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPG, PNG, GIF, WebP images allowed'));
    }
  }
}).single('photo');

// GET /api/students/list
router.get('/list', requireAuth, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) return fail(res, 'School ID required', 403);

    const search = (req.query.search || '').trim();
    const status = req.query.status || 'all';
    const yearName = req.query.year || null;
    const classId = req.query.class_id || null;
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 500));
    const offset = Math.max(0, parseInt(req.query.offset) || 0);

    const query = { schoolId, status: { $ne: 'deleted' } };

    if (search) {
      const regex = new RegExp(search, 'i');
      const matchingParentIds = await Parent.find({
        schoolId,
        $or: [{ name: regex }, { email: regex }]
      }).distinct('_id');

      query.$or = [
        { name: regex },
        { studentId: regex },
        { parentId: { $in: matchingParentIds } }
      ];
    }

    if (classId) {
      query.classId = classId;
    }

    let yearIds = null;
    if (yearName) {
      const years = await AcademicYear.find({ schoolId, name: yearName }).distinct('_id');
      yearIds = years;
      if (years.length > 0) {
        query.academicYearId = { $in: years };
      } else {
        query.academicYearId = '__none__';
      }
    }

    const totalCount = await Student.countDocuments(query);

    const students = await Student.find(query)
      .sort({ name: 1 })
      .skip(offset)
      .limit(limit)
      .lean();

    const enriched = [];
    for (const s of students) {
      const cls = await Class.findById(s.classId).select('name').lean();
      const parent = s.parentId ? await Parent.findById(s.parentId).select('name email phone').lean() : null;
      const year = await AcademicYear.findById(s.academicYearId).select('name').lean();

      const totalPaidAgg = await Payment.aggregate([
        { $match: { studentId: s._id, schoolId: s.schoolId } },
        { $group: { _id: null, total: { $sum: '$amount' } } }
      ]);
      const totalPaid = totalPaidAgg.length > 0 ? totalPaidAgg[0].total : 0;
      const balance = Math.max(0, (s.unitFee || 0) - totalPaid);

      let paymentStatus = 'unpaid';
      if (s.unitFee > 0 && totalPaid >= s.unitFee) {
        paymentStatus = 'paid';
      } else if (totalPaid > 0) {
        paymentStatus = 'partial';
      }

      enriched.push({
        ...s,
        class_name: cls ? cls.name : '',
        parent_name: parent ? parent.name : '',
        parent_email: parent ? parent.email : '',
        parent_phone: parent ? parent.phone : '',
        year_name: year ? year.name : '',
        total_paid: totalPaid,
        balance,
        payment_status: paymentStatus
      });
    }

    return success(res, { students: enriched, total: totalCount });
  } catch (error) {
    return fail(res, 'Failed to load students', 500, { error: error.message });
  }
});

// POST /api/students/create
router.post('/create', requireAuth, async (req, res) => {
  try {
    if (!canPerform(req.user, 'manage_students')) {
      return fail(res, 'Permission denied', 403);
    }

    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) return fail(res, 'School ID required', 403);

    const input = getInput(req);
    const name = (input.name || '').trim();
    const studentId = (input.student_id || '').trim();
    const gender = input.gender || null;
    const classId = input.class_id;
    const parentName = (input.parent_name || '').trim();
    const parentEmail = (input.parent_email || '').toLowerCase().trim();
    const parentPhone = (input.parent_phone || '').trim();
    const photo = input.photo || '';
    const id = input.id || null;

    const errors = {};
    if (!name) errors.name = 'Student name is required';
    if (!studentId) errors.student_id = 'Student ID is required';
    if (!classId) errors.class_id = 'Class is required';
    if (parentEmail && !validateEmail(parentEmail)) errors.parent_email = 'Valid parent email is required';
    if (Object.keys(errors).length > 0) {
      return fail(res, 'Validation failed', 422, errors);
    }

    const cls = await Class.findOne({ _id: classId, schoolId }).lean();
    if (!cls) return fail(res, 'Class not found', 404);

    const unitFee = cls.unitFee || 0;
    const yearId = cls.academicYearId;

    let parentId = null;
    if (parentEmail) {
      let existingParent = await Parent.findOne({ schoolId, email: parentEmail });
      if (existingParent) {
        parentId = existingParent._id;
        existingParent.name = parentName || existingParent.name;
        existingParent.phone = parentPhone || existingParent.phone;
        await existingParent.save();
      }
    } else if (parentPhone) {
      let existingParent = await Parent.findOne({ schoolId, phone: parentPhone });
      if (existingParent) {
        parentId = existingParent._id;
        existingParent.name = parentName || existingParent.name;
        existingParent.email = parentEmail || existingParent.email;
        await existingParent.save();
      }
    }

    if (!parentId) {
      const newParent = await Parent.create({
        schoolId,
        name: parentName || 'Parent',
        email: parentEmail,
        phone: parentPhone
      });
      parentId = newParent._id;
    }

    if (id) {
      const existing = await Student.findOne({ _id: id, schoolId });
      if (!existing) return fail(res, 'Student not found', 404);

      existing.name = name;
      existing.studentId = studentId;
      existing.gender = gender;
      existing.classId = classId;
      existing.parentId = parentId;
      existing.unitFee = unitFee;
      existing.photo = photo;
      await existing.save();

      await logActivity({
        action: 'student_updated',
        description: name,
        schoolId,
        userId: req.user._id,
        userEmail: req.user.email,
        entityType: 'student',
        entityId: 0,
        studentName: name,
        studentId,
        ipAddress: req.ip
      });

      return success(res, { id: existing._id, name, student_id: studentId, class_id: classId, parent_id: parentId });
    } else {
      const duplicate = await Student.findOne({ schoolId, academicYearId: yearId, studentId });
      if (duplicate) {
        return fail(res, 'A student with this ID already exists in this academic year', 409);
      }

      const newStudent = await Student.create({
        schoolId,
        academicYearId: yearId,
        classId,
        parentId,
        studentId,
        name,
        gender,
        photo,
        unitFee,
        status: 'active'
      });

      await logActivity({
        action: 'student_registered',
        description: name,
        schoolId,
        userId: req.user._id,
        userEmail: req.user.email,
        entityType: 'student',
        entityId: 0,
        studentName: name,
        studentId,
        ipAddress: req.ip
      });

      return success(res, { id: newStudent._id, name, student_id: studentId, class_id: classId, parent_id: parentId });
    }
  } catch (error) {
    return fail(res, 'Failed to save student', 500, { error: error.message });
  }
});

// POST /api/students/delete
router.post('/delete', requireAuth, async (req, res) => {
  try {
    if (!canPerform(req.user, 'manage_students')) {
      return fail(res, 'Permission denied', 403);
    }

    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) return fail(res, 'School ID required', 403);

    const input = getInput(req);
    const id = input.id;
    if (!id) return fail(res, 'Student ID required');

    const student = await Student.findOne({ _id: id, schoolId }).lean();
    if (!student) return fail(res, 'Student not found', 404);

    await Student.findByIdAndUpdate(id, { status: 'deleted' });

    await trashItem({
      schoolId,
      entityType: 'student',
      entityId: id.toString(),
      name: student.name,
      data: student,
      userId: req.user._id
    });

    await logActivity({
      action: 'student_deleted',
      description: `${student.name} moved to trash`,
      schoolId,
      userId: req.user._id,
      userEmail: req.user.email,
      entityType: 'student',
      entityId: 0,
      studentName: student.name,
      studentId: student.studentId,
      ipAddress: req.ip
    });

    return success(res, { message: 'Student moved to trash' });
  } catch (error) {
    return fail(res, 'Failed to delete student', 500, { error: error.message });
  }
});

// POST /api/students/import
router.post('/import', requireAuth, async (req, res) => {
  try {
    if (!canPerform(req.user, 'manage_students')) {
      return fail(res, 'Permission denied', 403);
    }

    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) return fail(res, 'School ID required', 403);

    const input = getInput(req);
    const names = input.names || [];
    const classId = input.class_id;
    const yearName = input.year || `${new Date().getFullYear()}\u2013${new Date().getFullYear() + 1}`;

    if (!names || !Array.isArray(names) || names.length === 0) {
      return fail(res, 'Names array is required');
    }
    if (!classId) return fail(res, 'Class is required');

    const cls = await Class.findOne({ _id: classId, schoolId }).lean();
    if (!cls) return fail(res, 'Class not found', 404);

    let year = await AcademicYear.findOne({ schoolId, name: yearName });
    if (!year) {
      year = await AcademicYear.create({ schoolId, name: yearName, status: 'active' });
    }
    const yearId = year._id;

    const uniqueNames = [...new Set(names.map(n => (n || '').trim()).filter(n => n.length > 0))];

    let added = 0;
    let duplicates = 0;

    for (const name of uniqueNames) {
      const existing = await Student.findOne({
        schoolId,
        classId,
        academicYearId: yearId,
        name: { $regex: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      });

      if (existing) {
        duplicates++;
        continue;
      }

      const count = await Student.countDocuments({ schoolId, classId, academicYearId: yearId });
      const num = count + 1;
      const genId = `${cls.name}-${String(num).padStart(3, '0')}`;

      await Student.create({
        schoolId,
        academicYearId: yearId,
        classId,
        studentId: genId,
        name,
        gender: null,
        photo: '',
        unitFee: cls.unitFee || 0,
        status: 'active'
      });
      added++;
    }

    await logActivity({
      action: 'students_import',
      description: `${added} students imported to ${cls.name}`,
      schoolId,
      userId: req.user._id,
      userEmail: req.user.email,
      entityType: 'class',
      entityId: 0,
      ipAddress: req.ip
    });

    return success(res, { added, duplicates, errors: 0 });
  } catch (error) {
    return fail(res, 'Import failed', 500, { error: error.message });
  }
});

// POST /api/students/photo
router.post('/photo', requireAuth, async (req, res) => {
  try {
    if (!canPerform(req.user, 'manage_students')) {
      return fail(res, 'Permission denied', 403);
    }

    const schoolId = getSchoolId(req.user, req);

    upload(req, res, async (err) => {
      if (err) {
        return fail(res, err.message || 'Upload error');
      }

      if (!req.file) {
        return fail(res, 'No photo uploaded');
      }

      const url = 'uploads/students/' + req.file.filename;

      const studentId = req.body.student_id;
      if (studentId) {
        await Student.findOneAndUpdate(
          { _id: studentId, schoolId },
          { photo: url }
        );
      }

      return success(res, { url });
    });
  } catch (error) {
    return fail(res, 'Failed to upload photo', 500, { error: error.message });
  }
});

// GET /api/students/history?id=
router.get('/history', requireAuth, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) return fail(res, 'School ID required', 403);

    const studentId = req.query.id;
    if (!studentId) return fail(res, 'Student ID required');

    const student = await Student.findOne({ _id: studentId, schoolId })
      .select('name')
      .lean();
    if (!student) return fail(res, 'Student not found', 404);

    const payments = await Payment.find({ studentId, schoolId })
      .sort({ paymentDate: -1 })
      .populate('termId', 'name')
      .populate('recordedBy', 'email')
      .lean();

    return success(res, { student, payments });
  } catch (error) {
    return fail(res, 'Failed to load payment history', 500, { error: error.message });
  }
});

module.exports = router;
