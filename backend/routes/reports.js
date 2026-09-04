const router = require('express').Router();
const Student = require('../models/Student');
const Class = require('../models/Class');
const Payment = require('../models/Payment');
const ActivityLog = require('../models/ActivityLog');
const AcademicYear = require('../models/AcademicYear');
const { success, fail } = require('../helpers/response');
const { requireAuth } = require('../middleware/auth');
const { requireSchool, getSchoolId } = require('../middleware/school');
const { canPerform } = require('../middleware/role');

router.get('/dashboard', requireAuth, requireSchool, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) {
      return fail(res, 'No school assigned', 403);
    }

    if (!canPerform(req.user, 'view_reports')) {
      return fail(res, 'Insufficient permissions', 403);
    }

    const academicYear = await AcademicYear.findOne({ schoolId, status: 'active' });

    const studentQuery = { schoolId, status: 'active' };
    if (academicYear) {
      studentQuery.academicYearId = academicYear._id;
    }

    const totalStudents = await Student.countDocuments(studentQuery);

    const classesQuery = { schoolId };
    if (academicYear) {
      classesQuery.academicYearId = academicYear._id;
    }

    const totalClasses = await Class.countDocuments(classesQuery);
    const classes = await Class.find(classesQuery);

    let expectedRevenue = 0;
    for (const cls of classes) {
      const studentCount = await Student.countDocuments({
        ...studentQuery,
        classId: cls._id
      });
      expectedRevenue += studentCount * cls.unitFee;
    }

    const paymentQuery = { schoolId };
    if (academicYear) {
      const studentIds = (await Student.find(studentQuery).select('_id')).map(s => s._id);
      paymentQuery.studentId = { $in: studentIds };
    }

    const payments = await Payment.find(paymentQuery);
    const collectedRevenue = payments.reduce((sum, p) => sum + p.amount, 0);
    const remainingRevenue = expectedRevenue - collectedRevenue;

    const studentPayments = {};
    for (const payment of payments) {
      const sid = payment.studentId.toString();
      if (!studentPayments[sid]) studentPayments[sid] = 0;
      studentPayments[sid] += payment.amount;
    }

    let paidCount = 0;
    let partialCount = 0;
    let unpaidCount = 0;

    const allStudents = await Student.find(studentQuery).select('unitFee');
    for (const student of allStudents) {
      const paid = studentPayments[student._id.toString()] || 0;
      if (paid >= student.unitFee && student.unitFee > 0) {
        paidCount++;
      } else if (paid > 0) {
        partialCount++;
      } else {
        unpaidCount++;
      }
    }

    const collectionPercentage = expectedRevenue > 0
      ? Math.round((collectedRevenue / expectedRevenue) * 100)
      : 0;

    const classPerformance = [];
    for (const cls of classes) {
      const clsStudents = await Student.find({
        ...studentQuery,
        classId: cls._id
      }).select('_id unitFee');

      const clsStudentIds = clsStudents.map(s => s._id);
      const clsPayments = await Payment.find({
        schoolId,
        studentId: { $in: clsStudentIds }
      });

      const clsCollected = clsPayments.reduce((sum, p) => sum + p.amount, 0);
      const clsExpected = clsStudents.reduce((sum, s) => sum + s.unitFee, 0);

      classPerformance.push({
        classId: cls._id,
        className: cls.name,
        studentCount: clsStudents.length,
        expectedRevenue: clsExpected,
        collectedRevenue: clsCollected,
        percentage: clsExpected > 0 ? Math.round((clsCollected / clsExpected) * 100) : 0
      });
    }

    return success(res, {
      total_students: totalStudents,
      total_classes: totalClasses,
      expected_revenue: expectedRevenue,
      collected_revenue: collectedRevenue,
      remaining_revenue: remainingRevenue,
      paid_count: paidCount,
      partial_count: partialCount,
      unpaid_count: unpaidCount,
      collection_percentage: collectionPercentage,
      class_performance: classPerformance
    });
  } catch (error) {
    return fail(res, 'Failed to load dashboard', 500, { error: error.message });
  }
});

router.get('/activity', requireAuth, requireSchool, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) {
      return fail(res, 'No school assigned', 403);
    }

    if (!canPerform(req.user, 'view_activity_logs')) {
      return fail(res, 'Insufficient permissions', 403);
    }

    const query = { schoolId };
    const { search, year, term, class: className } = req.query;

    if (search) {
      query.$or = [
        { description: { $regex: search, $options: 'i' } },
        { userEmail: { $regex: search, $options: 'i' } },
        { studentName: { $regex: search, $options: 'i' } },
        { action: { $regex: search, $options: 'i' } }
      ];
    }

    if (year) {
      query.academicYear = year;
    }

    if (term) {
      query.term = term;
    }

    if (className) {
      query.className = className;
    }

    const logs = await ActivityLog.find(query)
      .sort({ createdAt: -1 })
      .limit(500);

    return success(res, logs);
  } catch (error) {
    return fail(res, 'Failed to fetch activity logs', 500, { error: error.message });
  }
});

router.get('/export', requireAuth, requireSchool, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) {
      return fail(res, 'No school assigned', 403);
    }

    if (!canPerform(req.user, 'view_reports')) {
      return fail(res, 'Insufficient permissions', 403);
    }

    const academicYear = await AcademicYear.findOne({ schoolId, status: 'active' });

    const studentQuery = { schoolId, status: 'active' };
    if (academicYear) {
      studentQuery.academicYearId = academicYear._id;
    }

    const classesQuery = { schoolId };
    if (academicYear) {
      classesQuery.academicYearId = academicYear._id;
    }

    const classes = await Class.find(classesQuery);
    const allStudents = await Student.find(studentQuery).populate('classId', 'name unitFee');

    const paymentQuery = { schoolId };
    if (academicYear) {
      const studentIds = allStudents.map(s => s._id);
      paymentQuery.studentId = { $in: studentIds };
    }

    const payments = await Payment.find(paymentQuery);

    const paymentsByStudent = {};
    for (const payment of payments) {
      const sid = payment.studentId.toString();
      if (!paymentsByStudent[sid]) paymentsByStudent[sid] = 0;
      paymentsByStudent[sid] += payment.amount;
    }

    const escapeCSV = (value) => {
      const str = String(value == null ? '' : value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return str;
    };

    const headers = [
      'Student ID',
      'Student Name',
      'Class',
      'Unit Fee',
      'Amount Paid',
      'Balance',
      'Status'
    ];

    const rows = [];
    rows.push(headers.map(escapeCSV).join(','));

    for (const student of allStudents) {
      const paid = paymentsByStudent[student._id.toString()] || 0;
      const balance = student.unitFee - paid;
      let status;
      if (paid >= student.unitFee && student.unitFee > 0) {
        status = 'Paid';
      } else if (paid > 0) {
        status = 'Partial';
      } else {
        status = 'Unpaid';
      }

      rows.push([
        escapeCSV(student.studentId),
        escapeCSV(student.name),
        escapeCSV(student.classId ? student.classId.name : ''),
        escapeCSV(student.unitFee),
        escapeCSV(paid),
        escapeCSV(balance),
        escapeCSV(status)
      ].join(','));
    }

    const csv = rows.join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="fees_report.csv"');
    return res.send(csv);
  } catch (error) {
    return fail(res, 'Failed to export report', 500, { error: error.message });
  }
});

module.exports = router;
