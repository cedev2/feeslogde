const router = require('express').Router();
const AcademicYear = require('../models/AcademicYear');
const Term = require('../models/Term');
const { success, fail, getInput } = require('../helpers/response');
const { validateRequired } = require('../helpers/validation');
const { logActivity } = require('../helpers/audit');
const { requireAuth } = require('../middleware/auth');
const { requireSchool, getSchoolId } = require('../middleware/school');

router.get('/config', requireAuth, requireSchool, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) {
      return fail(res, 'No school assigned', 403);
    }

    const query = { schoolId };
    if (req.query.year) {
      query._id = req.query.year;
    }

    const years = await AcademicYear.find(query).sort({ createdAt: -1 });

    const yearsWithTerms = await Promise.all(
      years.map(async (year) => {
        const terms = await Term.find({ academicYearId: year._id }).sort({ startDate: 1 });
        return {
          ...year.toObject(),
          terms
        };
      })
    );

    return success(res, yearsWithTerms);
  } catch (error) {
    return fail(res, 'Failed to fetch academic config', 500, { error: error.message });
  }
});

router.post('/config', requireAuth, requireSchool, async (req, res) => {
  try {
    const input = getInput(req);
    const errors = validateRequired(input, ['name']);
    if (Object.keys(errors).length > 0) {
      return fail(res, 'Validation failed', 422, errors);
    }

    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) {
      return fail(res, 'No school assigned', 403);
    }

    let year;
    let isNew = false;

    if (input.id) {
      year = await AcademicYear.findOne({ _id: input.id, schoolId });
      if (!year) {
        return fail(res, 'Academic year not found', 404);
      }

      year.name = input.name;
      if (input.status) year.status = input.status;
      await year.save();
    } else {
      const existing = await AcademicYear.findOne({ schoolId, name: input.name });
      if (existing) {
        return fail(res, 'Academic year with this name already exists', 409);
      }

      year = await AcademicYear.create({
        schoolId,
        name: input.name,
        status: input.status || 'active'
      });
      isNew = true;
    }

    if (input.terms && Array.isArray(input.terms)) {
      for (const termData of input.terms) {
        if (!termData.name) continue;

        if (termData.id) {
          const term = await Term.findOne({ _id: termData.id, academicYearId: year._id });
          if (term) {
            term.name = termData.name;
            if (termData.startDate) term.startDate = new Date(termData.startDate);
            if (termData.endDate) term.endDate = new Date(termData.endDate);
            await term.save();
          }
        } else {
          const existingTerm = await Term.findOne({
            academicYearId: year._id,
            name: termData.name
          });
          if (!existingTerm) {
            await Term.create({
              academicYearId: year._id,
              name: termData.name,
              startDate: termData.startDate ? new Date(termData.startDate) : null,
              endDate: termData.endDate ? new Date(termData.endDate) : null
            });
          }
        }
      }
    }

    const terms = await Term.find({ academicYearId: year._id }).sort({ startDate: 1 });

    await logActivity({
      action: isNew ? 'academic_year_created' : 'academic_year_updated',
      description: `Academic year "${year.name}" ${isNew ? 'created' : 'updated'}`,
      schoolId,
      userId: req.user._id,
      userEmail: req.user.email,
      entityType: 'academic_year',
      entityId: 0,
      ipAddress: req.ip
    });

    return success(res, { ...year.toObject(), terms }, isNew ? 201 : 200);
  } catch (error) {
    return fail(res, 'Failed to save academic config', 500, { error: error.message });
  }
});

router.get('/list', requireAuth, requireSchool, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) {
      return fail(res, 'No school assigned', 403);
    }

    const years = await AcademicYear.find({ schoolId }).sort({ createdAt: -1 });

    return success(res, years);
  } catch (error) {
    return fail(res, 'Failed to fetch academic years', 500, { error: error.message });
  }
});

router.get('/terms', requireAuth, requireSchool, async (req, res) => {
  try {
    const schoolId = getSchoolId(req.user, req);
    if (!schoolId) {
      return fail(res, 'No school assigned', 403);
    }

    const { year } = req.query;
    if (!year) {
      return fail(res, 'Academic year ID is required', 422, { year: 'Academic year ID is required' });
    }

    const academicYear = await AcademicYear.findOne({ _id: year, schoolId });
    if (!academicYear) {
      return fail(res, 'Academic year not found', 404);
    }

    const terms = await Term.find({ academicYearId: year }).sort({ startDate: 1 });

    return success(res, terms);
  } catch (error) {
    return fail(res, 'Failed to fetch terms', 500, { error: error.message });
  }
});

module.exports = router;
