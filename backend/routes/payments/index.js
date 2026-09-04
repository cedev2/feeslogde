const router = require('express').Router();
const Student = require('../../models/Student');
const Class = require('../../models/Class');
const Payment = require('../../models/Payment');
const AcademicYear = require('../../models/AcademicYear');
const Term = require('../../models/Term');
const School = require('../../models/School');
const { success, fail, getInput } = require('../../helpers/response');
const { validateId } = require('../../helpers/validation');
const { generateReceiptNumber } = require('../../helpers/security');
const { logActivity } = require('../../helpers/audit');
const { requireAuth } = require('../../middleware/auth');
const { canPerform } = require('../../middleware/role');
const { getSchoolId } = require('../../middleware/school');

// GET /api/payments/list
router.get('/list', requireAuth, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) return fail(res, 'School ID required', 403);

    const yearName = req.query.year || null;
    const termName = req.query.term || null;
    const studentId = req.query.student_id || null;

    const match = { schoolId };

    if (yearName) {
      const years = await AcademicYear.find({ schoolId, name: yearName }).distinct('_id');
      if (years.length > 0) {
        const studentIds = await Student.find({ academicYearId: { $in: years }, schoolId }).distinct('_id');
        match.studentId = { $in: studentIds };
      } else {
        match.studentId = '__none__';
      }
    }

    if (termName && termName !== 'All Terms') {
      const term = await Term.findOne({ name: termName }).lean();
      if (term) {
        match.termId = term._id;
      } else {
        match.termId = '__none__';
      }
    }

    if (studentId) {
      match.studentId = studentId;
    }

    const payments = await Payment.find(match)
      .sort({ paymentDate: -1 })
      .populate({ path: 'studentId', select: 'name studentId' })
      .populate({ path: 'classId', select: 'name' })
      .populate({ path: 'termId', select: 'name' })
      .populate({ path: 'recordedBy', select: 'email' })
      .lean();

    const formatted = payments.map(p => ({
      ...p,
      student_name: p.studentId && p.studentId.name ? p.studentId.name : '',
      student_id_text: p.studentId && p.studentId.studentId ? p.studentId.studentId : '',
      class_name: p.classId && p.classId.name ? p.classId.name : '',
      term_name: p.termId && p.termId.name ? p.termId.name : '',
      recorded_by_email: p.recordedBy && p.recordedBy.email ? p.recordedBy.email : ''
    }));

    return success(res, { payments: formatted });
  } catch (error) {
    return fail(res, 'Failed to load payments', 500, { error: error.message });
  }
});

// POST /api/payments/create
router.post('/create', requireAuth, async (req, res) => {
  try {
    if (!canPerform(req.user, 'manage_payments')) {
      return fail(res, 'Permission denied', 403);
    }

    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) return fail(res, 'School ID required', 403);

    const input = getInput(req);
    const studentDbId = input.student_id;
    const amount = parseFloat(input.amount) || 0;
    const method = input.method || 'cash';
    const termName = input.term || null;

    if (!studentDbId) return fail(res, 'Student is required');
    if (amount <= 0) return fail(res, 'Amount must be positive');
    if (!['cash', 'bank', 'mobile_money', 'card', 'other'].includes(method)) {
      return fail(res, 'Invalid payment method');
    }

    const student = await Student.findOne({ _id: studentDbId, schoolId })
      .populate({ path: 'classId', select: 'name _id' })
      .lean();
    if (!student) return fail(res, 'Student not found', 404);

    let termId = null;
    if (termName && termName !== 'All Terms') {
      const term = await Term.findOne({ name: termName })
        .populate({ path: 'academicYearId', match: { schoolId } })
        .lean();
      if (term && term.academicYearId) {
        termId = term._id;
      }
    }

    const paidAgg = await Payment.aggregate([
      { $match: { studentId: student._id, schoolId } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const alreadyPaid = paidAgg.length > 0 ? paidAgg[0].total : 0;

    const unitFee = student.unitFee || 0;
    if (unitFee > 0 && alreadyPaid + amount > unitFee) {
      return fail(res, `Amount exceeds remaining balance. Balance: ${(unitFee - alreadyPaid).toLocaleString()} FRW`);
    }

    const receiptNumber = generateReceiptNumber();
    const classId = student.classId ? student.classId._id : student.classId;

    const payment = await Payment.create({
      schoolId,
      studentId: studentDbId,
      classId,
      termId,
      amount,
      paymentMethod: method,
      receiptNumber,
      recordedBy: req.user._id,
      paymentDate: new Date()
    });

    await logActivity({
      action: 'payment_recorded',
      description: `${student.name} \u2014 ${amount.toLocaleString()} FRW`,
      schoolId,
      userId: req.user._id,
      userEmail: req.user.email,
      entityType: 'payment',
      entityId: 0,
      studentName: student.name,
      studentId: student.studentId,
      className: student.classId ? student.classId.name : '',
      ipAddress: req.ip
    });

    return success(res, {
      id: payment._id,
      receipt_number: receiptNumber,
      student_name: student.name,
      amount,
      method,
      date: new Date().toISOString().slice(0, 19).replace('T', ' ')
    });
  } catch (error) {
    return fail(res, 'Payment recording failed', 500, { error: error.message });
  }
});

// GET /api/payments/receipt?id=
router.get('/receipt', requireAuth, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) return fail(res, 'School ID required', 403);

    const studentId = req.query.id;
    if (!studentId) return fail(res, 'Student ID required');

    const student = await Student.findOne({ _id: studentId, schoolId })
      .populate({ path: 'classId', select: 'name' })
      .populate({ path: 'parentId', select: 'name email' })
      .lean();
    if (!student) return fail(res, 'Student not found', 404);

    const paidAgg = await Payment.aggregate([
      { $match: { studentId: student._id, schoolId } },
      { $group: { _id: null, total: { $sum: '$amount' } } }
    ]);
    const totalPaid = paidAgg.length > 0 ? paidAgg[0].total : 0;

    const lastPayment = await Payment.findOne({ studentId: student._id, schoolId })
      .sort({ paymentDate: -1 })
      .lean();

    const totalFees = student.unitFee || 0;
    const balance = Math.max(0, totalFees - totalPaid);

    let status = 'unpaid';
    if (totalFees > 0 && totalPaid >= totalFees) {
      status = 'paid';
    } else if (totalPaid > 0) {
      status = 'partial';
    }

    const school = await School.findById(schoolId)
      .select('name email phone logo')
      .lean();

    return success(res, {
      student: {
        ...student,
        class_name: student.classId ? student.classId.name : '',
        parent_name: student.parentId ? student.parentId.name : '',
        parent_email: student.parentId ? student.parentId.email : ''
      },
      school,
      total_fees: totalFees,
      total_paid: totalPaid,
      balance,
      status,
      last_payment: lastPayment,
      receipt_number: lastPayment
        ? lastPayment.receiptNumber
        : 'REC-' + String(Math.floor(Math.random() * 999999)).padStart(6, '0')
    });
  } catch (error) {
    return fail(res, 'Failed to load receipt data', 500, { error: error.message });
  }
});

module.exports = router;
